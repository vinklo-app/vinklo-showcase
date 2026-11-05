-- RSVP (2026-07-13): el invitado confirma asistencia desde /b/[slug].
-- Una respuesta ES un invitado → se amplía wedding_guests en vez de
-- crear otra tabla; el tracker de la pareja lo enseña todo junto
-- (quién viene y quién ha regalado). La escritura anónima va por
-- server action con service role (RLS de la pareja intacta).

alter table public.wedding_guests
  add column if not exists rsvp_status text not null default 'pendiente'
    check (rsvp_status in ('pendiente', 'si', 'no')),
  add column if not exists rsvp_companions int not null default 0
    check (rsvp_companions between 0 and 10),
  add column if not exists rsvp_notes text,
  -- 'couple' = lo apuntó la pareja; 'rsvp' = se confirmó solo el invitado.
  add column if not exists source text not null default 'couple'
    check (source in ('couple', 'rsvp'));
