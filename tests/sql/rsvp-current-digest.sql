-- Respuesta anterior del invitado y resumen diario (20261021100000):
-- guest_rsvp_current, responded_at y wedding_members.digest_opt_out.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('71111111-1111-4111-8111-111111111111'), ('72222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','previa-pareja-a','71111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','previa-pareja-b','72222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('7a000000-0000-4000-8000-000000000001','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitada A','pendiente'),
 ('7a000000-0000-4000-8000-000000000002','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitado revocado','pendiente'),
 ('7b000000-0000-4000-8000-000000000001','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('7a000000-0000-4000-8000-000000000001','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('1',64),null),
 ('7a000000-0000-4000-8000-000000000002','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('2',64),null),
 ('7b000000-0000-4000-8000-000000000001','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('3',64),null);

-- ------------------------------------------------------------ privilegios
do $$ begin
 if has_function_privilege('anon','public.guest_rsvp_current(text,text)','execute') then raise exception 'guest_rsvp_current ejecutable por anon'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_current(text,text)','execute') then raise exception 'guest_rsvp_current ejecutable por authenticated'; end if;
 if not has_function_privilege('service_role','public.guest_rsvp_current(text,text)','execute') then raise exception 'service_role no puede leer la respuesta'; end if;
 if not (select prosecdef from pg_proc where oid = 'public.guest_rsvp_current(text,text)'::regprocedure) then raise exception 'guest_rsvp_current no es definer'; end if;
 if not exists (select 1 from pg_proc where oid = 'public.guest_rsvp_current(text,text)'::regprocedure and proconfig @> array['search_path=""']) then raise exception 'guest_rsvp_current sin search_path'; end if;
 -- La de 10 (20261101100000) y sus envoltorios de 9, 7 y 5, ninguna más.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='guest_rsvp_respond') <> 4 then
   raise exception 'guest_rsvp_respond cambió de sobrecargas';
 end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='guest_rsvp_current') <> 1 then
   raise exception 'guest_rsvp_current con más de una sobrecarga';
 end if;
 if has_function_privilege('anon','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'RPC de 6 ejecutable por anon'; end if;
end $$;

-- ---------------------------------------------- lectura y aislamiento
set local role service_role;
do $$ declare r text; j jsonb; t1 timestamptz; begin
 -- Sin responder: nada que rellenar (con 20261021110000, objeto con status NULL y el tope).
 j := public.guest_rsvp_current('previa-pareja-a', repeat('1',64));
 if j is null or j->'status' <> 'null'::jsonb or j ? 'notes' then raise exception 'Pendiente devolvió respuesta: %', j; end if;

 r := public.guest_rsvp_respond('previa-pareja-a', repeat('1',64), 'si', 2, 'Celíaca', '{"song":"Mediterráneo"}'::jsonb);
 if r <> 'ok' then raise exception 'Respuesta rechazada: %', r; end if;
 select responded_at into t1 from public.wedding_guests where id='7a000000-0000-4000-8000-000000000001';
 if t1 is null then raise exception 'responded_at no se escribió'; end if;

 j := public.guest_rsvp_current('previa-pareja-a', repeat('1',64));
 if j is null then raise exception 'Respuesta válida no devuelta'; end if;
 -- Sin el texto de la nota de salud (20261101110000, paso 2): solo que la hay.
 if j->>'status' <> 'si' or (j->>'companions')::int <> 2 or j ? 'notes' or (j->>'has_health_note')::boolean is not true
    or j->'answers'->>'song' <> 'Mediterráneo' or (j->>'responded_at')::timestamptz <> t1 then
   raise exception 'Respuesta mal devuelta: %', j;
 end if;

 -- Token de la otra boda, con el slug de esta (y al revés): nada.
 if public.guest_rsvp_current('previa-pareja-a', repeat('3',64)) is not null then raise exception 'Token de B leyó en A'; end if;
 if public.guest_rsvp_current('previa-pareja-b', repeat('1',64)) is not null then raise exception 'Token de A leyó en B'; end if;
 -- Slug inexistente y formatos inválidos: nada.
 if public.guest_rsvp_current('no-existe', repeat('1',64)) is not null then raise exception 'Slug inexistente devolvió algo'; end if;
 if public.guest_rsvp_current('previa-pareja-a', 'abc') is not null then raise exception 'Hash corto aceptado'; end if;
 if public.guest_rsvp_current('PREVIA', repeat('1',64)) is not null then raise exception 'Slug inválido aceptado'; end if;

 -- La de 5 argumentos (envoltorio) también marca responded_at.
 r := public.guest_rsvp_respond('previa-pareja-a', repeat('2',64), 'no', 0, null);
 if r <> 'ok' then raise exception 'La de 5 falló: %', r; end if;
 if (select responded_at from public.wedding_guests where id='7a000000-0000-4000-8000-000000000002') is null then raise exception 'La de 5 no escribió responded_at'; end if;
 if (public.guest_rsvp_current('previa-pareja-a', repeat('2',64)))->>'status' <> 'no' then raise exception '«No» no devuelto'; end if;
end $$;
reset role;

-- Token revocado: ni lee ni escribe.
update public.wedding_guest_tokens set revoked_at = now() where token_hash = repeat('2',64);
set local role service_role;
do $$ begin
 if public.guest_rsvp_current('previa-pareja-a', repeat('2',64)) is not null then raise exception 'Token revocado leyó la respuesta'; end if;
 if public.guest_rsvp_respond('previa-pareja-a', repeat('2',64), 'si', 0, null, null) <> 'unavailable' then raise exception 'Token revocado respondió'; end if;
end $$;
reset role;

-- Una respuesta rechazada no toca responded_at.
do $$ declare before_at timestamptz; begin
 select responded_at into before_at from public.wedding_guests where id='7b000000-0000-4000-8000-000000000001';
 if before_at is not null then raise exception 'B ya tenía responded_at'; end if;
end $$;
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'si', 11, null, null) <> 'invalid' then raise exception '11 acompañantes aceptados'; end if;
end $$;
reset role;
do $$ begin
 if (select responded_at from public.wedding_guests where id='7b000000-0000-4000-8000-000000000001') is not null then raise exception 'Respuesta inválida escribió responded_at'; end if;
end $$;

-- ------------------------------------------------- baja del resumen diario
do $$ begin
 if (select digest_opt_out from public.wedding_members where wedding_id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='71111111-1111-4111-8111-111111111111') is distinct from false then
   raise exception 'digest_opt_out no nace en false';
 end if;
end $$;
-- La pareja puede leer su propia preferencia (política select-self), no la de otra boda.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-4111-8111-111111111111', true);
do $$ begin
 if (select count(*) from public.wedding_members where digest_opt_out = false) <> 1 then raise exception 'La pareja no ve solo su fila'; end if;
end $$;
-- Y no puede cambiarla directamente (la escribe la server action con service_role).
do $$ begin
 update public.wedding_members set digest_opt_out = true where user_id = '71111111-1111-4111-8111-111111111111';
 raise exception 'authenticated escribió wedding_members';
exception when insufficient_privilege then null; end $$;
reset role;

-- --------------------------------- tope de acompañantes (20261021110000)
do $$ begin
 update public.wedding_guests set max_companions = 11 where id='7b000000-0000-4000-8000-000000000001';
 raise exception 'Tope de 11 aceptado';
exception when check_violation then null; end $$;
update public.wedding_guests set max_companions = 1 where id='7b000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare j jsonb; begin
 -- Pendiente: el formulario recibe el tope.
 j := public.guest_rsvp_current('previa-pareja-b', repeat('3',64));
 if (j->>'max_companions')::int <> 1 or j->'status' <> 'null'::jsonb then raise exception 'Tope no devuelto: %', j; end if;
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'si', 2, null, null) <> 'too_many' then raise exception 'Se pasó del tope'; end if;
 if (select rsvp_status from public.wedding_guests where id='7b000000-0000-4000-8000-000000000001') <> 'pendiente' then raise exception 'too_many guardó algo'; end if;
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'si', 1, null, null) <> 'ok' then raise exception 'Dentro del tope rechazado'; end if;
 -- «No» con acompañantes de más no es un exceso (se guardan 0).
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'no', 5, null, null) <> 'ok' then raise exception '«No» rechazado por el tope'; end if;
 -- La de 5 argumentos también respeta el tope.
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'si', 3, null) <> 'too_many' then raise exception 'La de 5 se saltó el tope'; end if;
 j := public.guest_rsvp_current('previa-pareja-b', repeat('3',64));
 if j->>'status' <> 'no' or (j->>'max_companions')::int <> 1 then raise exception 'Respuesta con tope mal devuelta: %', j; end if;
end $$;
reset role;
-- Sin tope (NULL) sigue el límite de siempre: 10.
update public.wedding_guests set max_companions = null where id='7b000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('previa-pareja-b', repeat('3',64), 'si', 10, null, null) <> 'ok' then raise exception 'Sin tope, 10 rechazados'; end if;
end $$;
reset role;
rollback;
