-- RSVP con enlace personal (20261006100000): auditoría 2026-10-04 H03 y H11.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rsvp-respond.sql
-- Dos bodas ficticias; todo se revierte con ROLLBACK. La carrera real
-- revocar/responder (dos conexiones) está en rsvp-respond-concurrencia.sql.
begin;
insert into auth.users(id) values ('51111111-1111-4111-8111-111111111111'), ('52222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rsvp-pareja-a','51111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','rsvp-pareja-b','52222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('5a000000-0000-4000-8000-000000000001','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitada A','pendiente'),
 ('5b000000-0000-4000-8000-000000000001','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('5a000000-0000-4000-8000-000000000001','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64)),
 ('5b000000-0000-4000-8000-000000000001','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('b',64));

-- ------------------------------------------------------------ privilegios
do $$ begin
 if has_function_privilege('anon','public.guest_rsvp_respond(text,text,text,integer,text)','execute') then raise exception 'RSVP RPC ejecutable por anon'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_respond(text,text,text,integer,text)','execute') then raise exception 'RSVP RPC ejecutable por authenticated'; end if;
 if not has_function_privilege('service_role','public.guest_rsvp_respond(text,text,text,integer,text)','execute') then raise exception 'service_role no puede responder'; end if;
 if has_function_privilege('anon','public.guest_rsvp_closes_at(date,timestamptz)','execute') then raise exception 'closes_at expuesta a anon'; end if;
end $$;
set local role anon;
do $$ begin
 perform public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 0, null);
 raise exception 'anon respondió sin pasar por la server action';
exception when insufficient_privilege then null; end $$;
reset role;

-- --------------------------------------------- respuesta y aislamiento
set local role service_role;
do $$ declare r text; g record; begin
 r := public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 2, '  Celíaca  ');
 if r <> 'ok' then raise exception 'Respuesta válida rechazada: %', r; end if;
 select * into g from public.wedding_guests where id='5a000000-0000-4000-8000-000000000001';
 if g.rsvp_status <> 'si' or g.rsvp_companions <> 2 or g.rsvp_notes <> 'Celíaca' then raise exception 'Respuesta mal guardada'; end if;

 -- Token de B con el slug de A, y al revés: nunca cruza bodas.
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('b',64), 'no', 0, null) <> 'unavailable' then raise exception 'Token de B aceptado en A'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-b', repeat('a',64), 'no', 0, null) <> 'unavailable' then raise exception 'Token de A aceptado en B'; end if;
 if (select rsvp_status from public.wedding_guests where id='5b000000-0000-4000-8000-000000000001') <> 'pendiente' then raise exception 'Invitado de B modificado'; end if;
 if public.guest_rsvp_respond('no-existe', repeat('a',64), 'si', 0, null) <> 'unavailable' then raise exception 'Slug inexistente aceptado'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('c',64), 'si', 0, null) <> 'unavailable' then raise exception 'Token inexistente aceptado'; end if;

 -- Datos fuera de contrato.
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'quizas', 0, null) <> 'invalid' then raise exception 'Estado inválido aceptado'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 11, null) <> 'invalid' then raise exception '11 acompañantes aceptados'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', -1, null) <> 'invalid' then raise exception 'Acompañantes negativos aceptados'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 0, repeat('x',501)) <> 'invalid' then raise exception 'Notas > 500 aceptadas'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', 'XYZ', 'si', 0, null) <> 'invalid' then raise exception 'Hash malformado aceptado'; end if;
 if public.guest_rsvp_respond('Rsvp Pareja', repeat('a',64), 'si', 0, null) <> 'invalid' then raise exception 'Slug malformado aceptado'; end if;

 -- Dos pestañas: se serializan y manda la última; «no» limpia acompañantes.
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 3, null) <> 'ok' then raise exception 'Primera pestaña rechazada'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'no', 3, '') <> 'ok' then raise exception 'Segunda pestaña rechazada'; end if;
 select * into g from public.wedding_guests where id='5a000000-0000-4000-8000-000000000001';
 if g.rsvp_status <> 'no' or g.rsvp_companions <> 0 or g.rsvp_notes is not null then raise exception 'Last-write-wins no aplicado: % % %', g.rsvp_status, g.rsvp_companions, g.rsvp_notes; end if;
end $$;
reset role;

-- ------------------------------ revocación («Regenerar enlace») secuencial
set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.issue_guest_token('5a000000-0000-4000-8000-000000000001', repeat('d',64), 'regenerate')) <> 1 then raise exception 'Regenerar no emitió'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('a',64), 'si', 1, null) <> 'unavailable' then raise exception 'Token revocado aceptado'; end if;
 if (select rsvp_status from public.wedding_guests where id='5a000000-0000-4000-8000-000000000001') <> 'no' then raise exception 'Token revocado cambió la respuesta'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 1, null) <> 'ok' then raise exception 'Token nuevo rechazado'; end if;
end $$;
reset role;

-- ------------------------------------------------------ web retirada (B)
-- Fila retirada (published_at y unpublished_at, sin puntero) solo en B.
insert into public.wedding_sites(wedding_id,draft_document,published_at,unpublished_at)
 values ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{"schemaVersion":1}'::jsonb, now() - interval '1 day', now());
-- Fila nunca publicada en A: se sigue sirviendo por el adaptador → acepta.
insert into public.wedding_sites(wedding_id,draft_document)
 values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"schemaVersion":1}'::jsonb);
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-b', repeat('b',64), 'si', 0, null) <> 'withdrawn' then raise exception 'Web retirada aceptó respuesta'; end if;
 if (select rsvp_status from public.wedding_guests where id='5b000000-0000-4000-8000-000000000001') <> 'pendiente' then raise exception 'Web retirada guardó respuesta'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'ok' then raise exception 'Web nunca publicada (adaptador) rechazada'; end if;
end $$;
reset role;
delete from public.wedding_sites where wedding_id='5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- ------------------------------------------------------ cierre (H11)
do $$ begin
 -- Regla: fin del día siguiente a la boda, hora de Madrid.
 if public.guest_rsvp_closes_at('2027-06-12', now()) <> '2027-06-14 00:00:00+02'::timestamptz then raise exception 'Cierre con fecha mal calculado'; end if;
 if public.guest_rsvp_closes_at(null, '2026-10-06 10:00:00+00') <> '2027-10-06 10:00:00+00'::timestamptz then raise exception 'Cierre sin fecha mal calculado'; end if;
end $$;
-- Boda hoy: sigue aceptando. Boda hace 3 días: cerrada. Solo afecta a A.
update public.weddings set wedding_date = current_date where id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'ok' then raise exception 'El día de la boda se rechazó'; end if;
end $$;
reset role;
update public.weddings set wedding_date = current_date - 3 where id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'no', 0, null) <> 'closed' then raise exception 'Boda pasada aceptó respuesta'; end if;
 if (select rsvp_status from public.wedding_guests where id='5a000000-0000-4000-8000-000000000001') <> 'si' then raise exception 'Boda pasada cambió la respuesta'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-b', repeat('b',64), 'si', 0, null) <> 'ok' then raise exception 'El cierre de A afectó a B'; end if;
end $$;
reset role;
-- Sin fecha: el token caduca a los 365 días de emitirse.
update public.weddings set wedding_date = null where id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'ok' then raise exception 'Token reciente sin fecha rechazado'; end if;
end $$;
reset role;
update public.wedding_guest_tokens set created_at = now() - interval '366 days' where token_hash = repeat('d',64);
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'closed' then raise exception 'Token sin fecha de hace 366 días aceptado'; end if;
end $$;
reset role;
update public.wedding_guest_tokens set created_at = now() where token_hash = repeat('d',64);
update public.weddings set wedding_date = current_date + 60 where id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ------------------------------------------ límite agregado por boda (H11)
-- 600 respuestas válidas/hora por boda; los tokens inventados no cuentan.
-- Las respuestas «ok» anteriores de esta suite ya contaron: se parte de 599.
delete from public.rate_limit_hits where bucket_key = 'rsvp-wedding:' || encode(sha256(convert_to('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','UTF8')),'hex');
insert into public.rate_limit_hits(bucket_key)
select 'rsvp-wedding:' || encode(sha256(convert_to('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','UTF8')),'hex') from generate_series(1,599);
set local role service_role;
do $$ begin
 -- Un token inventado no consume cupo...
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('e',64), 'si', 0, null) <> 'unavailable' then raise exception 'Token inventado aceptado'; end if;
 -- ...así que la respuesta 600 entra y la 601 se frena.
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'ok' then raise exception 'Respuesta 600 frenada'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-a', repeat('d',64), 'si', 0, null) <> 'rate_limited' then raise exception 'Límite por boda no aplicado'; end if;
 if public.guest_rsvp_respond('rsvp-pareja-b', repeat('b',64), 'si', 0, null) <> 'ok' then raise exception 'El límite de A frenó a B'; end if;
end $$;
reset role;

do $$ begin raise notice 'rsvp-respond: atómica, aislada por boda, revocación, web retirada, cierre y límite por boda OK'; end $$;
rollback;
