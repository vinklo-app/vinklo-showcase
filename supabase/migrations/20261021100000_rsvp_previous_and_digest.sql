-- El invitado ve su respuesta anterior y la pareja recibe un resumen diario
-- (plan maestro 8-oct-2026, §2.5 y §2.6).
--
--  * wedding_guests.responded_at: cuándo respondió el INVITADO por última
--    vez (solo lo escribe guest_rsvp_respond; los cambios de la pareja en el
--    CRM no lo tocan). Relleno inicial con updated_at para las respuestas
--    que ya existían, para que «Respuestas recientes» no las hunda al final.
--  * wedding_members.digest_opt_out: baja del resumen diario, por miembro
--    (cada novio decide por su correo). La escribe la server action con
--    service_role sobre la fila del propio usuario; la política de lectura
--    `wedding_members_select_self` ya deja leerla.
--  * guest_rsvp_respond (SOLO la sobrecarga de 6 argumentos): mismo cuerpo
--    que 20261018100000 + `responded_at = now()`. La de 5 es un envoltorio
--    que llama a esta y hereda el cambio; no se toca.
--  * guest_rsvp_current(p_slug, p_token_hash): la respuesta actual del
--    invitado para rellenar el formulario. Misma validación de enlace que
--    guest_rsvp_respond (formato, boda por slug, token activo de esa boda).
--    Devuelve jsonb (no RETURNS TABLE) para poder ampliarla con CREATE OR
--    REPLACE sin drop/grant. NULL si el enlace no vale o aún no respondió.
-- Aditiva: el código anterior sigue funcionando tras aplicarla.
begin;

alter table public.wedding_guests
  add column if not exists responded_at timestamptz;
comment on column public.wedding_guests.responded_at is
  'Última respuesta del invitado con su enlace (guest_rsvp_respond). NULL si nunca respondió él mismo.';
update public.wedding_guests
   set responded_at = updated_at
 where responded_at is null and rsvp_status in ('si', 'no');
create index if not exists wedding_guests_responded_at_idx
  on public.wedding_guests (responded_at) where responded_at is not null;

alter table public.wedding_members
  add column if not exists digest_opt_out boolean not null default false;
comment on column public.wedding_members.digest_opt_out is
  'true = este miembro no quiere el resumen diario de respuestas por correo (Ajustes).';

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
  perform 1 from public.wedding_guests g
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

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         rsvp_notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
         -- Con «no» no quedan respuestas de módulos (ni autobús ni menú).
         rsvp_answers = case when p_status = 'si' and p_answers is not null and p_answers <> '{}'::jsonb then p_answers else null end,
         responded_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) is
  'RSVP con enlace personal y respuestas de módulos (20261018100000) + responded_at (20261021100000). Solo service_role (server action submitRsvp).';
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

  select g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_answers, g.responded_at
    into v_row
    from public.wedding_guests g
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  if not found or v_row.rsvp_status not in ('si', 'no') then return null; end if;

  return pg_catalog.jsonb_build_object(
    'status', v_row.rsvp_status,
    'companions', coalesce(v_row.rsvp_companions, 0),
    'notes', v_row.rsvp_notes,
    'answers', v_row.rsvp_answers,
    'responded_at', v_row.responded_at
  );
end;
$$;
comment on function public.guest_rsvp_current(text, text) is
  'Respuesta actual del invitado con enlace personal, para rellenar el formulario (20261021100000). Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

commit;
