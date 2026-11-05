-- Publicar valida el contrato también en SQL (20261006101000, auditoría
-- 2026-10-04 H04). Solo una base DE PRUEBAS vacía con todas las migraciones.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/site-publish-contract.sql
-- Dos bodas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('61111111-1111-4111-8111-111111111111'), ('62222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','contrato-pareja-a','61111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','contrato-pareja-b','62222222-2222-4222-8222-222222222222','Lucia','Juan');

-- Documento válido (mismo que site-revisions.sql) + variante con paleta,
-- apertura y todas las escenas del catálogo.
create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"editorial","locale":"es-ES","scenes":[{"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"","image":null,"showCountdown":true}},{"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"x"}}]}'::jsonb as doc;
grant select on fixture to authenticated;

-- ------------------------------------------- oráculo del validador (puro)
do $$
declare d jsonb; r record; full_doc jsonb;
begin
 select doc into d from fixture;
 if public.site_document_issue(d) is not null or public.site_document_publish_issue(d) is not null then raise exception 'Fixture válido rechazado: %', public.site_document_publish_issue(d); end if;
 full_doc := jsonb_set(d || '{"palette":"terracota","opening":"sobre","layout":"web"}'::jsonb, '{scenes}', (d->'scenes') || '[{"id":"lugar","type":"venue","enabled":false,"props":{"venue":"","address":"","time":""}},{"id":"programa","type":"agenda","enabled":true,"props":{"title":"x","items":[]}},{"id":"programa-2","type":"agenda","props":{"title":"y","items":[]}}]'::jsonb);
 if public.site_document_publish_issue(full_doc) is not null then raise exception 'Documento completo rechazado: %', public.site_document_publish_issue(full_doc); end if;
 -- Maqueta opcional (20261011100000): las dos válidas.
 if public.site_document_issue(d || '{"layout":"historia"}') is not null or public.site_document_issue(d || '{"layout":"web"}') is not null then raise exception 'Maqueta válida rechazada'; end if;
 -- Ritmo de la Story (20261031130000): enteros 3–15, publicables.
 if public.site_document_issue(d || '{"storySeconds":3}') is not null or public.site_document_issue(d || '{"storySeconds":6}') is not null or public.site_document_issue(d || '{"storySeconds":15}') is not null then raise exception 'storySeconds válido rechazado'; end if;
 if public.site_document_publish_issue(d || '{"layout":"historia","storySeconds":8}') is not null then raise exception 'storySeconds no publicable: %', public.site_document_publish_issue(d || '{"layout":"historia","storySeconds":8}'); end if;
 -- Aperturas (20261019100000): sobre floral, liso y «sin sobre» explícito.
 if public.site_document_issue(d || '{"opening":"sobre-liso"}') is not null or public.site_document_issue(d || '{"opening":"ninguno"}') is not null then raise exception 'Apertura válida rechazada'; end if;
 if public.site_document_publish_issue(d || '{"opening":"ninguno"}') is not null then raise exception 'Apertura «ninguno» no publicable'; end if;
 -- Claves por defecto de Zod ausentes (themeId, locale): estructura válida.
 if public.site_document_issue(d - 'themeId' - 'locale') is not null then raise exception 'Defaults ausentes rechazados'; end if;
 -- Borrador incompleto: estructura válida, pero no publicable.
 if public.site_document_issue(jsonb_set(d,'{scenes,0,props,partnerName2}','""')) is not null then raise exception 'Borrador incompleto rechazado como estructura'; end if;

 for r in select * from (values
   ('{"schemaVersion":1}'::jsonb, 'template_id'),
   ('[]'::jsonb, 'not_object'),
   (d - 'scenes', 'scenes'),
   (d - 'templateId', 'template_id'),
   (d - 'templateVersion', 'template_version'),
   (jsonb_set(d,'{schemaVersion}','2'), 'schema_version'),
   (jsonb_set(d,'{schemaVersion}','"1"'), 'schema_version'),
   (jsonb_set(d,'{templateId}','"otro"'), 'template_id'),
   (jsonb_set(d,'{templateVersion}','2'), 'template_version'),
   (jsonb_set(d,'{themeId}','"neon"'), 'theme_id'),
   (d || '{"palette":"verde"}', 'palette'),
   (d || '{"opening":"cortina"}', 'opening'),
   (d || '{"layout":"scroll"}', 'layout'),
   (d || '{"storySeconds":2}', 'storySeconds'),
   (d || '{"storySeconds":16}', 'storySeconds'),
   (d || '{"storySeconds":"6"}', 'storySeconds'),
   (d || '{"storySeconds":6.5}', 'storySeconds'),
   (d || '{"storySeconds":-3}', 'storySeconds'),
   (d || '{"storySeconds":null}', 'storySeconds'),
   (d || '{"storySeconds":100}', 'storySeconds'),
   (d || '{"layout":null}', 'layout'),
   (jsonb_set(d,'{locale}','"en-US"'), 'locale'),
   (d || '{"script":"alert(1)"}', 'unknown_key'),
   (jsonb_set(d,'{scenes}','[]'), 'scenes_count'),
   (jsonb_set(d,'{scenes}','{}'), 'scenes'),
   (jsonb_set(d,'{scenes}', (select jsonb_agg(jsonb_build_object('id','agenda-' || i,'type','agenda','props','{}'::jsonb)) from generate_series(1,15) i)), 'scenes_count'), -- tope 14 desde 20261018100000
   (jsonb_set(d,'{scenes}', jsonb_build_array(d->'scenes'->1, d->'scenes'->0)), 'first_scene_not_cover'),
   (jsonb_set(d,'{scenes}', (d->'scenes') || jsonb_build_array(jsonb_set(d->'scenes'->1,'{id}','"otra"'))), 'scene_singleton'),
   (jsonb_set(d,'{scenes,1,id}','"portada"'), 'scene_id_duplicate'),
   (jsonb_set(d,'{scenes,1,id}','"Mal Id"'), 'scene_id'),
   (jsonb_set(d,'{scenes,1,type}','"html"'), 'scene_type'),
   (jsonb_set(d,'{scenes,1,props}','"x"'), 'scene_props'),
   (d #- '{scenes,1,props}', 'scene_props'),
   (jsonb_set(d,'{scenes,1}', (d->'scenes'->1) || '{"onload":"x"}'), 'scene_unknown_key'),
   (jsonb_set(d,'{scenes,0,enabled}','false'), 'cover_disabled'),
   (jsonb_set(d,'{scenes,1,enabled}','"si"'), 'scene_enabled'),
   (jsonb_set(d,'{scenes,1}','"x"'), 'scene_not_object'),
   (jsonb_set(d,'{scenes,0,props,welcomeMessage}', to_jsonb(repeat('x',70000))), 'too_large')
 ) v(doc, expected) loop
   if public.site_document_issue(r.doc) is distinct from r.expected then
     raise exception 'Estructura: esperado % y salió %', r.expected, public.site_document_issue(r.doc);
   end if;
 end loop;

 for r in select * from (values
   (jsonb_set(d,'{scenes,0,props,partnerName1}','"A"'), 'cover_names'),
   (jsonb_set(d,'{scenes,0,props,partnerName2}','"   "'), 'cover_names'),
   (d #- '{scenes,0,props,partnerName1}', 'cover_names'),
   (jsonb_set(d,'{scenes,0,props,weddingDate}','""'), 'cover_date'),
   (jsonb_set(d,'{scenes,0,props,weddingDate}','"2027-02-30"'), 'cover_date'),
   (jsonb_set(d,'{scenes,0,props,weddingDate}','"12/06/2027"'), 'cover_date'),
   (jsonb_set(d,'{scenes,0,props,weddingDate}','20270612'), 'cover_date')
 ) v(doc, expected) loop
   if public.site_document_publish_issue(r.doc) is distinct from r.expected then
     raise exception 'Publicar: esperado % y salió %', r.expected, public.site_document_publish_issue(r.doc);
   end if;
 end loop;
end $$;

-- --------------------------- sonda de la auditoría: ahora queda rechazada
set local role authenticated;
select set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
insert into public.wedding_sites(wedding_id,draft_document,draft_version)
 values('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"schemaVersion":1}'::jsonb,1);
do $$ begin
 perform * from public.wedding_site_publish('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'{"schemaVersion":1}'::jsonb);
 raise exception 'H04 sigue abierto: documento incompleto publicado por llamada directa';
exception when invalid_parameter_value then
 if sqlerrm <> 'site_document_invalid' then raise exception 'Mensaje inesperado %', sqlerrm; end if;
end $$;
do $$ begin
 if exists (select 1 from public.wedding_site_revisions where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Revisión creada pese al rechazo'; end if;
 if exists (select 1 from public.wedding_sites where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and published_revision_id is not null) then raise exception 'Puntero movido pese al rechazo'; end if;
end $$;

-- Borrador estructuralmente válido pero sin nombres: tampoco se publica.
update public.wedding_sites set draft_document = jsonb_set((select doc from fixture),'{scenes,0,props,partnerName2}','""'), draft_version = 2
 where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 perform * from public.wedding_site_publish('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,jsonb_set((select doc from fixture),'{scenes,0,props,partnerName2}','""'));
 raise exception 'Documento sin nombres publicado';
exception when invalid_parameter_value then null; end $$;

-- El conflicto de versión sigue teniendo prioridad (mismo código que antes).
do $$ begin
 perform * from public.wedding_site_publish('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',9,'{"schemaVersion":1}'::jsonb);
 raise exception 'Versión obsoleta aceptada';
exception when serialization_failure then null; end $$;

-- Documento válido: publica como siempre.
update public.wedding_sites set draft_document = (select doc from fixture), draft_version = 3
 where wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ declare p record; begin
 select * into p from public.wedding_site_publish('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',3,(select doc from fixture));
 if p.revision_id is null then raise exception 'Documento válido no publicado'; end if;
end $$;

-- B no publica el sitio de A, aunque el documento sea válido.
select set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
do $$ begin
 perform * from public.wedding_site_publish('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',3,(select doc from fixture));
 raise exception 'B publicó la web de A';
exception when insufficient_privilege then null; end $$;
reset role;

-- ------------------------------------- CHECK en revisiones (service_role)
set local role service_role;
do $$ begin
 insert into public.wedding_site_revisions(site_id,wedding_id,number,document,schema_version)
 select s.id, s.wedding_id, 99, '{"schemaVersion":1}'::jsonb, 1 from public.wedding_sites s where s.wedding_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'Revisión fuera de contrato insertada por service_role';
exception when check_violation then null; end $$;
reset role;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='wedding_site_revisions_document_contract' and not convalidated) then
  raise exception 'La CHECK debe ser NOT VALID (no revalida revisiones existentes en producción)';
 end if;
 raise notice 'site-publish-contract: sonda H04 rechazada; válidos publican; aislamiento A/B OK';
end $$;
rollback;
