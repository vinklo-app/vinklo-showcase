/**
 * Plazo para confirmar asistencia (client-safe, sin dependencias de servidor).
 *
 * Misma regla que `guest_rsvp_closes_at` (SQL, 20261006300000), en fechas
 * civiles de Madrid:
 *  - con `rsvp_deadline` (la elige la pareja): se acepta hasta el final de ese día;
 *  - sin ella y con fecha de boda: hasta el final del día SIGUIENTE a la boda;
 *  - sin ninguna: abierta (la caducidad de 365 días depende de cada enlace y
 *    solo la aplica la RPC al enviar).
 * La página solo decide qué se pinta; quien rechaza respuestas es la RPC.
 */

export type RsvpWindowState =
  | { status: "open"; deadline: null }
  | { status: "open"; deadline: string }
  | { status: "closed"; reason: "deadline"; deadline: string }
  | { status: "closed"; reason: "wedding_over"; weddingDate: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null | undefined): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Fecha civil de hoy en Madrid (AAAA-MM-DD). */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function rsvpWindow(
  dates: { weddingDate: string | null | undefined; rsvpDeadline: string | null | undefined },
  now: Date = new Date(),
): RsvpWindowState {
  const today = madridToday(now);
  const deadline = validDate(dates.rsvpDeadline);
  if (deadline) {
    return today > deadline ? { status: "closed", reason: "deadline", deadline } : { status: "open", deadline };
  }
  const weddingDate = validDate(dates.weddingDate);
  if (weddingDate && today > addDays(weddingDate, 1)) return { status: "closed", reason: "wedding_over", weddingDate };
  return { status: "open", deadline: null };
}

/** "1 de mayo" (y el año si no es el actual en Madrid). */
export function formatRsvpDate(date: string, now: Date = new Date()): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const withYear = date.slice(0, 4) !== madridToday(now).slice(0, 4);
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(parsed);
}
