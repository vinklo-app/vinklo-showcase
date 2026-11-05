-- Autoría de la nota del invitado (integración 8-oct-2026).
--
-- wedding_guests.rsvp_notes la escriben DOS personas: el invitado (alergias,
-- desde su enlace) y la pareja (desde la ficha del CRM, a veces apuntes
-- privados). guest_rsvp_current (20261021100000) devolvía la nota al
-- invitado al reabrir su enlace: habría visto los apuntes de la pareja.
--
--  * rsvp_notes_by_guest boolean: true solo si la última nota la escribió el
--    invitado. Las existentes quedan en false (no se enseñan: lo seguro).
--  * Trigger: cualquier cambio de la nota fuera de guest_rsvp_respond (la
--    pareja, importaciones, SQL) la marca como de la pareja.
--  * guest_rsvp_respond (6 args): mismo cuerpo que 20261021110000; marca la
--    autoría y, si el invitado deja la nota en blanco, no borra la de la pareja.
--  * guest_rsvp_current: mismo cuerpo; solo devuelve la nota del invitado.
-- Aditiva: el código actual no lee ni escribe la columna nueva.
begin;

alter table public.wedding_guests
  add column if not exists rsvp_notes_by_guest boolean not null default false;
comment on column public.wedding_guests.rsvp_notes_by_guest is
  'true si rsvp_notes la escribió el invitado desde su enlace (se le puede enseñar); false si es de la pareja.';

create or replace function public.wedding_guests_notes_owner()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.rsvp_notes is distinct from old.rsvp_notes
     and coalesce(pg_catalog.current_setting('vinklo.guest_rsvp_write', true), '') <> 'on' then
    new.rsvp_notes_by_guest := false;
  end if;
  return new;
end;
$$;
revoke all on function public.wedding_guests_notes_owner() from public, anon, authenticated;

drop trigger if exists wedding_guests_notes_owner on public.wedding_guests;
create trigger wedding_guests_notes_owner
  before update of rsvp_notes on public.wedding_guests
  for each row execute function public.wedding_guests_notes_owner();

create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text,
  p_answers jsonb
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_wedding_date date;
  v_rsvp_deadline date;
  v_guest_id uuid;
  v_token_created timestamptz;
  v_published_at timestamptz;
  v_revision uuid;
  v_max_companions smallint;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_notes is not null and pg_catalog.char_length(p_notes) > 500)
     or (p_answers is not null and (pg_catalog.jsonb_typeof(p_answers) <> 'object' or pg_catalog.octet_length(p_answers::text) > 4096)) then
    return 'invalid';
  end if;

  select w.id, w.wedding_date, w.rsvp_deadline into v_wedding_id, v_wedding_date, v_rsvp_deadline
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  -- Localiza el invitado (sin lock: aún no conocemos la fila a bloquear).
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  -- 1) Lock del invitado: mismo primer lock que issue_guest_token.
  select g.max_companions into v_max_companions from public.wedding_guests g
    where g.id = v_guest_id and g.wedding_id = v_wedding_id
    for update;
  if not found then return 'unavailable'; end if;

  -- 2) Re-lectura del token bajo el lock (snapshot nuevo) + FOR SHARE: una
  --    revocación confirmada mientras esperábamos ya es visible aquí.
  select t.created_at into v_token_created
    from public.wedding_guest_tokens t
   where t.token_hash = p_token_hash and t.wedding_id = v_wedding_id
     and t.guest_id = v_guest_id and t.revoked_at is null
   for share;
  if not found then return 'unavailable'; end if;

  -- 3) Web retirada (publicada alguna vez y sin revisión vigente).
  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id
    for share;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_rsvp_deadline, v_token_created) then
    return 'closed';
  end if;

  -- Tope de acompañantes de la invitación (NULL = libre hasta 10).
  if p_status = 'si' and v_max_companions is not null and p_companions > v_max_companions then
    return 'too_many';
  end if;

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  -- El trigger wedding_guests_notes_owner no debe tratar esta escritura como de la pareja.
  perform pg_catalog.set_config('vinklo.guest_rsvp_write', 'on', true);
  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         -- La nota del invitado sustituye a la anterior. Si la deja en blanco,
         -- solo se borra la que escribió él: una nota de la pareja se queda.
         rsvp_notes = case
           when nullif(pg_catalog.btrim(coalesce(p_notes, '')), '') is not null then pg_catalog.btrim(p_notes)
           when g.rsvp_notes_by_guest then null
           else g.rsvp_notes
         end,
         rsvp_notes_by_guest = nullif(pg_catalog.btrim(coalesce(p_notes, '')), '') is not null,
         -- Con «no» no quedan respuestas de módulos (ni autobús ni menú).
         rsvp_answers = case when p_status = 'si' and p_answers is not null and p_answers <> '{}'::jsonb then p_answers else null end,
         responded_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) is
  'RSVP con enlace personal y respuestas de módulos (20261018100000) + responded_at (20261021100000) + tope de acompañantes (20261021110000) + autoría de la nota (20261021120000). Solo service_role (server action submitRsvp).';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) to service_role;

create or replace function public.guest_rsvp_current(p_slug text, p_token_hash text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_guest_id uuid;
  v_row record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select w.id into v_wedding_id from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return null; end if;
  -- El token solo vale dentro de SU boda y si sigue activo.
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return null; end if;

  select g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_notes_by_guest, g.rsvp_answers, g.responded_at, g.max_companions
    into v_row
    from public.wedding_guests g
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  if not found then return null; end if;

  -- Pendiente: sin respuesta que rellenar (nada de la ficha), solo el tope.
  if v_row.rsvp_status is null or v_row.rsvp_status not in ('si', 'no') then
    return pg_catalog.jsonb_build_object('status', null, 'max_companions', v_row.max_companions);
  end if;

  return pg_catalog.jsonb_build_object(
    'max_companions', v_row.max_companions,
    'status', v_row.rsvp_status,
    'companions', coalesce(v_row.rsvp_companions, 0),
    -- Solo la nota que escribió el propio invitado: la pareja usa el mismo
    -- campo para apuntes privados que el invitado nunca debe ver.
    'notes', case when v_row.rsvp_notes_by_guest then v_row.rsvp_notes else null end,
    'answers', v_row.rsvp_answers,
    'responded_at', v_row.responded_at
  );
end;
$$;
comment on function public.guest_rsvp_current(text, text) is
  'Respuesta actual del invitado con enlace personal y su tope de acompañantes (20261021100000, 20261021110000). status NULL si aún no respondió. Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;
commit;
