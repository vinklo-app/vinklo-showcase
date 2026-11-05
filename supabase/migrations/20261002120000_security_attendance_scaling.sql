-- Preparada localmente. Aplicar después de las dos migraciones del 30/09 en staging.
begin;

alter table public.wedding_guests
  add column invitation_prepared_at timestamptz,
  add column invitation_sent_at timestamptz,
  add constraint invitation_hash_format check (
    invitation_token_hash is null or invitation_token_hash ~ '^[a-f0-9]{64}$'
  ) not valid,
  add constraint rsvp_notes_length check (rsvp_notes is null or char_length(rsvp_notes) <= 500) not valid;

alter table public.weddings
  add constraint wedding_names_length check (
    char_length(partner_name_1) between 2 and 80 and char_length(partner_name_2) between 2 and 80
  ) not valid,
  add constraint wedding_page_config_size check (octet_length(page_config::text) <= 16384) not valid;
-- NOT VALID protege escrituras nuevas sin alterar datos históricos.
-- Validar estas cuatro constraints tras comprobar/corregir filas previas en staging.

-- Bloquear también la vía PostgREST financiera: la interfaz desactivada no basta.
revoke update on public.contributions from authenticated;
revoke update (status) on public.contributions from authenticated;
-- Webhooks históricos conservan service_role. Reactivar Bizum requiere una RPC
-- restringida a method=bizum_manual y las transiciones permitidas, nunca el grant amplio.

-- MVP: una web por cuenta de pareja. Si existen duplicados, la migración
-- falla y revierte: revisarlos manualmente, nunca borrar bodas automáticamente.
create unique index weddings_one_per_couple_idx on public.weddings(couple_id);

create index wedding_guests_recent_responses_idx
  on public.wedding_guests (wedding_id, updated_at desc, id)
  where rsvp_status <> 'pendiente';
create index wedding_guests_created_page_idx
  on public.wedding_guests (wedding_id, created_at, id);
create index rate_limit_hits_created_at_idx on public.rate_limit_hits (created_at, id);

create or replace function public.attendance_summary(p_wedding_id uuid)
returns table(total bigint, pending bigint, confirmed bigint, declined bigint,
  companions bigint, attendees bigint, prepared bigint, sent bigint)
language sql stable security invoker set search_path = '' as $$
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
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;
revoke all on function public.attendance_summary(uuid) from public, anon;
grant execute on function public.attendance_summary(uuid) to authenticated;

-- Asegurar execute explícito: el modo fail-closed necesita una RPC operativa.
grant execute on function public.rl_check(text, int, int) to service_role;

create or replace function public.cleanup_rate_limit_hits(p_batch_size integer default 10000)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare deleted bigint;
begin
  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'invalid batch size';
  end if;
  with expired as (
    select id from public.rate_limit_hits
    where created_at < pg_catalog.now() - interval '2 days'
    order by created_at, id limit p_batch_size for update skip locked
  ), removed as (
    delete from public.rate_limit_hits h using expired e where h.id = e.id returning h.id
  ) select count(*) into deleted from removed;
  return deleted;
end;
$$;
revoke all on function public.cleanup_rate_limit_hits(integer) from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_hits(integer) to service_role;
commit;
