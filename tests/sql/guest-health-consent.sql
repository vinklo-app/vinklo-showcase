-- Consentimiento de salud y nota logística (20261030100000): la nota de salud
-- del invitado siempre lleva fecha y versión del consentimiento, la logística
-- no lo pide, el formulario anterior sigue funcionando y la retención lo borra.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('84444444-4444-4444-8444-444444444444'), ('85555555-5555-4555-8555-555555555555');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('8ccccccc-cccc-4ccc-8ccc-cccccccccccc','salud-c','84444444-4444-4444-8444-444444444444','Ana','Luis',current_date + 60),
 ('8ddddddd-dddd-4ddd-8ddd-dddddddddddd','salud-vieja','85555555-5555-4555-8555-555555555555','Eva','Pau','2026-05-01');
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_notes) values
 ('8c000000-0000-4000-8000-000000000001','8ccccccc-cccc-4ccc-8ccc-cccccccccccc','Prima','pendiente',null),
 ('8c000000-0000-4000-8000-000000000002','8ccccccc-cccc-4ccc-8ccc-cccccccccccc','Tío','si','Llamar antes');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('8c000000-0000-4000-8000-000000000001','8ccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('5',64),null),
 ('8c000000-0000-4000-8000-000000000002','8ccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('6',64),null);

-- (a) Permisos: la RPC nueva y el envoltorio, solo service_role; columnas nuevas fuera del cliente.
do $$ begin
 if has_function_privilege('anon', 'public.guest_rsvp_respond(text,text,text,integer,text,text,text,jsonb,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.guest_rsvp_respond(text,text,text,integer,text,text,text,jsonb,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)', 'execute') then
   raise exception 'guest_rsvp_respond ejecutable fuera de service_role';
 end if;
 if not has_function_privilege('service_role', 'public.guest_rsvp_respond(text,text,text,integer,text,text,text,jsonb,jsonb)', 'execute') then
   raise exception 'service_role sin la RPC nueva';
 end if;
 if has_column_privilege('authenticated', 'public.wedding_guests', 'rsvp_logistic_notes', 'update')
    or has_column_privilege('authenticated', 'public.wedding_guests', 'health_consent_at', 'update')
    or has_column_privilege('authenticated', 'public.wedding_guests', 'health_consent_version', 'update')
    or has_column_privilege('authenticated', 'public.wedding_guests', 'health_consent_at', 'insert') then
   raise exception 'la pareja puede fabricar el consentimiento o la nota logística';
 end if;
end $$;

-- (b) Invariante: una nota del invitado sin consentimiento no entra ni por SQL.
do $$ begin
 begin
   insert into public.wedding_guests(wedding_id,name,rsvp_status,rsvp_notes,rsvp_notes_by_guest)
   values ('8ccccccc-cccc-4ccc-8ccc-cccccccccccc','Sin permiso','si','Celíaca',true);
   raise exception 'entró una nota del invitado sin consentimiento';
 exception when check_violation then null;
 end;
 begin
   insert into public.wedding_guests(wedding_id,name,rsvp_status,health_consent_at)
   values ('8ccccccc-cccc-4ccc-8ccc-cccccccccccc','Media','si',now());
   raise exception 'entró una fecha de consentimiento sin versión';
 exception when check_violation then null;
 end;
end $$;

set local role service_role;
do $$ declare j jsonb; g record; begin
 -- (c) RPC nueva: salud con versión + logística.
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, ' Celíaca ', ' Vamos con carrito ', '2026-10', null, null) <> 'ok' then raise exception 'respuesta nueva rechazada'; end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_notes <> 'Celíaca' or not g.rsvp_notes_by_guest or g.rsvp_logistic_notes <> 'Vamos con carrito'
    or g.health_consent_version <> '2026-10' or g.health_consent_at is null then raise exception 'no se guardó bien: %', row_to_json(g); end if;
 j := public.guest_rsvp_current('salud-c', repeat('5',64));
 -- 20261101110000 (paso 2): sin textos, solo que los hay (y la fecha del consentimiento).
 if j ? 'notes' or j ? 'logistic_notes' or j ? 'health_consent_version' or (j->>'has_health_note')::boolean is not true
    or (j->>'has_logistic_note')::boolean is not true or j->>'health_consent_at' is null then raise exception 'current no devuelve lo nuevo: %', j; end if;

 -- (d) Nota de salud sin versión: no se guarda nada.
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, 'Marisco', '', null, null, null) <> 'invalid' then raise exception 'aceptó salud sin consentimiento'; end if;
 if (select rsvp_notes from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001') <> 'Celíaca' then raise exception 'escribió pese a invalid'; end if;

 -- (e) Solo logística (sin salud, sin «conservar», la de 10): sin consentimiento y se borra la nota de salud suya.
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, '', 'Llegamos tarde', null, null, null, false) <> 'ok' then raise exception 'logística sola rechazada'; end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_notes is not null or g.rsvp_notes_by_guest or g.health_consent_at is not null or g.health_consent_version is not null
    or g.rsvp_logistic_notes <> 'Llegamos tarde' then raise exception 'logística sola mal: %', row_to_json(g); end if;
 j := public.guest_rsvp_current('salud-c', repeat('5',64));
 if (j->>'has_health_note')::boolean or j->>'health_consent_at' is not null then raise exception 'consentimiento fantasma: %', j; end if;

 -- (f) Formulario anterior (7 y 6 argumentos): su nota es de salud con versión
 --     «legacy-2026-10» y no toca la logística.
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, 'Vegana', null::jsonb, null::jsonb) <> 'ok' then raise exception 'envoltorio de 7 rechazado'; end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_notes <> 'Vegana' or not g.rsvp_notes_by_guest or g.health_consent_version <> 'legacy-2026-10' or g.health_consent_at is null
    or g.rsvp_logistic_notes <> 'Llegamos tarde' then raise exception 'envoltorio de 7 mal: %', row_to_json(g); end if;
 -- Tras 20261101110000 (paso 2) el formulario anterior ya no ve la nota: en blanco la conserva.
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, null, null) <> 'ok' then raise exception 'envoltorio de 6 rechazado'; end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_notes is distinct from 'Vegana' or g.health_consent_version is distinct from 'legacy-2026-10' or g.health_consent_at is null
    or g.rsvp_logistic_notes <> 'Llegamos tarde' then raise exception 'envoltorio de 6 mal: %', row_to_json(g); end if;
 if public.guest_rsvp_respond('salud-c', repeat('5',64), 'si', 1, 'Sin lactosa') <> 'ok' then raise exception 'envoltorio de 5 rechazado'; end if;
 if (select health_consent_version from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001') <> 'legacy-2026-10' then raise exception 'envoltorio de 5 sin versión'; end if;

 -- (g) Nota de la pareja: responder sin salud no la borra ni le pone consentimiento;
 --     '' borra la logística (la de 10; la de 9 ya no borra en blanco, paso 2).
 if public.guest_rsvp_respond('salud-c', repeat('6',64), 'si', 0, null, 'Silla de ruedas', null, null, null) <> 'ok' then raise exception 'tío rechazado'; end if;
 if public.guest_rsvp_respond('salud-c', repeat('6',64), 'si', 0, null, '', null, null, null, false) <> 'ok' then raise exception 'tío 2 rechazado'; end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000002';
 if g.rsvp_notes <> 'Llamar antes' or g.rsvp_notes_by_guest or g.health_consent_at is not null or g.rsvp_logistic_notes is not null then
   raise exception 'nota de la pareja mal: %', row_to_json(g); end if;
 j := public.guest_rsvp_current('salud-c', repeat('6',64));
 if j ? 'notes' or (j->>'has_health_note')::boolean then raise exception 'el invitado vio la nota de la pareja: %', j; end if;
end $$;
reset role;

-- (h) La pareja sobrescribe la nota del invitado: pasa a ser suya y sin consentimiento.
-- (La marca de escritura del invitado dura la transacción; aquí todo es una sola.)
select set_config('vinklo.guest_rsvp_write', '', true);
do $$ declare g record; begin
 update public.wedding_guests set rsvp_notes = 'Sin lactosa · avisar a cocina' where id = '8c000000-0000-4000-8000-000000000001';
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_notes_by_guest or g.health_consent_at is not null or g.health_consent_version is not null then
   raise exception 'consentimiento sobre texto de la pareja: %', row_to_json(g); end if;
end $$;

-- (i) Retención: fuera nota de salud, logística y consentimiento.
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_notes,rsvp_notes_by_guest,rsvp_logistic_notes,health_consent_at,health_consent_version) values
 ('8d000000-0000-4000-8000-000000000001','8ddddddd-dddd-4ddd-8ddd-dddddddddddd','Abuela','si','Diabética',true,'Silla de ruedas',now(),'2026-10');
select public.mark_retention_notice('8ddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.wedding_retention set notice_sent_at = timestamptz '2027-06-15 09:00+02' where wedding_id = '8ddddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role service_role;
do $$ declare g record; begin
 if public.anonymise_expired_guests(date '2027-07-15') <> 1 then raise exception 'debía anonimizar 1 boda'; end if;
 select * into g from public.wedding_guests where id = '8d000000-0000-4000-8000-000000000001';
 if g.rsvp_notes is not null or g.rsvp_notes_by_guest or g.rsvp_logistic_notes is not null
    or g.health_consent_at is not null or g.health_consent_version is not null then raise exception 'retención incompleta: %', row_to_json(g); end if;
 select * into g from public.wedding_guests where id = '8c000000-0000-4000-8000-000000000001';
 if g.rsvp_logistic_notes is null then raise exception 'tocó una boda no vencida'; end if;
end $$;
reset role;
rollback;
