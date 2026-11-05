-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Ejecutar como administrador SQL: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/fase1-flujo.sql
-- Usa datos ficticios; revierte todos los cambios con ROLLBACK.
--
-- QA fase 1 (criterio de cierre ARQUITECTURA §8): «editar no altera publicado;
-- publicar atómico; slugs existentes funcionan». Flujo completo de dos parejas
-- visto desde los tres roles que usa la aplicación:
--   authenticated → lo que hace lib/actions/site.ts con el cliente de sesión
--   service_role  → lo que lee lib/data/site-public.ts (vista wedding_sites_public)
--   anon          → nada
-- Complementa tests/sql/site-revisions.sql (agente DB): aquí la vista pública
-- se consulta ENTRE cada paso del flujo (crear → publicar → editar → publicar
-- → despublicar) y se comprueba el límite de tamaño frente al presupuesto Zod.
-- Firma tras seguridad (db.md §6): wedding_site_publish(wedding, version, document)
-- y vista con is_published/unpublished_at (retirar → fila con document null → 404).
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date,page_config) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','qa-pareja-a','11111111-1111-4111-8111-111111111111','Ana','Luis','2027-06-12','{"style":"natural","venue":"Finca"}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','qa-pareja-b','22222222-2222-4222-8222-222222222222','Lucia','Juan',null,'{}');

-- Documento v1 válido para lib/site-document.ts (mismo que produce documentFromLegacy sobre la boda A).
create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"natural","locale":"es-ES","scenes":[{"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"v1","image":null,"showCountdown":true}},{"id":"lugar","type":"venue","enabled":true,"props":{"venue":"Finca","address":"","time":""}},{"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"Les hace la vida mucho más fácil saber cuántos seréis."}},{"id":"programa","type":"agenda","enabled":false,"props":{"title":"El día de la boda","items":[]}}]}'::jsonb as doc;
grant select on fixture to anon, authenticated, service_role;

-- Estado inicial: ninguna boda publicada → la vista está vacía (el servidor caerá al adaptador v1).
set local role service_role;
do $$ begin
 if (select count(*) from public.wedding_sites_public) <> 0 then raise exception 'View not empty before any publish'; end if;
 -- La vista antigua sigue sirviendo el slug (slugs existentes funcionan por adaptador).
 if (select count(*) from public.weddings_public where slug in ('qa-pareja-a','qa-pareja-b')) <> 2 then raise exception 'weddings_public missing legacy rows'; end if;
end $$;
reset role;

-- ============================================ paso 1: A crea su sitio (v1) y publica (number 1)
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare d jsonb; p record;
begin
 select doc into d from fixture;
 -- Antes de guardar nada no hay fila: publishSite con baseVersion 0 crea la fila y publica con versión 1.
 if exists(select 1 from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Site row exists before first save'; end if;
 insert into public.wedding_sites(wedding_id,draft_document,draft_version) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d,1);
  -- S-03: el RPC exige el documento que el servidor validó con Zod; uno distinto → 40001.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,jsonb_set(d,'{scenes,0,props,welcomeMessage}','"otro"'));
  raise exception 'Publish with mismatched document accepted';
 exception when serialization_failure then null; end;
 select * into p from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,d);
 if p.revision_id is null or p.published_at is null or p.draft_version <> 1 then raise exception 'First publish returned bad row'; end if;
 if (select number from public.wedding_site_revisions where id=p.revision_id) <> 1 then raise exception 'First revision number <> 1'; end if;
 raise notice 'paso 1: A publica revision % (number 1)', p.revision_id;
end $$;
reset role;

set local role service_role;
do $$ begin
 if (select count(*) from public.wedding_sites_public) <> 1 then raise exception 'View should list exactly A'; end if;
 if (select document #>> '{scenes,0,props,welcomeMessage}' from public.wedding_sites_public where slug='qa-pareja-a') <> 'v1' then raise exception 'View not serving v1'; end if;
 if (select plan from public.wedding_sites_public where slug='qa-pareja-a') <> 'free' then raise exception 'View plan wrong'; end if;
 if (select schema_version from public.wedding_sites_public where slug='qa-pareja-a') <> 1 then raise exception 'View schema_version wrong'; end if;
 if exists(select 1 from public.wedding_sites_public where slug='qa-pareja-b') then raise exception 'B visible without publishing'; end if;
 raise notice 'paso 1: vista publica sirve v1 para qa-pareja-a';
end $$;
reset role;

-- ============================================ paso 2: A edita el borrador (v2); lo publicado NO cambia
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare d jsonb; affected integer;
begin
 select doc into d from fixture;
 -- saveSiteDraft: update ... where wedding_id=? and draft_version=base, draft_version=base+1
 update public.wedding_sites
  set draft_document=jsonb_set(d,'{scenes,0,props,welcomeMessage}','"v2"'), draft_version=2
  where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=1;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Draft edit with correct base failed'; end if;
 -- Una segunda pestaña con la base antigua no pisa nada (0 filas → conflict en el action).
 update public.wedding_sites set draft_document=d, draft_version=2
  where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=1;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Stale base accepted'; end if;
 -- El borrador que ve la pareja es v2 y el puntero sigue en la revisión 1.
 if (select draft_document #>> '{scenes,0,props,welcomeMessage}' from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'v2' then raise exception 'Draft not updated'; end if;
 if (select r.number from public.wedding_sites s join public.wedding_site_revisions r on r.id=s.published_revision_id where s.wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then raise exception 'Pointer moved by edit'; end if;
 raise notice 'paso 2: borrador en v2 (draft_version 2), puntero sigue en number 1';
end $$;
reset role;

set local role service_role;
do $$ begin
 -- Editar no altera publicado: la vista sigue sirviendo v1.
 if (select document #>> '{scenes,0,props,welcomeMessage}' from public.wedding_sites_public where slug='qa-pareja-a') <> 'v1' then raise exception 'EDIT LEAKED TO PUBLISHED VIEW'; end if;
 if (select count(*) from public.wedding_sites_public) <> 1 then raise exception 'View count drifted after edit'; end if;
 raise notice 'paso 2: vista publica sigue en v1';
end $$;
reset role;

-- ============================================ paso 3: A publica el borrador (number 2)
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p record; d jsonb; d2 jsonb;
begin
 select doc into d from fixture;
 d2 := jsonb_set(d,'{scenes,0,props,welcomeMessage}','"v2"');
 -- Con la base obsoleta (1) el RPC rechaza y no deja revisión residual.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,d2);
  raise exception 'Stale publish accepted';
 exception when serialization_failure then null; end;
 if (select count(*) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then raise exception 'Residual revision after conflict'; end if;
 -- Con la base correcta pero el documento v1 (otra pestaña publicando lo que leyó): 40001.
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,d);
  raise exception 'Publish with stale document accepted';
 exception when serialization_failure then null; end;
 select * into p from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,d2);
 if (select number from public.wedding_site_revisions where id=p.revision_id) <> 2 then raise exception 'Second revision number <> 2'; end if;
 if p.draft_version <> 2 then raise exception 'Publish changed draft_version'; end if;
 if (select count(*) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Revision count <> 2'; end if;
 raise notice 'paso 3: A publica number 2';
end $$;
reset role;

set local role service_role;
do $$ begin
 if (select document #>> '{scenes,0,props,welcomeMessage}' from public.wedding_sites_public where slug='qa-pareja-a') <> 'v2' then raise exception 'View not serving v2 after publish'; end if;
 if (select count(*) from public.wedding_sites_public) <> 1 then raise exception 'View count drifted after second publish'; end if;
 raise notice 'paso 3: vista publica sirve v2';
end $$;
reset role;

-- ============================================ paso 4: A despublica → la vista queda vacía, el histórico se conserva
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 perform public.wedding_site_unpublish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 -- S-02: retirar conserva published_at y fija unpublished_at (estado «retirada»).
 if (select published_revision_id is null and published_at is not null and unpublished_at is not null from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not true then raise exception 'Unpublish did not set retired state'; end if;
 if (select draft_version from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Unpublish changed draft_version'; end if;
 if (select count(*) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Unpublish deleted revisions'; end if;
 -- Despublicar dos veces es idempotente (no lanza).
 perform public.wedding_site_unpublish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 raise notice 'paso 4: A despublica; revisiones conservadas';
end $$;
reset role;

set local role service_role;
do $$ begin
 -- S-02: la vista devuelve la fila retirada con is_published=false y document null → el servidor responde 404
 -- (no cae al adaptador). Una boda nunca publicada no tiene fila → adaptador v1.
 if not exists(select 1 from public.wedding_sites_public where slug='qa-pareja-a' and not is_published and document is null and unpublished_at is not null) then raise exception 'View does not expose retired site'; end if;
 if (select count(*) from public.wedding_sites_public) <> 1 then raise exception 'View should have exactly the retired row'; end if;
 if exists(select 1 from public.wedding_sites_public where slug='qa-pareja-b') then raise exception 'Never-published B appears in view'; end if;
 if not exists(select 1 from public.weddings_public where slug='qa-pareja-a') then raise exception 'Legacy view lost the slug'; end if;
 raise notice 'paso 4: vista publica expone la fila retirada (is_published=false, document null)';
end $$;
reset role;

-- ============================================ pareja B: no ve nada de A, ni puede tocarlo
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare d jsonb; affected integer;
begin
 select doc into d from fixture;
 if exists(select 1 from public.wedding_sites) then raise exception 'B sees a site row (A has one)'; end if;
 if exists(select 1 from public.wedding_site_revisions) then raise exception 'B sees revisions'; end if;
 update public.wedding_sites set draft_document=d, draft_version=3 where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'B modified A draft'; end if;
 begin
  insert into public.wedding_sites(wedding_id,draft_document,draft_version) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d,1);
  raise exception 'B inserted a site for A';
 exception when insufficient_privilege then null; when unique_violation then raise exception 'RLS let the insert reach the unique index'; end;
 begin
  perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,d);
  raise exception 'B published A';
 exception when insufficient_privilege then null; end;
 begin
  perform public.wedding_site_unpublish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'B unpublished A';
 exception when insufficient_privilege then null; end;
 -- B sin fila propia: site_not_found (boda v1 sin borrador guardado).
 begin
  perform * from public.wedding_site_publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',0,d);
  raise exception 'Publish without row accepted';
 exception when no_data_found then null; end;
 -- La vista pública no es legible por la pareja (solo servidor).
 begin
  perform * from public.wedding_sites_public;
  raise exception 'authenticated read public view';
 exception when insufficient_privilege then null; end;
 raise notice 'pareja B: aislada de A';
end $$;
reset role;

-- ============================================ anon: nada
set local role anon;
do $$ begin
 begin perform * from public.wedding_sites_public; raise exception 'anon read view'; exception when insufficient_privilege then null; end;
 begin perform * from public.wedding_sites; raise exception 'anon read sites'; exception when insufficient_privilege then null; end;
 begin perform * from public.wedding_site_revisions; raise exception 'anon read revisions'; exception when insufficient_privilege then null; end;
 begin perform * from public.wedding_site_publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'{}'::jsonb); raise exception 'anon executed publish'; exception when insufficient_privilege then null; end;
 begin perform public.wedding_site_unpublish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'anon executed unpublish'; exception when insufficient_privilege then null; end;
 raise notice 'anon: sin acceso';
end $$;
reset role;

-- ============================================ tamaño: ~70 KB falla; ~40 KB pasa en BD (Zod lo rechazaría)
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare big jsonb; mid jsonb; affected integer;
begin
 big := jsonb_build_object('schemaVersion',1,'templateId','papel-calido','pad',repeat('x',70000));
 raise notice 'pg_column_size(70 KB doc) = % bytes', pg_column_size(big);
 begin
  update public.wedding_sites set draft_document=big, draft_version=3 where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=2;
  raise exception 'Oversized (70 KB) document accepted';
 exception when check_violation then null; end;
 -- Tras el fallo el borrador sigue intacto en v2.
 if (select draft_version from public.wedding_sites where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Failed update changed version'; end if;
 -- Hueco documentado (db.md riesgo 6): 40 KB de texto > 32 KB de Zod, pero < 64 KB de la CHECK → la BD lo acepta.
 mid := jsonb_build_object('schemaVersion',1,'templateId','papel-calido','pad',repeat('y',40000));
 raise notice 'pg_column_size(40 KB doc) = % bytes (BD acepta; Zod rechaza a 32768)', pg_column_size(mid);
 update public.wedding_sites set draft_document=mid, draft_version=3 where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and draft_version=2;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception '40 KB document unexpectedly rejected by DB'; end if;
 raise notice 'tamanio: 70 KB rechazado por CHECK, 40 KB aceptado por BD';
end $$;
reset role;

-- ============================================ servidor: invariantes finales
do $$
declare n_rev integer;
begin
 select count(*) into n_rev from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if n_rev <> 2 then raise exception 'Expected 2 revisions for A, got %', n_rev; end if;
 if (select array_agg(number order by number) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> array[1,2] then raise exception 'Revision numbers not sequential'; end if;
 if (select array_agg(document #>> '{scenes,0,props,welcomeMessage}' order by number) from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> array['v1','v2'] then raise exception 'Revision documents not immutable snapshots'; end if;
 if (select published_by from public.wedding_site_revisions where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and number=2) <> '11111111-1111-4111-8111-111111111111' then raise exception 'published_by wrong'; end if;
 raise notice 'invariantes: 2 revisiones inmutables [v1,v2], publicadas por A';
end $$;
rollback;
