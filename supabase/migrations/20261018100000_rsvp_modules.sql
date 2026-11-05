-- Módulos del formulario de asistencia (8-oct-2026, docs/superpowers/specs/
-- 2026-10-08-modulos-rsvp-design.md): autobuses, alojamiento, canción, menú
-- y niños.
--
--  * wedding_guests.rsvp_answers: respuestas a los módulos (objeto JSON,
--    ≤ 4 KB). La forma y la pertenencia a los módulos activos de la web
--    publicada las valida la server action (lib/rsvp-answers.ts); aquí, la
--    defensa en profundidad de tipo y tamaño.
--  * guest_rsvp_respond gana una sobrecarga de 6 argumentos (p_answers) SIN
--    valor por defecto (no ambigua para PostgREST). La de 5 queda como
--    envoltorio con p_answers = null para el código ya desplegado: el cuerpo
--    (locks, token, web retirada, plazo, límite por boda: auditoría H03/H11)
--    vive solo en la de 6, copiado de 20261006300000.
--  * site_document_issue acepta las escenas «transport» y «stay» (una de
--    cada) y hasta 14 escenas. Mismo cuerpo que 20261017100000 salvo eso.
-- Aditiva: el código anterior sigue funcionando tras aplicarla.
begin;

alter table public.wedding_guests
  add column if not exists rsvp_answers jsonb;
alter table public.wedding_guests
  drop constraint if exists wedding_guests_rsvp_answers_shape;
alter table public.wedding_guests
  add constraint wedding_guests_rsvp_answers_shape check (
    rsvp_answers is null
    or (pg_catalog.jsonb_typeof(rsvp_answers) = 'object' and pg_catalog.octet_length(rsvp_answers::text) <= 4096)
  );
comment on column public.wedding_guests.rsvp_answers is
  'Respuestas a los módulos del formulario (autobús, alojamiento, canción, menú, niños). Forma en lib/rsvp-answers.ts. NULL si no viene o no hay módulos.';

create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text,
  p_answers jsonb
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_wedding_date date;
  v_rsvp_deadline date;
  v_guest_id uuid;
  v_token_created timestamptz;
  v_published_at timestamptz;
  v_revision uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_notes is not null and pg_catalog.char_length(p_notes) > 500)
     or (p_answers is not null and (pg_catalog.jsonb_typeof(p_answers) <> 'object' or pg_catalog.octet_length(p_answers::text) > 4096)) then
    return 'invalid';
  end if;

  select w.id, w.wedding_date, w.rsvp_deadline into v_wedding_id, v_wedding_date, v_rsvp_deadline
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  -- Localiza el invitado (sin lock: aún no conocemos la fila a bloquear).
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  -- 1) Lock del invitado: mismo primer lock que issue_guest_token.
  perform 1 from public.wedding_guests g
    where g.id = v_guest_id and g.wedding_id = v_wedding_id
    for update;
  if not found then return 'unavailable'; end if;

  -- 2) Re-lectura del token bajo el lock (snapshot nuevo) + FOR SHARE: una
  --    revocación confirmada mientras esperábamos ya es visible aquí.
  select t.created_at into v_token_created
    from public.wedding_guest_tokens t
   where t.token_hash = p_token_hash and t.wedding_id = v_wedding_id
     and t.guest_id = v_guest_id and t.revoked_at is null
   for share;
  if not found then return 'unavailable'; end if;

  -- 3) Web retirada (publicada alguna vez y sin revisión vigente).
  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id
    for share;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_rsvp_deadline, v_token_created) then
    return 'closed';
  end if;

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         rsvp_notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
         -- Con «no» no quedan respuestas de módulos (ni autobús ni menú).
         rsvp_answers = case when p_status = 'si' and p_answers is not null and p_answers <> '{}'::jsonb then p_answers else null end,
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) is
  'RSVP con enlace personal y respuestas de módulos (20261018100000). Solo service_role (server action submitRsvp).';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb) to service_role;

-- La de 5 argumentos: envoltorio sin módulos (código desplegado antes).
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text
) returns text
language sql volatile security definer set search_path = '' as $$
  select public.guest_rsvp_respond(p_slug, p_token_hash, p_status, p_companions, p_notes, null::jsonb);
$$;
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text) to service_role;

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
  if p_doc ? 'opening' and not ((p_doc -> 'opening') in ('"sobre"', '"sobre-liso"')) then return 'opening'; end if;
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
