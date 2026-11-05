/**
 * Cuenta atrás de la boda (backlog 13-oct-2026, punto 7).
 *
 * Todo en hora de Madrid, la de la boda, no la del reloj de quien mira:
 *  - Sin hora de ceremonia: días de calendario de Madrid hasta la fecha
 *    (hoy 13-oct, boda 17-oct → «4 días»). El día de la boda ya no cuenta.
 *  - Con hora (la del lugar o, si no, la del primer momento del programa con
 *    hora): hasta ese momento, en días, horas y minutos de RELOJ DE PARED de
 *    Madrid: los días son de calendario aunque haya un cambio de hora por
 *    medio (24-oct 18:00 → 26-oct 18:00 = «2 días», no «2 días y 1 hora»).
 * Nunca negativa: pasada la boda (o la ceremonia), null y no se enseña.
 */
import type { SiteDocument } from "@/lib/site-document";

const ZONE = "Europe/Madrid";
const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Clock { hours: number; minutes: number }

/**
 * Hora legible a partir de un texto de hora: «18:00», «18.30 h», «18 h»,
 * «18:00 h», «A las 12:30». El punto solo vale con «h» detrás: «17.10»
 * (una fecha) o «Mesa 4.30» no son horas. La del lugar es siempre «HH:MM»; la del programa
 * es texto libre (máx. 20). Sin hora reconocible → null.
 */
export function parseClock(text: string | null | undefined): Clock | null {
  if (!text) return null;
  for (const match of text.matchAll(/(?<![\d.])(2[0-3]|[01]?\d)\s*(?:(?::|h|\.(?=[0-5]\d\s*h))\s*([0-5]\d)(?!\d))?\s*(h\b|horas?\b)?/gi)) {
    // «2[0-3]» va primero: si no, «20:00» casaría solo el «2» y se perdería.
    // Un número suelto («2», «Mesa 4») no es una hora: hace falta «:mm» o «h».
    const hasMinutes = match[2] !== undefined;
    if (!hasMinutes && !match[3] && !/\dh/i.test(match[0])) continue;
    return { hours: Number(match[1]), minutes: hasMinutes ? Number(match[2]) : 0 };
  }
  return null;
}

/** Hora de la ceremonia: la del lugar; si no, la del primer momento del programa que la tenga. */
export function ceremonyTime(document: Pick<SiteDocument, "scenes">): string | null {
  const venue = document.scenes.find((scene) => scene.type === "venue" && scene.enabled);
  if (venue?.type === "venue" && parseClock(venue.props.time)) return venue.props.time;
  const agenda = document.scenes.find((scene) => scene.type === "agenda" && scene.enabled);
  if (agenda?.type === "agenda") {
    for (const item of agenda.props.items) if (parseClock(item.timeLabel)) return item.timeLabel;
  }
  return null;
}

const civilFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE });
const partsFormat = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });

/** Diferencia (ms) entre la hora de Madrid y UTC en ese instante (+1 h o +2 h). */
function madridOffset(at: number): number {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Instante (ms UTC) de una fecha y hora de pared en Madrid (con su cambio de hora). */
export function madridInstant(date: string, clock: Clock): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), clock.hours, clock.minutes);
  if (Number.isNaN(wall)) return null;
  const first = wall - madridOffset(wall);
  const second = madridOffset(first);
  return wall - second;
}

/** Fecha y hora de pared de Madrid de un instante, como si fuera UTC (para restar). */
function madridWall(at: number): number {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
}

/**
 * Milisegundos de RELOJ DE PARED de Madrid que faltan hasta `date` a la hora
 * `clock` (días de calendario + horas y minutos de pared). null si el
 * instante real ya ha pasado o la fecha no vale.
 */
export function wallTimeUntil(date: string, clock: Clock, now: number): number | null {
  const target = madridInstant(date, clock);
  if (target === null || target - now <= 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)!;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), clock.hours, clock.minutes) - madridWall(now);
  return wall > 0 ? wall : null;
}

/** Días : horas : minutos : segundos (hacia abajo) hasta una hora de pared de Madrid; para el reloj vivo. */
export function remainingParts(weddingDate: string, time: string, now: number): { d: number; h: number; m: number; s: number } | null {
  const clock = parseClock(time);
  const wall = clock ? wallTimeUntil(weddingDate, clock, now) : null;
  if (wall === null) return null;
  const total = Math.floor(wall / 1000);
  return { d: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export interface Countdown {
  days: number;
  /** null cuando no hay hora: solo se cuentan días. */
  hours: number | null;
  minutes: number | null;
}

/** Lo que falta para la boda (ver la cabecera). null si no hay fecha válida o ya ha pasado. */
export function weddingCountdown(weddingDate: string | null | undefined, time: string | null | undefined, now: Date | number = Date.now()): Countdown | null {
  if (!weddingDate || !/^\d{4}-\d{2}-\d{2}$/.test(weddingDate)) return null;
  const at = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(at)) return null;
  const clock = parseClock(time);
  if (clock) {
    const diff = wallTimeUntil(weddingDate, clock, at);
    if (diff === null) return null;
    // Minutos hacia arriba: a 30 s de la hora aún falta «1 minuto», nunca «0».
    const total = Math.ceil(diff / MINUTE);
    return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
  }
  const today = Date.parse(`${civilFormat.format(new Date(at))}T00:00:00Z`);
  const target = Date.parse(`${weddingDate}T00:00:00Z`);
  if (Number.isNaN(today) || Number.isNaN(target)) return null;
  const days = Math.round((target - today) / DAY);
  return days >= 1 ? { days, hours: null, minutes: null } : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Texto de la cuenta atrás: la cifra grande y lo que la sigue.
 * { value: 4, rest: "días, 3 horas y 20 minutos para el sí" }. Las partes a
 * cero no se dicen; el día de la boda, la cifra son las horas (o los minutos).
 */
export function countdownText(countdown: Countdown): { value: number; rest: string } {
  const { days, hours, minutes } = countdown;
  const units: Array<[number, string, string]> = [[days, "día", "días"]];
  if (hours !== null) units.push([hours, "hora", "horas"]);
  if (minutes !== null) units.push([minutes, "minuto", "minutos"]);
  const shown = units.filter(([n], index) => n > 0 || (index === 0 && hours === null));
  const [head, ...tail] = shown.length > 0 ? shown : [units[units.length - 1]!];
  const [value, one, many] = head!;
  const after = tail.map(([n, o, m]) => plural(n, o, m));
  const list = after.length === 0 ? "" : after.length === 1 ? ` y ${after[0]}` : `, ${after.slice(0, -1).join(", ")} y ${after[after.length - 1]}`;
  return { value, rest: `${value === 1 ? one : many}${list} para el sí` };
}

/** Frase completa para lectores de pantalla: «4 días, 3 horas y 20 minutos para el sí». */
export function countdownSentence(countdown: Countdown): string {
  const { value, rest } = countdownText(countdown);
  return `${value} ${rest}`;
}
