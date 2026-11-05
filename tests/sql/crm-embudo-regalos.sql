-- CRM completo (20261008100000): apertura del enlace, regalos y agregados.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/crm-embudo-regalos.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('61111111-1111-4111-8111-111111111111'), ('62222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','crm-pareja-a','61111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','crm-pareja-b','62222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 60);
-- A: 7 invitados en todas las etapas.
--  a1 añadido · a2 preparada · a3 enviada hace 5 días · a4 abierta (enviada hace 5 días, teléfono)
--  a5 abierta sin envío confirmado · a6 sí +2 · a7 no
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,rsvp_companions,invitation_prepared_at,invitation_sent_at) values
 ('6a000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alba',null,'pendiente',0,null,null),
 ('6a000000-0000-4000-8000-000000000002','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bea',null,'pendiente',0,now(),null),
 ('6a000000-0000-4000-8000-000000000003','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla','612345678','pendiente',0,now() - interval '6 days',now() - interval '5 days'),
 ('6a000000-0000-4000-8000-000000000004','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Dani','612345679','pendiente',0,now() - interval '6 days',now() - interval '5 days'),
 ('6a000000-0000-4000-8000-000000000005','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Eva','612345670','pendiente',0,now(),null),
 ('6a000000-0000-4000-8000-000000000006','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fran',null,'si',2,now(),now()),
 ('6a000000-0000-4000-8000-000000000007','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Gema',null,'no',0,null,null),
 ('6b000000-0000-4000-8000-000000000001','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B',null,'pendiente',0,now(),now());
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('6a000000-0000-4000-8000-000000000004','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('4',64),null),
 ('6a000000-0000-4000-8000-000000000005','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('5',64),null),
 ('6a000000-0000-4000-8000-000000000003','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('3',64),now()),
 ('6b000000-0000-4000-8000-000000000001','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('b',64),null);

-- ------------------------------------------------------------ privilegios
do $$ begin
 if has_function_privilege('anon','public.guest_invitation_opened(text,text,uuid)','execute') then raise exception 'opened ejecutable por anon'; end if;
 if has_function_privilege('authenticated','public.guest_invitation_opened(text,text,uuid)','execute') then raise exception 'opened ejecutable por authenticated'; end if;
 if not has_function_privilege('service_role','public.guest_invitation_opened(text,text,uuid)','execute') then raise exception 'service_role no puede registrar aperturas'; end if;
 if has_table_privilege('anon','public.wedding_gifts','select') or has_table_privilege('anon','public.wedding_gift_givers','select') then raise exception 'anon lee regalos'; end if;
 if has_function_privilege('anon','public.crm_gift_summary(uuid)','execute') or has_function_privilege('anon','public.crm_funnel_summary(uuid)','execute')
    or has_function_privilege('anon','public.create_wedding_gift(uuid,uuid[],text,integer,text,text,date)','execute')
    or has_function_privilege('anon','public.wedding_gift_list(uuid)','execute') then raise exception 'RPC del CRM ejecutable por anon'; end if;
 if not has_function_privilege('authenticated','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute')
    or not has_function_privilege('authenticated','public.guest_filter_counts(uuid)','execute') then raise exception 'guest_page/guest_filter_counts perdieron el grant'; end if;
 -- Las vistas públicas no conocen regalos ni aperturas.
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name ~ '(gift|opened|amount)') then raise exception 'Vista pública con datos del CRM'; end if;
end $$;

-- ------------------------------------------------------------- apertura
-- Web retirada en B; A sin fila (adaptador v1) = disponible.
insert into public.wedding_sites(wedding_id,draft_document,published_at,unpublished_at)
 values ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{"schemaVersion":1}'::jsonb, now() - interval '1 day', now());
set local role service_role;
do $$ declare first_open timestamptz; begin
 if public.guest_invitation_opened('crm-pareja-a', 'XYZ') <> 'invalid' then raise exception 'Hash malformado aceptado'; end if;
 if public.guest_invitation_opened('Crm Pareja', repeat('4',64)) <> 'invalid' then raise exception 'Slug malformado aceptado'; end if;
 if public.guest_invitation_opened('no-existe', repeat('4',64)) <> 'unavailable' then raise exception 'Slug inexistente aceptado'; end if;
 -- Token revocado (a3) y token de otra boda: nada.
 if public.guest_invitation_opened('crm-pareja-a', repeat('3',64)) <> 'unavailable' then raise exception 'Token revocado cuenta'; end if;
 if public.guest_invitation_opened('crm-pareja-a', repeat('b',64)) <> 'unavailable' then raise exception 'Token de B cuenta en A'; end if;
 if public.guest_invitation_opened('crm-pareja-b', repeat('4',64)) <> 'unavailable' then raise exception 'Token de A cuenta en B'; end if;
 -- Web retirada: no cuenta.
 if public.guest_invitation_opened('crm-pareja-b', repeat('b',64)) <> 'withdrawn' then raise exception 'Web retirada cuenta'; end if;
 if (select invitation_opened_at from public.wedding_guests where id='6b000000-0000-4000-8000-000000000001') is not null then raise exception 'Apertura con web retirada'; end if;
 -- La pareja abriendo su propio enlace (vista previa): no cuenta.
 if public.guest_invitation_opened('crm-pareja-a', repeat('4',64), '61111111-1111-4111-8111-111111111111') <> 'owner' then raise exception 'Vista previa de la pareja cuenta'; end if;
 if (select invitation_opened_at from public.wedding_guests where id='6a000000-0000-4000-8000-000000000004') is not null then raise exception 'Vista previa guardó apertura'; end if;
 -- Otra persona con sesión (no la pareja) sí cuenta.
 if public.guest_invitation_opened('crm-pareja-a', repeat('4',64), '62222222-2222-4222-8222-222222222222') <> 'ok' then raise exception 'Primera apertura rechazada'; end if;
 select invitation_opened_at into first_open from public.wedding_guests where id='6a000000-0000-4000-8000-000000000004';
 if first_open is null then raise exception 'Apertura no guardada'; end if;
 -- Segunda apertura: se conserva la primera.
 if public.guest_invitation_opened('crm-pareja-a', repeat('4',64)) <> 'already' then raise exception 'Segunda apertura no idempotente'; end if;
 if (select invitation_opened_at from public.wedding_guests where id='6a000000-0000-4000-8000-000000000004') is distinct from first_open then raise exception 'Primera apertura sobrescrita'; end if;
 if public.guest_invitation_opened('crm-pareja-a', repeat('5',64)) <> 'ok' then raise exception 'Apertura de a5 rechazada'; end if;
end $$;
reset role;
-- Apertura de a4 «hace 4 días» para que el embudo la considere (now() es fijo en la transacción).
update public.wedding_guests set invitation_opened_at = now() - interval '4 days' where id='6a000000-0000-4000-8000-000000000004';
-- Quien respondió también cuenta como abierta/enviada en «alcanzado»; a6 abrió.
update public.wedding_guests set invitation_opened_at = now() where id='6a000000-0000-4000-8000-000000000006';

set local role anon;
do $$ begin
 perform public.guest_invitation_opened('crm-pareja-a', repeat('4',64));
 raise exception 'anon registró una apertura';
exception when insufficient_privilege then null; end $$;
reset role;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
do $$
declare r record; f record; v1 uuid; v2 uuid; v3 uuid; ok boolean; affected integer; j jsonb;
begin
 -- La pareja no puede fabricar aperturas (grant de tabla + trigger).
 begin
   update public.wedding_guests set invitation_opened_at = now() where id='6a000000-0000-4000-8000-000000000001';
   raise exception 'Apertura fabricada por la pareja';
 exception when insufficient_privilege then null; end;

 -- Embudo: alcanzado acumulado.
 select * into f from public.crm_funnel_summary('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 -- added 7; prepared: a2..a7 = 6; sent: a3,a4,a5(abrió),a6,a7(respondió) = 5; opened: a4,a5,a6,a7 = 4; responded: a6,a7 = 2
 if (f.added, f.prepared, f.sent, f.opened, f.responded) is distinct from (7::bigint, 6::bigint, 5::bigint, 4::bigint, 2::bigint) then
   raise exception 'Etapas alcanzadas incorrectas: %', f; end if;
 if (f.yes, f.no, f.attendees) is distinct from (1::bigint, 1::bigint, 3::bigint) then raise exception 'Respuestas/asistentes incorrectos: %', f; end if;
 -- Pendientes: a1,a2 sin enviar · a3 enviada sin abrir · a4,a5 abiertas sin responder = 5 pendientes.
 if (f.not_sent, f.sent_unopened, f.opened_unanswered) is distinct from (2::bigint, 1::bigint, 2::bigint) then raise exception 'Cubos de pendientes incorrectos: %', f; end if;
 if f.not_sent + f.sent_unopened + f.opened_unanswered <> (select count(*) from public.wedding_guests where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and rsvp_status='pendiente') then
   raise exception 'Los cubos no suman los pendientes'; end if;
 -- Para recordar = cola de recordatorios (filtro «para_recordar»): a3 y a4 (enviadas, sin
 -- respuesta, teléfono, sin recordatorio). a5 no tiene envío marcado. (20261009100000)
 if f.to_remind <> 2 then raise exception 'toRemind incorrecto: %', f.to_remind; end if;
 if f.to_remind <> (select para_recordar from public.guest_filter_counts('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then
   raise exception 'toRemind no coincide con la cola de recordatorios'; end if;
 -- «Sin enviar» del filtro = cubo not_sent: a5 abrió sin envío marcado y no cuenta.
 if (select sin_enviar from public.guest_filter_counts('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> f.not_sent then
   raise exception 'Filtro sin_enviar distinto del embudo'; end if;
 update public.wedding_guests set last_reminder_at = now() - interval '1 day' where id='6a000000-0000-4000-8000-000000000004';
 if (select to_remind from public.crm_funnel_summary('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 1 then raise exception 'Recordado hace 1 día sigue en toRemind'; end if;
 update public.wedding_guests set last_reminder_at = null where id='6a000000-0000-4000-8000-000000000004';
 if exists (select 1 from public.crm_funnel_summary('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Embudo ajeno expuesto'; end if;

 -- Regalos: creación atómica con invitados.
 v1 := public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   array['6a000000-0000-4000-8000-000000000006','6a000000-0000-4000-8000-000000000007']::uuid[], 'bizum', 15000, null, 'De los dos', current_date);
 if v1 is null then raise exception 'Regalo compartido no creado'; end if;
 v2 := public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   array['6a000000-0000-4000-8000-000000000004']::uuid[], 'objeto', null, 'Una vajilla', null, null);
 if v2 is null then raise exception 'Regalo sin importe no creado'; end if;
 -- Lista vacía, repetidos, invitado de otra boda, boda ajena: null y nada creado.
 if public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array[]::uuid[], 'otro', null, null, null, null) is not null then raise exception 'Regalo sin invitados'; end if;
 if public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001']::uuid[], 'otro', null, null, null, null) is not null then raise exception 'Invitado repetido aceptado'; end if;
 if public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6b000000-0000-4000-8000-000000000001']::uuid[], 'otro', null, null, null, null) is not null then raise exception 'Invitado de B en regalo de A'; end if;
 if public.create_wedding_gift('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['6b000000-0000-4000-8000-000000000001']::uuid[], 'otro', null, null, null, null) is not null then raise exception 'Regalo en boda ajena'; end if;
 -- Importe en tipo no monetario: CHECK.
 begin
   perform public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6a000000-0000-4000-8000-000000000001']::uuid[], 'objeto', 100, null, null, null);
   raise exception 'Importe en regalo no monetario';
 exception when check_violation then null; end;
 begin
   perform public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6a000000-0000-4000-8000-000000000001']::uuid[], 'efectivo', 10000001, null, null, null);
   raise exception 'Importe > 100.000 €';
 exception when check_violation then null; end;
 begin
   perform public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6a000000-0000-4000-8000-000000000001']::uuid[], 'regalo', null, null, null, null);
   raise exception 'Tipo desconocido';
 exception when check_violation then null; end;

 -- Invitado de otra boda insertado a mano en un regalo propio: FK compuesta / RLS.
 begin
   insert into public.wedding_gift_givers(gift_id,guest_id,wedding_id) values (v1,'6b000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
   raise exception 'Invitado ajeno en regalo propio';
 exception when foreign_key_violation then null; end;
 begin
   insert into public.wedding_gift_givers(gift_id,guest_id,wedding_id) values (v1,'6b000000-0000-4000-8000-000000000001','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
   raise exception 'Fila de invitados en boda ajena';
 exception when insufficient_privilege then null; end;

 -- Regalo sin invitados por la Data API: falla al confirmar (diferido).
 begin
   insert into public.wedding_gifts(wedding_id,kind) values ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','otro');
   set constraints public.wedding_gifts_require_giver immediate;
   raise exception 'Regalo sin invitados confirmado';
 exception when check_violation then null; end;
 set constraints public.wedding_gifts_require_giver deferred;

 -- «Sin regalo»: a1 marcado; a6 marcado y luego regalo → manda el regalo (create lo limpia).
 update public.wedding_guests set gift_none = true where id in ('6a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000003');
 v3 := public.create_wedding_gift('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['6a000000-0000-4000-8000-000000000003']::uuid[], 'efectivo', 5000, null, null, null);
 if (select gift_none from public.wedding_guests where id='6a000000-0000-4000-8000-000000000003') then raise exception 'Crear regalo no quitó «sin regalo»'; end if;

 -- Agradecido.
 update public.wedding_gifts set thanked_at = now() where id = v2;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'No se pudo marcar agradecido'; end if;

 -- Resumen: 3 regalos; importes 15000 + 5000; con importe 2; sin agradecer v1,v3.
 select * into r from public.crm_gift_summary('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if (r.gift_count, r.total_cents, r.with_amount, r.unthanked) is distinct from (3::bigint, 20000::bigint, 2::bigint, 2::bigint) then raise exception 'Resumen de regalos incorrecto: %', r; end if;
 if r.by_kind <> '{"bizum":{"count":1,"totalCents":15000},"objeto":{"count":1,"totalCents":0},"efectivo":{"count":1,"totalCents":5000}}'::jsonb then raise exception 'byKind incorrecto: %', r.by_kind; end if;
 -- Invitados: con regalo a3,a4,a6,a7 = 4; sin regalo a1 = 1; sin indicar a2,a5 = 2.
 if (r.guests_yes, r.guests_no, r.guests_unknown) is distinct from (4::bigint, 1::bigint, 2::bigint) then raise exception 'Estados de regalo incorrectos: %', r; end if;
 if exists (select 1 from public.crm_gift_summary('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Resumen de regalos ajeno'; end if;

 -- Lista con invitados (ordenados por nombre).
 select l.givers into j from public.wedding_gift_list('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') l where l.id = v1;
 if j <> '[{"guestId":"6a000000-0000-4000-8000-000000000006","name":"Fran"},{"guestId":"6a000000-0000-4000-8000-000000000007","name":"Gema"}]'::jsonb then raise exception 'Invitados del regalo incorrectos: %', j; end if;
 if (select count(*) from public.wedding_gift_list('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 3 then raise exception 'Lista de regalos incompleta'; end if;
 if exists (select 1 from public.wedding_gift_list('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Lista ajena'; end if;

 -- Editar: cambiar invitados (de a6+a7 a a7+a2) sin pasar por 0; tipo no monetario exige quitar importe.
 ok := public.update_wedding_gift(v1, array['6a000000-0000-4000-8000-000000000007','6a000000-0000-4000-8000-000000000002']::uuid[], 'transferencia', 20000, 'Cuenta', null, null);
 if not ok then raise exception 'Edición rechazada'; end if;
 if (select array_agg(guest_id order by guest_id) from public.wedding_gift_givers where gift_id=v1)
    <> array['6a000000-0000-4000-8000-000000000002','6a000000-0000-4000-8000-000000000007']::uuid[] then raise exception 'Invitados no sustituidos'; end if;
 if (select amount_cents from public.wedding_gifts where id=v1) <> 20000 then raise exception 'Importe no editado'; end if;
 if public.update_wedding_gift(v1, array[]::uuid[], 'otro', null, null, null, null) then raise exception 'Edición a 0 invitados'; end if;
 if public.update_wedding_gift(v1, array['6b000000-0000-4000-8000-000000000001']::uuid[], 'otro', null, null, null, null) then raise exception 'Edición con invitado ajeno'; end if;
 if not exists (select 1 from public.wedding_gifts where id=v1) then raise exception 'Edición rechazada borró el regalo'; end if;

 -- guest_page: campos del CRM y filtros nuevos.
 select * into r from public.guest_page('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0) p where p.id='6a000000-0000-4000-8000-000000000007';
 if (r.gift_count, r.gift_unthanked, r.gift_total_cents, r.gift_none) is distinct from (1::bigint, true, 20000::bigint, false) then raise exception 'Campos CRM de a7: %', r; end if;
 select * into r from public.guest_page('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0) p where p.id='6a000000-0000-4000-8000-000000000004';
 if (r.gift_count, r.gift_unthanked) is distinct from (1::bigint, false) or r.invitation_opened_at is null then raise exception 'Campos CRM de a4: %', r; end if;
 select * into r from public.guest_filter_counts('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 -- con regalo: a2,a3,a4,a7 (a6 salió del regalo v1) · sin regalo: a1 · sin indicar: a5,a6 · sin agradecer: a2,a3,a7
 if (r.enviada_sin_abrir, r.abierta_sin_responder, r.con_regalo, r.sin_regalo, r.regalo_sin_indicar, r.sin_agradecer)
    is distinct from (1::bigint, 2::bigint, 4::bigint, 1::bigint, 2::bigint, 3::bigint) then raise exception 'Recuentos nuevos: %', r; end if;
 if r.con_regalo + r.sin_regalo + r.regalo_sin_indicar <> r.todos then raise exception 'Estados de regalo no suman el total'; end if;
 if (select count(*) from public.guest_page('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sin_agradecer','',100,0)) <> 3 then raise exception 'Página sin_agradecer no casa con su recuento'; end if;

 -- Borrar al último invitado de un regalo borra el regalo; con otro invitado, el regalo sigue.
 delete from public.wedding_guests where id='6a000000-0000-4000-8000-000000000004';
 if exists (select 1 from public.wedding_gifts where id=v2) then raise exception 'Regalo huérfano tras borrar a su único invitado'; end if;
 delete from public.wedding_guests where id='6a000000-0000-4000-8000-000000000002';
 if not exists (select 1 from public.wedding_gifts where id=v1) then raise exception 'Regalo compartido borrado con un solo invitado'; end if;
 -- Quitar a mano el último invitado: también se va el regalo.
 delete from public.wedding_gift_givers where gift_id=v3;
 if exists (select 1 from public.wedding_gifts where id=v3) then raise exception 'Regalo sin invitados tras quitar el último'; end if;

 -- Borrar el regalo (camino de deleteGift): sus filas de invitados se van en cascada sin error.
 delete from public.wedding_gifts where id=v1;
 get diagnostics affected = row_count;
 if affected <> 1 or exists (select 1 from public.wedding_gift_givers where gift_id=v1) then raise exception 'Borrado de regalo incompleto'; end if;

 -- Escrituras cruzadas: 0 filas.
 update public.wedding_gifts set note='pirata' where wedding_id='6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'A editó regalos de B'; end if;
 begin
   update public.wedding_gifts set wedding_id='6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   raise exception 'wedding_id del regalo modificable';
 exception when insufficient_privilege then null; end;

 -- Plantilla de agradecimiento: sin {enlace}; solo {nombre} y {novios}.
 insert into public.wedding_message_templates(wedding_id,kind,body) values ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','thanks','¡Gracias, {nombre}! Un abrazo, {novios}.');
 begin
   update public.wedding_message_templates set body='Gracias {fecha}' where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='thanks';
   raise exception 'Variable no permitida en agradecimiento';
 exception when check_violation then null; end;
 begin
   insert into public.wedding_message_templates(wedding_id,kind,body) values ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reminder','Hola {nombre}');
   raise exception 'Recordatorio sin {enlace}';
 exception when check_violation then null; end;
 begin
   insert into public.wedding_message_templates(wedding_id,kind,body) values ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','gracias','Hola');
   raise exception 'Tipo de plantilla desconocido';
 exception when check_violation then null; end;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists (select 1 from public.wedding_gifts) then raise exception 'B ve regalos de A'; end if;
 if exists (select 1 from public.wedding_gift_givers) then raise exception 'B ve invitados de regalos de A'; end if;
 if exists (select 1 from public.crm_funnel_summary('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'B ve el embudo de A'; end if;
 if (select gift_count from public.crm_gift_summary('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 0 then raise exception 'Resumen propio de B no vacío'; end if;
end $$;
reset role;

do $$ begin raise notice 'crm-embudo-regalos: apertura, regalos (≥1 invitado, misma boda), agregados y aislamiento A/B OK'; end $$;
rollback;
