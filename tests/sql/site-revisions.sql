-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Ejecutar como administrador SQL: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/site-revisions.sql
-- Usa datos ficticios; revierte todos los cambios con ROLLBACK.
-- Cubre 20261002130000_wedding_sites.sql: borrador/publicación, optimistic
-- locking, inmutabilidad de revisiones, FK compuesta y fronteras por wedding_id.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-pareja-a','11111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-pareja-b','22222222-2222-4222-8222-222222222222','Lucia','Juan');

-- Documento mínimo válido según lib/site-document.ts (schemaVersion 1).
create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"editorial","locale":"es-ES","scenes":[{"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"","image":null,"showCountdown":true}},{"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"x"}}]}'::jsonb as doc;
grant select on fixture to anon, authenticated, service_role;

-- Privilegios estáticos (ningún rol de la Data API ve la vista; anon nada).
do $$ begin
 if has_table_privilege('anon','public.wedding_sites_public','select') then raise exception 'Public site view exposed to anon'; end if;
 if has_table_privilege('authenticated','public.wedding_sites_public','select') then raise exception 'Public site view exposed to authenticated'; end if;
 if not has_table_privilege('service_role','public.wedding_sites_public','select') then raise exception 'Service role cannot read public site view'; end if;
 if has_table_privilege('anon','public.wedding_sites','select') or has_table_privilege('anon','public.wedding_site_revisions','select') then raise exception 'Anonymous site tables exposed'; end if;
 if has_function_privilege('anon','public.wedding_site_publish(uuid,integer,jsonb,jsonb)','execute') then raise exception 'Anonymous publish exposed'; end if;
 if has_function_privilege('anon','public.wedding_site_unpublish(uuid)','execute') then raise exception 'Anonymous unpublish exposed'; end if;
 if has_column_privilege('authenticated','public.wedding_sites','published_revision_id','update') then raise exception 'Pointer writable by authenticated'; end if;
 if has_column_privilege('authenticated','public.wedding_sites','published_at','update') then raise exception 'published_at writable by authenticated'; end if;
 if has_column_privilege('authenticated','public.wedding_sites','published_revision_id','insert') then raise exception 'Pointer insertable by authenticated'; end if;
 if has_table_privilege('authenticated','public.wedding_site_revisions','insert') or has_table_privilege('authenticated','public.wedding_site_revisions','update') or has_table_privilege('authenticated','public.wedding_site_revisions','delete') then raise exception 'Revisions writable by authenticated'; end if;
 if has_table_privilege('authenticated','public.wedding_sites','delete') then raise exception 'Sites deletable by authenticated'; end if;
end $$;

-- ===================================================== pareja A: flujo completo
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare d jsonb; affected integer; p record; r record; v integer;
begin
 select doc into d from fixture;

 -- Crear el borrador como hace lib/actions/site.ts (draft_version=1 explícito).
 insert into public.wedding_sites(wedding_id,draft_document,draft_version)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d,1);

 -- No se puede crear un sitio para la boda de otra pareja (RLS with check).
 begin
  insert into public.wedding_sites(wedding_id,draft_document) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',d);
  raise exception 'Foreign site created';
 exception when insufficient_privilege then null; end;

 -- Documentos inválidos rechazados en BD (no solo en Zod).
 begin
  update public.wedding_sites set draft_document='[]'::jsonb where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Non-object document accepted';
 exception when check_violation then null; end;
 begin
  update public.wedding_sites set draft_document='{"scenes":[]}'::jsonb where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Document without schemaVersion accepted';
 exception when check_violation then null; end;
 begin
  update public.wedding_sites set draft_document=jsonb_build_object('schemaVersion',1,'pad',repeat('x',70000)) where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Oversized document accepted';
 exception when check_violation then null; end;
 begin
  update public.wedding_sites set draft_document=jsonb_set(d,'{schemaVersion}','1.5') where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Non-integer schemaVersion accepted';
 exception when check_violation then null; end;

 -- Publicar con versión incorrecta: 40001.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',7,d);
  raise exception 'Stale publish accepted';
 exception when serialization_failure then
  if sqlerrm <> 'site_version_conflict' then raise exception 'Unexpected conflict message %', sqlerrm; end if;
 end;
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,d);
  raise exception 'Null expected version bypassed lock';
 exception when serialization_failure then null; end;
 -- S-03: el documento validado por el servidor debe ser el almacenado.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,jsonb_set(d,'{scenes,0,props,partnerName1}','"Mallory"'));
  raise exception 'Publish with different p_document accepted';
 exception when serialization_failure then
  if sqlerrm <> 'site_version_conflict' then raise exception 'Unexpected p_document conflict message %', sqlerrm; end if;
 end;
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,null);
  raise exception 'Publish with null p_document accepted';
 exception when serialization_failure then null; end;
 if exists(select 1 from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Revision created despite conflict'; end if;

 -- Publicar con la versión correcta: revisión 1, puntero puesto, borrador intacto.
 -- Igualdad jsonb semántica: distinto orden de claves y mismo contenido publica.
 select * into p from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,('{"scenes":' || (d->'scenes')::text || ',"locale":"es-ES","themeId":"editorial","templateVersion":1,"templateId":"papel-calido","schemaVersion":1}')::jsonb);
 if p.revision_id is null or p.published_at is null or p.draft_version <> 1 then raise exception 'Publish returned bad row'; end if;
 if (select unpublished_at from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then raise exception 'unpublished_at set on publish'; end if;
 select * into r from public.wedding_site_revisions where id=p.revision_id;
 if r.number <> 1 or r.schema_version <> 1 or r.document <> d or r.wedding_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' or r.published_by <> '11111111-1111-4111-8111-111111111111' then raise exception 'Revision 1 incorrect'; end if;
 select draft_version into v from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v <> 1 then raise exception 'Publish changed draft_version'; end if;
 if (select published_revision_id from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> p.revision_id then raise exception 'Pointer not moved'; end if;

 -- Editar el borrador con bloqueo optimista (update where draft_version=base).
 update public.wedding_sites
  set draft_document=jsonb_set(d,'{scenes,1,props,body}','"Confirmad antes del 1 de mayo"'), draft_version=2
  where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=1;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Draft update with correct base failed'; end if;
 update public.wedding_sites set draft_document=d, draft_version=2
  where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=1;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Stale draft update accepted'; end if;

 -- La revisión publicada sigue siendo la antigua (editar no publica).
 if (select document from public.wedding_site_revisions where id=p.revision_id) <> d then raise exception 'Published revision changed by draft edit'; end if;
 if (select published_revision_id from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> p.revision_id then raise exception 'Pointer moved by draft edit'; end if;

 -- La pareja no puede mover el puntero ni tocar revisiones directamente.
 begin
  update public.wedding_sites set published_revision_id=null where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Pointer updated directly';
 exception when insufficient_privilege then null; end;
 begin
  update public.wedding_site_revisions set document='{"schemaVersion":1}'::jsonb where id=p.revision_id;
  raise exception 'Revision updated by authenticated';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.wedding_site_revisions(site_id,wedding_id,number,document,schema_version)
   select id,wedding_id,99,d,1 from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Revision inserted by authenticated';
 exception when insufficient_privilege then null; end;

 -- Segunda publicación: number=2, puntero a la nueva, draft_version sigue en 2.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,d);
  raise exception 'Publish with stale p_document accepted';
 exception when serialization_failure then null; end;
 select * into p from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,jsonb_set(d,'{scenes,1,props,body}','"Confirmad antes del 1 de mayo"'));
 select * into r from public.wedding_site_revisions where id=p.revision_id;
 if r.number <> 2 or p.draft_version <> 2 then raise exception 'Revision 2 incorrect'; end if;
 if (select count(*) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Revision count wrong'; end if;
 if r.document ->> 'schemaVersion' <> '1' or r.document #>> '{scenes,1,props,body}' <> 'Confirmad antes del 1 de mayo' then raise exception 'Revision 2 has wrong document'; end if;

 -- Publicar una boda ajena: excepción explícita (no se filtra existencia).
 begin
  perform * from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,d);
  raise exception 'Foreign publish accepted';
 exception when insufficient_privilege then
  if sqlerrm <> 'site_forbidden' then raise exception 'Unexpected forbidden message %', sqlerrm; end if;
 end;
 begin
  perform public.wedding_site_unpublish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  raise exception 'Foreign unpublish accepted';
 exception when insufficient_privilege then null; end;
end $$;

-- ================================= pareja B: no ve ni toca el sitio de A
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare d jsonb; affected integer; p record;
begin
 select doc into d from fixture;
 if exists(select 1 from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Foreign site readable'; end if;
 if exists(select 1 from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Foreign revisions readable'; end if;
 update public.wedding_sites set draft_document=d, draft_version=3 where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign draft modified'; end if;
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,d);
  raise exception 'Foreign publish by B accepted';
 exception when insufficient_privilege then null; end;
 -- Su propia boda sin fila: site_not_found, no 'forbidden'.
 begin
  perform * from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,d);
  raise exception 'Publish without site row accepted';
 exception when no_data_found then
  if sqlerrm <> 'site_not_found' then raise exception 'Unexpected not-found message %', sqlerrm; end if;
 end;
 -- Retirar sobre una fila nunca publicada: no cambia nada (sigue en adaptador).
 insert into public.wedding_sites(wedding_id,draft_document) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',d);
 perform public.wedding_site_unpublish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if (select published_at is null and unpublished_at is null from public.wedding_sites where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not true then raise exception 'Unpublish touched never-published row'; end if;
 select * into p from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,d);
 if p.revision_id is null then raise exception 'Own publish failed'; end if;
 -- Retirar (S-02): puntero a null, published_at se CONSERVA, unpublished_at fijada.
 perform public.wedding_site_unpublish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if (select published_revision_id is null and published_at is not null and unpublished_at is not null from public.wedding_sites where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not true then raise exception 'Unpublish state wrong'; end if;
 perform public.wedding_site_unpublish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); -- idempotente
 -- Volver a publicar: number sigue la secuencia (2) y unpublished_at vuelve a null.
 select * into p from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,d);
 if (select number from public.wedding_site_revisions where id=p.revision_id) <> 2 then raise exception 'Republish number wrong'; end if;
 if (select unpublished_at is null and published_revision_id = p.revision_id from public.wedding_sites where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not true then raise exception 'Republish did not clear unpublished_at'; end if;
end $$;

-- ===================================================== anon: nada
set local role anon;
do $$ begin
 begin
  perform * from public.wedding_sites_public;
  raise exception 'Anonymous read of public site view';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.wedding_sites;
  raise exception 'Anonymous read of sites';
 exception when insufficient_privilege then null; end;
end $$;

-- ================================ servidor: vista pública e invariantes
reset role;
set local role service_role;
do $$
declare n integer;
begin
 select count(*) into n from public.wedding_sites_public;
 if n <> 2 then raise exception 'Public view should list 2 published sites, got %', n; end if;
 if (select schema_version from public.wedding_sites_public where slug='test-pareja-a') <> 1 then raise exception 'Public view schema_version wrong'; end if;
 if (select document #>> '{scenes,1,props,body}' from public.wedding_sites_public where slug='test-pareja-a') <> 'Confirmad antes del 1 de mayo' then raise exception 'Public view not serving latest revision'; end if;
 if exists(select 1 from public.wedding_sites_public where slug not in ('test-pareja-a','test-pareja-b')) then raise exception 'Public view leaks other rows'; end if;
 if (select bool_and(is_published and document is not null and unpublished_at is null and revision_id is not null) from public.wedding_sites_public) is not true then raise exception 'Published rows malformed in view'; end if;
end $$;
-- S-02 en la vista: la pareja B retira su web; el servidor ve la fila con is_published=false.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.wedding_site_unpublish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
reset role;
set local role service_role;
do $$
declare v record;
begin
 select * into v from public.wedding_sites_public where slug='test-pareja-b';
 if not found then raise exception 'Withdrawn site missing from view (would fall back to adapter)'; end if;
 if v.is_published or v.document is not null or v.revision_id is not null or v.schema_version is not null then raise exception 'Withdrawn site still serving document'; end if;
 if v.published_at is null or v.unpublished_at is null then raise exception 'Withdrawn site timestamps wrong'; end if;
 if (select count(*) from public.wedding_sites_public where is_published) <> 1 then raise exception 'Published count wrong after withdrawal'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare p record;
begin
 select * into p from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,(select doc from fixture));
 if (select number from public.wedding_site_revisions where id=p.revision_id) <> 3 then raise exception 'Republish after withdrawal number wrong'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
 if (select is_published and document is not null and unpublished_at is null from public.wedding_sites_public where slug='test-pareja-b') is not true then raise exception 'Republished site not visible in view'; end if;
 if (select count(*) from public.wedding_sites_public) <> 2 then raise exception 'View count wrong after republish'; end if;
end $$;
reset role;
do $$
declare rev_b uuid; site_a uuid;
begin
 select id into site_a from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 select published_revision_id into rev_b from public.wedding_sites where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 -- FK compuesta: el puntero de A no puede señalar una revisión de B (ni como admin).
 begin
  update public.wedding_sites set published_revision_id=rev_b where id=site_a;
  raise exception 'Cross-wedding pointer accepted';
 exception when foreign_key_violation then null; end;
 -- Estados inválidos rechazados por la CHECK (puntero sin published_at; puntero con unpublished_at; retirada sin unpublished_at).
 begin
  update public.wedding_sites set published_at=null where id=site_a;
  raise exception 'Pointer without published_at accepted';
 exception when check_violation then null; end;
 begin
  update public.wedding_sites set unpublished_at=now() where id=site_a;
  raise exception 'Pointer with unpublished_at accepted';
 exception when check_violation then null; end;
 begin
  update public.wedding_sites set published_revision_id=null where id=site_a;
  raise exception 'Null pointer without unpublished_at accepted';
 exception when check_violation then null; end;
 -- Revisiones inmutables incluso para el owner de la tabla (trigger).
 begin
  update public.wedding_site_revisions set document='{"schemaVersion":1}'::jsonb where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Revision updated by admin';
 exception when feature_not_supported then
  if sqlerrm <> 'wedding_site_revisions_immutable' then raise exception 'Unexpected immutability message %', sqlerrm; end if;
 end;
 -- Despublicar y volver a publicar no afecta a la vista de la otra boda.
 if (select count(*) from public.wedding_sites_public) <> 2 then raise exception 'View count drifted'; end if;
 -- Trigger de updated_at: now() es constante en la transacción, así que se
 -- retrasa el valor con el trigger desactivado y se comprueba que lo repone.
 alter table public.wedding_sites disable trigger wedding_sites_touch_updated_at;
 update public.wedding_sites set updated_at=now()-interval '1 day' where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 alter table public.wedding_sites enable trigger wedding_sites_touch_updated_at;
 update public.wedding_sites set draft_version=draft_version where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if (select updated_at from public.wedding_sites where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> now() then raise exception 'updated_at trigger not firing'; end if;
 -- Borrar la boda cascadea sitio y revisiones (el trigger no bloquea deletes).
 delete from public.weddings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if exists(select 1 from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Site survived wedding delete'; end if;
 if exists(select 1 from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Revisions survived wedding delete'; end if;
 if (select count(*) from public.wedding_sites_public) <> 1 then raise exception 'View still lists deleted wedding'; end if;
end $$;
rollback;
