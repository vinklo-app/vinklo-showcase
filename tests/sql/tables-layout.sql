-- Plano del salón (20261028100000): forma y posición de las mesas y
-- save_floor_plan. Base DE PRUEBAS vacía con todas las migraciones. Dos
-- parejas; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('a1111111-1111-4111-8111-111111111111'), ('a2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','plano-pareja-a','a1111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','plano-pareja-b','a2222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 90);
insert into public.wedding_tables(id,wedding_id,name,seats,position) values
 ('a0100000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Mesa 1',10,1),
 ('a0100000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Mesa 2',10,2),
 ('b0100000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Mesa 1',10,1);

do $$ begin
 if not has_function_privilege('authenticated','public.save_floor_plan(uuid,jsonb)','execute') then raise exception 'authenticated sin grant'; end if;
 if has_function_privilege('anon','public.save_floor_plan(uuid,jsonb)','execute') then raise exception 'anon ejecuta save_floor_plan'; end if;
 if (select prosecdef from pg_proc where oid = 'public.save_floor_plan(uuid,jsonb)'::regprocedure) then raise exception 'save_floor_plan es definer'; end if;
 if (select prosrc from pg_proc where oid = 'public.save_floor_plan(uuid,jsonb)'::regprocedure) like '%couple_id%' then raise exception 'save_floor_plan usa couple_id'; end if;
 if (select count(*) from pg_proc where proname = 'save_floor_plan') <> 1 then raise exception 'save_floor_plan con varias sobrecargas'; end if;
 -- Grants por columna: la pareja escribe forma y posición; anon nada.
 if not has_column_privilege('authenticated','public.wedding_tables','shape','UPDATE') then raise exception 'sin update(shape)'; end if;
 if not has_column_privilege('authenticated','public.wedding_tables','pos_x','INSERT') then raise exception 'sin insert(pos_x)'; end if;
 if not has_column_privilege('authenticated','public.wedding_tables','pos_y','UPDATE') then raise exception 'sin update(pos_y)'; end if;
 if has_column_privilege('anon','public.wedding_tables','shape','SELECT') then raise exception 'anon lee shape'; end if;
 if has_column_privilege('authenticated','public.wedding_tables','wedding_id','UPDATE') then raise exception 'wedding_id actualizable'; end if;
 -- RLS sigue activa.
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_tables'::regclass) then raise exception 'RLS desactivada'; end if;
end $$;

-- CHECK de forma y posición (como superusuario, sin RLS).
do $$ begin
 begin
   update public.wedding_tables set shape = 'ovalada' where id = 'a0100000-0000-4000-8000-000000000001';
   raise exception 'forma desconocida aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_tables set pos_x = 1.5, pos_y = 0.5 where id = 'a0100000-0000-4000-8000-000000000001';
   raise exception 'posición fuera de 0-1 aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_tables set pos_x = 0.5, pos_y = null where id = 'a0100000-0000-4000-8000-000000000001';
   raise exception 'posición a medias aceptada';
 exception when check_violation then null; end;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; t uuid; begin
 -- Escritura directa de las columnas nuevas (grants por columna + RLS).
 update public.wedding_tables set shape = 'redonda', pos_x = 0.25, pos_y = 0.75 where id = 'a0100000-0000-4000-8000-000000000001';
 if (select shape || '/' || pos_x || '/' || pos_y from public.wedding_tables where id = 'a0100000-0000-4000-8000-000000000001') <> 'redonda/0.25/0.75' then raise exception 'update de forma/posición'; end if;

 -- Actualiza las dos existentes intercambiando nombres y crea una nueva, en una llamada.
 v := public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[
   {"id":"a0100000-0000-4000-8000-000000000001","name":"Mesa 2","seats":8,"shape":"rectangular","x":0.1,"y":0.2},
   {"id":"a0100000-0000-4000-8000-000000000002","name":"Mesa 1","seats":12,"shape":null,"x":null,"y":null},
   {"id":null,"name":"Presidencial","seats":6,"shape":"imperial","x":0.5,"y":0.05}]');
 if jsonb_array_length(v->'tables') <> 3 then raise exception 'save_floor_plan: %', v; end if;
 if (select name || '/' || seats || '/' || shape from public.wedding_tables where id = 'a0100000-0000-4000-8000-000000000001') <> 'Mesa 2/8/rectangular' then raise exception 'existente 1 mal guardada'; end if;
 if (select name || '/' || seats || '/' || coalesce(shape, '-') || '/' || coalesce(pos_x::text, '-') from public.wedding_tables where id = 'a0100000-0000-4000-8000-000000000002') <> 'Mesa 1/12/-/-' then raise exception 'existente 2 mal guardada'; end if;
 t := (v->'tables'->2->>'id')::uuid;
 if not (v->'tables'->2->>'created')::boolean then raise exception 'la nueva no consta como creada'; end if;
 if (select name || '/' || seats || '/' || shape || '/' || position from public.wedding_tables where id = t) <> 'Presidencial/6/imperial/3' then raise exception 'nueva mal creada'; end if;

 -- Mesa de otra boda: rechazada y nada cambia (todo o nada).
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[
     {"id":null,"name":"Mesa fantasma","seats":10},
     {"id":"b0100000-0000-4000-8000-000000000001","name":"Robada","seats":10}]');
   raise exception 'mesa de B aceptada';
 exception when insufficient_privilege then null; end;
 if exists (select 1 from public.wedding_tables where name = 'Mesa fantasma') then raise exception 'quedó la mesa de una llamada fallida'; end if;
 -- Boda ajena.
 begin
   perform public.save_floor_plan('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '[{"id":null,"name":"Intrusa","seats":10}]');
   raise exception 'boda de B aceptada';
 exception when insufficient_privilege then null; end;
 -- CHECK: forma, plazas y posición fuera de rango; todo o nada.
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Ovalada","seats":10,"shape":"ovalada"}]');
   raise exception 'forma desconocida aceptada';
 exception when check_violation then null; end;
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Grande","seats":31}]');
   raise exception '31 plazas aceptadas';
 exception when check_violation then null; end;
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Fuera","seats":10,"x":2,"y":0.5}]');
   raise exception 'posición 2 aceptada';
 exception when check_violation then null; end;
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Media","seats":10,"x":0.2}]');
   raise exception 'posición a medias aceptada';
 exception when invalid_parameter_value then null; end;
 -- Nombre repetido (con una mesa que no viene en la lista).
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Presidencial","seats":10}]');
   raise exception 'nombre repetido aceptado';
 exception when unique_violation then null; end;
 -- Lista vacía, mesa repetida y forma no válida.
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[]');
   raise exception 'lista vacía aceptada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[
     {"id":"a0100000-0000-4000-8000-000000000001","name":"X","seats":10},
     {"id":"a0100000-0000-4000-8000-000000000001","name":"Y","seats":10}]');
   raise exception 'mesa repetida aceptada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '{"id":null}');
   raise exception 'objeto aceptado';
 exception when invalid_parameter_value then null; end;

 -- La pareja A no ve ni cambia las mesas de B.
 update public.wedding_tables set shape = 'redonda' where id = 'b0100000-0000-4000-8000-000000000001';
 if exists (select 1 from public.wedding_tables where id = 'b0100000-0000-4000-8000-000000000001') then raise exception 'A ve la mesa de B'; end if;
end $$;
reset role;
do $$ begin
 if (select shape from public.wedding_tables where id = 'b0100000-0000-4000-8000-000000000001') is not null then raise exception 'A cambió la forma de una mesa de B'; end if;
end $$;

-- ================================================================ anon
set local role anon;
do $$ begin
 begin
   perform public.save_floor_plan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[{"id":null,"name":"Anon","seats":10}]');
   raise exception 'anon ejecuta save_floor_plan';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
