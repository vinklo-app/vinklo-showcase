-- Publicar es atómico también para el modelo antiguo (plan maestro §5, 5.7 · D2).
--
-- Antes, publishSite (lib/actions/site.ts) llamaba a wedding_site_publish y
-- DESPUÉS, en otra petición, sincronizaba weddings (page_config, nombres,
-- fecha y foto de portada: ajustes y la OG image los leen de ahí). Si esa
-- segunda escritura fallaba, la web quedaba publicada con weddings
-- desfasado. Ahora la sincronización viaja en el mismo RPC y la misma
-- transacción: o se publica todo, o nada.
--
-- Firma: 4.º parámetro opcional p_legacy jsonb (default null). El código
-- desplegado sigue llamando con 3 argumentos con nombre y obtiene el mismo
-- comportamiento de antes (sin sincronización en SQL; él la hace después).
-- Cuerpo: el de 20261015100000_wedding_members.sql, sin cambios, más el
-- bloque de p_legacy al final. Una sola sobrecarga (drop + create + grants).
--
-- p_legacy (lo calcula la app con legacyConfigFromDocument + la portada):
--   { page_config?: object, partner_name_1?: string, partner_name_2?: string,
--     wedding_date?: 'YYYY-MM-DD', cover_image_url?: string | null }
-- Solo esas claves (otra → 22023 site_legacy_invalid). Son exactamente las
-- columnas de weddings que authenticated ya puede actualizar por su cuenta
-- (grants por columna), así que el RPC definer no amplía nada; los CHECK de
-- weddings siguen aplicando (un fallo deshace también la publicación).
begin;

drop function if exists public.wedding_site_publish(uuid, integer, jsonb);

create function public.wedding_site_publish(
  p_wedding_id uuid,
  p_expected_version integer,
  p_document jsonb,
  p_legacy jsonb default null
)
 returns table(revision_id uuid, published_at timestamp with time zone, draft_version integer)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_site public.wedding_sites%rowtype;
  v_schema_version integer;
  v_revision_id uuid;
  v_published_at timestamptz := pg_catalog.now();
  v_issue text;
begin
  if v_uid is null or not public.owns_wedding(p_wedding_id) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  -- Forma de p_legacy antes de tocar nada (solo llega mal si se llama a mano).
  if p_legacy is not null and (
       pg_catalog.jsonb_typeof(p_legacy) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(p_legacy) k
                  where k not in ('page_config', 'partner_name_1', 'partner_name_2', 'wedding_date', 'cover_image_url'))
       or (p_legacy ? 'page_config' and pg_catalog.jsonb_typeof(p_legacy -> 'page_config') <> 'object')
       or (p_legacy ? 'partner_name_1' and pg_catalog.jsonb_typeof(p_legacy -> 'partner_name_1') <> 'string')
       or (p_legacy ? 'partner_name_2' and pg_catalog.jsonb_typeof(p_legacy -> 'partner_name_2') <> 'string')
       or (p_legacy ? 'wedding_date' and (pg_catalog.jsonb_typeof(p_legacy -> 'wedding_date') <> 'string'
                                          or (p_legacy ->> 'wedding_date') !~ '^\d{4}-\d{2}-\d{2}$'))
       or (p_legacy ? 'cover_image_url' and pg_catalog.jsonb_typeof(p_legacy -> 'cover_image_url') not in ('string', 'null'))
     ) then
    raise exception using errcode = '22023', message = 'site_legacy_invalid';
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

  -- 5.7: sincronización del modelo antiguo en la misma transacción. Clave
  -- ausente = no tocar la columna; cover_image_url presente y null = quitarla.
  if p_legacy is not null then
    update public.weddings w
    set page_config = case when p_legacy ? 'page_config' then p_legacy -> 'page_config' else w.page_config end,
        partner_name_1 = case when p_legacy ? 'partner_name_1' then p_legacy ->> 'partner_name_1' else w.partner_name_1 end,
        partner_name_2 = case when p_legacy ? 'partner_name_2' then p_legacy ->> 'partner_name_2' else w.partner_name_2 end,
        wedding_date = case when p_legacy ? 'wedding_date' then (p_legacy ->> 'wedding_date')::date else w.wedding_date end,
        cover_image_url = case when p_legacy ? 'cover_image_url' then p_legacy ->> 'cover_image_url' else w.cover_image_url end
    where w.id = p_wedding_id;
  end if;

  return query select v_revision_id, v_published_at, v_site.draft_version;
end;
$function$;

revoke all on function public.wedding_site_publish(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.wedding_site_publish(uuid, integer, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
