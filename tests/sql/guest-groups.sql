-- Grupos de invitados (20261012100000): columna, guest_page con p_group y guest_group_summary.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/guest-groups.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('71111111-1111-4111-8111-111111111111'), ('72222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','grupos-pareja-a','71111111-1111-4111-8111-111111111111','Elena','Marcos',current_date + 90),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','grupos-pareja-b','72222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 90);
-- A: «Familia de Elena» (sí +1, no, pendiente) · «Trabajo» (sí, pendiente) · sin grupo (pendiente).
-- B: un invitado en un grupo con el MISMO nombre que uno de A.
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_companions,group_name) values
 ('7a000000-0000-4000-8000-000000000001','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tía Puri','si',1,'Familia de Elena'),
 ('7a000000-0000-4000-8000-000000000002','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Primo Luis','no',0,'Familia de Elena'),
 ('7a000000-0000-4000-8000-000000000003','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Abuela Carmen','pendiente',0,'Familia de Elena'),
 ('7a000000-0000-4000-8000-000000000004','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nacho','si',0,'Trabajo'),
 ('7a000000-0000-4000-8000-000000000005','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sara','pendiente',0,'Trabajo'),
 ('7a000000-0000-4000-8000-000000000006','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Vecina del 3.º','pendiente',0,null),
 ('7b000000-0000-4000-8000-000000000001','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','si',3,'Trabajo');

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='guest_page') <> 1 then
   raise exception 'guest_page tiene más de una sobrecarga (PostgREST la vería ambigua)'; end if;
 if not has_function_privilege('authenticated','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute')
    or not has_function_privilege('authenticated','public.guest_group_summary(uuid)','execute') then raise exception 'authenticated sin grant'; end if;
 if has_function_privilege('anon','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute')
    or has_function_privilege('anon','public.guest_group_summary(uuid)','execute') then raise exception 'anon ejecuta RPC de grupos'; end if;
 if (select prosecdef from pg_proc where oid = 'public.guest_group_summary(uuid)'::regprocedure) then raise exception 'guest_group_summary no es invoker'; end if;
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name ~ 'group') then raise exception 'Vista pública con grupos'; end if;
end $$;

-- ------------------------------------------------------------ CHECK de group_name
do $$ begin
 begin update public.wedding_guests set group_name = '' where id='7a000000-0000-4000-8000-000000000006'; raise exception 'Grupo vacío aceptado';
 exception when check_violation then null; end;
 begin update public.wedding_guests set group_name = 'Trabajo ' where id='7a000000-0000-4000-8000-000000000006'; raise exception 'Grupo sin recortar aceptado';
 exception when check_violation then null; end;
 begin update public.wedding_guests set group_name = ' Trabajo' where id='7a000000-0000-4000-8000-000000000006'; raise exception 'Grupo con espacio inicial aceptado';
 exception when check_violation then null; end;
 begin update public.wedding_guests set group_name = repeat('a', 41) where id='7a000000-0000-4000-8000-000000000006'; raise exception 'Grupo de 41 caracteres aceptado';
 exception when check_violation then null; end;
 -- 40 caracteres con tildes (caracteres, no bytes): vale.
 update public.wedding_guests set group_name = repeat('é', 40) where id='7a000000-0000-4000-8000-000000000006';
 update public.wedding_guests set group_name = null where id='7a000000-0000-4000-8000-000000000006';
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
do $$ declare r record; begin
 -- Firma antigua (5 argumentos, como el código ya desplegado): todos, con group_name.
 if (select count(*) from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0)) <> 6 then raise exception 'guest_page sin p_group no devuelve todo'; end if;
 if (select group_name from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','Nacho',100,0)) <> 'Trabajo' then raise exception 'guest_page sin group_name'; end if;
 -- Filtro por grupo (nombre exacto), sin grupo ('') y combinado con filtro de tarea y búsqueda.
 if (select max(total_count) from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'Familia de Elena')) <> 3 then raise exception 'Filtro de grupo falla'; end if;
 if exists (select 1 from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'familia de elena')) then raise exception 'El grupo debe coincidir exacto'; end if;
 if (select name from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'')) <> 'Vecina del 3.º' then raise exception 'Sin grupo falla'; end if;
 if (select count(*) from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sin_respuesta','',100,0,'Familia de Elena')) <> 1 then raise exception 'Grupo + filtro falla'; end if;
 if (select count(*) from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','vienen','',100,0,'Trabajo')) <> 1 then raise exception 'Grupo + vienen falla (¿se cuela B?)'; end if;
 if (select count(*) from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','primo',100,0,'Familia de Elena')) <> 1 then raise exception 'Grupo + búsqueda falla'; end if;
 if exists (select 1 from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'No existe')) then raise exception 'Grupo inexistente devuelve filas'; end if;

 -- Resumen: Familia (3: 1 sí +1, 1 no, 1 pendiente → 2 personas), Trabajo (2: 1 sí, 1 pendiente → 1), sin grupo (1 pendiente).
 if (select count(*) from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 3 then raise exception 'Resumen: número de grupos'; end if;
 select * into r from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where group_name = 'Familia de Elena';
 if (r.guests, r.confirmed, r.declined, r.pending, r.attendees) <> (3::bigint, 1::bigint, 1::bigint, 1::bigint, 2::bigint) then raise exception 'Resumen Familia: %', r; end if;
 select * into r from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where group_name = 'Trabajo';
 if (r.guests, r.confirmed, r.declined, r.pending, r.attendees) <> (2::bigint, 1::bigint, 0::bigint, 1::bigint, 1::bigint) then raise exception 'Resumen Trabajo mezcla bodas: %', r; end if;
 select * into r from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where group_name is null;
 if (r.guests, r.pending) <> (1::bigint, 1::bigint) then raise exception 'Resumen sin grupo: %', r; end if;
 -- Orden: alfabético, «sin grupo» al final.
 if (select array_agg(coalesce(group_name, '∅')) from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> array['Familia de Elena','Trabajo','∅'] then raise exception 'Orden del resumen'; end if;

 -- Mover a grupo (lo que hace setGuestsGroup): la pareja actualiza los suyos.
 update public.wedding_guests set group_name = 'Vecinos' where id = '7a000000-0000-4000-8000-000000000006';
 if (select group_name from public.wedding_guests where id = '7a000000-0000-4000-8000-000000000006') <> 'Vecinos' then raise exception 'La pareja no puede agrupar'; end if;
 -- …y no los de B (RLS: 0 filas, sin error).
 update public.wedding_guests set group_name = 'Robado' where id = '7b000000-0000-4000-8000-000000000001';
 if found then raise exception 'A cambia el grupo de un invitado de B'; end if;
 -- Ver B: nada.
 if exists (select 1 from public.guest_group_summary('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'A ve los grupos de B'; end if;
 if exists (select 1 from public.guest_page('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','todos','',100,0,'Trabajo')) then raise exception 'A ve la página de B'; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',true);
do $$ declare r record; begin
 if (select group_name from public.wedding_guests where id = '7b000000-0000-4000-8000-000000000001') <> 'Trabajo' then raise exception 'A modificó a B'; end if;
 select * into r from public.guest_group_summary('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if (r.group_name, r.guests, r.attendees) <> ('Trabajo'::text, 1::bigint, 4::bigint) then raise exception 'Resumen propio de B: %', r; end if;
 if (select count(*) from public.guest_group_summary('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 then raise exception 'B ve grupos de A'; end if;
 if exists (select 1 from public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'B ve el resumen de A'; end if;
 if exists (select 1 from public.guest_page('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'Familia de Elena')) then raise exception 'B ve la página de A'; end if;
end $$;
reset role;

-- Sin sesión (anon): ni siquiera puede llamar.
set local role anon;
do $$ begin
 begin perform public.guest_group_summary('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'anon llama a guest_group_summary';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'guest-groups: CHECK, filtro por grupo, resumen y aislamiento A/B OK'; end $$;
rollback;
