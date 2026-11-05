-- Publicación de la web: invariantes del contrato también en SQL
-- (auditoría integral 2026-10-04, hallazgo H04).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
--
-- wedding_site_publish es ejecutable por `authenticated`. La igualdad jsonb
-- (S-03) solo prueba que se publica lo guardado, no que lo guardado pasó Zod:
-- la pareja podía insertar {"schemaVersion":1} como borrador y publicarlo
-- llamando a la RPC directamente. Ahora la RPC rechaza (22023
-- site_document_invalid, detalle = código) cualquier documento que no cumpla:
--   * objeto con solo las claves conocidas; schemaVersion=1,
--     templateId="papel-calido", templateVersion=1; themeId/locale/palette/
--     opening opcionales pero, si están, dentro de su catálogo;
--   * scenes: array de 1..12 objetos {id,type,enabled?,props}, id con el
--     formato de sceneId, tipo del catálogo, ids únicos, cover/rsvp únicos,
--     la primera escena es la portada (y enabled=true si viene);
--   * presupuesto de tamaño: 64 KiB de jsonb::text (el texto de jsonb añade
--     espacios respecto a JSON.stringify; el límite exacto de 32 KiB sigue en
--     lib/site-document.ts);
--   * requisitos de publicar (publishIssues): dos nombres de ≥2 caracteres y
--     una fecha válida AAAA-MM-DD en la portada.
-- lib/site-document.ts sigue siendo la fuente de verdad: esto es defensa en
-- profundidad, más laxo en props pero nunca más permisivo en la forma.
-- ATENCIÓN: subir SITE_SCHEMA_VERSION, cambiar templateId/versión o ampliar el
-- catálogo de escenas/temas/paletas exige una migración que actualice
-- site_document_issue; si no, publicar falla cerrado.
--
-- Además, CHECK NOT VALID en wedding_site_revisions.document con la parte
-- estructural: ninguna vía (ni service_role) inserta revisiones fuera de
-- contrato. NOT VALID no revisa las filas existentes (producción intacta).
begin;

-- Estructura del documento (sin requisitos de publicación). NULL = válido.
create or replace function public.site_document_issue(p_doc jsonb)
returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_scenes jsonb;
  v_scene jsonb;
  v_count integer;
  v_index integer := 0;
  v_type text;
  v_ids text[] := '{}';
  v_singletons text[] := '{}';
begin
  if p_doc is null or pg_catalog.jsonb_typeof(p_doc) <> 'object' then return 'not_object'; end if;
  if pg_catalog.octet_length(p_doc::text) > 65536 then return 'too_large'; end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_doc) k
             where k not in ('schemaVersion', 'templateId', 'templateVersion', 'themeId', 'palette', 'opening', 'locale', 'scenes')) then
    return 'unknown_key';
  end if;
  if (p_doc -> 'schemaVersion') is distinct from '1'::jsonb then return 'schema_version'; end if;
  if (p_doc -> 'templateId') is distinct from '"papel-calido"'::jsonb then return 'template_id'; end if;
  if (p_doc -> 'templateVersion') is distinct from '1'::jsonb then return 'template_version'; end if;
  if p_doc ? 'themeId' and not ((p_doc -> 'themeId') in ('"editorial"', '"clasico"', '"natural"')) then
    return 'theme_id';
  end if;
  if p_doc ? 'palette' and not ((p_doc -> 'palette') in
      ('"editorial"', '"clasico"', '"natural"', '"terracota"', '"rosa"', '"mar"', '"lavanda"', '"oro"')) then
    return 'palette';
  end if;
  if p_doc ? 'opening' and (p_doc -> 'opening') is distinct from '"sobre"'::jsonb then return 'opening'; end if;
  if p_doc ? 'locale' and (p_doc -> 'locale') is distinct from '"es-ES"'::jsonb then return 'locale'; end if;

  v_scenes := p_doc -> 'scenes';
  if v_scenes is null or pg_catalog.jsonb_typeof(v_scenes) <> 'array' then return 'scenes'; end if;
  v_count := pg_catalog.jsonb_array_length(v_scenes);
  if v_count < 1 or v_count > 12 then return 'scenes_count'; end if;

  for v_scene in select e from pg_catalog.jsonb_array_elements(v_scenes) e loop
    if pg_catalog.jsonb_typeof(v_scene) <> 'object' then return 'scene_not_object'; end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_scene) k where k not in ('id', 'type', 'enabled', 'props')) then
      return 'scene_unknown_key';
    end if;
    if pg_catalog.jsonb_typeof(v_scene -> 'id') is distinct from 'string'
       or (v_scene ->> 'id') !~ '^[a-z][a-z0-9-]{1,39}$' then
      return 'scene_id';
    end if;
    if (v_scene ->> 'id') = any (v_ids) then return 'scene_id_duplicate'; end if;
    v_ids := v_ids || (v_scene ->> 'id');
    if pg_catalog.jsonb_typeof(v_scene -> 'type') is distinct from 'string' then return 'scene_type'; end if;
    v_type := v_scene ->> 'type';
    if v_type not in ('cover', 'venue', 'agenda', 'rsvp') then return 'scene_type'; end if;
    if v_type in ('cover', 'rsvp') then
      if v_type = any (v_singletons) then return 'scene_singleton'; end if;
      v_singletons := v_singletons || v_type;
    end if;
    if v_scene ? 'enabled' and pg_catalog.jsonb_typeof(v_scene -> 'enabled') <> 'boolean' then return 'scene_enabled'; end if;
    if v_type = 'cover' and v_scene ? 'enabled' and (v_scene -> 'enabled') <> 'true'::jsonb then return 'cover_disabled'; end if;
    if pg_catalog.jsonb_typeof(v_scene -> 'props') is distinct from 'object' then return 'scene_props'; end if;
    if v_index = 0 and v_type <> 'cover' then return 'first_scene_not_cover'; end if;
    v_index := v_index + 1;
  end loop;
  return null;
end;
$$;
comment on function public.site_document_issue(jsonb) is
  'Defensa en profundidad del contrato SiteDocument v1 (lib/site-document.ts): NULL si la estructura es válida; si no, un código. Debe actualizarse con cada cambio de schemaVersion o catálogo.';

-- Estructura + requisitos para publicar (publishIssues). NULL = publicable.
create or replace function public.site_document_publish_issue(p_doc jsonb)
returns text
language plpgsql stable parallel safe set search_path = '' as $$
declare
  v_issue text := public.site_document_issue(p_doc);
  v_cover jsonb;
  v_date text;
begin
  if v_issue is not null then return v_issue; end if;
  v_cover := p_doc #> '{scenes,0,props}';
  if pg_catalog.jsonb_typeof(v_cover -> 'partnerName1') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_cover -> 'partnerName2') is distinct from 'string'
     or pg_catalog.char_length(pg_catalog.btrim(v_cover ->> 'partnerName1')) < 2
     or pg_catalog.char_length(pg_catalog.btrim(v_cover ->> 'partnerName2')) < 2 then
    return 'cover_names';
  end if;
  v_date := v_cover ->> 'weddingDate';
  if pg_catalog.jsonb_typeof(v_cover -> 'weddingDate') is distinct from 'string'
     or v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return 'cover_date';
  end if;
  begin
    -- to_char ida y vuelta: rechaza fechas imposibles (2027-02-30).
    if pg_catalog.to_char(v_date::date, 'YYYY-MM-DD') <> v_date then return 'cover_date'; end if;
  exception when others then
    return 'cover_date';
  end;
  return null;
end;
$$;
comment on function public.site_document_publish_issue(jsonb) is
  'site_document_issue + requisitos de publicar (dos nombres y fecha en la portada). NULL = publicable.';

revoke all on function public.site_document_issue(jsonb) from public, anon;
revoke all on function public.site_document_publish_issue(jsonb) from public, anon;
grant execute on function public.site_document_issue(jsonb) to authenticated, service_role;
grant execute on function public.site_document_publish_issue(jsonb) to authenticated, service_role;

-- Misma firma, mismo comportamiento, más la validación tras las igualdades.
create or replace function public.wedding_site_publish(
  p_wedding_id uuid,
  p_expected_version integer,
  p_document jsonb
) returns table(revision_id uuid, published_at timestamptz, draft_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_site public.wedding_sites%rowtype;
  v_schema_version integer;
  v_revision_id uuid;
  v_published_at timestamptz := pg_catalog.now();
  v_issue text;
begin
  if v_uid is null or not exists (
    select 1 from public.weddings w where w.id = p_wedding_id and w.couple_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  select * into v_site
  from public.wedding_sites s
  where s.wedding_id = p_wedding_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  if v_site.draft_version is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;
  if v_site.draft_document is distinct from p_document then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;

  -- H04: la igualdad no demuestra validación. El servidor de la app valida
  -- con Zod; aquí se exigen los invariantes aunque se llame directamente.
  v_issue := public.site_document_publish_issue(v_site.draft_document);
  if v_issue is not null then
    raise exception using errcode = '22023', message = 'site_document_invalid', detail = v_issue;
  end if;

  v_schema_version := (v_site.draft_document ->> 'schemaVersion')::integer;

  insert into public.wedding_site_revisions (site_id, wedding_id, number, document, schema_version, published_by)
  select v_site.id, v_site.wedding_id,
         coalesce(max(r.number), 0) + 1,
         v_site.draft_document, v_schema_version, v_uid
  from public.wedding_site_revisions r
  where r.site_id = v_site.id
  returning id into v_revision_id;

  update public.wedding_sites s
  set published_revision_id = v_revision_id,
      published_at = v_published_at,
      unpublished_at = null
  where s.id = v_site.id;

  return query select v_revision_id, v_published_at, v_site.draft_version;
end;
$$;

revoke all on function public.wedding_site_publish(uuid, integer, jsonb) from public, anon;
grant execute on function public.wedding_site_publish(uuid, integer, jsonb) to authenticated, service_role;

alter table public.wedding_site_revisions
  add constraint wedding_site_revisions_document_contract
  check (public.site_document_issue(document) is null) not valid;

commit;
