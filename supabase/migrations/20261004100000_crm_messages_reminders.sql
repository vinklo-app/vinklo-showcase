-- CRM: plantillas de mensaje, recordatorios preparados y filtros por tarea (2026-10-04).
-- Plan: docs/handoffs/2026-10-03-v2/plan-crm-mensajes.md · Contrato: docs/handoffs/2026-10-04-crm-mensajes/datos.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto: la ordena y aplica el coordinador.
--
-- Todo se envía desde el móvil de la pareja (wa.me + confirmación manual).
-- Nada aquí registra entrega ni lectura: last_reminder_at es «la pareja dice
-- que lo ha enviado», igual que invitation_sent_at.
begin;

-- ======================================================= plantillas de mensaje
-- Sin fila = texto por defecto del código (lib/messages/templates.ts).
create table public.wedding_message_templates (
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  kind text not null check (kind in ('invitation', 'reminder')),
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (wedding_id, kind),
  -- Misma regla que validateTemplate (TS): 1..1000 caracteres, {enlace}
  -- obligatorio y, quitando las cuatro variables conocidas, ninguna llave suelta.
  constraint wedding_message_templates_body check (
    char_length(body) between 1 and 1000
    and position('{enlace}' in body) > 0
    and regexp_replace(body, '\{(nombre|enlace|novios|fecha)\}', '', 'g') !~ '[{}]'
  )
);
comment on table public.wedding_message_templates is
  'Textos de WhatsApp editados por la pareja (invitation, reminder). Se envían desde su móvil vía wa.me; Vinklo nunca envía.';

alter table public.wedding_message_templates enable row level security;
create policy "wedding_message_templates_select_couple" on public.wedding_message_templates for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_message_templates_insert_couple" on public.wedding_message_templates for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_message_templates_update_couple" on public.wedding_message_templates for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_message_templates_delete_couple" on public.wedding_message_templates for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- Patrón 20260907 / wedding_sites: nada implícito, columnas explícitas.
revoke all on public.wedding_message_templates from public, anon, authenticated;
grant select, delete on public.wedding_message_templates to authenticated;
grant insert (wedding_id, kind, body) on public.wedding_message_templates to authenticated;
grant update (body, updated_at) on public.wedding_message_templates to authenticated;
grant all on public.wedding_message_templates to service_role;

-- ================================================== recordatorios por invitado
-- Columnas en wedding_guests (no tabla aparte): relación 1:1, la fila de
-- recordatorios y los recuentos las leen en el mismo recorrido y el índice
-- parcial las cubre. wedding_guests ya tiene grant de update a nivel de tabla
-- (20260930210000): son datos de la propia pareja acotados por RLS; el
-- incremento atómico va por confirm_guest_reminder.
alter table public.wedding_guests
  add column last_reminder_at timestamptz,
  add column reminder_count integer not null default 0 check (reminder_count between 0 and 1000),
  add column reminders_opt_out boolean not null default false;
comment on column public.wedding_guests.last_reminder_at is
  'Último recordatorio que la pareja CONFIRMA haber enviado desde su WhatsApp. No es entrega ni lectura.';

create index wedding_guests_wedding_rsvp_idx on public.wedding_guests (wedding_id, rsvp_status);
create index wedding_guests_reminder_queue_idx
  on public.wedding_guests (wedding_id, invitation_sent_at, id)
  where rsvp_status = 'pendiente' and not reminders_opt_out and invitation_sent_at is not null;

-- ======================================================= teléfono para wa.me
-- Copia exacta de whatsappNumber (lib/invitation-sharing.ts). Mismo oráculo de
-- números en lib/invitation-sharing.test.ts y tests/sql/crm-mensajes.sql.
create or replace function public.whatsapp_number(p_phone text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when c ~ '^[67][0-9]{8}$' then '34' || c
    when i ~ '^[1-9][0-9]{9,14}$' then i
  end
  from (select c, case when left(c, 1) = '+' then substr(c, 2)
                       when left(c, 2) = '00' then substr(c, 3)
                       else c end as i
        from (select pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phone, ''), E' \t\n\r\f\v'),
                                               -- chr(160) = NBSP: llega al pegar números; JS \s lo quita.
                                               '[[:space:]' || pg_catalog.chr(160) || '().-]', '', 'g') as c) s) t;
$$;
revoke all on function public.whatsapp_number(text) from public, anon;
grant execute on function public.whatsapp_number(text) to authenticated, service_role;

-- ======================================================== filtros por tarea
-- ÚNICO predicado para recuentos, página, fila de recordatorios y CSV: cada
-- chip devuelve exactamente lo que dice su recuento por construcción.
-- Claves: todos · sin_enviar · esperando · para_recordar · vienen · no_vienen ·
-- sin_telefono · con_notas · sin_respuesta (= antiguo status=pendiente).
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
    else false
  end;
$$;
revoke all on function public.guest_in_filter(public.wedding_guests, text) from public, anon;
grant execute on function public.guest_in_filter(public.wedding_guests, text) to authenticated, service_role;

-- Recuentos de los chips. Invoker + couple_id explícito (como attendance_summary):
-- boda ajena o sin sesión = 0 filas.
create or replace function public.guest_filter_counts(p_wedding_id uuid)
returns table(todos bigint, sin_enviar bigint, esperando bigint, para_recordar bigint,
  vienen bigint, no_vienen bigint, sin_telefono bigint, con_notas bigint, sin_respuesta bigint)
language sql stable security invoker set search_path = '' as $$
  select count(g.id),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_enviar')),
    count(g.id) filter (where public.guest_in_filter(g, 'esperando')),
    count(g.id) filter (where public.guest_in_filter(g, 'para_recordar')),
    count(g.id) filter (where public.guest_in_filter(g, 'vienen')),
    count(g.id) filter (where public.guest_in_filter(g, 'no_vienen')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_telefono')),
    count(g.id) filter (where public.guest_in_filter(g, 'con_notas')),
    count(g.id) filter (where public.guest_in_filter(g, 'sin_respuesta'))
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;

-- Página de la lista (y CSV): filtro + búsqueda por nombre sin comodines,
-- orden estable (created_at, id) y total del filtro en cada fila.
create or replace function public.guest_page(p_wedding_id uuid, p_filter text, p_search text,
  p_limit integer, p_offset integer)
returns table(id uuid, name text, phone text, rsvp_status text, rsvp_companions integer,
  rsvp_notes text, source text, invitation_prepared_at timestamptz, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, reminders_opt_out boolean,
  created_at timestamptz, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.source,
    g.invitation_prepared_at, g.invitation_sent_at, g.last_reminder_at, g.reminder_count,
    g.reminders_opt_out, g.created_at, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
    and public.guest_in_filter(g, p_filter)
    and (coalesce(p_search, '') = '' or position(lower(p_search) in lower(g.name)) > 0)
  order by g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 100), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Fila de recordatorios: quien menos recientemente se contactó, primero.
create or replace function public.reminder_queue(p_wedding_id uuid, p_limit integer default 200)
returns table(id uuid, name text, phone text, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.invitation_sent_at, g.last_reminder_at, g.reminder_count, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
    and public.guest_in_filter(g, 'para_recordar')
  order by coalesce(g.last_reminder_at, g.invitation_sent_at), g.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- Declaración de la pareja: «lo he enviado desde mi WhatsApp». Incremento
-- atómico; una segunda pulsación en 60 s no suma. Exige invitación enviada.
-- 0 filas = invitado ajeno, inexistente o sin invitación enviada.
create or replace function public.confirm_guest_reminder(p_guest_id uuid)
returns table(last_reminder_at timestamptz, reminder_count integer)
language sql volatile security invoker set search_path = '' as $$
  update public.wedding_guests g
     set last_reminder_at = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                                 then g.last_reminder_at else pg_catalog.now() end,
         reminder_count = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                               then g.reminder_count else g.reminder_count + 1 end
    from public.weddings w
   where g.id = p_guest_id and w.id = g.wedding_id and w.couple_id = (select auth.uid())
     and g.invitation_sent_at is not null
  returning g.last_reminder_at, g.reminder_count;
$$;

revoke all on function public.guest_filter_counts(uuid) from public, anon;
revoke all on function public.guest_page(uuid, text, text, integer, integer) from public, anon;
revoke all on function public.reminder_queue(uuid, integer) from public, anon;
revoke all on function public.confirm_guest_reminder(uuid) from public, anon;
grant execute on function public.guest_filter_counts(uuid) to authenticated, service_role;
grant execute on function public.guest_page(uuid, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.reminder_queue(uuid, integer) to authenticated, service_role;
grant execute on function public.confirm_guest_reminder(uuid) to authenticated, service_role;


-- ================================================ varios enlaces por invitado
-- Decisión del coordinador (2026-10-04): el enlace del primer mensaje NO puede
-- dejar de funcionar al enviar un recordatorio. Cada enlace es un token
-- aleatorio de 256 bits guardado solo como SHA-256. El recordatorio AÑADE un
-- token; «Regenerar enlace» revoca todos y crea uno. La respuesta (RSVP) busca
-- el invitado por cualquier token activo de ESA boda.
--
-- wedding_guests.invitation_token_hash se conserva SOLO por compatibilidad con
-- el código ya desplegado mientras llega el nuevo (lo sigue escribiendo
-- «Regenerar»). Ya no autoriza nada en el código nuevo. Borrarla en una
-- migración posterior, tras desplegar.
alter table public.wedding_guests
  add constraint wedding_guests_id_wedding_key unique (id, wedding_id);

create table public.wedding_guest_tokens (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null,
  wedding_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- FK compuesta: el token no puede apuntar a un invitado de otra boda.
  foreign key (guest_id, wedding_id) references public.wedding_guests (id, wedding_id) on delete cascade
);
create index wedding_guest_tokens_active_guest_idx on public.wedding_guest_tokens (guest_id) where revoked_at is null;
comment on table public.wedding_guest_tokens is
  'Enlaces personales activos/revocados. Solo hash SHA-256; el token en claro nunca se guarda. Escritura solo vía issue_guest_token (definer) y RSVP con service_role.';

-- Backfill: el enlace vigente de cada invitado sigue funcionando.
insert into public.wedding_guest_tokens (guest_id, wedding_id, token_hash, created_at)
select g.id, g.wedding_id, g.invitation_token_hash, coalesce(g.invitation_prepared_at, g.updated_at, now())
from public.wedding_guests g
where g.invitation_token_hash is not null;
-- Invitados con enlace anterior a 20261002 (sin marca de preparada): se marca
-- para que «confirmar envío» siga disponible.
update public.wedding_guests set invitation_prepared_at = coalesce(updated_at, now())
where invitation_token_hash is not null and invitation_prepared_at is null;

alter table public.wedding_guest_tokens enable row level security;
-- Sin políticas ni grants para anon/authenticated: la pareja no lee ni escribe
-- hashes por la Data API. Única vía de escritura: issue_guest_token.
revoke all on public.wedding_guest_tokens from public, anon, authenticated;
grant all on public.wedding_guest_tokens to service_role;

-- Emite un enlace para un invitado de la boda del usuario.
--   p_mode 'regenerate': revoca todos los activos, crea uno, marca preparada y
--                        quita «enviada» (mismo comportamiento que antes).
--   p_mode 'reminder'  : añade uno sin revocar nada; exige invitación enviada;
--                        no toca preparada/enviada.
-- 0 filas = invitado ajeno/inexistente, recordatorio sin envío o datos
-- inválidos (misma respuesta: no enumera).
create or replace function public.issue_guest_token(p_guest_id uuid, p_token_hash text, p_mode text)
returns table(token_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding uuid;
  v_sent timestamptz;
  v_now timestamptz := pg_catalog.now();
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_mode not in ('regenerate', 'reminder') then
    return;
  end if;
  select g.wedding_id, g.invitation_sent_at into v_wedding, v_sent
    from public.wedding_guests g join public.weddings w on w.id = g.wedding_id
   where g.id = p_guest_id and w.couple_id = (select auth.uid())
   for update of g;
  if v_wedding is null then return; end if;

  if p_mode = 'reminder' then
    if v_sent is null then return; end if;
  else
    update public.wedding_guest_tokens t set revoked_at = v_now
     where t.guest_id = p_guest_id and t.revoked_at is null;
    update public.wedding_guests g
       set invitation_token_hash = p_token_hash, invitation_prepared_at = v_now, invitation_sent_at = null
     where g.id = p_guest_id;
  end if;

  return query
    insert into public.wedding_guest_tokens (guest_id, wedding_id, token_hash, created_at)
    values (p_guest_id, v_wedding, p_token_hash, v_now)
    returning id;
end;
$$;
revoke all on function public.issue_guest_token(uuid, text, text) from public, anon;
grant execute on function public.issue_guest_token(uuid, text, text) to authenticated, service_role;

commit;
