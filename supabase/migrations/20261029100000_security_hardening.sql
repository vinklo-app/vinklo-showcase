-- Endurecimiento de base de datos (auditoría 2026-10-10, tarea 2).
-- Preparada en local. NO aplicada en remoto: el controlador la aplica a mano
-- ANTES de desplegar el código. Solo restringe privilegios y añade índices;
-- las funciones se recrean con la misma firma, security, search_path y grants.
--
--   1. Privilegios por defecto: quita los grants automáticos de Supabase a
--      anon/authenticated para funciones/secuencias futuras. OJO: el EXECUTE
--      por defecto de PUBLIC de Postgres NO se quita con esto; la protección
--      real son los revoke por función + el barrido de tests/sql/security-hardening.sql.
--   2. owns_wedding / guest_tags_valid: solo authenticated + service_role.
--   3. profiles: authenticated solo actualiza full_name y phone (no `role`).
--   4. vendors / vendor_invoices / payment_tranches (backlog): sin escritura
--      desde authenticated (solo select). inviteVendor y markTranchePaid
--      (lib/actions/vendors.ts) usaban el cliente de sesión: quedan muertas
--      tras RSVP_MVP y, al reactivarlas, deberán escribir con service role.
--   5. Invitaciones de pareja: caducidad máxima de 30 días desde AHORA
--      (trigger; un CHECK sobre created_at rompería el reenvío de invitaciones antiguas).
--   6. accept_wedding_invite / pending_wedding_invite_for_me: exigen email
--      confirmado en auth.users.
--   7. Retención: las contribuciones también se anonimizan.
--   8. Índices del cron diario.
begin;

-- ----------------------------------------------------------- 1. defaults
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ----------------------------------------------------------- 2. helpers
revoke all on function public.owns_wedding(uuid) from public, anon;
grant execute on function public.owns_wedding(uuid) to authenticated, service_role;
revoke all on function public.guest_tags_valid(text[]) from public, anon;
grant execute on function public.guest_tags_valid(text[]) to authenticated, service_role;

-- ----------------------------------------------------------- 3. profiles
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- ----------------------------------------------------------- 4. legacy
revoke insert, update, delete on public.vendors from authenticated;
revoke insert, update, delete on public.vendor_invoices from authenticated;
revoke insert, update, delete on public.payment_tranches from authenticated;

-- ----------------------------------------------------------- 5. TTL invitaciones
create or replace function public.wedding_member_invites_ttl()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at > pg_catalog.now() + interval '30 days' then
    raise exception 'La invitación no puede caducar a más de 30 días' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.wedding_member_invites_ttl() from public, anon;
drop trigger if exists wedding_member_invites_ttl on public.wedding_member_invites;
create trigger wedding_member_invites_ttl
  before insert or update of expires_at on public.wedding_member_invites
  for each row execute function public.wedding_member_invites_ttl();

-- ----------------------------------------------------------- 6. invitaciones
create or replace function public.accept_wedding_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.wedding_member_invites%rowtype;
  v_email text;
  v_current uuid;
begin
  if v_uid is null then return 'unauthenticated'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then return 'invalid'; end if;

  select * into v_invite from public.wedding_member_invites i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then return 'invalid'; end if;

  if v_invite.accepted_at is not null then
    return case when v_invite.accepted_by = v_uid then 'already_member' else 'used' end;
  end if;
  if v_invite.expires_at <= pg_catalog.now() then return 'expired'; end if;

  select pg_catalog.lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email <> v_invite.email then return 'email_mismatch'; end if;

  select m.wedding_id into v_current from public.wedding_members m where m.user_id = v_uid;
  if v_current = v_invite.wedding_id then
    update public.wedding_member_invites set accepted_at = pg_catalog.now(), accepted_by = v_uid where id = v_invite.id;
    return 'already_member';
  end if;
  if v_current is not null then return 'has_wedding'; end if;
  -- Quien creó su propia boda y aún no tiene fila de miembro (no debería: trigger).
  if exists (select 1 from public.weddings w where w.couple_id = v_uid) then return 'has_wedding'; end if;

  perform 1 from public.weddings w where w.id = v_invite.wedding_id for update;
  if (select count(*) from public.wedding_members m where m.wedding_id = v_invite.wedding_id) >= 2 then
    return 'full';
  end if;

  insert into public.wedding_members (wedding_id, user_id, role) values (v_invite.wedding_id, v_uid, 'partner');
  update public.wedding_member_invites set accepted_at = pg_catalog.now(), accepted_by = v_uid where id = v_invite.id;
  return 'ok';
end;
$$;
revoke execute on function public.accept_wedding_invite(text) from public, anon;
grant execute on function public.accept_wedding_invite(text) to authenticated, service_role;

create or replace function public.pending_wedding_invite_for_me()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wedding_member_invites i
    join auth.users u on u.id = (select auth.uid()) and u.email_confirmed_at is not null
    where i.email = pg_catalog.lower(u.email)
      and i.accepted_at is null and i.expires_at > pg_catalog.now()
  );
$$;
revoke execute on function public.pending_wedding_invite_for_me() from public, anon;
grant execute on function public.pending_wedding_invite_for_me() to authenticated, service_role;

-- ----------------------------------------------------------- 7. retención
create or replace function public.anonymise_expired_guests(p_today date, p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_has_companions boolean := pg_catalog.to_regclass('public.wedding_guest_companions') is not null;
begin
  if p_today is null then
    raise exception 'p_today is required';
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids
  from (
    select w.id
    from public.weddings w
    join public.wedding_retention r on r.wedding_id = w.id
    where w.wedding_date is not null
      and (w.wedding_date + interval '12 months')::date <= p_today
      and r.notice_sent_at is not null
      and (r.notice_sent_at at time zone 'Europe/Madrid')::date + 30 <= p_today
      and r.anonymised_at is null
    order by w.wedding_date, w.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update of r skip locked
  ) x;

  if pg_catalog.cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Primero la marca: el trigger de huérfanos de regalos la consulta para no
  -- borrar los regalos al quitarles los regalantes (20261026100000).
  update public.wedding_retention r
     set anonymised_at = pg_catalog.now()
   where r.wedding_id = any(v_ids);

  -- Acompañantes con nombre (tabla de otra rama): si existe, sus filas se
  -- borran. Se localizan por wedding_id si la tabla lo tiene; si no, por guest_id.
  if v_has_companions then
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'wedding_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions where wedding_id = any($1)' using v_ids;
    elsif exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'guest_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions c using public.wedding_guests g
               where c.guest_id = g.id and g.wedding_id = any($1)' using v_ids;
    end if;
  end if;

  delete from public.wedding_guest_tokens t where t.wedding_id = any(v_ids);

  update public.wedding_guests g
     set phone = null,
         notes = null,
         rsvp_notes = null,
         rsvp_answers = null,
         rsvp_key_hash = null,
         invitation_token_hash = null
   where g.wedding_id = any(v_ids);

  -- Regalos (20261026100000): fuera quién y el texto libre; se quedan tipo,
  -- importe, fechas y «agradecido».
  delete from public.wedding_gift_givers gg where gg.wedding_id = any(v_ids);

  update public.wedding_gifts f
     set note = null,
         description = null
   where f.wedding_id = any(v_ids)
     and (f.note is not null or f.description is not null);

  -- Contribuciones (20261029100000): fuera correo y mensaje; el nombre queda
  -- en «primer nombre + inicial del siguiente» («María G.») o «Invitado».
  -- Se conservan importes, método, estado y ids de Stripe (contabilidad).
  update public.contributions c
     set guest_email = null,
         message = null,
         guest_name = coalesce(
           nullif(
             pg_catalog.concat_ws(' ',
               nullif(pg_catalog.split_part(pg_catalog.btrim(c.guest_name), ' ', 1), ''),
               nullif(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(c.guest_name), ' ', 2), 1), '') || '.'),
             ''),
           'Invitado')
   where c.wedding_id = any(v_ids);

  return pg_catalog.cardinality(v_ids);
end;
$$;
revoke all on function public.anonymise_expired_guests(date, integer) from public, anon, authenticated;
grant execute on function public.anonymise_expired_guests(date, integer) to service_role;

-- ----------------------------------------------------------- 8. índices cron
create index if not exists weddings_wedding_date_idx on public.weddings (wedding_date);
create index if not exists events_type_created_idx on public.events (type, created_at desc);

commit;
