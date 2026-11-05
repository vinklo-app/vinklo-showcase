-- Apertura explícita «sin sobre» (8-oct-2026): `opening` admite "ninguno".
-- Desde este cambio, un documento SIN `opening` abre con el sobre floral
-- (lib/site-document.ts, resolveOpening): la landing promete el sobre y las
-- webs creadas no lo guardaban. Quien elige «Directa» guarda "ninguno".
-- Aditiva: el código anterior nunca escribe "ninguno" y sigue publicando
-- igual. Debe aplicarse ANTES del código que escribe "ninguno" (si no, la
-- RPC rechaza esas publicaciones con site_document_invalid).
-- Mismo cuerpo que 20261018100000 cambiando solo la comprobación de opening.
begin;
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
             where k not in ('schemaVersion', 'templateId', 'templateVersion', 'themeId', 'palette', 'opening', 'layout', 'locale', 'scenes')) then
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
  if p_doc ? 'opening' and not ((p_doc -> 'opening') in ('"sobre"', '"sobre-liso"', '"ninguno"')) then return 'opening'; end if;
  if p_doc ? 'layout' and not ((p_doc -> 'layout') in ('"historia"', '"web"')) then return 'layout'; end if;
  if p_doc ? 'locale' and (p_doc -> 'locale') is distinct from '"es-ES"'::jsonb then return 'locale'; end if;

  v_scenes := p_doc -> 'scenes';
  if v_scenes is null or pg_catalog.jsonb_typeof(v_scenes) <> 'array' then return 'scenes'; end if;
  v_count := pg_catalog.jsonb_array_length(v_scenes);
  if v_count < 1 or v_count > 14 then return 'scenes_count'; end if;

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
    if v_type not in ('cover', 'venue', 'agenda', 'rsvp', 'story', 'gallery', 'details', 'faq', 'transport', 'stay') then return 'scene_type'; end if;
    if v_type in ('cover', 'rsvp', 'transport', 'stay') then
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

commit;
