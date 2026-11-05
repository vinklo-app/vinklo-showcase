/**
 * Quién está para recordar (revisión UX P0 #3 y P1 #14). Puro, sin I/O: lo
 * usan la fila de recordatorios, los avisos del panel y los tests.
 *
 *  - Entregada = envío confirmado por la pareja O primera apertura del
 *    enlace personal. Abrir el enlace prueba que la invitación llegó (la
 *    pareja suele olvidar «Sí, enviada» al volver de WhatsApp). Abrir
 *    WhatsApp, en cambio, no prueba nada: eso nunca marca nada.
 *  - Sin respuesta, con móvil válido para WhatsApp y sin «no recordar».
 *  - Con el plazo cerrado (fecha límite pasada o boda pasada) no se propone
 *    a nadie: el formulario ya no acepta respuestas.
 *  - Margen tras la entrega: REMINDER_MIN_GAP_DAYS días desde el envío (o la
 *    apertura), salvo que el plazo termine en DEADLINE_SOON_DAYS días o menos.
 *  - Entre recordatorios, siempre REMINDER_MIN_GAP_DAYS días.
 *
 * El SQL (`guest_in_filter('para_recordar')`, `reminder_queue`, recuentos)
 * aplica estas mismas reglas desde 20261101120000; la entrega se deduce al
 * leer y nunca se escribe en la ficha (invitation_sent_at sigue siendo solo
 * el «Sí, enviada» de la pareja).
 */
import { madridToday, rsvpWindow, type RsvpWindowState } from "@/lib/rsvp-window";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { REMINDER_MIN_DAYS } from "@/lib/messages/filters";

export const REMINDER_MIN_GAP_DAYS = REMINDER_MIN_DAYS;
export const DEADLINE_SOON_DAYS = 3;
const DAY_MS = 86_400_000;

export interface ReminderCandidate {
  rsvp_status: "pendiente" | "si" | "no";
  phone: string | null;
  invitation_sent_at: string | null;
  invitation_opened_at: string | null;
  last_reminder_at: string | null;
  reminders_opt_out?: boolean | null;
}

/** Cuándo sabemos que la invitación llegó: envío confirmado o, si no, primera apertura. */
export function deliveredAt(guest: Pick<ReminderCandidate, "invitation_sent_at" | "invitation_opened_at">): string | null {
  return guest.invitation_sent_at ?? guest.invitation_opened_at ?? null;
}

export type ReminderPeriod =
  | { status: "open"; deadline: string | null; daysLeft: number | null; soon: boolean }
  | { status: "closed"; window: Extract<RsvpWindowState, { status: "closed" }> };

function civilDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

/**
 * Plazo visto desde los recordatorios: cerrado (nadie para recordar) o
 * abierto con los días que quedan hasta la fecha límite (incluido ese día;
 * 0 = termina hoy). Sin fecha límite, `daysLeft` es null.
 */
export function reminderPeriod(dates: { weddingDate: string | null | undefined; rsvpDeadline: string | null | undefined }, now: Date = new Date()): ReminderPeriod {
  const window = rsvpWindow(dates, now);
  if (window.status === "closed") return { status: "closed", window };
  if (!window.deadline) return { status: "open", deadline: null, daysLeft: null, soon: false };
  const daysLeft = civilDaysBetween(madridToday(now), window.deadline);
  return { status: "open", deadline: window.deadline, daysLeft, soon: daysLeft <= DEADLINE_SOON_DAYS };
}

function olderThan(iso: string | null, days: number, now: Date): boolean {
  if (!iso) return true;
  const time = Date.parse(iso);
  return Number.isNaN(time) || time <= now.getTime() - days * DAY_MS;
}

/** ¿Toca proponer un recordatorio a esta persona ahora? */
export function isReminderDue(guest: ReminderCandidate, period: ReminderPeriod, now: Date = new Date()): boolean {
  if (period.status === "closed") return false;
  if (guest.rsvp_status !== "pendiente") return false;
  if (guest.reminders_opt_out) return false;
  if (!whatsappNumber(guest.phone)) return false;
  const delivered = deliveredAt(guest);
  if (!delivered) return false;
  if (!olderThan(guest.last_reminder_at, REMINDER_MIN_GAP_DAYS, now)) return false;
  // Primer recordatorio: margen tras la entrega, salvo que el plazo esté encima.
  if (!guest.last_reminder_at && !period.soon && !olderThan(delivered, REMINDER_MIN_GAP_DAYS, now)) return false;
  return true;
}

/** Quien menos recientemente se contactó, primero (como `reminder_queue`). Estable por id. */
export function sortReminders<T extends { id: string } & Pick<ReminderCandidate, "invitation_sent_at" | "invitation_opened_at" | "last_reminder_at">>(items: readonly T[]): T[] {
  const key = (item: T) => item.last_reminder_at ?? deliveredAt(item) ?? "";
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

/** Filtra y ordena; sin duplicados (la misma persona puede venir de dos lecturas). */
export function selectReminders<T extends { id: string } & ReminderCandidate>(items: readonly T[], period: ReminderPeriod, now: Date = new Date()): T[] {
  const seen = new Set<string>();
  const due = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return isReminderDue(item, period, now);
  });
  return sortReminders(due);
}
