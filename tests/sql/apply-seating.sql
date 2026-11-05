-- Mesas automáticas (20261020110000): apply_seating. Base DE PRUEBAS vacía con
-- todas las migraciones. Dos parejas; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('91111111-1111-4111-8111-111111111111'), ('92222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seat-pareja-a','91111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','seat-pareja-b','92222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 90);
insert into public.wedding_tables(id,wedding_id,name,seats,position) values
 ('9a100000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 1',10,1),
 ('9b100000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mesa 1',10,1);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_companions) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ana','si',1),
 ('9a000000-0000-4000-8000-000000000002','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bruno','si',0),
 ('9a000000-0000-4000-8000-000000000003','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla','si',0),
 ('9b000000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Berta','si',0);

do $$ begin
 if not has_function_privilege('authenticated','public.apply_seating(uuid,jsonb,jsonb)','execute') then raise exception 'authenticated sin grant'; end if;
 if has_function_privilege('anon','public.apply_seating(uuid,jsonb,jsonb)','execute') then raise exception 'anon ejecuta apply_seating'; end if;
 if (select prosecdef from pg_proc where oid = 'public.apply_seating(uuid,jsonb,jsonb)'::regprocedure) then raise exception 'apply_seating es definer'; end if;
 if (select prosrc from pg_proc where oid = 'public.apply_seating(uuid,jsonb,jsonb)'::regprocedure) like '%couple_id%' then raise exception 'apply_seating usa couple_id'; end if;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; n int; t uuid; begin
 -- Crea dos mesas y sienta a los tres (uno en la existente) en una sola llamada.
 v := public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '[{"key":"new:1","name":"Mesa 2","seats":8},{"key":"new:2","name":"Mesa 3","seats":4}]',
   '[{"guestId":"9a000000-0000-4000-8000-000000000001","tableId":"new:1"},
     {"guestId":"9a000000-0000-4000-8000-000000000002","tableId":"new:2"},
     {"guestId":"9a000000-0000-4000-8000-000000000003","tableId":"9a100000-0000-4000-8000-000000000001"}]');
 if (v->>'seated')::int <> 3 or jsonb_array_length(v->'created') <> 2 then raise exception 'apply_seating: %', v; end if;
 select (e->>'id')::uuid into t from jsonb_array_elements(v->'created') e where e->>'key' = 'new:1';
 if (select table_id from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001') <> t then raise exception 'new:1 mal asignada'; end if;
 if (select name || '/' || seats || '/' || position from public.wedding_tables where id = t) <> 'Mesa 2/8/2' then raise exception 'Mesa nueva mal creada'; end if;
 if (select table_id from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000003') <> '9a100000-0000-4000-8000-000000000001' then raise exception 'Mesa existente mal asignada'; end if;

 -- Deshacer: tableId null les quita la mesa.
 v := public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]', '[{"guestId":"9a000000-0000-4000-8000-000000000003","tableId":null}]');
 if (select table_id from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000003') is not null then raise exception 'Deshacer no quita la mesa'; end if;

 -- Mesa de otra boda: rechazada y nada cambia.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa 9","seats":10}]',
     '[{"guestId":"9a000000-0000-4000-8000-000000000002","tableId":"9b100000-0000-4000-8000-000000000001"}]');
   raise exception 'Mesa de B aceptada';
 exception when insufficient_privilege then null; end;
 -- Invitado de otra boda: rechazado.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]',
     '[{"guestId":"9b000000-0000-4000-8000-000000000001","tableId":"9a100000-0000-4000-8000-000000000001"}]');
   raise exception 'Invitado de B aceptado';
 exception when insufficient_privilege then null; end;
 -- Boda ajena: rechazada.
 begin
   perform public.apply_seating('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '[]',
     '[{"guestId":"9b000000-0000-4000-8000-000000000001","tableId":null}]');
   raise exception 'Boda de B aceptada';
 exception when insufficient_privilege then null; end;
 -- Todo o nada: la mesa nueva se crea y la 2.ª asignación apunta a una clave desconocida → no queda ni la mesa.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa fantasma","seats":10}]',
     '[{"guestId":"9a000000-0000-4000-8000-000000000003","tableId":"new:1"},{"guestId":"9a000000-0000-4000-8000-000000000002","tableId":"new:7"}]');
   raise exception 'Clave desconocida aceptada';
 exception when invalid_parameter_value then null; end;
 if exists (select 1 from public.wedding_tables where name = 'Mesa fantasma') then raise exception 'Quedó la mesa de una llamada fallida'; end if;
 if (select table_id from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000003') is not null then raise exception 'Quedó una asignación de una llamada fallida'; end if;
 -- Nombre repetido: 23505 y nada cambia.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa 1","seats":10}]', '[]');
   raise exception 'Nombre repetido aceptado';
 exception when unique_violation then null; end;
 -- Plazas fuera de rango: CHECK.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa grande","seats":31}]', '[]');
   raise exception '31 plazas aceptadas';
 exception when check_violation then null; end;
 -- Invitado repetido y forma no válida.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]',
     '[{"guestId":"9a000000-0000-4000-8000-000000000003","tableId":null},{"guestId":"9a000000-0000-4000-8000-000000000003","tableId":null}]');
   raise exception 'Invitado repetido aceptado';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]', '[{"guestId":"no-es-uuid","tableId":null}]');
   raise exception 'guestId no válido aceptado';
 exception when invalid_parameter_value then null; end;
 -- Tope de 120 mesas por boda (ya tiene 3).
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     (select jsonb_agg(jsonb_build_object('key', 'new:' || i, 'name', 'Extra ' || i, 'seats', 10)) from generate_series(1, 118) i), '[]');
   raise exception 'Más de 120 mesas aceptadas';
 exception when invalid_parameter_value then null; end;
 -- Tope de 2.000 asignaciones.
 begin
   perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]',
     (select jsonb_agg(jsonb_build_object('guestId', '9a000000-0000-4000-8000-000000000001', 'tableId', null)) from generate_series(1, 2001)));
   raise exception 'Más de 2.000 asignaciones aceptadas';
 exception when invalid_parameter_value then null; end;
 select count(*) into n from public.wedding_tables where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if n <> 3 then raise exception 'Mesas de A: %', n; end if;
end $$;
reset role;

-- ================================================================ pareja B: intacta
set local role authenticated;
select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
do $$ begin
 if (select table_id from public.wedding_guests where id = '9b000000-0000-4000-8000-000000000001') is not null then raise exception 'A sentó a B'; end if;
 if (select count(*) from public.wedding_tables) <> 1 then raise exception 'B ve mesas de A o A creó en B'; end if;
end $$;
reset role;

set local role anon;
do $$ begin
 begin perform public.apply_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]', '[]'); raise exception 'anon llama a apply_seating';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'apply-seating: crea y sienta en bloque, deshace, todo o nada y aislamiento A/B OK'; end $$;
rollback;
