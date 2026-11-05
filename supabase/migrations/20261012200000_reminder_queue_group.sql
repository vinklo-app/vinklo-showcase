-- Recordatorios por grupo (petición del propietario 6-oct-2026: el CRM como
-- todo en uno). `reminder_queue` acepta un grupo opcional y devuelve el grupo
-- de cada persona.
-- Preparada en local. Aplicar ANTES del código que envía `p_group`; el código
-- anterior sigue funcionando con ella (p_group tiene default null y la
-- columna nueva va al final; el esquema zod no es estricto).
--   * Se borra y se recrea (cambia el tipo de retorno): una sola versión,
--     para que PostgREST no tenga que elegir entre sobrecargas.
--   * Misma lógica y orden que 20261004100000; mismos grants.
begin;

drop function if exists public.reminder_queue(uuid, integer);

create function public.reminder_queue(p_wedding_id uuid, p_limit integer default 200, p_group text default null)
returns table(id uuid, name text, phone text, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, total_count bigint, group_name text)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.invitation_sent_at, g.last_reminder_at, g.reminder_count, count(*) over (), g.group_name
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
    and public.guest_in_filter(g, 'para_recordar')
    and (p_group is null or g.group_name = p_group)
  order by coalesce(g.last_reminder_at, g.invitation_sent_at), g.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.reminder_queue(uuid, integer, text) from public, anon;
grant execute on function public.reminder_queue(uuid, integer, text) to authenticated, service_role;

commit;
