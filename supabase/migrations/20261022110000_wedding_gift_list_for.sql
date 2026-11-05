-- Panel más ágil (plan maestro §4.4, R05): la lista de invitados lee solo los
-- regalos de las personas de la página, no todos los de la boda.
-- `wedding_gift_list_for(boda, ids)`: los regalos en los que participa alguno
-- de esos invitados, con TODOS sus regalantes (un regalo compartido se pinta
-- entero). Mismo contrato que wedding_gift_list (20261015100000): invoker,
-- RLS + owns_wedding, mismas columnas y mismo orden.
-- Aditiva: función nueva con nombre propio (wedding_gift_list no cambia). Sin
-- ella, el código cae a wedding_gift_list y filtra en el servidor.
begin;
create or replace function public.wedding_gift_list_for(p_wedding_id uuid, p_guest_ids uuid[])
 returns table(id uuid, kind text, amount_cents integer, description text, note text, received_on date, thanked_at timestamp with time zone, created_at timestamp with time zone, givers jsonb)
 language sql
 stable
 security invoker
 set search_path to ''
as $function$
  select f.id, f.kind, f.amount_cents, f.description, f.note, f.received_on, f.thanked_at, f.created_at,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('guestId', g.id, 'name', g.name) order by g.name, g.id)
                from public.wedding_gift_givers gg join public.wedding_guests g on g.id = gg.guest_id
               where gg.gift_id = f.id), '[]'::jsonb)
  from public.wedding_gifts f
  join public.weddings w on w.id = f.wedding_id
  where f.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    -- Tope de ids: la lista pide una página (100). Más de 500 = nada (el llamante debe partir).
    and pg_catalog.cardinality(p_guest_ids) <= 500
    and exists (select 1 from public.wedding_gift_givers mine
                 where mine.gift_id = f.id and mine.wedding_id = p_wedding_id and mine.guest_id = any (p_guest_ids))
  order by f.received_on desc nulls last, f.created_at desc, f.id;
$function$;

revoke all on function public.wedding_gift_list_for(uuid, uuid[]) from public, anon;
grant execute on function public.wedding_gift_list_for(uuid, uuid[]) to authenticated, service_role;
commit;
