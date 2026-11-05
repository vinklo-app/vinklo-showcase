-- Fotos de borrador en un bucket PRIVADO (cierre de H05 de
-- docs/audits/2026-10-04-revision-integral-vinklo.txt).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
--
-- Antes (20261006200000, H05 mitigado): la foto se subía directamente al
-- bucket público `wedding-photos`; una foto de BORRADOR era descargable por
-- quien conociera su URL, aunque la pareja nunca publicase.
--
-- Ahora:
--  * `wedding-photos-drafts` (public = false): uploadCouplePhoto escribe aquí
--    (service_role, tras recodificar con sharp). El borrador guarda una
--    referencia estable y no servible:
--      https://<proyecto>/storage/v1/object/authenticated/wedding-photos-drafts/<wedding_id>/cover-<128 bits>.jpg
--    El editor la enseña con URLs firmadas de 1 h que emite el servidor
--    (getCouplePhotoPreview) tras comprobar sesión y boda.
--  * Sin políticas en storage.objects para este bucket: ni anon ni
--    authenticated (tampoco la pareja dueña) leen, listan, escriben ni borran
--    por la API. Solo service_role (que no pasa por RLS) desde el servidor.
--    Las políticas existentes de storage.objects filtran por
--    bucket_id = 'wedding-photos' o 'invoices', así que no lo abren.
--  * Al publicar (publishSite) el servidor copia el objeto a `wedding-photos`
--    con otra ruta aleatoria, reescribe la URL en el borrador y entonces
--    publica. Lo publicado sigue siendo público (invitados + next/image).
--  * Defensa en profundidad: ninguna revisión publicada puede referenciar el
--    bucket privado. `site_document_publish_issue` devuelve `private_media`
--    (la RPC wedding_site_publish lo convierte en 22023 site_document_invalid)
--    y una CHECK NOT VALID en wedding_site_revisions lo impide también a
--    service_role.
--
-- Datos existentes (solo hacia delante): las fotos ya subidas a
-- `wedding-photos` siguen sirviéndose por su URL pública y los borradores y
-- revisiones que las referencian siguen siendo válidos (la regla solo mira el
-- bucket privado). NOT VALID no revisa revisiones antiguas.
--
-- Orden: aplicar ANTES de desplegar el código que sube al bucket privado (sin
-- el bucket, las subidas nuevas fallan). Es compatible con el código anterior.
-- Idempotente.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-photos-drafts', 'wedding-photos-drafts', false, 4194304, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ¿El documento referencia un objeto del bucket privado (cualquier forma de
-- URL de Storage, también /render/image/): public/sign/authenticated o sin prefijo. Texto libre de la
-- pareja que solo mencione el nombre del bucket no cuenta.
create or replace function public.site_document_has_private_media(p_doc jsonb)
returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_doc::text ~ '/storage/v1/(object|render/image)/([a-z]+/)?wedding-photos-drafts/', false);
$$;
comment on function public.site_document_has_private_media(jsonb) is
  'true si el documento referencia el bucket privado wedding-photos-drafts (H05): nunca se publica.';
revoke all on function public.site_document_has_private_media(jsonb) from public, anon;
grant execute on function public.site_document_has_private_media(jsonb) to authenticated, service_role;

-- Misma función que 20261006101000 + la regla `private_media`.
create or replace function public.site_document_publish_issue(p_doc jsonb)
returns text
language plpgsql stable parallel safe set search_path = '' as $$
declare
  v_issue text := public.site_document_issue(p_doc);
  v_cover jsonb;
  v_date text;
begin
  if v_issue is not null then return v_issue; end if;
  -- H05: una foto de borrador (bucket privado) nunca llega a lo publicado;
  -- publishSite la copia antes al bucket público y reescribe la URL.
  if public.site_document_has_private_media(p_doc) then return 'private_media'; end if;
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
  'site_document_issue + sin medios privados (H05) + requisitos de publicar (dos nombres y fecha en la portada). NULL = publicable.';

alter table public.wedding_site_revisions
  drop constraint if exists wedding_site_revisions_no_private_media;
alter table public.wedding_site_revisions
  add constraint wedding_site_revisions_no_private_media
  check (not public.site_document_has_private_media(document)) not valid;

commit;
