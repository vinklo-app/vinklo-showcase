-- Retención de public.events (plan maestro §5.3, R14).
-- Preparada en local. NO aplicada en remoto. Aditiva: el código actual no la
-- usa; el cron diario la llama solo si existe.
--
--  * Índice (wedding_id, created_at): las lecturas por boda ordenadas por
--    fecha (feed de actividad, idempotencia del cron). Sustituye en la
--    práctica a events_wedding_id_idx, que se conserva para no tocar planes.
--  * Índice (created_at): el borrado por antigüedad recorre la tabla entera
--    por fecha; con el índice compuesto (columna inicial wedding_id) no
--    podría usarlo.
--  * purge_old_events(p_batch_size): borra eventos de más de 13 meses por
--    lotes (como cleanup_rate_limit_hits). Solo service_role. Los eventos de
--    idempotencia de Stripe (stripe_event_id) también caducan: Stripe deja de
--    reintentar un webhook a los 3 días.
begin;

create index if not exists events_wedding_created_idx on public.events (wedding_id, created_at);
create index if not exists events_created_at_idx on public.events (created_at);

create or replace function public.purge_old_events(p_batch_size integer default 10000)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare deleted bigint;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'invalid batch size';
  end if;
  with expired as (
    select e.id from public.events e
    where e.created_at < pg_catalog.now() - interval '13 months'
    order by e.created_at, e.id
    limit p_batch_size
    for update skip locked
  ), removed as (
    delete from public.events e using expired x where e.id = x.id returning e.id
  ) select count(*) into deleted from removed;
  return deleted;
end;
$$;
revoke all on function public.purge_old_events(integer) from public, anon, authenticated;
grant execute on function public.purge_old_events(integer) to service_role;

commit;
