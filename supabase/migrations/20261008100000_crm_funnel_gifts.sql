-- CRM completo (2026-10-05): embudo «abierta», regalos manuales y agradecimientos.
-- Contrato: lib/crm/contract.ts · Handoff: docs/handoffs/2026-10-05-crm/datos.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto: la ordena y aplica el coordinador.
-- Aplicar ANTES de desplegar el código que la usa (guest_page devuelve columnas nuevas
-- y el código nuevo las exige; el código antiguo las ignora).
--
-- Reglas de producto (contrato):
--  * El regalo es una ANOTACIÓN privada de la pareja. No es un cobro, no avisa al
--    invitado y nunca aparece en vistas públicas (wedding_sites_public y
--    weddings_public no se tocan).
--  * Asistencia, regalo y pago son dimensiones independientes. Las columnas
--    antiguas wedding_guests.gift_status / amount_cents (20260708170000, flujo de
--    aportaciones dormido) NO son esto y no se leen aquí.
--  * «Abierta» = primera vez que el invitado abre SU enlace personal activo.
begin;

-- ============================================================ embudo: abierta
alter table public.wedding_guests
  add column invitation_opened_at timestamptz,
  add column gift_none boolean not null default false;
comment on column public.wedding_guests.invitation_opened_at is
  'Primera apertura del enlace personal por el invitado (no se sobrescribe). La escribe solo guest_invitation_opened (service_role). Regenerar el enlace NO la borra: es «la primera vez que abrió su invitación».';
comment on column public.wedding_guests.gift_none is
  'La pareja marcó «sin regalo» explícitamente. Si el invitado tiene algún regalo anotado, manda el regalo.';

-- wedding_guests tiene grant de update a nivel de tabla (20260930210000): un
-- privilegio de columna no puede retirarlo. Trigger de respaldo, mismo patrón
-- que weddings_slug_immutable: la pareja no puede fabricar aperturas.
create or replace function public.wedding_guests_opened_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invitation_opened_at is distinct from old.invitation_opened_at
     and current_user in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'invitation_opened_at_readonly',
      hint = 'La apertura la registra el servidor cuando el invitado abre su enlace.';
  end if;
  return new;
end;
$$;
revoke all on function public.wedding_guests_opened_guard() from public, anon, authenticated;
create trigger wedding_guests_opened_guard
  before update of invitation_opened_at on public.wedding_guests
  for each row execute function public.wedding_guests_opened_guard();

-- Resultado (texto, nunca lanza por datos del visitante):
--   ok           primera apertura registrada ahora
--   already      ya estaba registrada (se conserva la primera)
--   owner        quien abre es la propia pareja (vista previa): no cuenta
--   invalid      slug o hash con formato incorrecto
--   unavailable  boda inexistente o token inexistente/revocado/de otra boda
--   withdrawn    la pareja retiró la web
-- Mismas comprobaciones de disponibilidad que guest_rsvp_respond (sin plazo:
-- abrir fuera de plazo sigue siendo abrir).
create or replace function public.guest_invitation_opened(
  p_slug text,
  p_token_hash text,
  p_viewer_id uuid default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_couple_id uuid;
  v_guest_id uuid;
  v_published_at timestamptz;
  v_revision uuid;
  v_rows integer;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return 'invalid';
  end if;

  select w.id, w.couple_id into v_wedding_id, v_couple_id
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if p_viewer_id is not null and p_viewer_id = v_couple_id then return 'owner'; end if;

  update public.wedding_guests g
     set invitation_opened_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id and g.invitation_opened_at is null;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'ok' else 'already' end;
end;
$$;
comment on function public.guest_invitation_opened(text, text, uuid) is
  'Registra la primera apertura del enlace personal (token activo de esa boda, web no retirada, no la pareja). Solo service_role.';
revoke all on function public.guest_invitation_opened(text, text, uuid) from public, anon, authenticated;
grant execute on function public.guest_invitation_opened(text, text, uuid) to service_role;

-- ================================================================== regalos
create table public.wedding_gifts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  kind text not null check (kind in ('transferencia', 'bizum', 'efectivo', 'lista', 'objeto', 'experiencia', 'otro')),
  amount_cents integer check (amount_cents between 0 and 10000000),
  description text check (char_length(description) <= 200),
  note text check (char_length(note) <= 500),
  received_on date,
  thanked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MONETARY_GIFT_KINDS: solo en estos tiene sentido un importe.
  constraint wedding_gifts_amount_monetary check (amount_cents is null or kind in ('transferencia', 'bizum', 'efectivo')),
  constraint wedding_gifts_id_wedding_key unique (id, wedding_id)
);
comment on table public.wedding_gifts is
  'Regalos que la pareja ANOTA a mano (privado). No es un cobro ni un pago de Vinklo; nunca se expone al invitado. Cada regalo tiene ≥ 1 invitado (wedding_gift_givers).';
create index wedding_gifts_wedding_idx on public.wedding_gifts (wedding_id, created_at, id);

create table public.wedding_gift_givers (
  gift_id uuid not null,
  guest_id uuid not null,
  wedding_id uuid not null,
  primary key (gift_id, guest_id),
  -- FKs compuestas: regalo e invitado son, por construcción, de la MISMA boda.
  foreign key (gift_id, wedding_id) references public.wedding_gifts (id, wedding_id) on delete cascade,
  foreign key (guest_id, wedding_id) references public.wedding_guests (id, wedding_id) on delete cascade
);
comment on table public.wedding_gift_givers is
  'Quién hizo cada regalo (uno o varios invitados de la misma boda). Borrar al último invitado de un regalo borra el regalo.';
create index wedding_gift_givers_guest_idx on public.wedding_gift_givers (guest_id);
create index wedding_gift_givers_wedding_idx on public.wedding_gift_givers (wedding_id);

create or replace function public.wedding_gifts_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.wedding_gifts_touch_updated_at() from public, anon, authenticated;
create trigger wedding_gifts_touch_updated_at
  before update on public.wedding_gifts
  for each row execute function public.wedding_gifts_touch_updated_at();

-- ≥ 1 invitado por regalo, en dos mitades:
--  a) Al crear: comprobación DIFERIDA al final de la transacción (la RPC inserta
--     el regalo y luego sus invitados). Un insert suelto por la Data API sin
--     invitados falla al confirmar.
--  b) Al quitar invitados: si un regalo se queda sin ninguno (p. ej. la pareja
--     borra al único invitado que lo hizo), el regalo se borra con él.
--     Decisión: un regalo sin nadie a quien agradecerlo no tiene sentido en el
--     CRM, y bloquear el borrado del invitado sorprendería más. La interfaz
--     debe avisar antes de borrar a un invitado con regalos.
create or replace function public.wedding_gifts_require_giver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.wedding_gifts g where g.id = new.id)
     and not exists (select 1 from public.wedding_gift_givers gg where gg.gift_id = new.id) then
    raise exception using
      errcode = '23514',
      message = 'wedding_gift_requires_giver',
      hint = 'Cada regalo necesita al menos un invitado.';
  end if;
  return null;
end;
$$;
revoke all on function public.wedding_gifts_require_giver() from public, anon, authenticated;
create constraint trigger wedding_gifts_require_giver
  after insert on public.wedding_gifts
  deferrable initially deferred
  for each row execute function public.wedding_gifts_require_giver();

create or replace function public.wedding_gift_givers_drop_orphan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wedding_gift_givers gg where gg.gift_id = old.gift_id) then
    delete from public.wedding_gifts g where g.id = old.gift_id;
  end if;
  return null;
end;
$$;
revoke all on function public.wedding_gift_givers_drop_orphan() from public, anon, authenticated;
create trigger wedding_gift_givers_drop_orphan
  after delete on public.wedding_gift_givers
  for each row execute function public.wedding_gift_givers_drop_orphan();

alter table public.wedding_gifts enable row level security;
create policy "wedding_gifts_select_couple" on public.wedding_gifts for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_gifts_insert_couple" on public.wedding_gifts for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_gifts_update_couple" on public.wedding_gifts for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_gifts_delete_couple" on public.wedding_gifts for delete
  to authenticated using (public.owns_wedding(wedding_id));

alter table public.wedding_gift_givers enable row level security;
create policy "wedding_gift_givers_select_couple" on public.wedding_gift_givers for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_gift_givers_insert_couple" on public.wedding_gift_givers for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_gift_givers_delete_couple" on public.wedding_gift_givers for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- Patrón 20261005100000: nada implícito, columnas explícitas. Sin anon.
-- id, wedding_id, created_at y updated_at no se actualizan por la Data API.
revoke all on public.wedding_gifts from public, anon, authenticated;
grant select, delete on public.wedding_gifts to authenticated;
grant insert (wedding_id, kind, amount_cents, description, note, received_on)
  on public.wedding_gifts to authenticated;
grant update (kind, amount_cents, description, note, received_on, thanked_at)
  on public.wedding_gifts to authenticated;
grant all on public.wedding_gifts to service_role;

revoke all on public.wedding_gift_givers from public, anon, authenticated;
grant select, delete on public.wedding_gift_givers to authenticated;
grant insert (gift_id, guest_id, wedding_id) on public.wedding_gift_givers to authenticated;
grant all on public.wedding_gift_givers to service_role;

-- Crear regalo + invitados en UNA llamada (invoker: RLS y grants mandan).
-- null = boda ajena, invitados ajenos/inexistentes/repetidos o lista vacía.
-- Quita «sin regalo» de quienes lo hicieron (ya no es verdad).
create or replace function public.create_wedding_gift(
  p_wedding_id uuid,
  p_guest_ids uuid[],
  p_kind text,
  p_amount_cents integer,
  p_description text,
  p_note text,
  p_received_on date
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_n integer := coalesce(pg_catalog.cardinality(p_guest_ids), 0);
begin
  if v_n < 1 or v_n > 50 or p_wedding_id is null or not public.owns_wedding(p_wedding_id) then
    return null;
  end if;
  if (select count(distinct x) from pg_catalog.unnest(p_guest_ids) x) <> v_n
     or (select count(*) from public.wedding_guests g
          where g.wedding_id = p_wedding_id and g.id = any (p_guest_ids)) <> v_n then
    return null;
  end if;

  insert into public.wedding_gifts (wedding_id, kind, amount_cents, description, note, received_on)
  values (p_wedding_id, p_kind, p_amount_cents, p_description, p_note, p_received_on)
  returning id into v_id;
  insert into public.wedding_gift_givers (gift_id, guest_id, wedding_id)
  select v_id, x, p_wedding_id from pg_catalog.unnest(p_guest_ids) x;
  update public.wedding_guests g set gift_none = false
   where g.wedding_id = p_wedding_id and g.id = any (p_guest_ids) and g.gift_none;
  return v_id;
end;
$$;
revoke all on function public.create_wedding_gift(uuid, uuid[], text, integer, text, text, date) from public, anon;
grant execute on function public.create_wedding_gift(uuid, uuid[], text, integer, text, text, date) to authenticated, service_role;

-- Editar datos + sustituir invitados en UNA llamada. Primero se añaden los
-- nuevos y luego se quitan los sobrantes: el regalo nunca pasa por 0 invitados
-- (si no, el trigger de huérfanos lo borraría). false = no existe/ajeno o lista inválida.
create or replace function public.update_wedding_gift(
  p_gift_id uuid,
  p_guest_ids uuid[],
  p_kind text,
  p_amount_cents integer,
  p_description text,
  p_note text,
  p_received_on date
) returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_wedding uuid;
  v_n integer := coalesce(pg_catalog.cardinality(p_guest_ids), 0);
begin
  if v_n < 1 or v_n > 50 then return false; end if;
  select g.wedding_id into v_wedding from public.wedding_gifts g where g.id = p_gift_id for update;
  if v_wedding is null or not public.owns_wedding(v_wedding) then return false; end if;
  if (select count(distinct x) from pg_catalog.unnest(p_guest_ids) x) <> v_n
     or (select count(*) from public.wedding_guests g
          where g.wedding_id = v_wedding and g.id = any (p_guest_ids)) <> v_n then
    return false;
  end if;

  update public.wedding_gifts g
     set kind = p_kind, amount_cents = p_amount_cents, description = p_description,
         note = p_note, received_on = p_received_on
   where g.id = p_gift_id;
  insert into public.wedding_gift_givers (gift_id, guest_id, wedding_id)
  select p_gift_id, x, v_wedding from pg_catalog.unnest(p_guest_ids) x
  on conflict (gift_id, guest_id) do nothing;
  delete from public.wedding_gift_givers gg
   where gg.gift_id = p_gift_id and not (gg.guest_id = any (p_guest_ids));
  update public.wedding_guests g set gift_none = false
   where g.wedding_id = v_wedding and g.id = any (p_guest_ids) and g.gift_none;
  return true;
end;
$$;
revoke all on function public.update_wedding_gift(uuid, uuid[], text, integer, text, text, date) from public, anon;
grant execute on function public.update_wedding_gift(uuid, uuid[], text, integer, text, text, date) to authenticated, service_role;

-- Lista de regalos con sus invitados (jsonb ordenado por nombre).
create or replace function public.wedding_gift_list(p_wedding_id uuid)
returns table(id uuid, kind text, amount_cents integer, description text, note text,
  received_on date, thanked_at timestamptz, created_at timestamptz, givers jsonb)
language sql stable security invoker set search_path = '' as $$
  select f.id, f.kind, f.amount_cents, f.description, f.note, f.received_on, f.thanked_at, f.created_at,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('guestId', g.id, 'name', g.name) order by g.name, g.id)
                from public.wedding_gift_givers gg join public.wedding_guests g on g.id = gg.guest_id
               where gg.gift_id = f.id), '[]'::jsonb)
  from public.wedding_gifts f
  join public.weddings w on w.id = f.wedding_id
  where f.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
  order by f.received_on desc nulls last, f.created_at desc, f.id;
$$;
revoke all on function public.wedding_gift_list(uuid) from public, anon;
grant execute on function public.wedding_gift_list(uuid) to authenticated, service_role;

-- ================================================ plantilla de agradecimiento
-- kind 'thanks': no lleva enlace. Variables {nombre} y {novios} (contrato).
-- Misma regla en validateTemplate(body, kind) (lib/messages/templates.ts).
alter table public.wedding_message_templates drop constraint wedding_message_templates_kind_check;
alter table public.wedding_message_templates add constraint wedding_message_templates_kind_check
  check (kind in ('invitation', 'reminder', 'thanks'));
alter table public.wedding_message_templates drop constraint wedding_message_templates_body;
alter table public.wedding_message_templates add constraint wedding_message_templates_body check (
  char_length(body) between 1 and 1000
  and case when kind = 'thanks'
    then regexp_replace(body, '\{(nombre|novios)\}', '', 'g') !~ '[{}]'
    else position('{enlace}' in body) > 0
      and regexp_replace(body, '\{(nombre|enlace|novios|fecha)\}', '', 'g') !~ '[{}]'
  end
);

-- ====================================================== filtros de la lista
-- Se añaden claves; las existentes no cambian.
--   enviada_sin_abrir      sin respuesta, enviada, sin abrir
--   abierta_sin_responder  sin respuesta, abierta
--   con_regalo             algún regalo anotado
--   sin_regalo             marcado «sin regalo» y ninguno anotado
--   regalo_sin_indicar     ni regalo ni «sin regalo»
--   sin_agradecer          algún regalo suyo sin agradecer
create or replace function public.guest_in_filter(g public.wedding_guests, p_filter text)
returns boolean language sql stable set search_path = '' as $$
  select case p_filter
    when 'todos' then true
    when 'sin_enviar' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is null
    when 'esperando' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
    when 'para_recordar' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and not g.reminders_opt_out and public.whatsapp_number(g.phone) is not null
      and (g.last_reminder_at is null or g.last_reminder_at < pg_catalog.now() - interval '3 days')
    when 'vienen' then g.rsvp_status = 'si'
    when 'no_vienen' then g.rsvp_status = 'no'
    when 'sin_telefono' then public.whatsapp_number(g.phone) is null
    when 'con_notas' then coalesce(pg_catalog.btrim(g.rsvp_notes), '') <> ''
    when 'sin_respuesta' then g.rsvp_status = 'pendiente'
    when 'enviada_sin_abrir' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and g.invitation_opened_at is null
    when 'abierta_sin_responder' then g.rsvp_status = 'pendiente' and g.invitation_opened_at is not null
    when 'con_regalo' then exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'sin_regalo' then g.gift_none
      and not exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'regalo_sin_indicar' then not g.gift_none
      and not exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'sin_agradecer' then exists (
      select 1 from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
       where gg.guest_id = g.id and f.thanked_at is null)
    else false
  end;
$$;

-- Recuentos: cambia el tipo de retorno → drop + create (y grants de nuevo).
drop function public.guest_filter_counts(uuid);
create function public.guest_filter_counts(p_wedding_id uuid)
returns table(todos bigint, sin_enviar bigint, esperando bigint, para_recordar bigint,
  vienen bigint, no_vienen bigint, sin_telefono bigint, con_notas bigint, sin_respuesta bigint,
  enviada_sin_abrir bigint, abierta_sin_responder bigint, con_regalo bigint, sin_regalo bigint,
  regalo_sin_indicar bigint, sin_agradecer bigint)
language sql stable security invoker set search_path = '' as $$
  select count(g.id),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_enviar')),
    count(g.id) filter (where public.guest_in_filter(g, 'esperando')),
    count(g.id) filter (where public.guest_in_filter(g, 'para_recordar')),
    count(g.id) filter (where public.guest_in_filter(g, 'vienen')),
    count(g.id) filter (where public.guest_in_filter(g, 'no_vienen')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_telefono')),
    count(g.id) filter (where public.guest_in_filter(g, 'con_notas')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_respuesta')),
    count(g.id) filter (where public.guest_in_filter(g, 'enviada_sin_abrir')),
    count(g.id) filter (where public.guest_in_filter(g, 'abierta_sin_responder')),
    count(g.id) filter (where public.guest_in_filter(g, 'con_regalo')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_regalo')),
    count(g.id) filter (where public.guest_in_filter(g, 'regalo_sin_indicar')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_agradecer'))
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;
revoke all on function public.guest_filter_counts(uuid) from public, anon;
grant execute on function public.guest_filter_counts(uuid) to authenticated, service_role;

-- Página de la lista (y CSV) + campos del CRM por invitado.
drop function public.guest_page(uuid, text, text, integer, integer);
create function public.guest_page(p_wedding_id uuid, p_filter text, p_search text,
  p_limit integer, p_offset integer)
returns table(id uuid, name text, phone text, rsvp_status text, rsvp_companions integer,
  rsvp_notes text, source text, invitation_prepared_at timestamptz, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, reminders_opt_out boolean,
  created_at timestamptz, invitation_opened_at timestamptz, gift_none boolean,
  gift_count bigint, gift_unthanked boolean, gift_total_cents bigint, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.source,
    g.invitation_prepared_at, g.invitation_sent_at, g.last_reminder_at, g.reminder_count,
    g.reminders_opt_out, g.created_at, g.invitation_opened_at, g.gift_none,
    gs.gift_count, gs.gift_unthanked, gs.gift_total_cents, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  cross join lateral (
    select count(f.id) as gift_count,
      coalesce(bool_or(f.thanked_at is null), false) as gift_unthanked,
      coalesce(sum(f.amount_cents), 0)::bigint as gift_total_cents
    from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
    where gg.guest_id = g.id
  ) gs
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
    and public.guest_in_filter(g, p_filter)
    and (coalesce(p_search, '') = '' or position(lower(p_search) in lower(g.name)) > 0)
  order by g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 100), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.guest_page(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.guest_page(uuid, text, text, integer, integer) to authenticated, service_role;

-- ================================================================ agregados
-- Invoker + couple_id explícito (como attendance_summary): boda ajena o sin
-- sesión = 0 filas; boda sin invitados = una fila de ceros.
-- Etapa ALCANZADA (acumulada): respondida ⊂ abierta ⊂ enviada ⊂ preparada ⊂ añadida,
-- tomando la señal más avanzada (quien respondió cuenta como abierta/enviada aunque
-- la pareja no confirmara el envío).
-- Pendientes (rsvp 'pendiente') en tres cubos disjuntos que suman el total pendiente.
-- to_remind = filtro «para_recordar» (enviada, sin «no recordar», teléfono válido,
-- sin recordatorio en 3 días) ∧ abierta ∧ enviada hace ≥ 3 días: el número del
-- embudo nunca contradice al chip ni a la fila de recordatorios.
create or replace function public.crm_funnel_summary(p_wedding_id uuid)
returns table(added bigint, prepared bigint, sent bigint, opened bigint, responded bigint,
  yes bigint, no bigint, attendees bigint, not_sent bigint, sent_unopened bigint,
  opened_unanswered bigint, to_remind bigint)
language sql stable security invoker set search_path = '' as $$
  select count(g.id),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null
      or g.invitation_sent_at is not null or g.invitation_prepared_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null
      or g.invitation_sent_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente'),
    count(g.id) filter (where g.rsvp_status = 'si'),
    count(g.id) filter (where g.rsvp_status = 'no'),
    (count(g.id) filter (where g.rsvp_status = 'si')
      + coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint,
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_sent_at is null
      and g.invitation_opened_at is null),
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and g.invitation_opened_at is null),
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_opened_at is not null),
    count(g.id) filter (where public.guest_in_filter(g, 'para_recordar')
      and g.invitation_opened_at is not null
      and g.invitation_sent_at <= pg_catalog.now() - interval '3 days')
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;
revoke all on function public.crm_funnel_summary(uuid) from public, anon;
grant execute on function public.crm_funnel_summary(uuid) to authenticated, service_role;

-- by_kind: objeto {kind: {count, totalCents}} solo con los tipos presentes
-- (el código rellena el resto con ceros).
create or replace function public.crm_gift_summary(p_wedding_id uuid)
returns table(gift_count bigint, total_cents bigint, with_amount bigint, unthanked bigint,
  by_kind jsonb, guests_yes bigint, guests_no bigint, guests_unknown bigint)
language sql stable security invoker set search_path = '' as $$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  ), f as (
    select f.* from public.wedding_gifts f join w on w.id = f.wedding_id
  ), k as (
    select f.kind, count(*) as n, coalesce(sum(f.amount_cents), 0)::bigint as cents from f group by f.kind
  ), g as (
    select g.gift_none,
      exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id) as has_gift
    from public.wedding_guests g join w on w.id = g.wedding_id
  )
  select
    (select count(*) from f),
    (select coalesce(sum(f.amount_cents), 0)::bigint from f),
    (select count(*) from f where f.amount_cents is not null),
    (select count(*) from f where f.thanked_at is null),
    (select coalesce(pg_catalog.jsonb_object_agg(k.kind, pg_catalog.jsonb_build_object('count', k.n, 'totalCents', k.cents)), '{}'::jsonb) from k),
    (select count(*) from g where g.has_gift),
    (select count(*) from g where not g.has_gift and g.gift_none),
    (select count(*) from g where not g.has_gift and not g.gift_none)
  from w;
$$;
revoke all on function public.crm_gift_summary(uuid) from public, anon;
grant execute on function public.crm_gift_summary(uuid) to authenticated, service_role;

commit;
