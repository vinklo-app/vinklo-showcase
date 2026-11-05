-- Módulos del formulario (20261018100000): respuestas en rsvp_answers, la
-- sobrecarga de 6 argumentos, el envoltorio de 5 y las escenas transport/stay.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('61111111-1111-4111-8111-111111111111');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','modulos-pareja','61111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('6a000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Familia de Elena','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('6a000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('d',64));

do $$ begin
 if has_function_privilege('anon','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'RPC de 6 ejecutable por anon'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'RPC de 6 ejecutable por authenticated'; end if;
 if not has_function_privilege('service_role','public.guest_rsvp_respond(text,text,text,integer,text,jsonb,jsonb)','execute') then raise exception 'service_role no puede usar la de 6'; end if;
 if not has_function_privilege('service_role','public.guest_rsvp_respond(text,text,text,integer,text)','execute') then raise exception 'service_role perdió la de 5'; end if;
end $$;

set local role service_role;
do $$ declare g record; begin
 -- Con módulos: se guardan tal cual.
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'si', 3, 'Celíaca', '{"bus":{"use":"ambos","stop":"p-1"},"lodging":{"where":"hotel","hotel":"h-1"},"kids":1}'::jsonb) <> 'ok' then raise exception 'Respuesta con módulos rechazada'; end if;
 select * into g from public.wedding_guests where id='6a000000-0000-4000-8000-000000000001';
 if g.rsvp_answers->'bus'->>'use' <> 'ambos' or (g.rsvp_answers->>'kids')::int <> 1 or g.rsvp_companions <> 3 then raise exception 'Módulos mal guardados: %', g.rsvp_answers; end if;

 -- La de 5 (código anterior) limpia los módulos en lugar de dejarlos rancios.
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'si', 3, null) <> 'ok' then raise exception 'La de 5 dejó de funcionar'; end if;
 if (select rsvp_answers from public.wedding_guests where id='6a000000-0000-4000-8000-000000000001') is not null then raise exception 'La de 5 dejó respuestas antiguas'; end if;

 -- «No» nunca guarda módulos; objeto vacío = null.
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'no', 0, null, '{"bus":{"use":"ida"}}'::jsonb) <> 'ok' then raise exception '«No» rechazado'; end if;
 if (select rsvp_answers from public.wedding_guests where id='6a000000-0000-4000-8000-000000000001') is not null then raise exception '«No» guardó módulos'; end if;
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'si', 0, null, '{}'::jsonb) <> 'ok' then raise exception 'Objeto vacío rechazado'; end if;
 if (select rsvp_answers from public.wedding_guests where id='6a000000-0000-4000-8000-000000000001') is not null then raise exception 'Objeto vacío guardado'; end if;

 -- Fuera de contrato: no objeto o > 4 KB.
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'si', 0, null, '[1,2]'::jsonb) <> 'invalid' then raise exception 'Array aceptado'; end if;
 if public.guest_rsvp_respond('modulos-pareja', repeat('d',64), 'si', 0, null, jsonb_build_object('song', repeat('x', 5000))) <> 'invalid' then raise exception '> 4 KB aceptado'; end if;
end $$;
reset role;

-- La columna rechaza formas inválidas aunque se escriba directamente.
do $$ begin
 update public.wedding_guests set rsvp_answers = '"texto"'::jsonb where id='6a000000-0000-4000-8000-000000000001';
 raise exception 'Columna aceptó un string';
exception when check_violation then null; end $$;

-- Catálogo: transport y stay válidos, únicos; hasta 14 escenas.
do $$
declare d jsonb := '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"scenes":[
  {"id":"portada","type":"cover","props":{}},
  {"id":"autobuses","type":"transport","props":{"title":"Autobuses","stops":[]}},
  {"id":"alojamiento","type":"stay","props":{"title":"Dónde alojarse","hotels":[]}},
  {"id":"asistencia","type":"rsvp","props":{"song":true,"kids":true,"menuOptions":[{"id":"m-1","label":"Carne"}]}}]}'::jsonb;
 many jsonb := '[]'::jsonb;
begin
 if public.site_document_issue(d) is not null then raise exception 'Módulos rechazados: %', public.site_document_issue(d); end if;
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || jsonb_build_array(jsonb_set(d->'scenes'->1, '{id}', '"autobuses-2"')))) is distinct from 'scene_singleton' then raise exception 'Dos escenas de autobuses aceptadas'; end if;
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || jsonb_build_array(jsonb_set(d->'scenes'->2, '{id}', '"alojamiento-2"')))) is distinct from 'scene_singleton' then raise exception 'Dos escenas de alojamiento aceptadas'; end if;
 for i in 1..10 loop many := many || jsonb_build_array(jsonb_build_object('id', 'faq-' || i, 'type', 'faq', 'props', '{}'::jsonb)); end loop;
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || many)) is not null then raise exception '14 escenas rechazadas'; end if;
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || many || jsonb_build_array(jsonb_build_object('id','faq-11','type','faq','props','{}'::jsonb)))) is distinct from 'scenes_count' then raise exception '15 escenas aceptadas'; end if;
end $$;
rollback;
