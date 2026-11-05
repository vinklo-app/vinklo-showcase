-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Ejecutar como administrador SQL: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-photos.sql
-- Requiere el shim de storage (storage.buckets con file_size_limit/allowed_mime_types
-- y storage.objects con RLS), ver docs/handoffs/2026-10-03-v2/datos-ia.md.
-- Cubre 20261003100000_wedding_photos_bucket.sql + 20261006200000_wedding_photos_server_only.sql
-- (dos bodas: solo service_role escribe; la pareja dueña ve y borra lo suyo; la otra
-- pareja y anon no ven nada) y 20261003110000_waitlist_interested_in_gifts.sql.
-- LÍMITE: el shim no sirve HTTP. Esto prueba la API (RLS), no la URL pública
-- /storage/v1/object/public/…, que en un bucket público NO pasa por RLS (H05).
-- Revierte todo con ROLLBACK.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-foto-a','11111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-foto-b','22222222-2222-4222-8222-222222222222','Lucia','Juan');

-- ===================================================== bucket y helper
do $$
declare b record;
begin
 select * into b from storage.buckets where id = 'wedding-photos';
 if not found then raise exception 'Bucket wedding-photos missing'; end if;
 if not b.public then raise exception 'Bucket must be public-read'; end if;
 if b.file_size_limit is distinct from 4194304 then raise exception 'Bucket size limit must be 4 MiB (MAX_BYTES of uploadCouplePhoto), got %', b.file_size_limit; end if;
 if b.allowed_mime_types is distinct from array['image/jpeg'] then raise exception 'Bucket must only take the server JPEG output: %', b.allowed_mime_types; end if;
 if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('wedding_photos_insert_couple','wedding_photos_update_couple')) then
  raise exception 'Couple insert/update policies on wedding-photos must be gone';
 end if;
 if public.wedding_photo_wedding_id('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-x.jpg') is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then raise exception 'Helper must parse the wedding id'; end if;
 if public.wedding_photo_wedding_id('no-es-uuid/cover.jpg') is not null then raise exception 'Helper must return null on garbage'; end if;
 if public.wedding_photo_wedding_id('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then raise exception 'Helper must require a file under the folder'; end if;
 if public.wedding_photo_wedding_id('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/') is not null then raise exception 'Helper must reject empty file name'; end if;
 if has_function_privilege('anon','public.wedding_photo_wedding_id(text)','execute') then raise exception 'Helper executable by anon'; end if;
end $$;

-- ===================================================== servidor (service_role): única vía de escritura
-- uploadCouplePhoto sube con service_role tras comprobar la boda y recodificar.
set local role service_role;
insert into storage.objects(bucket_id,name,owner) values
 ('wedding-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-a1.jpg',null),
 ('wedding-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-borrador.jpg',null),
 ('wedding-photos','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-b1.jpg',null);
reset role;

-- ===================================================== pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare n integer;
begin
 -- H06/H07: ni siquiera en su propia carpeta puede escribir bytes sin procesar.
 begin
  insert into storage.objects(bucket_id,name,owner) values ('wedding-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-directa.jpg','11111111-1111-4111-8111-111111111111');
  raise exception 'A could upload directly into its own folder (bypassing the server pipeline)';
 exception when insufficient_privilege then null; end;

 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-intruso.jpg');
  raise exception 'A could upload into B folder';
 exception when insufficient_privilege then null; end;

 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos','cover-suelta.jpg');
  raise exception 'A could upload outside a wedding folder';
 exception when insufficient_privilege then null; end;

 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos','no-es-uuid/cover.jpg');
  raise exception 'A could upload under a garbage folder';
 exception when insufficient_privilege then null; end;

 begin
  insert into storage.objects(bucket_id,name) values ('invoices','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/factura.pdf');
  raise exception 'A could write into the invoices bucket';
 exception when insufficient_privilege then null; end;

 -- Ve sus dos objetos (incluido el borrador) y ninguno de B.
 select count(*) into n from storage.objects where bucket_id='wedding-photos';
 if n <> 2 then raise exception 'A should see exactly its 2 objects, saw %', n; end if;
 select count(*) into n from storage.objects where name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-borrador.jpg';
 if n <> 1 then raise exception 'A cannot see its own draft photo'; end if;
 -- Sin update: no puede pisar (upsert) ni mover/renombrar lo que procesó el servidor.
 update storage.objects set name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-a2.jpg' where name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-a1.jpg';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'A could update (overwrite/rename) a processed object'; end if;
 update storage.objects set name='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-movida.jpg' where name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-a1.jpg';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'A could move its object into B folder'; end if;
 -- Puede borrar su foto (sustituida o retirada).
 delete from storage.objects where name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-borrador.jpg';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'A could not delete its own draft photo'; end if;
end $$;

-- ===================================================== pareja B
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare n integer;
begin
 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-b2.webp');
  raise exception 'B could upload directly';
 exception when insufficient_privilege then null; end;
 select count(*) into n from storage.objects where name like 'aaaaaaaa-%';
 if n <> 0 then raise exception 'B can see A objects (including drafts)'; end if;
 select count(*) into n from storage.objects where bucket_id='wedding-photos';
 if n <> 1 then raise exception 'B should see only its own object, saw %', n; end if;
 update storage.objects set name='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/robada.jpg' where name like 'aaaaaaaa-%';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'B could update A objects'; end if;
 delete from storage.objects where name like 'aaaaaaaa-%';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'B could delete A objects'; end if;
 delete from storage.objects where name='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-b1.jpg';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'B could not delete its own object'; end if;
end $$;

-- ===================================================== anon
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare n integer;
begin
 begin
  insert into storage.objects(bucket_id,name) values ('wedding-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/anon.jpg');
  raise exception 'anon could upload';
 exception when insufficient_privilege then null; end;
 -- Sin política de select para anon: no puede listar ni enumerar wedding_id
 -- (la lectura pública va por la URL pública del bucket, fuera de RLS).
 select count(*) into n from storage.objects where bucket_id='wedding-photos';
 if n <> 0 then raise exception 'anon can list the bucket'; end if;
 delete from storage.objects where bucket_id='wedding-photos';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'anon could delete'; end if;
end $$;

-- ===================================================== borrado de boda: el objeto sigue (limpieza fuera de SQL)
reset role;
do $$
declare n integer;
begin
 select count(*) into n from storage.objects where name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-a1.jpg';
 if n <> 1 then raise exception 'A object should still exist, found %', n; end if;
end $$;

-- ===================================================== waitlist.interested_in_gifts
do $$
declare v boolean;
begin
 if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist' and column_name='interested_in_gifts' and data_type='boolean' and is_nullable='NO' and column_default='false') then
  raise exception 'waitlist.interested_in_gifts missing or wrong shape';
 end if;
 if has_table_privilege('anon','public.waitlist','select') or has_table_privilege('anon','public.waitlist','insert')
   or has_table_privilege('authenticated','public.waitlist','select') or has_table_privilege('authenticated','public.waitlist','insert') then
  raise exception 'waitlist exposed to the Data API';
 end if;
 if not has_column_privilege('service_role','public.waitlist','interested_in_gifts','insert') then raise exception 'service_role cannot write interested_in_gifts'; end if;
 insert into public.waitlist(email,kind,source) values ('sin-casilla@example.com','pareja','test') returning interested_in_gifts into v;
 if v then raise exception 'interested_in_gifts must default to false'; end if;
 insert into public.waitlist(email,kind,source,interested_in_gifts) values ('con-casilla@example.com','pareja','test',true) returning interested_in_gifts into v;
 if not v then raise exception 'interested_in_gifts true not stored'; end if;
 begin
  insert into public.waitlist(email,kind,source,interested_in_gifts) values ('nula@example.com','pareja','test',null);
  raise exception 'interested_in_gifts accepted null';
 exception when not_null_violation then null; end;
end $$;

rollback;
