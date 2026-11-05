-- Ejecutar como administrador SQL: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/site-scenes-v2.sql
-- Requiere las migraciones hasta 20261016100000_site_document_scenes_v2.sql.
--
-- Cubre el catálogo v2 (story, gallery, details, faq): site_document_issue
-- los acepta, sigue rechazando tipos desconocidos, y publicar un documento
-- con las cuatro escenas (fotos ya públicas) funciona; con una foto privada
-- en un capítulo, publicar falla (private_media), igual que con la portada.
begin;

-- Fixture mínima (como site-revisions.sql): usuario + boda de la pareja A.
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ana-y-luis-v2','11111111-1111-4111-8111-111111111111','Ana','Luis','2027-06-12');

create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"editorial","locale":"es-ES","layout":"web","scenes":[
   {"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"","image":null,"showCountdown":true}},
   {"id":"fotos","type":"gallery","enabled":true,"props":{"title":"Os invitamos a celebrar nuestra historia","images":[{"url":"https://example.test/storage/v1/object/public/wedding-photos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-00000000000000000000000000000001.jpg","alt":"","caption":"Primer viaje"}]}},
   {"id":"historia","type":"story","enabled":true,"props":{"title":"Nuestra historia","intro":"","chapters":[{"id":"c1","title":"Cómo nos conocimos","body":"En la universidad.","images":[]}]}},
   {"id":"detalles","type":"details","enabled":true,"props":{"title":"Algunos detalles más","intro":"","cards":[{"id":"d1","title":"Dress code","teaser":"Fiesta en el jardín","body":"Colores claros.","linkLabel":""}]}},
   {"id":"preguntas","type":"faq","enabled":true,"props":{"title":"Preguntas y respuestas","contact":"","items":[{"id":"q1","question":"¿Hay aparcamiento?","answer":"Sí, en la finca."}]}},
   {"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"x"}}
 ]}'::jsonb as doc;
grant select on fixture to anon, authenticated, service_role;

do $$
declare d jsonb;
begin
 select doc into d from fixture;
 if public.site_document_issue(d) is not null then raise exception 'Documento v2 rechazado: %', public.site_document_issue(d); end if;
 if public.site_document_publish_issue(d) is not null then raise exception 'Documento v2 no publicable: %', public.site_document_publish_issue(d); end if;
 -- Tipo fuera del catálogo: sigue rechazado.
 if public.site_document_issue(jsonb_set(d, '{scenes,2,type}', '"video"')) is distinct from 'scene_type' then raise exception 'Tipo desconocido aceptado'; end if;
 -- Dos historias pueden convivir (no son únicas); dos portadas no.
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || jsonb_build_array(jsonb_set(d->'scenes'->2, '{id}', '"historia-2"')))) is not null then raise exception 'Segunda historia rechazada'; end if;
 if public.site_document_issue(jsonb_set(d, '{scenes}', (d->'scenes') || jsonb_build_array(jsonb_set(d->'scenes'->0, '{id}', '"portada-2"')))) is distinct from 'scene_singleton' then raise exception 'Segunda portada aceptada'; end if;
 -- Foto privada en un capítulo: no publicable (misma regla que la portada).
 if public.site_document_publish_issue(jsonb_set(d, '{scenes,2,props,chapters,0,images}', '[{"url":"https://example.test/storage/v1/object/authenticated/wedding-photos-drafts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-00000000000000000000000000000002.jpg","alt":""}]'::jsonb)) is distinct from 'private_media' then
   raise exception 'Foto privada en capítulo publicable';
 end if;
end $$;

-- Publicar de verdad, como la pareja.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare d jsonb; r record;
begin
 select doc into d from fixture;
 insert into public.wedding_sites(wedding_id,draft_document,draft_version) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d,1);
 select * into r from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,d);
 if r.revision_id is null then raise exception 'Publicación v2 sin revisión'; end if;
 if (select count(*) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and document->'scenes'->2->>'type'='story') <> 1 then
   raise exception 'La revisión publicada no conserva la historia';
 end if;
end $$;

reset role;
do $$ begin raise notice 'site-scenes-v2: story/gallery/details/faq aceptadas, publicables y sin medios privados OK'; end $$;
rollback;
