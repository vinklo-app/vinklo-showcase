-- Fotos de borrador en bucket privado (20261007100000, cierre de H05 de la
-- auditoría 2026-10-04). Solo una base DE PRUEBAS vacía con todas las
-- migraciones y el shim de storage:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-photos-drafts.sql
-- Dos bodas ficticias; todo se revierte con ROLLBACK.
-- LÍMITE: el shim no sirve HTTP. Aquí se prueba el bucket (privado), RLS de
-- la API (nadie salvo service_role) y que nada publicado referencia el bucket
-- privado; que Storage no sirva `public/wedding-photos-drafts/...` lo
-- garantiza `public = false` (lo comprueba la primera sección).
begin;
insert into auth.users(id) values ('71111111-1111-4111-8111-111111111111'), ('72222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fotos-borrador-a','71111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fotos-borrador-b','72222222-2222-4222-8222-222222222222','Lucia','Juan');

create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"editorial","locale":"es-ES","scenes":[{"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"","image":null,"showCountdown":true}},{"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"x"}}]}'::jsonb as doc,
 'https://sb.example.co/storage/v1/object/authenticated/wedding-photos-drafts/7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'::text as draft_url,
 'https://sb.example.co/storage/v1/object/public/wedding-photos/7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-cccccccccccccccccccccccccccccccc.jpg'::text as public_url;
grant select on fixture to authenticated, service_role;

-- ===================================================== bucket privado
do $$
declare b record;
begin
 select * into b from storage.buckets where id = 'wedding-photos-drafts';
 if not found then raise exception 'Bucket wedding-photos-drafts missing'; end if;
 if b.public then raise exception 'H05: el bucket de borradores debe ser PRIVADO'; end if;
 if b.file_size_limit is distinct from 4194304 then raise exception 'Límite 4 MiB (MAX_BYTES), got %', b.file_size_limit; end if;
 if b.allowed_mime_types is distinct from array['image/jpeg'] then raise exception 'Solo el JPEG del servidor: %', b.allowed_mime_types; end if;
 -- El bucket público sigue público (lo publicado y los datos anteriores).
 if not (select public from storage.buckets where id = 'wedding-photos') then raise exception 'wedding-photos debe seguir público'; end if;
 -- Ninguna política menciona el bucket privado: solo service_role opera.
 if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
            and (coalesce(qual,'') || coalesce(with_check,'')) like '%wedding-photos-drafts%') then
  raise exception 'No debe haber políticas para wedding-photos-drafts';
 end if;
end $$;

-- ===================================================== servidor (service_role)
set local role service_role;
insert into storage.objects(bucket_id,name,owner) values
 ('wedding-photos-drafts','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',null),
 ('wedding-photos-drafts','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg',null);
do $$ declare n integer; begin
 select count(*) into n from storage.objects where bucket_id='wedding-photos-drafts';
 if n <> 2 then raise exception 'service_role debe ver los borradores, vio %', n; end if;
end $$;
reset role;

-- ===================================================== pareja A: ni siquiera lo suyo por la API
set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
do $$
declare n integer;
begin
 select count(*) into n from storage.objects where bucket_id='wedding-photos-drafts';
 if n <> 0 then raise exception 'A no debe ver/listar el bucket privado (vio %)', n; end if;
 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos-drafts','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-directa.jpg');
  raise exception 'A pudo subir directamente al bucket privado';
 exception when insufficient_privilege then null; end;
 update storage.objects set name = name || 'x' where bucket_id='wedding-photos-drafts';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'A pudo modificar borradores'; end if;
 delete from storage.objects where bucket_id='wedding-photos-drafts';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'A pudo borrar borradores'; end if;
end $$;

-- ===================================================== anon
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare n integer;
begin
 select count(*) into n from storage.objects where bucket_id='wedding-photos-drafts';
 if n <> 0 then raise exception 'anon ve el bucket privado'; end if;
 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos-drafts','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/anon.jpg');
  raise exception 'anon pudo subir';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===================================================== oráculo: medios privados nunca publicables
do $$
declare d jsonb; f record;
begin
 select * into f from fixture;
 d := f.doc;
 -- Foto privada en la portada: estructura válida (puede estar en el borrador)…
 if public.site_document_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', f.draft_url, 'alt', ''))) is not null then
  raise exception 'Una foto privada debe poder guardarse en el borrador';
 end if;
 -- …pero no publicable, venga en la forma que venga.
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', f.draft_url, 'alt', ''))) is distinct from 'private_media' then
  raise exception 'Foto privada (authenticated) publicable';
 end if;
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', replace(f.draft_url, '/authenticated/', '/sign/') || '?token=x', 'alt', ''))) is distinct from 'private_media' then
  raise exception 'Foto privada (URL firmada) publicable';
 end if;
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', replace(f.draft_url, '/authenticated/', '/'), 'alt', ''))) is distinct from 'private_media' then
  raise exception 'Foto privada (sin prefijo) publicable';
 end if;
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', replace(f.draft_url, '/object/authenticated/', '/render/image/sign/') || '?token=x', 'alt', ''))) is distinct from 'private_media' then
  raise exception 'Foto privada (transformación de imagen) publicable';
 end if;
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,1,props,body}', to_jsonb(f.draft_url))) is distinct from 'private_media' then
  raise exception 'Referencia privada fuera de la portada publicable';
 end if;
 -- Lo público (y los datos anteriores a H05) sigue publicable.
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,image}', jsonb_build_object('url', f.public_url, 'alt', ''))) is not null then
  raise exception 'Foto pública rechazada';
 end if;
 -- Texto libre que solo nombra el bucket no bloquea.
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,1,props,body}', '"carpeta wedding-photos-drafts"')) is not null then
  raise exception 'Texto libre con el nombre del bucket rechazado';
 end if;
 -- El resto de reglas de publicar siguen por delante/igual.
 if public.site_document_publish_issue(jsonb_set(d,'{scenes,0,props,partnerName1}','"A"')) is distinct from 'cover_names' then
  raise exception 'cover_names cambió';
 end if;
 if has_function_privilege('anon','public.site_document_has_private_media(jsonb)','execute') then raise exception 'Helper ejecutable por anon'; end if;
end $$;

-- ===================================================== RPC: borrador con foto privada → 22023
set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
insert into public.wedding_sites(wedding_id,draft_document,draft_version)
 select '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_set(doc,'{scenes,0,props,image}', jsonb_build_object('url', draft_url, 'alt', '')), 1 from fixture;
do $$ begin
 perform * from public.wedding_site_publish('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1,
   (select jsonb_set(doc,'{scenes,0,props,image}', jsonb_build_object('url', draft_url, 'alt', '')) from fixture));
 raise exception 'H05 abierto: borrador con foto privada publicado por la RPC';
exception when invalid_parameter_value then
 if sqlerrm <> 'site_document_invalid' then raise exception 'Mensaje inesperado %', sqlerrm; end if;
end $$;
do $$ begin
 if exists (select 1 from public.wedding_site_revisions where wedding_id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Revisión creada pese al rechazo'; end if;
end $$;

-- Flujo de publishSite: guardar el borrador reescrito (URL pública) y publicarlo.
update public.wedding_sites
   set draft_document = (select jsonb_set(doc,'{scenes,0,props,image}', jsonb_build_object('url', public_url, 'alt', '')) from fixture),
       draft_version = 2
 where wedding_id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version = 1;
do $$ declare p record; begin
 select * into p from public.wedding_site_publish('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2,
   (select jsonb_set(doc,'{scenes,0,props,image}', jsonb_build_object('url', public_url, 'alt', '')) from fixture));
 if p.revision_id is null or p.draft_version <> 2 then raise exception 'La versión reescrita no se publicó'; end if;
 if exists (select 1 from public.wedding_site_revisions r where r.wedding_id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            and r.document::text like '%wedding-photos-drafts%') then
  raise exception 'Revisión publicada con referencia privada';
 end if;
end $$;
reset role;

-- ===================================================== CHECK en revisiones (también service_role)
set local role service_role;
do $$ begin
 insert into public.wedding_site_revisions(site_id,wedding_id,number,document,schema_version)
 select s.id, s.wedding_id, 99, (select jsonb_set(doc,'{scenes,0,props,image}', jsonb_build_object('url', draft_url, 'alt', '')) from fixture), 1
 from public.wedding_sites s where s.wedding_id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'service_role insertó una revisión con foto privada';
exception when check_violation then null; end $$;
reset role;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='wedding_site_revisions_no_private_media' and not convalidated) then
  raise exception 'La CHECK debe ser NOT VALID (no revalida revisiones existentes en producción)';
 end if;
 raise notice 'wedding-photos-drafts: bucket privado solo service_role; nada publicado referencia borradores';
end $$;
rollback;
