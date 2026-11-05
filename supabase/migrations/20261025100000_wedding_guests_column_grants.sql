-- Permisos por columna en wedding_guests (plan maestro §5, fila 5.6 · S3).
--
-- Hasta ahora `authenticated` tenía INSERT/UPDATE a nivel de TABLA
-- (20260930210000): con RLS solo en su boda, pero sobre CUALQUIER columna. La
-- pareja podía fabricar desde el cliente datos que solo escribe el servidor:
-- responded_at, rsvp_answers, rsvp_key_hash, invitation_token_hash,
-- invitation_prepared_at, rsvp_notes_by_guest, source…, o mover filas de boda
-- (wedding_id). Ahora solo las columnas que la app escribe con la sesión del
-- usuario (cliente de servidor con RLS y RPCs `security invoker`).
--
-- Inventario (código desplegado, v3 @ c1b3f03):
--   lib/actions/guests.ts  fields(): name, phone, rsvp_status, rsvp_companions,
--                          rsvp_notes, updated_at, group_name, tags, side,
--                          max_companions (insert + update); setGuestsGroup
--                          (group_name), setGuestsSide (side),
--                          setGuestsMaxCompanions (max_companions),
--                          confirm*InvitationSent (invitation_sent_at);
--                          insert además: wedding_id, source ('couple').
--   lib/actions/tables.ts  seatGuests: table_id.
--   lib/actions/gifts.ts   setGuestNoGift: gift_none.
--   lib/actions/messages.ts setRemindersOptOut: reminders_opt_out.
--   RPCs invoker: confirm_guest_reminder (last_reminder_at, reminder_count),
--                 set_guest_tags / rename_guest_tag (tags),
--                 apply_seating (table_id),
--                 create_wedding_gift / update_wedding_gift (gift_none).
-- Fuera a propósito (las escriben RPCs security definer, service_role o
-- triggers; los triggers BEFORE no pasan por los permisos de columna):
--   invitation_prepared_at, invitation_token_hash (issue_guest_token),
--   invitation_opened_at (guest_invitation_opened), responded_at,
--   rsvp_answers, rsvp_notes_by_guest (guest_rsvp_respond + trigger
--   wedding_guests_notes_owner), rsvp_key_hash, source (solo al crear),
--   wedding_id (solo al crear), id, created_at, y las columnas heredadas sin
--   uso: notes, gift_status, amount_cents.
--
-- AL AÑADIR UNA COLUMNA que la pareja deba escribir (p. ej. nombres de
-- acompañantes): añadidla a la lista de abajo en vuestra migración con un
-- `grant update (columna) …` / `grant insert (columna) …` aparte. NUNCA
-- volváis a dar `grant update on public.wedding_guests to authenticated`
-- (tabla entera): deshace esta migración.
--
-- Aditiva para el código desplegado: toda columna que escribe con la sesión
-- del usuario sigue concedida. service_role (servidor) no cambia.
begin;

revoke insert, update on public.wedding_guests from authenticated;

-- ── UPDATE: lista única de columnas editables por la pareja (RLS: su boda).
grant update (
  name,
  phone,
  rsvp_status,
  rsvp_companions,
  rsvp_notes,
  updated_at,
  group_name,
  tags,
  side,
  max_companions,
  table_id,
  invitation_sent_at,
  gift_none,
  reminders_opt_out,
  last_reminder_at,
  reminder_count
) on public.wedding_guests to authenticated;

-- ── INSERT: alta manual o importación (addGuest / bulkCreateGuests).
grant insert (
  wedding_id,
  source,
  name,
  phone,
  rsvp_status,
  rsvp_companions,
  rsvp_notes,
  updated_at,
  group_name,
  tags,
  side,
  max_companions
) on public.wedding_guests to authenticated;

notify pgrst, 'reload schema';
commit;
