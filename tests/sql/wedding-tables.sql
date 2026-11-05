-- Plan de mesas (20261013100000): wedding_tables, wedding_guests.table_id y wedding_seating.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-tables.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('81111111-1111-4111-8111-111111111111'), ('82222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','mesas-pareja-a','81111111-1111-4111-8111-111111111111','Elena','Marcos',current_date + 90),
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','mesas-pareja-b','82222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 90);
-- A: Tía Puri (sí +2), Primo Luis (no), Abuela Carmen (pendiente), Nacho (sí), Sara (sí +1, sin mesa), Vecina (pendiente, sin mesa).
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_companions,rsvp_notes,group_name) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tía Puri','si',2,'Celíaca','Familia de Elena'),
 ('8a000000-0000-4000-8000-000000000002','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Primo Luis','no',0,null,'Familia de Elena'),
 ('8a000000-0000-4000-8000-000000000003','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Abuela Carmen','pendiente',0,null,'Familia de Elena'),
 ('8a000000-0000-4000-8000-000000000004','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nacho','si',0,null,'Trabajo'),
 ('8a000000-0000-4000-8000-000000000005','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sara','si',1,'Vegana','Trabajo'),
 ('8a000000-0000-4000-8000-000000000006','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Vecina del 3.º','pendiente',0,null,null),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','si',3,null,null);
insert into public.wedding_tables(id,wedding_id,name,seats,position) values
 ('8a100000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 1',4,1),
 ('8a100000-0000-4000-8000-000000000002','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 2',10,2),
 ('8b100000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mesa 1',8,1);
update public.wedding_guests set table_id = '8a100000-0000-4000-8000-000000000001'
 where id in ('8a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000002','8a000000-0000-4000-8000-000000000003');
update public.wedding_guests set table_id = '8a100000-0000-4000-8000-000000000002' where id = '8a000000-0000-4000-8000-000000000004';
update public.wedding_guests set table_id = '8b100000-0000-4000-8000-000000000001' where id = '8b000000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_tables'::regclass) then raise exception 'wedding_tables sin RLS'; end if;
 if (select prosecdef from pg_proc where oid = 'public.wedding_seating(uuid)'::regprocedure) then raise exception 'wedding_seating no es invoker'; end if;
 if not has_function_privilege('authenticated','public.wedding_seating(uuid)','execute') then raise exception 'authenticated sin execute'; end if;
 if has_function_privilege('anon','public.wedding_seating(uuid)','execute') then raise exception 'anon ejecuta wedding_seating'; end if;
 if has_table_privilege('anon','public.wedding_tables','select') or has_table_privilege('anon','public.wedding_tables','insert')
    or has_table_privilege('anon','public.wedding_tables','update') or has_table_privilege('anon','public.wedding_tables','delete') then raise exception 'anon con privilegios en wedding_tables'; end if;
 if not has_table_privilege('authenticated','public.wedding_tables','select') or not has_table_privilege('authenticated','public.wedding_tables','delete') then raise exception 'authenticated sin select/delete'; end if;
 if has_table_privilege('authenticated','public.wedding_tables','truncate') or has_table_privilege('authenticated','public.wedding_tables','references') then raise exception 'authenticated con privilegios de más'; end if;
 if not has_column_privilege('authenticated','public.wedding_tables','name','insert') or not has_column_privilege('authenticated','public.wedding_tables','seats','update') then raise exception 'Faltan grants por columna'; end if;
 if has_column_privilege('authenticated','public.wedding_tables','wedding_id','update') then raise exception 'authenticated puede mover una mesa de boda'; end if;
 if has_column_privilege('authenticated','public.wedding_tables','id','insert') or has_column_privilege('authenticated','public.wedding_tables','created_at','update') then raise exception 'authenticated escribe id/created_at'; end if;
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name ~ 'table') then raise exception 'Vista pública con mesas'; end if;
end $$;

-- ------------------------------------------------------------ CHECKs
do $$ begin
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','',10); raise exception 'Nombre vacío aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',' Mesa 3',10); raise exception 'Nombre sin recortar aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',41),10); raise exception 'Nombre de 41 aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 0',0); raise exception '0 plazas aceptadas';
 exception when check_violation then null; end;
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 31',31); raise exception '31 plazas aceptadas';
 exception when check_violation then null; end;
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 1',10); raise exception 'Nombre repetido en la misma boda';
 exception when unique_violation then null; end;
 -- 40 caracteres con tildes y 30 plazas: vale (se revierte en el savepoint del bloque).
 insert into public.wedding_tables(wedding_id,name,seats) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('é',40),30);
 delete from public.wedding_tables where name = repeat('é',40);
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
do $$ declare s jsonb; t jsonb; n integer; begin
 -- Solo ve sus mesas.
 if (select count(*) from public.wedding_tables) <> 2 then raise exception 'A ve mesas ajenas'; end if;

 -- Ocupación: Mesa 1 = Tía Puri (sí +2 → 3) + Primo Luis (no → 0) + Abuela (pendiente → 0, cuenta como pendiente).
 s := public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if jsonb_array_length(s->'tables') <> 2 then raise exception 'Número de mesas: %', s->'tables'; end if;
 t := s->'tables'->0;
 if t->>'name' <> 'Mesa 1' or (t->>'attending')::int <> 3 or (t->>'pending')::int <> 1 or (t->>'declined')::int <> 1 or (t->>'seats')::int <> 4 then raise exception 'Ocupación Mesa 1: %', t; end if;
 if jsonb_array_length(t->'guests') <> 3 or t->'guests'->0->>'name' <> 'Tía Puri' or t->'guests'->0->>'notes' <> 'Celíaca'
    or (t->'guests'->0->>'companions')::int <> 2 or t->'guests'->0->>'group_name' <> 'Familia de Elena' then raise exception 'Invitados de Mesa 1: %', t->'guests'; end if;
 -- Orden: viene, pendiente, no viene.
 if t->'guests'->2->>'rsvp_status' <> 'no' then raise exception 'Orden dentro de la mesa: %', t->'guests'; end if;
 if (s->'tables'->1->>'attending')::int <> 1 then raise exception 'Ocupación Mesa 2'; end if;
 -- Sin mesa: Sara (sí +1) primero, luego Vecina (pendiente). Nada de B.
 if jsonb_array_length(s->'unseated') <> 2 or s->'unseated'->0->>'name' <> 'Sara' or s->'unseated'->1->>'name' <> 'Vecina del 3.º' then raise exception 'Sin mesa: %', s->'unseated'; end if;
 if s::text ~ 'Invitado B' then raise exception 'El plan de A incluye invitados de B'; end if;

 -- Crear, renombrar, cambiar plazas (lo que hacen las acciones).
 insert into public.wedding_tables(wedding_id,name,seats,position) values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Primos',6,3);
 update public.wedding_tables set name = 'Mesa de los primos', seats = 8 where wedding_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Primos';
 get diagnostics n = row_count; if n <> 1 then raise exception 'A no puede renombrar su mesa'; end if;

 -- No puede crear mesas en B ni mover una suya a B.
 begin insert into public.wedding_tables(wedding_id,name,seats) values ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Intrusa',10); raise exception 'A crea mesa en B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_tables set wedding_id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = '8a100000-0000-4000-8000-000000000002'; raise exception 'A mueve una mesa a B';
 exception when insufficient_privilege then null; end;
 -- Ni tocar ni borrar la de B (RLS: 0 filas).
 update public.wedding_tables set name = 'Robada' where id = '8b100000-0000-4000-8000-000000000001';
 if found then raise exception 'A renombra la mesa de B'; end if;
 delete from public.wedding_tables where id = '8b100000-0000-4000-8000-000000000001';
 if found then raise exception 'A borra la mesa de B'; end if;

 -- FK cruzada: sentar a un invitado de A en la mesa de B → rechazado.
 begin update public.wedding_guests set table_id = '8b100000-0000-4000-8000-000000000001' where id = '8a000000-0000-4000-8000-000000000005'; raise exception 'Invitado de A en mesa de B';
 exception when foreign_key_violation then null; end;
 -- Mesa inexistente → rechazado.
 begin update public.wedding_guests set table_id = gen_random_uuid() where id = '8a000000-0000-4000-8000-000000000005'; raise exception 'Mesa inexistente aceptada';
 exception when foreign_key_violation then null; end;
 -- Sentar al invitado de B en mi mesa: RLS de wedding_guests → 0 filas.
 update public.wedding_guests set table_id = '8a100000-0000-4000-8000-000000000002' where id = '8b000000-0000-4000-8000-000000000001';
 if found then raise exception 'A sienta a un invitado de B'; end if;

 -- Asignar varios y quitar.
 update public.wedding_guests set table_id = '8a100000-0000-4000-8000-000000000002'
  where id in ('8a000000-0000-4000-8000-000000000005','8a000000-0000-4000-8000-000000000006') and wedding_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics n = row_count; if n <> 2 then raise exception 'Asignar varios: %', n; end if;
 s := public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if (s->'tables'->1->>'attending')::int <> 3 or (s->'tables'->1->>'pending')::int <> 1 or jsonb_array_length(s->'unseated') <> 0 then raise exception 'Tras asignar: %', s; end if;
 update public.wedding_guests set table_id = null where id = '8a000000-0000-4000-8000-000000000006';

 -- Borrar la Mesa 1 deja a sus tres invitados sin mesa (y no los borra).
 delete from public.wedding_tables where id = '8a100000-0000-4000-8000-000000000001';
 if not found then raise exception 'A no puede borrar su mesa'; end if;
 if (select count(*) from public.wedding_guests where wedding_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 6 then raise exception 'Borrar la mesa borró invitados'; end if;
 if exists (select 1 from public.wedding_guests where id in ('8a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000002','8a000000-0000-4000-8000-000000000003') and table_id is not null) then raise exception 'Invitados siguen en la mesa borrada'; end if;
 s := public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if jsonb_array_length(s->'unseated') <> 4 or s->'unseated'->0->>'name' <> 'Tía Puri' or s->'unseated'->3->>'name' <> 'Primo Luis' then raise exception 'Sin mesa tras borrar: %', s->'unseated'; end if;

 -- Plan de B visto por A: vacío.
 s := public.wedding_seating('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if s <> '{"tables": [], "unseated": []}'::jsonb then raise exception 'A ve el plan de B: %', s; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
do $$ declare s jsonb; begin
 s := public.wedding_seating('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if jsonb_array_length(s->'tables') <> 1 or s->'tables'->0->>'name' <> 'Mesa 1' or (s->'tables'->0->>'attending')::int <> 4 then raise exception 'Plan de B: %', s; end if;
 if (select count(*) from public.wedding_tables) <> 1 then raise exception 'B ve mesas de A'; end if;
 if public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> '{"tables": [], "unseated": []}'::jsonb then raise exception 'B ve el plan de A'; end if;
 -- Mismo nombre que una mesa de A en otra boda: permitido.
 insert into public.wedding_tables(wedding_id,name,seats) values ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mesa 2',10);
end $$;
reset role;

-- Sin sesión (anon): ni la tabla ni la función.
set local role anon;
do $$ begin
 begin perform public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'anon llama a wedding_seating';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.wedding_tables; raise exception 'anon lee wedding_tables';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Borrar la boda arrastra mesas e invitados sin chocar con el set null.
delete from public.weddings where id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
 if exists (select 1 from public.wedding_tables where wedding_id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Quedan mesas de una boda borrada'; end if;
end $$;

do $$ begin raise notice 'wedding-tables: CHECK, grants, FK cruzada, borrado → sin mesa, ocupación y aislamiento A/B OK'; end $$;
rollback;
