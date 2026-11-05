-- Foto de la pareja (V2, F1 datos): bucket público `wedding-photos`.
--
-- Contrato (docs/handoffs/2026-10-03-v2/datos-ia.md):
--  * Ruta: `<wedding_id>/cover-<aleatorio>.<jpg|png|webp>`. El primer segmento
--    es SIEMPRE el uuid de la boda; RLS autoriza por él.
--  * Lectura pública: el bucket es `public = true`, así que la URL
--    `/storage/v1/object/public/wedding-photos/...` se sirve sin política.
--    NO se crea una política de select para anon: con ella cualquiera podría
--    LISTAR el bucket por la API y enumerar los wedding_id. Solo la pareja
--    dueña puede ver/listar sus objetos (lo necesita Storage para borrar).
--  * Escritura: solo `authenticated`, solo bajo `<wedding_id>/` de una boda
--    propia (`owns_wedding`). Tamaño (5 MB) y tipos MIME los aplica la API de
--    Storage con las columnas del bucket; el servidor los vuelve a comprobar
--    (lib/actions/photo.ts, incluidos los magic bytes).
--  * El primer segmento se valida con regex antes de convertirlo a uuid: una
--    ruta basura deniega (null → owns_wedding false) en vez de lanzar 22P02.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-photos', 'wedding-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- wedding_id del primer segmento de la ruta, o null si no es un uuid.
create or replace function public.wedding_photo_wedding_id(object_name text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(object_name, '/', 2) <> ''
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function public.wedding_photo_wedding_id(text) from public, anon;
grant execute on function public.wedding_photo_wedding_id(text) to authenticated, service_role;

drop policy if exists "wedding_photos_select_couple" on storage.objects;
drop policy if exists "wedding_photos_insert_couple" on storage.objects;
drop policy if exists "wedding_photos_update_couple" on storage.objects;
drop policy if exists "wedding_photos_delete_couple" on storage.objects;

create policy "wedding_photos_select_couple" on storage.objects for select
  to authenticated
  using (bucket_id = 'wedding-photos' and public.owns_wedding(public.wedding_photo_wedding_id(name)));

create policy "wedding_photos_insert_couple" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'wedding-photos' and public.owns_wedding(public.wedding_photo_wedding_id(name)));

create policy "wedding_photos_update_couple" on storage.objects for update
  to authenticated
  using (bucket_id = 'wedding-photos' and public.owns_wedding(public.wedding_photo_wedding_id(name)))
  with check (bucket_id = 'wedding-photos' and public.owns_wedding(public.wedding_photo_wedding_id(name)));

create policy "wedding_photos_delete_couple" on storage.objects for delete
  to authenticated
  using (bucket_id = 'wedding-photos' and public.owns_wedding(public.wedding_photo_wedding_id(name)));
