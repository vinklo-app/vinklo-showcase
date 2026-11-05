-- Borrador del creador guardado en servidor mientras la pareja confirma su
-- correo (builder_draft_stash).
-- Preparada en local. NO aplicada en remoto.
-- Aplicar ANTES de desplegar el código que la usa (/login la escribe y
-- /onboarding la lee). Sin la tabla, el código sigue funcionando: el borrador
-- se queda solo en el navegador, como hasta ahora.
--
-- Problema: el borrador de /crear vive en localStorage. El enlace del correo
-- se abre a menudo en otro navegador (el de la app de correo, otro
-- dispositivo), que no tiene ese borrador, y la pareja empezaba de cero.
--
--   * Una fila por correo (en minúsculas). Volver a pedir el enlace la pisa.
--   * Solo texto del borrador validado por el servidor (nunca la foto: sigue
--     en el IndexedDB del navegador donde se eligió).
--   * Caduca a los 7 días; cada escritura purga las caducadas.
--   * Se borra al crear la boda.
--   * Sin grants para anon/authenticated ni políticas: solo el servidor
--     (service_role) lee y escribe, igual que `waitlist`. Quien lee es la
--     cuenta que ha demostrado ser dueña del correo al abrir el enlace.
begin;

create table if not exists public.builder_draft_stash (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create index if not exists builder_draft_stash_expires_at_idx
  on public.builder_draft_stash (expires_at);

alter table public.builder_draft_stash enable row level security;
revoke all on public.builder_draft_stash from anon, authenticated;
grant all on public.builder_draft_stash to service_role;

commit;
