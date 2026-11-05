-- Segunda cuenta de pareja (2026-10-15): los dos novios gestionan la misma
-- boda, cada uno con su email.
--
-- Modelo
--   * public.wedding_members(wedding_id, user_id, role 'owner'|'partner'):
--     quién gestiona cada boda. Un usuario pertenece a UNA sola boda
--     (unique user_id) y una boda tiene como mucho 2 miembros (trigger).
--   * weddings.couple_id se conserva: es el dueño original (rol 'owner'),
--     el único que puede borrar la boda o quitar a la pareja. Un trigger
--     mantiene su fila de miembro (alta al crear la boda, cambio de dueño
--     si service_role reasigna couple_id).
--   * public.owns_wedding(w_id) pasa de «soy couple_id» a «soy miembro».
--     El parámetro se sigue llamando w_id: CREATE OR REPLACE no permite
--     renombrarlo y ~40 políticas dependen de la función (no se puede DROP).
--     Sigue siendo INVOKER (como antes): lee wedding_members con la política
--     `user_id = auth.uid()`, sin recursión.
--   * Invitaciones: public.wedding_member_invites (email en minúsculas,
--     hash SHA-256 del token, caducidad). Se aceptan SOLO con la RPC
--     accept_wedding_invite(p_token) (security definer, search_path fijado,
--     sin anon), que exige: sesión, token válido y vigente, el email de la
--     sesión = email invitado, que el usuario no tenga otra boda y que la
--     boda no esté completa.
--
-- Funciones y políticas que inlineaban `couple_id = auth.uid()` y pasan a
-- public.owns_wedding() (mismas firmas, grants, volatilidad y resultado):
--   políticas  weddings_select_couple                                    (owns_wedding(id) o dueño: ver INSERT … RETURNING)
--              weddings_update_couple                                    (owns_wedding(id))
--              weddings_insert_couple, weddings_delete_couple           (siguen con couple_id: crea/borra el dueño)
--              wedding_guests_{select,insert,update,delete}_couple      (owns_wedding(wedding_id))
--   invoker    attendance_summary, confirm_guest_reminder, crm_funnel_summary,
--              crm_gift_summary, guest_filter_counts, guest_group_summary,
--              guest_page, reminder_queue, wedding_gift_list, wedding_seating,
--              wedding_vendor_summary
--   definer    issue_guest_token, wedding_site_publish, wedding_site_unpublish,
--              guest_invitation_opened (la apertura de cualquiera de los dos
--              novios devuelve 'owner' y no cuenta como apertura)
-- En las funciones SQL la comprobación va como `(select public.owns_wedding(p))`
-- para que se evalúe una vez (InitPlan) y no por fila: SET search_path impide
-- inlinear la función.
--
-- Comprobado con un recorrido de pg_proc/pg_policies tras aplicar todas las
-- migraciones hasta 20261013100000: no queda ningún `couple_id` en políticas
-- ni funciones salvo owns_wedding() (ya no), la inserción/borrado de weddings
-- y los triggers de esta migración. Las migraciones posteriores (20261014*)
-- deben usar public.owns_wedding(); repetir el recorrido al integrarlas.

-- ===================================================================== tablas
create table public.wedding_members (
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'partner')),
  created_at timestamptz not null default now(),
  primary key (wedding_id, user_id),
  constraint wedding_members_one_wedding_per_user unique (user_id)
);
create unique index wedding_members_one_owner_idx on public.wedding_members (wedding_id) where role = 'owner';

alter table public.wedding_members enable row level security;
revoke all on public.wedding_members from public, anon, authenticated;
grant select on public.wedding_members to authenticated;
grant all on public.wedding_members to service_role;

-- Cada uno ve SOLO su fila: es lo que necesita owns_wedding() y evita la
-- recursión (una política que llamase a owns_wedding() se llamaría a sí misma).
-- Los datos de la pareja (email, estado) salen por wedding_partners().
create policy "wedding_members_select_self" on public.wedding_members for select
  to authenticated using (user_id = (select auth.uid()));

-- Máximo 2 miembros por boda. Bloquea la fila de la boda para que dos
-- aceptaciones simultáneas no pasen las dos.
create or replace function public.wedding_members_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.weddings w where w.id = new.wedding_id for update;
  if (select count(*) from public.wedding_members m where m.wedding_id = new.wedding_id) >= 2 then
    raise exception using errcode = '23514', message = 'wedding_members_full';
  end if;
  return new;
end;
$$;
revoke execute on function public.wedding_members_limit() from public, anon, authenticated;

create trigger wedding_members_limit
  before insert on public.wedding_members
  for each row execute function public.wedding_members_limit();

-- Backfill: el dueño actual de cada boda.
insert into public.wedding_members (wedding_id, user_id, role, created_at)
select w.id, w.couple_id, 'owner', w.created_at
from public.weddings w
on conflict do nothing;

-- Alta del dueño al crear la boda (el cliente de sesión no puede insertar en
-- wedding_members: security definer). Si el usuario ya es miembro de otra
-- boda (p. ej. aceptó la invitación de su pareja), la unique de user_id hace
-- fallar la creación entera con 23505 / wedding_members_one_wedding_per_user.
create or replace function public.wedding_members_sync_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.wedding_members (wedding_id, user_id, role)
    values (new.id, new.couple_id, 'owner');
  elsif new.couple_id is distinct from old.couple_id then
    -- Solo service_role puede cambiar couple_id (sin grant de UPDATE para
    -- authenticated): el nuevo dueño hereda el rol.
    delete from public.wedding_members m where m.wedding_id = new.id and m.user_id = new.couple_id;
    update public.wedding_members m set user_id = new.couple_id
     where m.wedding_id = new.id and m.role = 'owner';
  end if;
  return new;
end;
$$;
revoke execute on function public.wedding_members_sync_owner() from public, anon, authenticated;

create trigger wedding_members_owner_on_insert
  after insert on public.weddings
  for each row execute function public.wedding_members_sync_owner();
create trigger wedding_members_owner_on_update
  after update of couple_id on public.weddings
  for each row execute function public.wedding_members_sync_owner();

-- Invitaciones a la pareja. Una pendiente por boda; reenviar = rotar
-- token_hash y expires_at. Nunca se guarda el token en claro.
create table public.wedding_member_invites (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  email text not null check (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create unique index wedding_member_invites_one_pending_idx
  on public.wedding_member_invites (wedding_id) where accepted_at is null;

alter table public.wedding_member_invites enable row level security;
revoke all on public.wedding_member_invites from public, anon, authenticated;
-- Sin token_hash en lectura: la pareja ve email y estado, no el hash.
grant select (id, wedding_id, email, expires_at, sent_at, accepted_at, created_at) on public.wedding_member_invites to authenticated;
grant insert (wedding_id, email, token_hash, expires_at, created_by) on public.wedding_member_invites to authenticated;
grant update (token_hash, expires_at, sent_at) on public.wedding_member_invites to authenticated;
grant delete on public.wedding_member_invites to authenticated;
grant all on public.wedding_member_invites to service_role;

create policy "wedding_member_invites_select" on public.wedding_member_invites for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_member_invites_insert" on public.wedding_member_invites for insert
  to authenticated with check (public.owns_wedding(wedding_id) and created_by = (select auth.uid()));
-- Solo invitaciones pendientes: una aceptada es historia.
create policy "wedding_member_invites_update" on public.wedding_member_invites for update
  to authenticated using (public.owns_wedding(wedding_id) and accepted_at is null)
  with check (public.owns_wedding(wedding_id) and accepted_at is null);
create policy "wedding_member_invites_delete" on public.wedding_member_invites for delete
  to authenticated using (public.owns_wedding(wedding_id) and accepted_at is null);

-- Boda completa = no se puede invitar (security definer: la pareja solo ve
-- su propia fila de miembros y no podría contarlas).
create or replace function public.wedding_member_invites_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Quien no es de la boda no aprende nada de ella: lo rechaza RLS después.
  if (select auth.uid()) is not null and not public.owns_wedding(new.wedding_id) then
    return new;
  end if;
  if (select count(*) from public.wedding_members m where m.wedding_id = new.wedding_id) >= 2 then
    raise exception using errcode = '23514', message = 'wedding_members_full';
  end if;
  if exists (select 1 from public.wedding_members m
               join auth.users u on u.id = m.user_id
              where m.wedding_id = new.wedding_id and pg_catalog.lower(u.email) = new.email) then
    raise exception using errcode = '23514', message = 'wedding_invite_self';
  end if;
  return new;
end;
$$;
revoke execute on function public.wedding_member_invites_guard() from public, anon, authenticated;

create trigger wedding_member_invites_guard
  before insert on public.wedding_member_invites
  for each row execute function public.wedding_member_invites_guard();

-- ======================================================== owns_wedding()
create or replace function public.owns_wedding(w_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.wedding_members m
    where m.wedding_id = w_id and m.user_id = (select auth.uid())
  );
$$;

-- ============================================================== RPC pareja
-- Aceptar la invitación. Devuelve un código (nunca datos de la boda):
--   ok | already_member | invalid | used | expired | email_mismatch |
--   has_wedding | full | unauthenticated
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

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v_uid;
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

-- Miembros de MI boda con su email (auth.users no es legible por authenticated).
create or replace function public.wedding_partners()
returns table (user_id uuid, email text, role text, created_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email, m.role, m.created_at, m.user_id = (select auth.uid())
  from public.wedding_members m
  join auth.users u on u.id = m.user_id
  where m.wedding_id = (select me.wedding_id from public.wedding_members me where me.user_id = (select auth.uid()))
  order by m.role = 'partner', m.created_at;
$$;
revoke execute on function public.wedding_partners() from public, anon;
grant execute on function public.wedding_partners() to authenticated, service_role;

-- ¿Hay una invitación vigente para el email de MI sesión? Solo sí/no: sirve
-- para que /onboarding avise («abrid el enlace de la invitación») en vez de
-- dejar crear una segunda boda. No revela nada de la boda que invita.
create or replace function public.pending_wedding_invite_for_me()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wedding_member_invites i
    join auth.users u on u.id = (select auth.uid())
    where i.email = pg_catalog.lower(u.email)
      and i.accepted_at is null and i.expires_at > pg_catalog.now()
  );
$$;
revoke execute on function public.pending_wedding_invite_for_me() from public, anon;
grant execute on function public.pending_wedding_invite_for_me() to authenticated, service_role;

-- El dueño quita el acceso a la pareja (la pareja no puede quitar al dueño).
create or replace function public.remove_wedding_partner()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wedding uuid;
  v_rows integer;
begin
  select m.wedding_id into v_wedding from public.wedding_members m
   where m.user_id = (select auth.uid()) and m.role = 'owner';
  if v_wedding is null then
    raise exception using errcode = '42501', message = 'wedding_owner_only';
  end if;
  delete from public.wedding_members m where m.wedding_id = v_wedding and m.role = 'partner';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke execute on function public.remove_wedding_partner() from public, anon;
grant execute on function public.remove_wedding_partner() to authenticated, service_role;

-- ================================================================ políticas
-- `or couple_id = auth.uid()`: INSERT … RETURNING (createWedding hace
-- .insert().select("id")) evalúa la política de SELECT ANTES de que el
-- trigger AFTER INSERT dé de alta al dueño en wedding_members; sin esto,
-- crear una boda fallaría con 42501. El dueño siempre es miembro igualmente.
drop policy "weddings_select_couple" on public.weddings;
create policy "weddings_select_couple" on public.weddings for select
  to authenticated using (public.owns_wedding(id) or couple_id = (select auth.uid()));
drop policy "weddings_update_couple" on public.weddings;
create policy "weddings_update_couple" on public.weddings for update
  to authenticated using (public.owns_wedding(id)) with check (public.owns_wedding(id));
-- weddings_insert_couple y weddings_delete_couple se quedan con couple_id:
-- crear la boda y borrarla es cosa del dueño original.

drop policy "wedding_guests_select_couple" on public.wedding_guests;
create policy "wedding_guests_select_couple" on public.wedding_guests for select
  to authenticated using (public.owns_wedding(wedding_id));
drop policy "wedding_guests_insert_couple" on public.wedding_guests;
create policy "wedding_guests_insert_couple" on public.wedding_guests for insert
  to authenticated with check (public.owns_wedding(wedding_id));
drop policy "wedding_guests_update_couple" on public.wedding_guests;
create policy "wedding_guests_update_couple" on public.wedding_guests for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
drop policy "wedding_guests_delete_couple" on public.wedding_guests;
create policy "wedding_guests_delete_couple" on public.wedding_guests for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- ======================================================= funciones invoker
create or replace function public.attendance_summary(p_wedding_id uuid)
 returns table(total bigint, pending bigint, confirmed bigint, declined bigint, companions bigint, attendees bigint, prepared bigint, sent bigint)
 language sql
 stable
 set search_path to ''
as $function$
  select count(g.id),
    count(g.id) filter (where g.rsvp_status = 'pendiente'),
    count(g.id) filter (where g.rsvp_status = 'si'),
    count(g.id) filter (where g.rsvp_status = 'no'),
    coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0)::bigint,
    (count(g.id) filter (where g.rsvp_status = 'si') +
      coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint,
    count(g.id) filter (where g.invitation_prepared_at is not null),
    count(g.id) filter (where g.invitation_sent_at is not null)
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by w.id;
$function$;

create or replace function public.confirm_guest_reminder(p_guest_id uuid)
 returns table(last_reminder_at timestamp with time zone, reminder_count integer)
 language sql
 set search_path to ''
as $function$
  update public.wedding_guests g
     set last_reminder_at = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                                 then g.last_reminder_at else pg_catalog.now() end,
         reminder_count = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                               then g.reminder_count else g.reminder_count + 1 end
    from public.weddings w
   where g.id = p_guest_id and w.id = g.wedding_id and public.owns_wedding(w.id)
     and g.invitation_sent_at is not null
  returning g.last_reminder_at, g.reminder_count;
$function$;

create or replace function public.crm_funnel_summary(p_wedding_id uuid)
 returns table(added bigint, prepared bigint, sent bigint, opened bigint, responded bigint, yes bigint, no bigint, attendees bigint, not_sent bigint, sent_unopened bigint, opened_unanswered bigint, to_remind bigint)
 language sql
 stable
 set search_path to ''
as $function$
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
    count(g.id) filter (where public.guest_in_filter(g, 'para_recordar'))
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by w.id;
$function$;

create or replace function public.crm_gift_summary(p_wedding_id uuid)
 returns table(gift_count bigint, total_cents bigint, with_amount bigint, unthanked bigint, by_kind jsonb, guests_yes bigint, guests_no bigint, guests_unknown bigint)
 language sql
 stable
 set search_path to ''
as $function$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
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
$function$;

create or replace function public.guest_filter_counts(p_wedding_id uuid)
 returns table(todos bigint, sin_enviar bigint, esperando bigint, para_recordar bigint, vienen bigint, no_vienen bigint, sin_telefono bigint, con_notas bigint, sin_respuesta bigint, enviada_sin_abrir bigint, abierta_sin_responder bigint, con_regalo bigint, sin_regalo bigint, regalo_sin_indicar bigint, sin_agradecer bigint)
 language sql
 stable
 set search_path to ''
as $function$
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
  where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by w.id;
$function$;

create or replace function public.guest_group_summary(p_wedding_id uuid)
 returns table(group_name text, guests bigint, confirmed bigint, declined bigint, pending bigint, attendees bigint)
 language sql
 stable
 set search_path to ''
as $function$
  select g.group_name,
    count(*),
    count(*) filter (where g.rsvp_status = 'si'),
    count(*) filter (where g.rsvp_status = 'no'),
    count(*) filter (where g.rsvp_status = 'pendiente'),
    (count(*) filter (where g.rsvp_status = 'si')
      + coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by g.group_name
  order by g.group_name is null, pg_catalog.lower(g.group_name), g.group_name;
$function$;

create or replace function public.guest_page(p_wedding_id uuid, p_filter text, p_search text, p_limit integer, p_offset integer, p_group text default null::text)
 returns table(id uuid, name text, phone text, rsvp_status text, rsvp_companions integer, rsvp_notes text, source text, invitation_prepared_at timestamp with time zone, invitation_sent_at timestamp with time zone, last_reminder_at timestamp with time zone, reminder_count integer, reminders_opt_out boolean, created_at timestamp with time zone, invitation_opened_at timestamp with time zone, gift_none boolean, gift_count bigint, gift_unthanked boolean, gift_total_cents bigint, group_name text, total_count bigint)
 language sql
 stable
 set search_path to ''
as $function$
  select g.id, g.name, g.phone, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.source,
    g.invitation_prepared_at, g.invitation_sent_at, g.last_reminder_at, g.reminder_count,
    g.reminders_opt_out, g.created_at, g.invitation_opened_at, g.gift_none,
    gs.gift_count, gs.gift_unthanked, gs.gift_total_cents, g.group_name, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  cross join lateral (
    select count(f.id) as gift_count,
      coalesce(bool_or(f.thanked_at is null), false) as gift_unthanked,
      coalesce(sum(f.amount_cents), 0)::bigint as gift_total_cents
    from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
    where gg.guest_id = g.id
  ) gs
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    and public.guest_in_filter(g, p_filter)
    and (p_group is null
      or (p_group = '' and g.group_name is null)
      or g.group_name = p_group)
    and (coalesce(p_search, '') = '' or position(lower(p_search) in lower(g.name)) > 0)
  order by g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 100), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

create or replace function public.reminder_queue(p_wedding_id uuid, p_limit integer default 200, p_group text default null::text)
 returns table(id uuid, name text, phone text, invitation_sent_at timestamp with time zone, last_reminder_at timestamp with time zone, reminder_count integer, total_count bigint, group_name text)
 language sql
 stable
 set search_path to ''
as $function$
  select g.id, g.name, g.phone, g.invitation_sent_at, g.last_reminder_at, g.reminder_count, count(*) over (), g.group_name
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    and public.guest_in_filter(g, 'para_recordar')
    and (p_group is null or g.group_name = p_group)
  order by coalesce(g.last_reminder_at, g.invitation_sent_at), g.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$function$;

create or replace function public.wedding_gift_list(p_wedding_id uuid)
 returns table(id uuid, kind text, amount_cents integer, description text, note text, received_on date, thanked_at timestamp with time zone, created_at timestamp with time zone, givers jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  select f.id, f.kind, f.amount_cents, f.description, f.note, f.received_on, f.thanked_at, f.created_at,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('guestId', g.id, 'name', g.name) order by g.name, g.id)
                from public.wedding_gift_givers gg join public.wedding_guests g on g.id = gg.guest_id
               where gg.gift_id = f.id), '[]'::jsonb)
  from public.wedding_gifts f
  join public.weddings w on w.id = f.wedding_id
  where f.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  order by f.received_on desc nulls last, f.created_at desc, f.id;
$function$;

create or replace function public.wedding_seating(p_wedding_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  ),
  g as (
    select g.id, g.name, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.group_name, g.table_id,
      case g.rsvp_status when 'si' then 0 when 'pendiente' then 1 else 2 end as rank
    from public.wedding_guests g join w on w.id = g.wedding_id
  ),
  gj as (
    select g.*, pg_catalog.jsonb_build_object(
      'id', g.id, 'name', g.name, 'rsvp_status', g.rsvp_status,
      'companions', g.rsvp_companions, 'notes', g.rsvp_notes, 'group_name', g.group_name) as doc
    from g
  )
  select pg_catalog.jsonb_build_object(
    'tables', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', t.id, 'name', t.name, 'seats', t.seats, 'position', t.position,
          'attending', coalesce((select sum(1 + x.rsvp_companions) from g x where x.table_id = t.id and x.rsvp_status = 'si'), 0),
          'pending', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'pendiente'),
          'declined', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'no'),
          'guests', coalesce((select pg_catalog.jsonb_agg(x.doc order by x.rank, pg_catalog.lower(x.name), x.id)
                              from gj x where x.table_id = t.id), '[]'::jsonb))
        order by t.position, t.created_at, t.id)
      from public.wedding_tables t join w on w.id = t.wedding_id), '[]'::jsonb),
    'unseated', coalesce((
      select pg_catalog.jsonb_agg(x.doc order by x.rank, x.group_name is null, pg_catalog.lower(x.group_name),
                                  pg_catalog.lower(x.name), x.id)
      from gj x where x.table_id is null), '[]'::jsonb)
  );
$function$;

create or replace function public.wedding_vendor_summary(p_wedding_id uuid)
 returns table(total bigint, por_contactar bigint, contactado bigint, en_conversacion bigint, contratado bigint, descartado bigint)
 language sql
 stable
 set search_path to ''
as $function$
  select count(v.id),
    count(v.id) filter (where v.status = 'por_contactar'),
    count(v.id) filter (where v.status = 'contactado'),
    count(v.id) filter (where v.status = 'en_conversacion'),
    count(v.id) filter (where v.status = 'contratado'),
    count(v.id) filter (where v.status = 'descartado')
  from public.weddings w left join public.wedding_vendor_contacts v on v.wedding_id = w.id
  where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by w.id;
$function$;

-- ======================================================= funciones definer
create or replace function public.issue_guest_token(p_guest_id uuid, p_token_hash text, p_mode text)
 returns table(token_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
   where g.id = p_guest_id and public.owns_wedding(w.id)
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
$function$;

create or replace function public.guest_invitation_opened(p_slug text, p_token_hash text, p_viewer_id uuid default null::uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_wedding_id uuid;
  v_guest_id uuid;
  v_published_at timestamptz;
  v_revision uuid;
  v_rows integer;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return 'invalid';
  end if;

  select w.id into v_wedding_id
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  -- Cualquiera de los dos novios mirando el enlace no cuenta como apertura.
  if p_viewer_id is not null and exists (
    select 1 from public.wedding_members m where m.wedding_id = v_wedding_id and m.user_id = p_viewer_id
  ) then return 'owner'; end if;

  update public.wedding_guests g
     set invitation_opened_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id and g.invitation_opened_at is null;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'ok' else 'already' end;
end;
$function$;

create or replace function public.wedding_site_publish(p_wedding_id uuid, p_expected_version integer, p_document jsonb)
 returns table(revision_id uuid, published_at timestamp with time zone, draft_version integer)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_site public.wedding_sites%rowtype;
  v_schema_version integer;
  v_revision_id uuid;
  v_published_at timestamptz := pg_catalog.now();
  v_issue text;
begin
  if v_uid is null or not public.owns_wedding(p_wedding_id) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  select * into v_site
  from public.wedding_sites s
  where s.wedding_id = p_wedding_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  if v_site.draft_version is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;
  if v_site.draft_document is distinct from p_document then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;

  -- H04: la igualdad no demuestra validación. El servidor de la app valida
  -- con Zod; aquí se exigen los invariantes aunque se llame directamente.
  v_issue := public.site_document_publish_issue(v_site.draft_document);
  if v_issue is not null then
    raise exception using errcode = '22023', message = 'site_document_invalid', detail = v_issue;
  end if;

  v_schema_version := (v_site.draft_document ->> 'schemaVersion')::integer;

  insert into public.wedding_site_revisions (site_id, wedding_id, number, document, schema_version, published_by)
  select v_site.id, v_site.wedding_id,
         coalesce(max(r.number), 0) + 1,
         v_site.draft_document, v_schema_version, v_uid
  from public.wedding_site_revisions r
  where r.site_id = v_site.id
  returning id into v_revision_id;

  update public.wedding_sites s
  set published_revision_id = v_revision_id,
      published_at = v_published_at,
      unpublished_at = null
  where s.id = v_site.id;

  return query select v_revision_id, v_published_at, v_site.draft_version;
end;
$function$;

create or replace function public.wedding_site_unpublish(p_wedding_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.owns_wedding(p_wedding_id) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  update public.wedding_sites s
  set published_revision_id = null,
      unpublished_at = case
        when s.published_revision_id is not null then pg_catalog.now()
        else s.unpublished_at
      end
  where s.wedding_id = p_wedding_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;
end;
$function$;
