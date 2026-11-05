/**
 * Fechas de calendario de «Planificar» (tareas y pagos anotados), siempre como
 * `YYYY-MM-DD` y con aritmética en UTC: sin horas, sin zona del navegador.
 * «Hoy» se calcula UNA vez en el servidor en Europe/Madrid y baja como prop a
 * los componentes cliente (así no hay desajustes de hidratación ni una tarea
 * que parpadea entre «vencida» y «hoy» según el huso del dispositivo).
 * Módulo puro: lo usan servidor y cliente.
 */

export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha de calendario real con formato YYYY-MM-DD? */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parts(iso: IsoDate): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}
function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Hoy en Madrid (o en la zona indicada). */
export function todayIn(timeZone = "Europe/Madrid", now: Date = new Date()): IsoDate {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(iso);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Suma meses sin desbordar: 31 de marzo − 1 mes = 28/29 de febrero. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

/** Días de `from` a `to` (negativo si `to` es anterior). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

const SHORT = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" });
const LONG = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long" });

function asDate(iso: IsoDate): Date {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d));
}

/** «12 jun» (mismo año que hoy) o «12 jun 2027». */
export function formatShortDate(iso: IsoDate, today?: IsoDate): string {
  const sameYear = today ? iso.slice(0, 4) === today.slice(0, 4) : false;
  return (sameYear ? SHORT : LONG).format(asDate(iso)).replace(/\./g, "");
}

/** Cuándo vence, en palabras: «Hoy», «Mañana», «El jueves», «Hace 3 días», «12 jun». */
export function relativeDue(iso: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff === -1) return "Ayer";
  if (diff < 0) return `Hace ${-diff} días`;
  if (diff < 7) {
    const day = WEEKDAY.format(asDate(iso));
    return `El ${day}`;
  }
  return formatShortDate(iso, today);
}
