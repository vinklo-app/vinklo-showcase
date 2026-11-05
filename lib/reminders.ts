/**
 * Selección pura de recordatorios para el cron diario (spec 2026-07-08).
 * Sin I/O: recibe filas y "hoy", devuelve qué recordar. El route del cron
 * hace las consultas, el dedupe contra `events` y los envíos.
 */

/** Días de antelación con los que se avisa de un vencimiento. */
export const TRANCHE_REMINDER_DAYS = 7;
/** Días antes de la boda para el empujón de compartir el enlace. */
export const NUDGE_BEFORE_WEDDING_DAYS = 30;
/** Con menos aportaciones confirmadas que esto, se envía el empujón. */
export const NUDGE_MIN_CONTRIBUTIONS = 5;

export interface TrancheForReminder {
  id: string;
  vendor_id: string;
  label: string;
  amount_cents: number;
  due_date: string | null; // YYYY-MM-DD
  status: string;
}

export interface WeddingForNudge {
  id: string;
  wedding_date: string | null; // YYYY-MM-DD
  confirmedContributions: number;
}

/** "YYYY-MM-DD" de `days` días después de `todayIso` (fechas civiles). */
export function isoDaysFromNow(todayIso: string, days: number): string {
  const date = new Date(`${todayIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Tramos pendientes que vencen exactamente dentro de TRANCHE_REMINDER_DAYS.
 * Exactamente (no "≤") para que el cron diario avise una sola vez de forma
 * natural; el dedupe en events cubre reejecuciones del mismo día.
 */
export function selectTranchesToRemind(
  tranches: readonly TrancheForReminder[],
  todayIso: string,
): TrancheForReminder[] {
  const target = isoDaysFromNow(todayIso, TRANCHE_REMINDER_DAYS);
  return tranches.filter(
    (t) => t.status === "pending" && t.due_date === target,
  );
}

/**
 * Bodas a NUDGE_BEFORE_WEDDING_DAYS días con pocas aportaciones: empujón
 * para compartir el enlace ("aportar con antelación ayuda").
 */
export function selectWeddingsToNudge(
  weddings: readonly WeddingForNudge[],
  todayIso: string,
): WeddingForNudge[] {
  const target = isoDaysFromNow(todayIso, NUDGE_BEFORE_WEDDING_DAYS);
  return weddings.filter(
    (w) =>
      w.wedding_date === target &&
      w.confirmedContributions < NUDGE_MIN_CONTRIBUTIONS,
  );
}
