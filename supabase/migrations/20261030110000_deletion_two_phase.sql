-- Seguridad de los datos (revisión Fable 2026-10-11, P2-4 y P2-5).
-- Preparada en local. NO aplicada en remoto: aplicar ANTES de desplegar el
-- código que la usa. Solo añade: columnas nulas o con default, una tabla,
-- dos funciones nuevas y filtros `deleted_at is null` que no cambian nada
-- mientras ninguna boda lo tenga. El código actual (43c1a11) sigue igual:
-- sus RPC conservan firma y la política de borrado no cambia.
--
-- P2-4 · builder_draft_stash: `updated_at` (cuándo editó la pareja el
--   borrador, no cuándo pidió el enlace) y builder_draft_stash_put(), que
--   solo pisa una copia vigente si la que llega es igual o más reciente.
--
-- P2-5 · Borrado de boda en dos fases:
--   1. wedding_mark_deleted() (sesión del dueño, una transacción): marca
--      weddings.deleted_at, apunta la purga en pending_deletions (con los
--      proveedores, cuyas facturas viven en Storage), revoca los enlaces de
--      invitado, borra las invitaciones de pareja pendientes y las
--      membresías. Desde aquí la boda no se sirve a nadie.
--   2. El servidor borra la fila (cascada) y vacía Storage; Auth se borra en
--      «Eliminar mi cuenta». Lo que falle lo reintenta el cron diario desde
--      pending_deletions (sin FK: sobrevive a la cascada y al usuario).
--   Lecturas que dejan de ver una boda marcada: políticas de weddings (panel
--   y getCurrentWedding), las tres vistas públicas (service_role se salta
--   RLS) y retention_notice_candidates. Las RPC del invitado por enlace
--   exigen un token sin revocar: quedan cubiertas por la revocación.
begin;

-- ------------------------------------------------------------ P2-4 stash
alter table public.builder_draft_stash add column if not exists updated_at timestamptz;
-- Las copias existentes: su fecha real es la de escritura, no la de esta migración.
update public.builder_draft_stash set updated_at = created_at where updated_at is null;
alter table public.builder_draft_stash alter column updated_at set default now();
alter table public.builder_draft_stash alter column updated_at set not null;

-- true si escribió. Una copia caducada se pisa siempre; una fecha futura
-- (reloj del navegador adelantado) se recorta a ahora para no bloquear.
create or replace function public.builder_draft_stash_put(
  p_email text, p_draft jsonb, p_updated_at timestamptz, p_expires_at timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with written as (
    insert into public.builder_draft_stash as s (email, draft, created_at, expires_at, updated_at)
    values (p_email, p_draft, pg_catalog.now(), p_expires_at,
            least(coalesce(p_updated_at, pg_catalog.now()), pg_catalog.now()))
    on conflict (email) do update
      set draft = excluded.draft, created_at = excluded.created_at,
          expires_at = excluded.expires_at, updated_at = excluded.updated_at
      where s.updated_at <= excluded.updated_at or s.expires_at <= pg_catalog.now()
    returning 1
  )
  select exists (select 1 from written);
$$;
revoke all on function public.builder_draft_stash_put(text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.builder_draft_stash_put(text, jsonb, timestamptz, timestamptz) to service_role;

-- ------------------------------------------------------------ P2-5 marca
alter table public.weddings add column if not exists deleted_at timestamptz;
create index if not exists weddings_deleted_at_idx on public.weddings (deleted_at) where deleted_at is not null;

-- Cola de purgas: sin FK a weddings ni a auth.users a propósito.
create table if not exists public.pending_deletions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('wedding', 'user')),
  target_id uuid not null,
  -- Carpetas de facturas (invoices/<vendor_id>): tras la cascada ya no se pueden leer.
  vendor_ids uuid[] not null default '{}',
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  -- Solo fase y código (sin datos personales).
  last_error text check (last_error is null or char_length(last_error) <= 200),
  unique (kind, target_id)
);
create index if not exists pending_deletions_next_idx
  on public.pending_deletions (last_attempt_at nulls first, requested_at);
alter table public.pending_deletions enable row level security;
revoke all on public.pending_deletions from public, anon, authenticated;
grant all on public.pending_deletions to service_role;

-- 'ok' | 'not_found' | 'forbidden' | 'unauthenticated'. Idempotente: volver
-- a llamar (p. ej. un reintento) devuelve 'ok' sin cambiar la fecha.
create or replace function public.wedding_mark_deleted(p_wedding_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_couple uuid;
begin
  if v_uid is null then return 'unauthenticated'; end if;
  select w.couple_id into v_couple from public.weddings w where w.id = p_wedding_id for update;
  if not found then return 'not_found'; end if;
  -- Solo quien creó la boda (como la política weddings_delete_couple).
  if v_couple is distinct from v_uid then return 'forbidden'; end if;

  update public.weddings set deleted_at = pg_catalog.now()
   where id = p_wedding_id and deleted_at is null;
  insert into public.pending_deletions (kind, target_id, vendor_ids)
  select 'wedding', p_wedding_id, coalesce(array_agg(v.id), '{}')
    from public.vendors v where v.wedding_id = p_wedding_id
  on conflict (kind, target_id) do nothing;
  -- Que nada la siga sirviendo mientras se borra: enlaces de invitado,
  -- invitaciones de pareja y membresías (owns_wedding pasa a false).
  update public.wedding_guest_tokens set revoked_at = pg_catalog.now()
   where wedding_id = p_wedding_id and revoked_at is null;
  delete from public.wedding_member_invites where wedding_id = p_wedding_id and accepted_at is null;
  delete from public.wedding_members where wedding_id = p_wedding_id;
  return 'ok';
end;
$$;
revoke all on function public.wedding_mark_deleted(uuid) from public, anon;
grant execute on function public.wedding_mark_deleted(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ políticas
-- La de borrado (couple_id) no cambia: el código actual borra con sesión.
-- Ojo: con la marca puesta, un DELETE con sesión ya no encuentra la fila
-- (las políticas de SELECT filtran el WHERE); el código nuevo borra con
-- service_role tras marcar.
drop policy if exists weddings_select_couple on public.weddings;
create policy weddings_select_couple on public.weddings
  for select to authenticated
  using (deleted_at is null and (public.owns_wedding(id) or couple_id = (select auth.uid())));

drop policy if exists weddings_select_planner on public.weddings;
create policy weddings_select_planner on public.weddings
  for select to authenticated
  using (deleted_at is null and (select auth.uid()) = planner_id);

drop policy if exists weddings_update_couple on public.weddings;
create policy weddings_update_couple on public.weddings
  for update to authenticated
  using (deleted_at is null and public.owns_wedding(id))
  with check (deleted_at is null and public.owns_wedding(id));

-- ------------------------------------------------------------ vistas públicas
-- Mismas columnas y opciones; solo el filtro nuevo.
create or replace view public.weddings_public with (security_invoker = true) as
  select w.slug, w.partner_name_1, w.partner_name_2, w.wedding_date, w.cubierto_price_cents,
         w.cover_image_url, w.bizum_phone, w.stripe_onboarded, w.plan, w.page_config, w.rsvp_deadline
    from public.weddings w
   where w.deleted_at is null;

create or replace view public.wedding_agenda_public with (security_invoker = true) as
  select w.slug, a.id, a.title, a.time_label, a.place, a.address, a.notes, a.sort
    from public.wedding_agenda_items a
    join public.weddings w on w.id = a.wedding_id
   where w.deleted_at is null;

create or replace view public.wedding_sites_public with (security_invoker = true) as
  select w.slug, w.plan, (s.published_revision_id is not null) as is_published, r.document,
         s.published_at, s.unpublished_at, r.schema_version, r.id as revision_id
    from public.wedding_sites s
    left join public.wedding_site_revisions r on r.id = s.published_revision_id
    join public.weddings w on w.id = s.wedding_id
   where s.published_at is not null and w.deleted_at is null;

-- ------------------------------------------------------------ retención
-- Sin aviso de retención a una boda que se está borrando.
create or replace function public.retention_notice_candidates(p_today date, p_limit integer default 200)
returns table (wedding_id uuid, slug text, wedding_date date, anonymise_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.slug, w.wedding_date,
         greatest((w.wedding_date + interval '12 months')::date, p_today + 30)
  from public.weddings w
  left join public.wedding_retention r on r.wedding_id = w.id
  where w.wedding_date is not null
    and w.deleted_at is null
    and (w.wedding_date + interval '12 months')::date - 30 <= p_today
    and r.notice_sent_at is null
    and r.anonymised_at is null
  order by w.wedding_date, w.id
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke all on function public.retention_notice_candidates(date, integer) from public, anon, authenticated;
grant execute on function public.retention_notice_candidates(date, integer) to service_role;

-- PostgREST: que vea ya las funciones, la tabla y las columnas nuevas.
notify pgrst, 'reload schema';
commit;
