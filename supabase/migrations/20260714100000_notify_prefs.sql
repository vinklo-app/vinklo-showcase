-- Preferencia de avisos por email (2026-07-14): la pareja elige cómo
-- enterarse de las aportaciones — cada una al momento ('inmediato',
-- comportamiento actual y por defecto), un resumen los lunes ('semanal')
-- o nada ('nunca'). La gestiona la propia pareja por RLS desde su panel.

alter table public.weddings
  add column if not exists notify_contribution text not null default 'inmediato'
    check (notify_contribution in ('inmediato', 'semanal', 'nunca'));
