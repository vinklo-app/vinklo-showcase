-- Enlace personal mínimo (20261101100000 paso 1 + 20261101110000 paso 2,
-- revisión de seguridad M1 y revisión del bloque 1 F1):
-- guest_rsvp_current no devuelve textos privados (salud, logística, nombres),
-- nada privado con el plazo cerrado, NULL solo para enlaces no válidos; la RPC
-- de 10 conserva la nota de salud a petición y con «no» la borra.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('91111111-1111-4111-8111-111111111111'), ('92222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','minimo-a','91111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','minimo-b','92222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_notes) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Prima','pendiente',null),
 ('9a000000-0000-4000-8000-000000000002','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tío','si','Apunte privado de la pareja'),
 ('9b000000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','pendiente',null);
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64),null),
 ('9a000000-0000-4000-8000-000000000002','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),null),
 ('9b000000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('c',64),null);

-- (a) Permisos: la de 10 y la de 9 (envoltorio), y current, solo service_role, definer y search_path vacío.
do $$ declare f text; begin
 foreach f in array array[
   'public.guest_rsvp_respond(text,text,text,integer,text,text,text,jsonb,jsonb,boolean)',
   'public.guest_rsvp_respond(text,text,text,integer,text,text,text,jsonb,jsonb)',
   'public.guest_rsvp_current(text,text)'] loop
   if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
      or has_function_privilege('public', f, 'execute') then raise exception '% ejecutable fuera de service_role', f; end if;
   if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sin %', f; end if;
   if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '% no es definer', f; end if;
   if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig @> array['search_path=""']) then raise exception '% sin search_path', f; end if;
 end loop;
end $$;

set local role service_role;
do $$ declare j jsonb; g record; t1 timestamptz; begin
 -- (b) Pendiente: objeto (no NULL) con status NULL y el tope; nada más.
 j := public.guest_rsvp_current('minimo-a', repeat('a',64));
 if j is null or j->'status' <> 'null'::jsonb or j ? 'has_health_note' then raise exception 'pendiente mal: %', j; end if;

 -- (c) Responde con todo: salud, logística, nombres y módulos.
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, 'Celíaca', 'Vamos con carrito', '2026-10',
      '{"song":"Mediterráneo","menu":{"carne":3}}'::jsonb, '[{"name":"Leo","kid":true},{"name":"Marta"}]'::jsonb, false) <> 'ok' then
   raise exception 'respuesta completa rechazada'; end if;
 select health_consent_at into t1 from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 j := public.guest_rsvp_current('minimo-a', repeat('a',64));
 -- Ningún texto privado, en ninguna clave.
 if j ? 'notes' or j ? 'logistic_notes' or j ? 'companion_list' or j ? 'health_consent_version' then raise exception 'claves privadas: %', j; end if;
 if j::text like '%Celíaca%' or j::text like '%carrito%' or j::text like '%Leo%' or j::text like '%Marta%' then raise exception 'texto privado filtrado: %', j; end if;
 if j->>'status' <> 'si' or (j->>'companions')::int <> 2 or (j->>'has_health_note')::boolean is not true
    or (j->>'has_logistic_note')::boolean is not true or (j->>'has_companion_names')::boolean is not true
    or (j->>'health_consent_at')::timestamptz <> t1 or j->'answers'->>'song' <> 'Mediterráneo' or j->>'responded_at' is null then
   raise exception 'current incompleto: %', j; end if;

 -- (d) Reenvío con la nota en blanco y «conservar»: se quedan nota, versión y fecha del consentimiento;
 --     la logística y los nombres NULL tampoco se tocan.
 -- (now() es fijo en la transacción: la fecha original se lleva al pasado para distinguirla.)
 update public.wedding_guests set health_consent_at = timestamptz '2026-09-01 10:00+02' where id = '9a000000-0000-4000-8000-000000000001';
 t1 := timestamptz '2026-09-01 10:00+02';
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, '', null, null, null, null, true) <> 'ok' then raise exception 'conservar rechazado'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_notes <> 'Celíaca' or not g.rsvp_notes_by_guest or g.health_consent_version <> '2026-10' or g.health_consent_at <> t1
    or g.rsvp_logistic_notes <> 'Vamos con carrito' then raise exception 'conservar no conservó: %', row_to_json(g); end if;
 if (select count(*) from public.wedding_guest_companions where guest_id = '9a000000-0000-4000-8000-000000000001' and by_guest) <> 2 then
   raise exception 'conservar tocó los nombres'; end if;

 -- (e) Nota nueva con «conservar»: manda la nueva (y su consentimiento nuevo).
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, 'Sin lactosa', null, '2026-10', null, null, true) <> 'ok' then raise exception 'nota nueva rechazada'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_notes <> 'Sin lactosa' or g.health_consent_at = t1 then raise exception 'nota nueva mal: %', row_to_json(g); end if;

 -- (f) Sin «conservar» y en blanco: se borra la suya (contrato de la de 9).
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, '', null, null, null, null, false) <> 'ok' then raise exception 'borrar rechazado'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_notes is not null or g.rsvp_notes_by_guest or g.health_consent_at is not null then raise exception 'no se borró: %', row_to_json(g); end if;

 -- (g) «No» borra la nota de salud aunque llegue texto y «conservar» (ni la guarda ni da invalid).
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, 'Marisco', null, '2026-10', null, null, false) <> 'ok' then raise exception 'nota rechazada'; end if;
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'no', 0, 'Marisco', null, null, null, null, true) <> 'ok' then raise exception '«no» con nota rechazado'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_status <> 'no' or g.rsvp_notes is not null or g.rsvp_notes_by_guest or g.health_consent_at is not null or g.health_consent_version is not null then
   raise exception '«no» dejó salud: %', row_to_json(g); end if;
 -- El envoltorio de 7 (formulario antiguo) con «no» tampoco la guarda.
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'no', 0, 'Marisco', null::jsonb, null::jsonb) <> 'ok' then raise exception 'envoltorio de 7 con «no» rechazado'; end if;
 if (select rsvp_notes from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001') is not null then raise exception 'el envoltorio de 7 guardó salud con «no»'; end if;
 j := public.guest_rsvp_current('minimo-a', repeat('a',64));
 if j->>'status' <> 'no' or (j->>'has_health_note')::boolean or (j->>'has_companion_names')::boolean then raise exception '«no» mal devuelto: %', j; end if;

 -- (h) Nota de la pareja: ni has_health_note, y «conservar» no la convierte en del invitado.
 if public.guest_rsvp_respond('minimo-a', repeat('b',64), 'si', 0, '', null, null, null, null, true) <> 'ok' then raise exception 'tío rechazado'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000002';
 if g.rsvp_notes <> 'Apunte privado de la pareja' or g.rsvp_notes_by_guest or g.health_consent_at is not null then raise exception 'nota de la pareja mal: %', row_to_json(g); end if;
 j := public.guest_rsvp_current('minimo-a', repeat('b',64));
 if (j->>'has_health_note')::boolean or j->>'health_consent_at' is not null or j::text like '%Apunte%' then raise exception 'el invitado ve la nota de la pareja: %', j; end if;

 -- (h2) Llamante antiguo (la de 9) tras el paso 2: ya no recibe los textos, así
 --      que en blanco NO borra: salud conservada, logística '' y nombres [] no se tocan.
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, 'Celíaca', 'Carrito', '2026-10', null,
      '[{"name":"Leo"},{"name":"Marta"}]'::jsonb, false) <> 'ok' then raise exception 'h2 preparar'; end if;
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 2, '', '', null, null::jsonb, '[]'::jsonb) <> 'ok' then
   raise exception 'h2 envoltorio de 9 rechazado'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_notes is distinct from 'Celíaca' or not g.rsvp_notes_by_guest or g.health_consent_version is distinct from '2026-10'
    or g.rsvp_logistic_notes is distinct from 'Carrito' then raise exception 'el envoltorio de 9 perdió datos: %', row_to_json(g); end if;
 if (select count(*) from public.wedding_guest_companions where guest_id = g.id and by_guest) <> 2 then
   raise exception 'el envoltorio de 9 borró los nombres'; end if;
 -- Lo que llega escrito por la de 9 sí se guarda.
 if public.guest_rsvp_respond('minimo-a', repeat('a',64), 'si', 1, 'Sin marisco', 'Llegamos tarde', '2026-10', null::jsonb, '[{"name":"Leo"}]'::jsonb) <> 'ok' then
   raise exception 'h2 escrito'; end if;
 select * into g from public.wedding_guests where id = '9a000000-0000-4000-8000-000000000001';
 if g.rsvp_notes <> 'Sin marisco' or g.rsvp_logistic_notes <> 'Llegamos tarde'
    or (select count(*) from public.wedding_guest_companions where guest_id = g.id and by_guest) <> 1 then
   raise exception 'h2 escrito no se guardó: %', row_to_json(g); end if;

 -- (i) Aislamiento entre bodas y formatos: NULL.
 if public.guest_rsvp_current('minimo-a', repeat('c',64)) is not null then raise exception 'token de B leyó en A'; end if;
 if public.guest_rsvp_current('minimo-b', repeat('a',64)) is not null then raise exception 'token de A leyó en B'; end if;
 if public.guest_rsvp_current('minimo-a', 'abc') is not null then raise exception 'hash corto aceptado'; end if;
end $$;
reset role;

-- (j) Token revocado: NULL (la página lo explica en lugar del formulario).
update public.wedding_guest_tokens set revoked_at = now() where token_hash = repeat('b',64);
set local role service_role;
do $$ begin
 if public.guest_rsvp_current('minimo-a', repeat('b',64)) is not null then raise exception 'token revocado leyó'; end if;
end $$;
reset role;

-- (k) Plazo cerrado (fecha límite de la pareja ayer): {"closed": true} y nada más.
update public.weddings set rsvp_deadline = current_date - 1 where id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ declare j jsonb; begin
 j := public.guest_rsvp_current('minimo-a', repeat('a',64));
 if j is distinct from '{"closed": true}'::jsonb then raise exception 'cerrado devolvió de más: %', j; end if;
end $$;
reset role;
-- Boda ya celebrada (sin fecha límite): igual.
update public.weddings set rsvp_deadline = null, wedding_date = current_date - 3 where id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role service_role;
do $$ declare j jsonb; begin
 j := public.guest_rsvp_current('minimo-b', repeat('c',64));
 if j is distinct from '{"closed": true}'::jsonb then raise exception 'boda pasada devolvió de más: %', j; end if;
end $$;
reset role;
rollback;
