-- MVP web de boda + CRM: pendiente de aplicar manualmente antes de compartir
-- invitaciones personales. No modifica regalos históricos ni respuestas.
begin;
alter table public.wedding_guests add column if not exists invitation_token_hash text;
create unique index if not exists wedding_guests_invitation_token_hash_idx
  on public.wedding_guests (invitation_token_hash) where invitation_token_hash is not null;
comment on column public.wedding_guests.invitation_token_hash is
  'SHA-256 de un token aleatorio de 256 bits. Rotar el hash revoca el enlace anterior; token nunca almacenado en claro. El servidor valida también wedding_id.';
-- Grants explícitos: RLS existente limita todas estas operaciones al propietario.
grant select, insert, update, delete on public.wedding_guests to authenticated;
grant all on public.wedding_guests to service_role;
commit;
