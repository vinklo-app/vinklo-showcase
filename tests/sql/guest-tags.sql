-- Etiquetas y lado (20261020100000): CHECK, guest_page con p_tag/p_side,
-- guest_tag_summary, set_guest_tags, rename_guest_tag, wedding_seating y
-- reminder_queue con p_tag. Solo una base DE PRUEBAS vacía con todas las
-- migraciones aplicadas. Dos parejas ficticias; todo se revierte con ROLLBACK.
-- Orden de etiquetas: solo ASCII (la colación local puede no ser la de producción).
begin;
insert into auth.users(id) values ('81111111-1111-4111-8111-111111111111'), ('82222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','tags-pareja-a','81111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','tags-pareja-b','82222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 90);
-- A: Uni (si +1, pendiente), Uni+Trabajo (si), Trabajo (no), sin etiquetas (pendiente, enviada hace 5 días).
-- B: una invitada con la MISMA etiqueta «Uni».
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,rsvp_companions,group_name,tags,side,invitation_prepared_at,invitation_sent_at,rsvp_answers) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ana','612000001','si',1,'Pareja Ana',array['Uni'],'p1',null,null,'{"kids":1}'),
 ('8a000000-0000-4000-8000-000000000002','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bruno','612000002','pendiente',0,null,array['Uni'],'p2',null,null,null),
 ('8a000000-0000-4000-8000-000000000003','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla','612000003','si',0,'Familia',array['Uni','Trabajo'],'ambos',null,null,'{"kids":"x"}'),
 ('8a000000-0000-4000-8000-000000000004','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Dario','612000004','no',0,'Familia',array['Trabajo'],null,null,null,null),
 ('8a000000-0000-4000-8000-000000000005','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Elsa','612000005','pendiente',0,null,'{}',null,now() - interval '6 days',now() - interval '5 days',null),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Berta','612000006','si',2,null,array['Uni'],'p1',now() - interval '6 days',now() - interval '5 days',null);

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='guest_page') <> 1 then
   raise exception 'guest_page tiene más de una sobrecarga'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='reminder_queue') <> 1 then
   raise exception 'reminder_queue tiene más de una sobrecarga'; end if;
 if not has_function_privilege('authenticated','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute')
    or not has_function_privilege('authenticated','public.guest_tag_summary(uuid)','execute')
    or not has_function_privilege('authenticated','public.set_guest_tags(uuid,uuid[],text[],text[])','execute')
    or not has_function_privilege('authenticated','public.rename_guest_tag(uuid,text,text)','execute')
    or not has_function_privilege('authenticated','public.reminder_queue(uuid,integer,text,text)','execute') then raise exception 'authenticated sin grant'; end if;
 if has_function_privilege('anon','public.guest_page(uuid,text,text,integer,integer,text,text,text)','execute')
    or has_function_privilege('anon','public.guest_tag_summary(uuid)','execute')
    or has_function_privilege('anon','public.set_guest_tags(uuid,uuid[],text[],text[])','execute')
    or has_function_privilege('anon','public.rename_guest_tag(uuid,text,text)','execute')
    or has_function_privilege('anon','public.reminder_queue(uuid,integer,text,text)','execute')
    or has_function_privilege('anon','public.wedding_seating(uuid)','execute') then raise exception 'anon ejecuta RPC de etiquetas'; end if;
 if exists (select 1 from pg_proc where oid in ('public.guest_tag_summary(uuid)'::regprocedure, 'public.set_guest_tags(uuid,uuid[],text[],text[])'::regprocedure,
            'public.rename_guest_tag(uuid,text,text)'::regprocedure) and prosecdef) then raise exception 'RPC de etiquetas como definer'; end if;
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name in ('tags','side')) then raise exception 'Vista pública con etiquetas o lado'; end if;
 -- Ninguna RPC nueva se fía de couple_id = auth.uid(): todas pasan por owns_wedding.
 if exists (select 1 from pg_proc where proname in ('guest_page','guest_tag_summary','set_guest_tags','rename_guest_tag','reminder_queue','wedding_seating')
            and pronamespace = 'public'::regnamespace and (prosrc like '%couple_id%' or prosrc not like '%owns_wedding%')) then
   raise exception 'RPC sin owns_wedding o con couple_id'; end if;
end $$;

-- ------------------------------------------------------------ CHECK de tags y side
do $$ begin
 begin update public.wedding_guests set tags = array['a','b','c','d','e','f','g','h','i'] where id='8a000000-0000-4000-8000-000000000005'; raise exception '9 etiquetas aceptadas';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array[''] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Etiqueta vacía aceptada';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array[' Uni'] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Etiqueta sin recortar aceptada';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array['Uni '] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Etiqueta con espacio final aceptada';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array[repeat('a', 31)] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Etiqueta de 31 aceptada';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array['Uni','uni'] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Duplicadas sin mayúsculas aceptadas';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = array['Uni', null] where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Etiqueta null aceptada';
 exception when check_violation then null; end;
 begin update public.wedding_guests set tags = null where id='8a000000-0000-4000-8000-000000000005'; raise exception 'tags null aceptado';
 exception when not_null_violation then null; end;
 begin update public.wedding_guests set side = 'novio' where id='8a000000-0000-4000-8000-000000000005'; raise exception 'Lado desconocido aceptado';
 exception when check_violation then null; end;
 -- 8 de 30 caracteres con tildes (caracteres, no bytes): vale.
 update public.wedding_guests set tags = array[repeat('é',30), 'b','c','d','e','f','g','h'] where id='8a000000-0000-4000-8000-000000000005';
 update public.wedding_guests set tags = '{}' where id='8a000000-0000-4000-8000-000000000005';
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
do $$ declare r record; n int; v jsonb; begin
 -- Firmas antiguas (5 y 6 argumentos): siguen valiendo y traen tags/side.
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0)) <> 5 then raise exception 'guest_page de 5 argumentos'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'Familia')) <> 2 then raise exception 'guest_page de 6 argumentos'; end if;
 select * into r from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','Carla',100,0);
 if r.tags <> array['Uni','Trabajo'] or r.side <> 'ambos' then raise exception 'guest_page sin tags/side: %', r; end if;
 -- Filtro por etiqueta (exacta), solo, con grupo, con filtro de tarea, con búsqueda y con lado.
 if (select max(total_count) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,'Uni')) <> 3 then raise exception 'Filtro de etiqueta (¿se cuela B?)'; end if;
 if exists (select 1 from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,'uni')) then raise exception 'La etiqueta debe coincidir exacta'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,'Familia','Uni')) <> 1 then raise exception 'Etiqueta + grupo'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','vienen','',100,0,null,'Uni')) <> 2 then raise exception 'Etiqueta + vienen'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','bru',100,0,null,'Uni')) <> 1 then raise exception 'Etiqueta + búsqueda'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,'Uni','p1')) <> 1 then raise exception 'Etiqueta + lado'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,null,'')) <> 2 then raise exception 'Sin lado'; end if;
 if (select count(*) from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,null,'ambos')) <> 1 then raise exception 'Lado ambos'; end if;
 if exists (select 1 from public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,'No existe')) then raise exception 'Etiqueta inexistente devuelve filas'; end if;

 -- Resumen: Trabajo (2: 1 sí, 1 no → 1 persona), Uni (3: 2 sí, uno +1 → 3 personas). Sin «sin etiqueta».
 if (select array_agg(tag) from public.guest_tag_summary('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> array['Trabajo','Uni'] then raise exception 'Resumen: etiquetas u orden'; end if;
 select * into r from public.guest_tag_summary('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where tag = 'Uni';
 if (r.guests, r.confirmed, r.attendees) <> (3::bigint, 2::bigint, 3::bigint) then raise exception 'Resumen Uni (¿mezcla B?): %', r; end if;
 select * into r from public.guest_tag_summary('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where tag = 'Trabajo';
 if (r.guests, r.confirmed, r.attendees) <> (2::bigint, 1::bigint, 1::bigint) then raise exception 'Resumen Trabajo: %', r; end if;

 -- set_guest_tags: añade reutilizando la forma existente («uni» → «Uni»), sin repetir, y quita sin mayúsculas.
 n := public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8a000000-0000-4000-8000-000000000004','8a000000-0000-4000-8000-000000000005']::uuid[], array['  uni ', 'Pueblo'], array['TRABAJO']);
 if n <> 2 then raise exception 'set_guest_tags: filas %', n; end if;
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000004') <> array['Uni','Pueblo'] then raise exception 'set_guest_tags Dario: %', (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000004'); end if;
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000005') <> array['Uni','Pueblo'] then raise exception 'set_guest_tags Elsa'; end if;
 -- Repetir no cambia nada (0 filas).
 if public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8a000000-0000-4000-8000-000000000005']::uuid[], array['Pueblo'], '{}') <> 0 then raise exception 'set_guest_tags sin cambios cuenta filas'; end if;
 -- Tope de 8: las que ya tenía ganan; las que no caben se descartan sin error.
 perform public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8a000000-0000-4000-8000-000000000005']::uuid[], array['t1','t2','t3','t4','t5','t6','t7','t8'], '{}');
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000005') <> array['Uni','Pueblo','t1','t2','t3','t4','t5','t6'] then raise exception 'Tope de 8: %', (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000005'); end if;
 -- Etiqueta de 31 caracteres: error claro.
 begin perform public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8a000000-0000-4000-8000-000000000005']::uuid[], array[repeat('x',31)], '{}'); raise exception 'Etiqueta larga aceptada';
 exception when invalid_parameter_value then null; end;
 -- Ids de B dentro de la lista: no se tocan.
 perform public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8b000000-0000-4000-8000-000000000001']::uuid[], array['Robada'], '{}');
 -- Boda ajena: error.
 begin perform public.set_guest_tags('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['8b000000-0000-4000-8000-000000000001']::uuid[], array['Robada'], '{}'); raise exception 'A etiqueta en la boda de B';
 exception when insufficient_privilege then null; end;
 perform public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['8a000000-0000-4000-8000-000000000005']::uuid[], '{}', array['t1','t2','t3','t4','t5','t6']);

 -- rename_guest_tag: renombra sin mayúsculas, fusiona si ya la tenía y borra con ''.
 -- Antes: Ana [Uni], Bruno [Uni], Carla [Uni,Trabajo], Dario [Uni,Pueblo], Elsa [Uni,Pueblo].
 if public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pueblo', 'Uni') <> 2 then raise exception 'rename: filas'; end if;
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000004') <> array['Uni'] then raise exception 'rename no fusiona'; end if;
 if public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'UNI', '  Amigos   de la uni ') <> 5 then raise exception 'rename Uni: filas'; end if;
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000003') <> array['Amigos de la uni','Trabajo'] then raise exception 'rename conserva el orden'; end if;
 if public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Trabajo', '') <> 1 then raise exception 'rename a vacío: filas'; end if;
 if (select tags from public.wedding_guests where id='8a000000-0000-4000-8000-000000000003') <> array['Amigos de la uni'] then raise exception 'rename a vacío no quita'; end if;
 if public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'No existe', 'Algo') <> 0 then raise exception 'rename inexistente'; end if;
 begin perform public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Amigos de la uni', repeat('x',31)); raise exception 'rename largo aceptado';
 exception when invalid_parameter_value then null; end;
 -- …y no toca a B ni puede renombrar en B.
 begin perform public.rename_guest_tag('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Uni', 'Robada'); raise exception 'A renombra en B';
 exception when insufficient_privilege then null; end;

 -- Lado: la pareja lo cambia en los suyos y no en los de B (RLS: 0 filas).
 update public.wedding_guests set side = 'p2' where id = '8a000000-0000-4000-8000-000000000005';
 update public.wedding_guests set side = 'p2', tags = array['Robada'] where id = '8b000000-0000-4000-8000-000000000001';
 if found then raise exception 'A cambia el lado de B'; end if;

 -- wedding_seating: tags, side y kids (0 si falta o no es número).
 v := public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 select e into v from jsonb_array_elements(v->'unseated') e where e->>'name' = 'Ana';
 if v->'tags' <> '["Amigos de la uni"]'::jsonb or v->>'side' <> 'p1' or (v->>'kids')::int <> 1 then raise exception 'wedding_seating Ana: %', v; end if;
 select e into v from jsonb_array_elements(public.wedding_seating('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'unseated') e where e->>'name' = 'Carla';
 if (v->>'kids')::int <> 0 or v->'side' is null then raise exception 'wedding_seating kids no numérico: %', v; end if;
 if jsonb_array_length(public.wedding_seating('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'unseated') <> 0 then raise exception 'A ve el plano de B'; end if;

 -- reminder_queue con etiqueta (Elsa: enviada hace 5 días, sin respuesta).
 if (select count(*) from public.reminder_queue('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 1 then raise exception 'reminder_queue sin etiqueta'; end if;
 if (select count(*) from public.reminder_queue('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200, null, 'Amigos de la uni')) <> 1 then raise exception 'reminder_queue por etiqueta'; end if;
 if exists (select 1 from public.reminder_queue('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200, null, 'Trabajo')) then raise exception 'reminder_queue etiqueta ajena a la fila'; end if;
 if (select tags from public.reminder_queue('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> array['Amigos de la uni'] then raise exception 'reminder_queue sin tags'; end if;
 if exists (select 1 from public.reminder_queue('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 200, null, 'Uni')) then raise exception 'A ve la fila de B'; end if;

 -- Ver B: nada.
 if exists (select 1 from public.guest_tag_summary('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'A ve las etiquetas de B'; end if;
 if exists (select 1 from public.guest_page('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','todos','',100,0,null,'Uni')) then raise exception 'A ve la página de B'; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
do $$ declare r record; begin
 select * into r from public.wedding_guests where id = '8b000000-0000-4000-8000-000000000001';
 if r.tags <> array['Uni'] or r.side <> 'p1' then raise exception 'A modificó a B: %', r; end if;
 select * into r from public.guest_tag_summary('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if (r.tag, r.guests, r.attendees) <> ('Uni'::text, 1::bigint, 3::bigint) then raise exception 'Resumen propio de B: %', r; end if;
 if exists (select 1 from public.guest_tag_summary('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'B ve el resumen de A'; end if;
 begin perform public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Amigos de la uni', 'Robada'); raise exception 'B renombra en A';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Sin sesión (anon): ni siquiera puede llamar.
set local role anon;
do $$ begin
 begin perform public.guest_tag_summary('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'anon llama a guest_tag_summary';
 exception when insufficient_privilege then null; end;
 begin perform public.set_guest_tags('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array[]::uuid[], '{}', '{}'); raise exception 'anon llama a set_guest_tags';
 exception when insufficient_privilege then null; end;
 begin perform public.rename_guest_tag('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a', 'b'); raise exception 'anon llama a rename_guest_tag';
 exception when insufficient_privilege then null; end;
 begin perform public.guest_page('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos','',100,0,null,'Uni'); raise exception 'anon llama a guest_page';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'guest-tags: CHECK, filtros, resumen, set/rename, seating y aislamiento A/B OK'; end $$;
rollback;
