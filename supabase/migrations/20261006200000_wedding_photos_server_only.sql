-- Foto de la pareja: solo el servidor escribe; límites alineados (H05–H07 de
-- docs/audits/2026-10-04-revision-integral-vinklo.txt).
--
-- Antes: la pareja (rol `authenticated`) podía subir/sobrescribir objetos en
-- `<wedding_id>/` directamente por la API de Storage con su sesión, saltándose
-- lib/actions/photo.ts. Así podía guardar una foto con EXIF/GPS (H06) o un
-- archivo de hasta 5 MB que la función de Vercel nunca habría aceptado (H07).
--
-- Ahora:
--  * Escritura: SOLO service_role, desde uploadCouplePhoto, después de
--    comprobar la boda con la sesión (RLS de weddings) y de decodificar y
--    recodificar la imagen con sharp (JPEG sin metadatos). Se retiran las
--    políticas de insert y update para `authenticated` (sin update tampoco
--    vale `upsert` para pisar un objeto ya procesado con bytes crudos).
--  * Lectura/listado: la pareja dueña sigue viendo sus objetos (select) y
--    puede borrarlos (delete), como antes. Otra pareja y anon no ven nada por
--    la API: sigue sin existir política de select para anon (no se puede
--    listar el bucket ni enumerar wedding_id).
--  * Bucket: sigue `public = true` (decisión H05, ver abajo); tamaño máximo
--    4 MiB (= MAX_BYTES de la acción, por debajo de los 4,5 MB de Vercel) y
--    solo image/jpeg, que es lo único que emite el servidor.
--
-- H05 — decisión documentada (mitigado, no cerrado):
--  El bucket sigue siendo público porque /b/[slug], next/image (remotePatterns
--  /storage/v1/object/public/wedding-photos/**) y el preview del editor usan
--  la URL pública. La URL pública de Supabase NO pasa por RLS: una foto de
--  borrador es descargable por quien conozca su URL exacta. Mitigaciones:
--  ruta con 128 bits aleatorios (no adivinable), ningún listado público,
--  Cache-Control de 1 h en vez de 1 año (al borrar el objeto, deja de
--  servirse pronto también en la caché de next/image). Cerrar H05 del todo
--  exige un bucket privado para borradores y copiar a público al publicar
--  (lib/actions/site.ts + preview con URL firmada): fuera de esta migración.
--
-- Seguro sobre datos de producción: no toca storage.objects. Las fotos ya
-- subidas (jpg/png/webp de hasta 5 MB) siguen sirviéndose por su URL pública;
-- los límites del bucket solo se aplican a subidas nuevas. Idempotente.

update storage.buckets
   set public = true,
       file_size_limit = 4194304,
       allowed_mime_types = array['image/jpeg']
 where id = 'wedding-photos';

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'wedding-photos') then
    raise exception 'Bucket wedding-photos missing: apply 20261003100000_wedding_photos_bucket.sql first';
  end if;
end $$;

drop policy if exists "wedding_photos_insert_couple" on storage.objects;
drop policy if exists "wedding_photos_update_couple" on storage.objects;

-- select y delete de la pareja dueña se mantienen tal cual (20261003100000).
