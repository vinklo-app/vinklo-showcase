-- Regalos solo de una página de invitados (20261022110000, R05).
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('d1111111-1111-4111-8111-111111111111'), ('d2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','regalos-pagina-a','d1111111-1111-4111-8111-111111111111','Ana','Luis','2027-06-12'),
 ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','regalos-pagina-b','d2222222-2222-4222-8222-222222222222','Lucia','Juan',null);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('da000000-0000-4000-8000-000000000001','daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alba','pendiente'),
 ('da000000-0000-4000-8000-000000000002','daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bruno','pendiente'),
 ('da000000-0000-4000-8000-000000000003','daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla','pendiente'),
 ('db000000-0000-4000-8000-000000000001','dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Otra pareja','pendiente');

set local role authenticated;
select set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
do $$
declare v_shared uuid; v_solo uuid; v_other uuid; j jsonb;
begin
 v_shared := public.create_wedding_gift('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   array['da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002']::uuid[], 'bizum', 10000, null, null, current_date);
 v_solo := public.create_wedding_gift('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   array['da000000-0000-4000-8000-000000000003']::uuid[], 'objeto', null, 'Una lámpara', null, null);
 -- Página con Alba: solo el regalo compartido, con Bruno también entre los regalantes.
 if (select count(*) from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['da000000-0000-4000-8000-000000000001']::uuid[])) <> 1 then raise exception 'Página con Alba: debe haber 1 regalo'; end if;
 select l.givers into j from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['da000000-0000-4000-8000-000000000001']::uuid[]) l;
 if pg_catalog.jsonb_array_length(j) <> 2 then raise exception 'El regalo compartido debe traer a sus dos regalantes'; end if;
 -- Página con todos: lo mismo que la lista completa, sin duplicados.
 if (select count(*) from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      array['da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000003']::uuid[]))
    <> (select count(*) from public.wedding_gift_list('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'Página completa distinta de la lista'; end if;
 -- Página vacía o sin regalos: nada.
 if exists (select 1 from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array[]::uuid[])) then raise exception 'Página vacía con regalos'; end if;
 -- Ids de otra boda: nada.
 if exists (select 1 from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['db000000-0000-4000-8000-000000000001']::uuid[])) then raise exception 'Invitado ajeno trae regalos'; end if;
end $$;

-- La otra pareja no ve los regalos de A, ni con los ids de A.
select set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists (select 1 from public.wedding_gift_list_for('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['da000000-0000-4000-8000-000000000001']::uuid[])) then raise exception 'Regalos ajenos expuestos'; end if;
end $$;

set local role anon;
do $$ begin
 if has_function_privilege('anon','public.wedding_gift_list_for(uuid,uuid[])','execute') then raise exception 'wedding_gift_list_for ejecutable por anon'; end if;
end $$;
rollback;
