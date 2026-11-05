-- Lista de espera (V2): casilla «Nos interesa que nuestros invitados puedan
-- hacer su regalo desde la web». Solo señal de interés; no activa pagos.
-- Grants sin cambios: la tabla sigue sin acceso para anon/authenticated
-- (20260907180000) y `grant all ... to service_role` (20260707145754) cubre
-- la columna nueva. Escribe solo lib/actions/waitlist.ts con service role.
alter table public.waitlist
  add column if not exists interested_in_gifts boolean not null default false;

comment on column public.waitlist.interested_in_gifts is
  'La pareja marcó interés en recibir regalos desde la web (casilla de la landing). Default false.';
