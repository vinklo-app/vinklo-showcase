-- Seguridad del magic-link de proveedor (auditoría 2026-07-12, MEDIUM):
-- el token era cripto-fuerte pero no expiraba y seguía vivo tras el
-- setup, permitiendo cambiar el IBAN de cobro sin aviso a la pareja.
--
-- 1) Caducidad de la invitación: 30 días para completar el setup.
--    Tras activarse, el enlace sigue sirviendo para CONSULTAR (el
--    proveedor mira el estado de sus cobros), pero el código bloquea
--    el cambio de IBAN y avisa a la pareja de cada reenvío.
alter table public.vendors
  add column if not exists invite_token_expires_at timestamptz
    not null default (now() + interval '30 days');

comment on column public.vendors.invite_token_expires_at is
  'Caducidad del magic-link mientras status=invited. Activo: el enlace
   solo consulta; los reenvíos de setup no pueden cambiar el IBAN.';
