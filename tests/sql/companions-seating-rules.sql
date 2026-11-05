-- Nombres de acompañantes y restricciones de mesas (20261023100000, 20261023110000).
-- Base DE PRUEBAS vacía con todas las migraciones. Dos parejas; ROLLBACK al final.
begin;
insert into auth.users(id) values ('a1111111-1111-4111-8111-111111111111'), ('a2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','acomp-pareja-a','a1111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','acomp-pareja-b','a2222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 90);
insert into public.wedding_tables(id,wedding_id,name,seats,position) values
 ('aa100000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 1',10,1),
 ('ab100000-0000-4000-8000-000000000001','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mesa 1',10,1);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_companions,group_name) values
 ('aa000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ana','si',2,'Familia de Ana'),
 ('aa000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bruno','si',0,null),
 ('aa000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla','pendiente',0,null),
 ('ab000000-0000-4000-8000-000000000001','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Berta','si',1,null);
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('aa000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('7',64),null);
insert into public.wedding_guest_companions(id,wedding_id,guest_id,name,is_kid,position) values
 ('ab200000-0000-4000-8000-000000000001','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ab000000-0000-4000-8000-000000000001','Hija de Berta',true,0);

-- La suite acaba en ROLLBACK: sin esto, unique (guest_id, position) (diferida)
-- nunca se comprobaría. Así se comprueba al final de cada sentencia.
set constraints all immediate;

-- ================================================================ estructura y permisos
do $$ begin
 -- RLS activa y sin couple_id en políticas ni funciones nuevas.
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_guest_companions'::regclass) then raise exception 'companions sin RLS'; end if;
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_guest_apart'::regclass) then raise exception 'apart sin RLS'; end if;
 if exists (select 1 from pg_policies where tablename in ('wedding_guest_companions','wedding_guest_apart')
            and (coalesce(qual,'') || coalesce(with_check,'')) like '%couple_id%') then raise exception 'Política con couple_id'; end if;
 if exists (select 1 from pg_policies where tablename in ('wedding_guest_companions','wedding_guest_apart')
            and (coalesce(qual,'') || coalesce(with_check,'')) not like '%owns_wedding%') then raise exception 'Política sin owns_wedding'; end if;
 if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('set_guest_companions','wedding_seating','apply_seating')
            and (prosrc like '%couple_id%' or prosrc not like '%owns_wedding%')) then raise exception 'RPC sin owns_wedding o con couple_id'; end if;
 -- anon: nada.
 if has_table_privilege('anon','public.wedding_guest_companions','select') or has_table_privilege('anon','public.wedding_guest_apart','select') then raise exception 'anon lee'; end if;
 if has_function_privilege('anon','public.set_guest_companions(uuid,uuid,jsonb)','execute') then raise exception 'anon ejecuta set_guest_companions'; end if;
 if has_function_privilege('anon','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'anon responde'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'authenticated responde'; end if;
 -- La pareja nunca escribe by_guest.
 if has_column_privilege('authenticated','public.wedding_guest_companions','by_guest','update')
    or has_column_privilege('authenticated','public.wedding_guest_companions','by_guest','insert') then raise exception 'by_guest escribible por la pareja'; end if;
 if not has_column_privilege('authenticated','public.wedding_tables','pinned_group','update') then raise exception 'pinned_group sin grant'; end if;
 -- La de 9 (20261030100000) y los envoltorios de 7 y 5: nada más.
 if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guest_rsvp_respond') <> 4 then raise exception 'sobrecargas de guest_rsvp_respond'; end if;
 if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'apply_seating') <> 1 then raise exception 'sobrecargas de apply_seating'; end if;
 -- Dos acompañantes en la misma posición: rechazado (la comprobación inmediata funciona).
 begin
   insert into public.wedding_guest_companions(wedding_id,guest_id,name,position) values ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ab000000-0000-4000-8000-000000000001','Otra',0);
   raise exception 'posición repetida aceptada';
 exception when unique_violation then null; end;
 -- CHECK de pares ordenados.
 begin
   insert into public.wedding_guest_apart(wedding_id,guest_a,guest_b) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001');
   raise exception 'par desordenado aceptado';
 exception when check_violation then null; end;
 -- FK compuesta: acompañante de un invitado de B en la boda A.
 begin
   insert into public.wedding_guest_companions(wedding_id,guest_id,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ab000000-0000-4000-8000-000000000001','Colado');
   raise exception 'acompañante de otra boda aceptado';
 exception when foreign_key_violation then null; end;
 -- FK compuesta: mesa de B para un acompañante de A.
 begin
   insert into public.wedding_guest_companions(wedding_id,guest_id,name,table_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','Colado','ab100000-0000-4000-8000-000000000001');
   raise exception 'mesa de otra boda aceptada';
 exception when foreign_key_violation then null; end;
end $$;

-- ================================================================ invitado (service_role)
set local role service_role;
do $$ declare j jsonb; begin
 -- Más nombres que acompañantes, repetidos o vacíos: inválido.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 1, null, null, '[{"name":"Leo"},{"name":"Mia"}]') <> 'invalid' then raise exception 'Más nombres que acompañantes'; end if;
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null, '[{"name":"Leo"},{"name":"leo "}]') <> 'invalid' then raise exception 'Nombres repetidos'; end if;
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 1, null, null, '[{"name":"  "}]') <> 'invalid' then raise exception 'Nombre vacío'; end if;
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 1, null, null, '[{"name":"Leo","kid":"si"}]') <> 'invalid' then raise exception 'kid no booleano'; end if;
 -- Bien: dos nombres, uno niño.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null, '[{"name":" Leo ","kid":true},{"name":"Marta"}]') <> 'ok' then raise exception 'Nombres rechazados'; end if;
 if (select count(*) from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003' and by_guest) <> 2 then raise exception 'No se guardaron como del invitado'; end if;
 if (select name || '/' || is_kid || '/' || position from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003' and position = 0) <> 'Leo/true/0' then raise exception 'Leo mal guardado'; end if;
 j := public.guest_rsvp_current('acomp-pareja-a', repeat('7',64));
 -- Sin los nombres (20261101110000, paso 2): solo que los escribió él.
 if j ? 'companion_list' or (j->>'has_companion_names')::boolean is not true then raise exception 'current no marca los nombres: %', j; end if;
 -- Llamada antigua (6 argumentos): no toca los nombres.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null) <> 'ok' then raise exception 'Llamada de 6 rechazada'; end if;
 if (select count(*) from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003') <> 2 then raise exception 'La llamada de 6 tocó los nombres'; end if;
 -- El envoltorio de 5 sigue funcionando.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null) <> 'ok' then raise exception 'Envoltorio de 5 roto'; end if;
end $$;
reset role;

-- La pareja corrige a Marta: ya no es del invitado y no se le enseña.
-- (En producción cada petición es su transacción; aquí hay que limpiar la
-- marca que guest_rsvp_respond deja hasta el final de la transacción.)
select set_config('vinklo.guest_rsvp_write', '', true);
do $$ declare j jsonb; begin
 update public.wedding_guest_companions set name = 'Marta López' where guest_id = 'aa000000-0000-4000-8000-000000000003' and name = 'Marta';
 if (select by_guest from public.wedding_guest_companions where name = 'Marta López') then raise exception 'Edición de la pareja quedó como del invitado'; end if;
 -- Leo en la Mesa 1 (mesa infantil, por ejemplo).
 update public.wedding_guest_companions set table_id = 'aa100000-0000-4000-8000-000000000001' where guest_id = 'aa000000-0000-4000-8000-000000000003' and name = 'Leo';
 if not (select by_guest from public.wedding_guest_companions where name = 'Leo') then raise exception 'Sentar a Leo cambió la autoría'; end if;
 set local role service_role;
 j := public.guest_rsvp_current('acomp-pareja-a', repeat('7',64));
 if j ? 'companion_list' or (j->>'has_companion_names')::boolean is not true then raise exception 'El invitado ve nombres de la pareja: %', j; end if;
 -- Reenvía con Leo y Sara: Leo conserva su mesa, Marta López (de la pareja) sale: manda el invitado.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null, '[{"name":"leo","kid":true},{"name":"Sara"}]') <> 'ok' then raise exception 'Reenvío rechazado'; end if;
 reset role;
 perform set_config('vinklo.guest_rsvp_write', '', true);
 if (select table_id from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003' and lower(name) = 'leo') is distinct from 'aa100000-0000-4000-8000-000000000001' then raise exception 'Leo perdió su mesa'; end if;
 if exists (select 1 from public.wedding_guest_companions where name = 'Marta López') then raise exception 'La lista del invitado no sustituyó a la anterior'; end if;
 -- La pareja añade a Tomás; el invitado responde sin nombres: solo se borran los suyos.
 insert into public.wedding_guest_companions(wedding_id,guest_id,name,position) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000003','Tomás',5);
 set local role service_role;
 -- Con el envoltorio antiguo (paso 2) una lista vacía con «sí» ya no borra nada.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null, '[]') <> 'ok' then raise exception 'Lista vacía (7) rechazada'; end if;
 if (select count(*) from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003' and by_guest) = 0 then raise exception 'El envoltorio antiguo borró los nombres'; end if;
 -- La de 10 con lista vacía: solo se borran los suyos.
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'si', 2, null, null, null, null, '[]'::jsonb, false) <> 'ok' then raise exception 'Lista vacía rechazada'; end if;
 reset role;
 perform set_config('vinklo.guest_rsvp_write', '', true);
 if (select string_agg(name, ',') from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000003') <> 'Tomás' then raise exception 'Lista vacía borró lo de la pareja o dejó lo suyo'; end if;
 -- «No» con nombres: inválido (tope 0).
 set local role service_role;
 if public.guest_rsvp_respond('acomp-pareja-a', repeat('7',64), 'no', 0, null, null, '[{"name":"Leo"}]') <> 'invalid' then raise exception '«No» con nombres aceptado'; end if;
 reset role;
end $$;

-- ================================================================ pareja A
select set_config('vinklo.guest_rsvp_write', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; id1 uuid; seat jsonb; begin
 -- Ve solo lo suyo.
 if exists (select 1 from public.wedding_guest_companions where wedding_id = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'A ve acompañantes de B'; end if;
 -- set_guest_companions: crea, reordena y conserva.
 v := public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','[{"name":"Pablo","kid":true},{"name":"Irene","kid":true}]');
 if jsonb_array_length(v) <> 2 or v->0->>'name' <> 'Pablo' or (v->0->>'by_guest')::boolean then raise exception 'set_guest_companions: %', v; end if;
 id1 := (v->0->>'id')::uuid;
 update public.wedding_guest_companions set table_id = 'aa100000-0000-4000-8000-000000000001' where id = id1;
 v := public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001',
   jsonb_build_array(jsonb_build_object('id', id1, 'name', 'Pablo G.', 'kid', true)));
 if jsonb_array_length(v) <> 1 or (v->0->>'table_id')::uuid is distinct from 'aa100000-0000-4000-8000-000000000001' then raise exception 'No conserva la mesa: %', v; end if;
 -- Id de otra boda: rechazado.
 begin
   perform public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','[{"id":"ab200000-0000-4000-8000-000000000001","name":"Robada"}]');
   raise exception 'Id ajeno aceptado';
 exception when insufficient_privilege then null; end;
 -- Invitado de otra boda o boda ajena: rechazado.
 begin
   perform public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ab000000-0000-4000-8000-000000000001','[]');
   raise exception 'Invitado de B aceptado';
 exception when insufficient_privilege then null; end;
 begin
   perform public.set_guest_companions('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ab000000-0000-4000-8000-000000000001','[]');
   raise exception 'Boda de B aceptada';
 exception when insufficient_privilege then null; end;
 -- Más de 10: rechazado.
 begin
   perform public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001',
     (select jsonb_agg(jsonb_build_object('name', 'N' || i)) from generate_series(1, 11) i));
   raise exception 'Once acompañantes aceptados';
 exception when invalid_parameter_value then null; end;

 -- No sentar juntos: A sí, con B no.
 insert into public.wedding_guest_apart(wedding_id,guest_a,guest_b) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002');
 begin
   insert into public.wedding_guest_apart(wedding_id,guest_a,guest_b) values ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001');
   raise exception 'A escribió en B';
 exception when insufficient_privilege or foreign_key_violation then null; end;
 -- Mesa fija para un grupo.
 update public.wedding_tables set pinned_group = 'Familia de Ana' where id = 'aa100000-0000-4000-8000-000000000001';
 begin
   update public.wedding_tables set pinned_group = ' mal ' where id = 'aa100000-0000-4000-8000-000000000001';
   raise exception 'pinned_group sin recortar aceptado';
 exception when check_violation then null; end;

 -- wedding_seating trae nombres, kids derivado, pinned_group y apart.
 seat := public.wedding_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if seat->'apart' <> '[["aa000000-0000-4000-8000-000000000001","aa000000-0000-4000-8000-000000000002"]]'::jsonb then raise exception 'apart: %', seat->'apart'; end if;
 if seat->'tables'->0->>'pinned_group' <> 'Familia de Ana' then raise exception 'pinned_group: %', seat->'tables'->0; end if;
 if (select (x->>'kids')::int from jsonb_array_elements(seat->'unseated') x where x->>'name' = 'Ana') <> 1 then raise exception 'kids no derivado: %', seat; end if;
 if (select jsonb_array_length(x->'companion_list') from jsonb_array_elements(seat->'unseated') x where x->>'name' = 'Ana') <> 1 then raise exception 'companion_list: %', seat; end if;
 if public.wedding_seating('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not null
    and public.wedding_seating('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'tables' <> '[]'::jsonb then raise exception 'A ve el plano de B'; end if;

 -- apply_seating con acompañantes: crea la mesa infantil y sienta a Pablo allí.
 v := public.apply_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa infantil","seats":8}]',
   jsonb_build_array(jsonb_build_object('companionId', id1, 'tableId', 'new:1'),
                     jsonb_build_object('guestId', 'aa000000-0000-4000-8000-000000000002', 'tableId', 'aa100000-0000-4000-8000-000000000001')));
 if (v->>'companions')::int <> 1 or (v->>'seated')::int <> 1 then raise exception 'apply con acompañantes: %', v; end if;
 if (select t.name from public.wedding_guest_companions c join public.wedding_tables t on t.id = c.table_id where c.id = id1) <> 'Mesa infantil' then raise exception 'Pablo no está en la mesa infantil'; end if;
 -- Acompañante de B: error y nada cambia (ni la mesa nueva).
 begin
   perform public.apply_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"key":"new:1","name":"Mesa infantil 2","seats":8}]',
     '[{"companionId":"ab200000-0000-4000-8000-000000000001","tableId":"new:1"}]');
   raise exception 'Acompañante de B aceptado';
 exception when insufficient_privilege then null; end;
 if exists (select 1 from public.wedding_tables where name = 'Mesa infantil 2') then raise exception 'Quedó la mesa creada'; end if;
 -- guestId y companionId a la vez: forma no válida.
 begin
   perform public.apply_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]',
     jsonb_build_array(jsonb_build_object('companionId', id1, 'guestId', 'aa000000-0000-4000-8000-000000000002', 'tableId', null)));
   raise exception 'Asignación doble aceptada';
 exception when invalid_parameter_value then null; end;
 -- De vuelta con su familia (null).
 perform public.apply_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]', jsonb_build_array(jsonb_build_object('companionId', id1, 'tableId', null)));
 if (select table_id from public.wedding_guest_companions where id = id1) is not null then raise exception 'No volvió con su familia'; end if;
end $$;
reset role;

-- ================================================================ pareja B no toca lo de A
set local role authenticated;
select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
do $$ declare n int; begin
 if exists (select 1 from public.wedding_guest_companions where wedding_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'B ve acompañantes de A'; end if;
 if exists (select 1 from public.wedding_guest_apart where wedding_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'B ve pares de A'; end if;
 delete from public.wedding_guest_apart where wedding_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 update public.wedding_guest_companions set name = 'Hackeado' where wedding_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 begin
   insert into public.wedding_guest_companions(wedding_id,guest_id,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','Intruso');
   raise exception 'B insertó en A';
 exception when insufficient_privilege then null; end;
 begin
   perform public.apply_seating('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]', '[]');
   raise exception 'B aplicó en A';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.wedding_guest_apart where wedding_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then raise exception 'B borró pares de A'; end if;
 if exists (select 1 from public.wedding_guest_companions where name = 'Hackeado') then raise exception 'B editó acompañantes de A'; end if;
end $$;

-- ================================================================ anon
set local role anon;
do $$ begin
 begin
   perform 1 from public.wedding_guest_companions;
   raise exception 'anon lee acompañantes';
 exception when insufficient_privilege then null; end;
 begin
   perform public.set_guest_companions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aa000000-0000-4000-8000-000000000001','[]');
   raise exception 'anon guarda acompañantes';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Borrar la mesa deja al acompañante con su familia; borrar al invitado borra sus acompañantes y pares.
do $$ begin
 update public.wedding_guest_companions set table_id = 'aa100000-0000-4000-8000-000000000001' where name = 'Pablo G.';
 delete from public.wedding_tables where id = 'aa100000-0000-4000-8000-000000000001';
 if (select table_id from public.wedding_guest_companions where name = 'Pablo G.') is not null then raise exception 'on delete set null (table_id)'; end if;
 delete from public.wedding_guests where id = 'aa000000-0000-4000-8000-000000000001';
 if exists (select 1 from public.wedding_guest_companions where guest_id = 'aa000000-0000-4000-8000-000000000001') then raise exception 'Quedaron acompañantes huérfanos'; end if;
 if exists (select 1 from public.wedding_guest_apart where guest_a = 'aa000000-0000-4000-8000-000000000001') then raise exception 'Quedaron pares huérfanos'; end if;
end $$;
rollback;
