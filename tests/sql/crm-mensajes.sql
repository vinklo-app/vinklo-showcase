-- CRM mensajes (20261004100000): plantillas, recordatorios, filtros por tarea.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/crm-mensajes.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','crm-pareja-a','11111111-1111-4111-8111-111111111111','Ana','Luis','2027-06-12'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','crm-pareja-b','22222222-2222-4222-8222-222222222222','Lucia','Juan',null);

-- Un invitado por caso. a1..a9 en la boda A; b1 en la B.
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,rsvp_notes,invitation_prepared_at,invitation_sent_at,last_reminder_at,reminders_opt_out,created_at) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sin enviar','612345678','pendiente',null,now(),null,null,false,now()-interval '9 min'),
 ('a0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Espera nunca recordada','+34 612 000 002','pendiente',null,now(),now()-interval '5 days',null,false,now()-interval '8 min'),
 ('a0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Espera recordada hace 2 dias','612000003','pendiente',null,now(),now()-interval '10 days',now()-interval '2 days',false,now()-interval '7 min'),
 ('a0000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Espera recordada hace 4 dias','612000004','pendiente',null,now(),now()-interval '10 days',now()-interval '4 days',false,now()-interval '6 min'),
 ('a0000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Espera no recordar','612000005','pendiente',null,now(),now()-interval '10 days',null,true,now()-interval '5 min'),
 ('a0000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Espera sin telefono',null,'pendiente',null,now(),now()-interval '10 days',null,false,now()-interval '4 min'),
 ('a0000000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Telefono fijo','123456','pendiente',null,null,null,null,false,now()-interval '3 min'),
 ('a0000000-0000-4000-8000-000000000008','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Viene con notas','612000008','si','Celíaca',now(),now()-interval '10 days',null,false,now()-interval '2 min'),
 ('a0000000-0000-4000-8000-000000000009','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','No viene','+44 7700 900123','no','   ',null,null,null,false,now()-interval '1 min'),
 ('b0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Otra pareja','612999999','pendiente',null,now(),now()-interval '10 days',null,false,now());

-- ------------------------------------------------ oráculo de teléfonos
-- MISMA lista que lib/invitation-sharing.test.ts (WHATSAPP_NUMBER_ORACLE).
do $$
declare r record;
begin
 for r in select * from (values
   ('612 345 678','34612345678'), ('+34 612 345 678','34612345678'), ('0034 612345678','34612345678'),
   ('+44 7700 900123','447700900123'), ('0044 7700 900123','447700900123'), ('(612) 34-56.78','34612345678'),
   ('  712345678  ','34712345678'), (E'612\u00a0345\u00a0678','34612345678'), ('+1 415 555 2671','14155552671'), ('6123456789','6123456789'),
   ('912345678',null), ('61234567',null), ('123',null), ('',null), ('javascript:alert(1)',null),
   ('+00000000000',null), ('+0034612345678',null), ('+34 612 345 678 9012 3456',null)
 ) v(phone, expected) loop
   if public.whatsapp_number(r.phone) is distinct from r.expected then
     raise exception 'whatsapp_number(%) = %, esperado %', r.phone, public.whatsapp_number(r.phone), r.expected;
   end if;
 end loop;
 if public.whatsapp_number(null) is not null then raise exception 'null phone accepted'; end if;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare c record; k text; page_total bigint; page_rows bigint; expected bigint; ids uuid[]; r record;
begin
 -- Recuentos exactos por caso.
 select * into c from public.guest_filter_counts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if (c.todos, c.sin_enviar, c.esperando, c.para_recordar, c.vienen, c.no_vienen, c.sin_telefono, c.con_notas, c.sin_respuesta)
    is distinct from (9::bigint, 2::bigint, 5::bigint, 2::bigint, 1::bigint, 1::bigint, 2::bigint, 1::bigint, 7::bigint) then
   raise exception 'Recuentos incorrectos: %', c;
 end if;

 -- Cada chip devuelve exactamente lo que dice su recuento (página y total).
 foreach k in array array['todos','sin_enviar','esperando','para_recordar','vienen','no_vienen','sin_telefono','con_notas','sin_respuesta'] loop
   execute format('select %I from public.guest_filter_counts($1)', k) into expected using 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
   select count(*), coalesce(max(total_count),0) into page_rows, page_total
     from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', k, '', 100, 0);
   if page_rows <> expected or page_total <> expected then
     raise exception 'Chip % : recuento % / filas % / total %', k, expected, page_rows, page_total;
   end if;
 end loop;
 if exists(select 1 from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','desconocido','',100,0)) then
   raise exception 'Filtro desconocido devuelve filas';
 end if;

 -- Orden estable (created_at, id), paginación y búsqueda sin comodines.
 select array_agg(id order by ord) into ids from (
   select id, row_number() over () ord from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',3,3)) p;
 if ids <> array['a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006']::uuid[] then
   raise exception 'Paginación/orden inestable: %', ids;
 end if;
 if (select max(total_count) from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','ESPERA',100,0)) <> 5 then raise exception 'Búsqueda sin mayúsculas falla'; end if;
 if (select count(*) from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','esperando','dias',100,0)) <> 2 then raise exception 'Filtro + búsqueda falla'; end if;
 if exists(select 1 from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','%',100,0)) then raise exception 'Comodín interpretado'; end if;
 if (select count(*) from public.guest_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100000,0)) <> 9 then raise exception 'Límite alto no acotado correctamente'; end if;

 -- Fila de recordatorios: solo 2 y 4 (2 días = fuera; opt-out, sin teléfono, sin enviar y respondidos fuera).
 -- Orden: quien menos recientemente se contactó (coalesce(last_reminder_at, invitation_sent_at)).
 select array_agg(id order by ord) into ids from (
   select id, row_number() over () ord from public.reminder_queue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200)) q;
 if ids is distinct from array['a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000004']::uuid[] then
   raise exception 'Fila de recordatorios incorrecta: %', ids;
 end if;

 -- Confirmar recordatorio: +1, idempotente 60 s, sale de la fila.
 select * into r from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000002');
 if r.reminder_count <> 1 or r.last_reminder_at is null then raise exception 'Primer recordatorio no registrado: %', r; end if;
 select * into r from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000002');
 if r.reminder_count <> 1 then raise exception 'Doble pulsación sumó dos: %', r; end if;
 if exists(select 1 from public.reminder_queue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',200) where id='a0000000-0000-4000-8000-000000000002') then
   raise exception 'Recordada hoy sigue en la fila';
 end if;
 if (select para_recordar from public.guest_filter_counts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 1 then raise exception 'Recuento para_recordar no baja'; end if;
 -- Sin invitación enviada o de otra boda: 0 filas, nada cambia.
 if exists(select 1 from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000001')) then raise exception 'Recordatorio sin invitación enviada'; end if;
 if exists(select 1 from public.confirm_guest_reminder('b0000000-0000-4000-8000-000000000001')) then raise exception 'Recordatorio en boda ajena'; end if;

 -- Opt-out por la Data API (RLS limita a la propia boda).
 update public.wedding_guests set reminders_opt_out = true where id='a0000000-0000-4000-8000-000000000004';
 if exists(select 1 from public.reminder_queue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',200)) then raise exception 'Opt-out sigue en la fila'; end if;

 -- Aislamiento de agregados y listas.
 if exists(select 1 from public.guest_filter_counts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Recuentos ajenos expuestos'; end if;
 if exists(select 1 from public.guest_page('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','todos','',100,0)) then raise exception 'Página ajena expuesta'; end if;
 if exists(select 1 from public.reminder_queue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',200)) then raise exception 'Fila ajena expuesta'; end if;

 -- Plantillas: crear, editar y reglas del CHECK.
 insert into public.wedding_message_templates(wedding_id,kind,body)
   values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitation','Hola {nombre}, aquí va: {enlace} — {novios} {fecha}');
 update public.wedding_message_templates set body='Ven {nombre}: {enlace}', updated_at=now()
   where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='invitation';
 begin
   update public.wedding_message_templates set body='Sin enlace {nombre}' where kind='invitation';
   raise exception 'Plantilla sin {enlace} aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_message_templates set body='{enlace} {apellido}' where kind='invitation';
   raise exception 'Variable desconocida aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_message_templates set body='{enlace} }' where kind='invitation';
   raise exception 'Llave suelta aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_message_templates set body='{enlace}' || repeat('x', 993) where kind='invitation';
   raise exception 'Plantilla de 1001 caracteres aceptada';
 exception when check_violation then null; end;
 update public.wedding_message_templates set body='{enlace}' || repeat('x', 992) where kind='invitation';
 begin
   insert into public.wedding_message_templates(wedding_id,kind,body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aviso','{enlace}');
   raise exception 'Tipo desconocido aceptado';
 exception when check_violation then null; end;
 begin
   update public.wedding_message_templates set kind='reminder' where kind='invitation';
   raise exception 'kind modificable';
 exception when insufficient_privilege then null; end;
 begin
   update public.wedding_message_templates set wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
   raise exception 'wedding_id modificable';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.wedding_message_templates(wedding_id,kind,body) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','reminder','{enlace}');
   raise exception 'Plantilla escrita en boda ajena';
 exception when insufficient_privilege then null; end;
 insert into public.wedding_message_templates(wedding_id,kind,body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reminder','¿Vienes? {enlace}');
end $$;

-- 60 s después se puede volver a sumar (now() es fijo en la transacción: se envejece la marca).
reset role;
update public.wedding_guests set last_reminder_at = now() - interval '61 seconds' where id='a0000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare r record; begin
 select * into r from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000002');
 if r.reminder_count <> 2 then raise exception 'Tras 60 s no suma: %', r; end if;
end $$;

-- ================================================================ pareja B
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare affected integer; begin
 if exists(select 1 from public.wedding_message_templates where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Plantilla ajena legible'; end if;
 update public.wedding_message_templates set body='{enlace} pirata' where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Plantilla ajena modificada'; end if;
 delete from public.wedding_message_templates where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Plantilla ajena borrada'; end if;
 update public.wedding_guests set reminders_opt_out = true, reminder_count = 99 where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Invitado ajeno modificado'; end if;
 if (select para_recordar from public.guest_filter_counts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 then raise exception 'Fila propia de B incorrecta'; end if;
 if (select count(*) from public.reminder_queue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',200)) <> 1 then raise exception 'Fila propia de B no disponible'; end if;
end $$;

-- ================================================================ anon
set local role anon;
do $$ begin
 if has_table_privilege('anon','public.wedding_message_templates','select') then raise exception 'Plantillas expuestas a anon'; end if;
 if has_function_privilege('anon','public.guest_filter_counts(uuid)','execute') then raise exception 'Recuentos expuestos a anon'; end if;
 if has_function_privilege('anon','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute') then raise exception 'Página expuesta a anon'; end if;
 if has_function_privilege('anon','public.reminder_queue(uuid,integer,text,text)','execute') then raise exception 'Fila expuesta a anon'; end if;
 if has_function_privilege('anon','public.confirm_guest_reminder(uuid)','execute') then raise exception 'Confirmación expuesta a anon'; end if;
end $$;

-- Estado final como superusuario: nada de B tocó A.
reset role;
do $$ begin
 if (select reminder_count from public.wedding_guests where id='a0000000-0000-4000-8000-000000000002') <> 2 then raise exception 'Contador final incorrecto'; end if;
 if (select reminder_count from public.wedding_guests where id='b0000000-0000-4000-8000-000000000001') <> 0 then raise exception 'Contador de B tocado'; end if;
 if (select count(*) from public.wedding_message_templates where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Plantillas de A perdidas'; end if;
 if (select count(*) from public.wedding_guests where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and reminder_count = 99) <> 0 then raise exception 'B escribió en A'; end if;
end $$;
-- ======================================================= enlaces (tokens)
-- Varios tokens activos por invitado; recordatorio no invalida el original;
-- «Regenerar» revoca todos. Hashes ficticios (64 hex).
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status)
 values ('a0000000-0000-4000-8000-000000000010','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Enlaces','612000010','pendiente');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if has_table_privilege('authenticated','public.wedding_guest_tokens','select')
    or has_table_privilege('authenticated','public.wedding_guest_tokens','insert')
    or has_table_privilege('authenticated','public.wedding_guest_tokens','update') then raise exception 'Tokens accesibles por la Data API'; end if;
 -- Recordatorio antes de enviar la invitación: nada.
 if exists(select 1 from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('1',64), 'reminder')) then raise exception 'Recordatorio sin envío emitido'; end if;
 -- Invitación (regenerate) → preparada, no enviada.
 if (select count(*) from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('1',64), 'regenerate')) <> 1 then raise exception 'Invitación no emitida'; end if;
 if exists(select 1 from public.wedding_guests where id='a0000000-0000-4000-8000-000000000010' and (invitation_prepared_at is null or invitation_sent_at is not null)) then raise exception 'Estado tras regenerar incorrecto'; end if;
 update public.wedding_guests set invitation_sent_at = now() where id='a0000000-0000-4000-8000-000000000010';
 -- Recordatorio: añade sin revocar ni tocar el envío.
 if (select count(*) from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('2',64), 'reminder')) <> 1 then raise exception 'Recordatorio no emitido'; end if;
 if exists(select 1 from public.wedding_guests where id='a0000000-0000-4000-8000-000000000010' and invitation_sent_at is null) then raise exception 'Recordatorio quitó «enviada»'; end if;
 -- Datos inválidos: nada.
 if exists(select 1 from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', 'xyz', 'reminder')) then raise exception 'Hash inválido aceptado'; end if;
 if exists(select 1 from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('9',64), 'otro')) then raise exception 'Modo inválido aceptado'; end if;
 if exists(select 1 from public.issue_guest_token('b0000000-0000-4000-8000-000000000001', repeat('9',64), 'regenerate')) then raise exception 'Token emitido en boda ajena'; end if;
 begin
   perform public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('1',64), 'reminder');
   raise exception 'Hash duplicado aceptado';
 exception when unique_violation then null; end;
end $$;
-- Pareja B no puede emitir para A.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('8',64), 'reminder')) then raise exception 'B emitió enlace para A'; end if;
 if exists(select 1 from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('8',64), 'regenerate')) then raise exception 'B regeneró enlace de A'; end if;
end $$;
-- Búsqueda del RSVP (service_role, como lib/actions/rsvp.ts): token activo + boda.
set local role service_role;
do $$ begin
 if (select guest_id from public.wedding_guest_tokens where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and token_hash=repeat('1',64) and revoked_at is null) is distinct from 'a0000000-0000-4000-8000-000000000010'::uuid then raise exception 'El enlace original dejó de funcionar tras el recordatorio'; end if;
 if (select guest_id from public.wedding_guest_tokens where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and token_hash=repeat('2',64) and revoked_at is null) is distinct from 'a0000000-0000-4000-8000-000000000010'::uuid then raise exception 'El enlace del recordatorio no funciona'; end if;
 if exists(select 1 from public.wedding_guest_tokens where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and token_hash=repeat('1',64) and revoked_at is null) then raise exception 'Token válido en otra boda'; end if;
end $$;
-- Regenerar revoca TODOS y deja uno.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.issue_guest_token('a0000000-0000-4000-8000-000000000010', repeat('3',64), 'regenerate')) <> 1 then raise exception 'Regenerar no emitió'; end if;
 if exists(select 1 from public.wedding_guests where id='a0000000-0000-4000-8000-000000000010' and invitation_sent_at is not null) then raise exception 'Regenerar no quitó «enviada»'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.wedding_guest_tokens where token_hash in (repeat('1',64), repeat('2',64)) and revoked_at is null) then raise exception 'Token revocado sigue activo'; end if;
 if (select count(*) from public.wedding_guest_tokens where guest_id='a0000000-0000-4000-8000-000000000010' and revoked_at is null) <> 1 then raise exception 'Debe quedar un único token activo'; end if;
 if (select invitation_token_hash from public.wedding_guests where id='a0000000-0000-4000-8000-000000000010') <> repeat('3',64) then raise exception 'Columna de compatibilidad no sincronizada'; end if;
 -- FK compuesta: un token no puede apuntar a un invitado de otra boda.
 begin
   insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values ('a0000000-0000-4000-8000-000000000010','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('7',64));
   raise exception 'Token cruzado entre bodas aceptado';
 exception when foreign_key_violation then null; end;
end $$;
set local role anon;
do $$ begin
 if has_function_privilege('anon','public.issue_guest_token(uuid,text,text)','execute') then raise exception 'Emisión expuesta a anon'; end if;
 if has_table_privilege('anon','public.wedding_guest_tokens','select') then raise exception 'Tokens expuestos a anon'; end if;
end $$;
reset role;
-- Borrar el invitado borra sus tokens.
delete from public.wedding_guests where id='a0000000-0000-4000-8000-000000000010';
do $$ begin
 if exists(select 1 from public.wedding_guest_tokens where guest_id='a0000000-0000-4000-8000-000000000010') then raise exception 'Tokens huérfanos'; end if;
end $$;

-- Borrar la boda arrastra sus plantillas.
delete from public.weddings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 if exists(select 1 from public.wedding_message_templates where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Plantillas huérfanas'; end if;
end $$;
rollback;
