/**
 * Utilidades puras de formato para la invitación (portada, cuenta atrás).
 *
 * Reciben strings del documento (`SiteDocument`), no filas de Supabase, para
 * que el renderer sea idéntico en la página pública y en el preview del
 * navegador.
 */
import { parseClock } from "@/lib/countdown";

/**
 * Primer grafema visible de un nombre. `charAt(0)` parte los emoji (pares
 * sustitutos) y las secuencias con ZWJ; `Intl.Segmenter` los respeta.
 */
function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
      const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
      if (!first.done) return first.value.segment;
    }
  } catch {
    /* motor sin Segmenter: cae a puntos de código */
  }
  return Array.from(trimmed)[0] ?? "";
}

/** Primer grafema que es una letra (salta emoji y signos: «💍 Marta» da «M»). */
function firstLetterGrapheme(value: string): string {
  const trimmed = value.trim();
  const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(trimmed), (part) => part.segment)
    : Array.from(trimmed);
  return graphemes.find((grapheme) => /\p{L}/u.test(grapheme)) ?? "";
}

export interface CoupleInitialsOptions {
  /** Usa la primera LETRA de cada nombre en vez del primer grafema (el creador, que muestra la vista previa en vivo). */
  lettersOnly?: boolean;
  /** Texto si no sale ninguna inicial (por defecto, cadena vacía). */
  fallback?: string;
}

/** Iniciales para el monograma, p. ej. "M·J". */
export function coupleInitials(partnerName1: string, partnerName2: string, opts: CoupleInitialsOptions = {}): string {
  const pick = opts.lettersOnly ? firstLetterGrapheme : firstGrapheme;
  const a = pick(partnerName1).toLocaleUpperCase("es");
  const b = pick(partnerName2).toLocaleUpperCase("es");
  return [a, b].filter((c) => c !== "").join("·") || (opts.fallback ?? "");
}

// ---------------------------------------------------------------------------
// Imagen de portada: ¿la optimiza next/image?
// ---------------------------------------------------------------------------

/**
 * next/image solo puede optimizar rutas propias (`/…`) y las fotos del bucket
 * público `wedding-photos` (único `remotePatterns` de next.config). Cualquier
 * otra URL (cover_image_url histórica, `blob:` del preview del creador) va sin
 * optimizar: si no, next/image lanza «hostname not configured».
 */
export function isOptimizableImage(url: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (!supabaseUrl) return false;
  try {
    const base = new URL(supabaseUrl);
    const target = new URL(url);
    return (
      target.protocol === "https:" &&
      target.hostname === base.hostname &&
      target.pathname.startsWith("/storage/v1/object/public/wedding-photos/")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// «Cómo llegar» y «Añadir al calendario» — solo con datos del documento
// ---------------------------------------------------------------------------

/**
 * Enlace a Google Maps (abre la app de mapas del móvil) con el lugar y la
 * dirección tal como los escribió la pareja. Si la dirección ya es un enlace
 * https (p. ej. de Google Maps), se usa tal cual. Con `placeId` (la pareja
 * eligió una sugerencia de Google) se añade `query_place_id`: Maps abre ese
 * sitio exacto y la consulta queda de respaldo. null si no hay nada.
 */
export function mapsUrl(venue: string, address: string, placeId?: string): string | null {
  const a = address.trim();
  if (/^https:\/\/\S+$/.test(a)) return a;
  const query = [venue.trim(), a].filter(Boolean).join(", ");
  if (!query) return null;
  const exact = placeId && /^[A-Za-z0-9_-]{10,300}$/.test(placeId) ? `&query_place_id=${placeId}` : "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${exact}`;
}

/** Desfase (ms) de Europe/Madrid respecto a UTC en un instante dado. */
function madridOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Escapa texto según RFC 5545 (barra, punto y coma, coma, saltos de línea). */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliega líneas a 75 octetos (aprox. por caracteres) como pide RFC 5545. */
function foldLine(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 74) return line;
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += 73) out.push((i === 0 ? "" : " ") + chars.slice(i, i + 73).join(""));
  return out.join("\r\n");
}

export interface WeddingIcsInput {
  partnerName1: string;
  partnerName2: string;
  /** YYYY-MM-DD (fecha civil). Sin fecha no hay evento. */
  weddingDate: string;
  /** HH:MM en hora de Madrid; vacío = evento de día completo. */
  time?: string;
  venue?: string;
  address?: string;
  /** URL pública de la invitación (opcional). */
  url?: string;
  /**
   * Horas del programa («18:00», «A las 21 h»…), en su orden. Solo alargan el
   * evento si el último momento empieza más tarde que inicio + 8 h.
   */
  programTimes?: readonly string[];
  /** DTSTAMP: cuándo se genera el archivo. Sin él, la fecha de la boda (determinista). */
  stamp?: Date;
}

/** Duración por defecto con hora de inicio: el programa no tiene horas de fin. */
export const WEDDING_EVENT_HOURS = 8;
const HOUR_MS = 3_600_000;

/** Hora del programa («18:00», «A las 21 h»…, ver parseClock) → minutos desde medianoche. */
function clockMinutes(text: string): number | null {
  const clock = parseClock(text);
  return clock ? clock.hours * 60 + clock.minutes : null;
}

/** Instante UTC (ms) de una hora de pared de Madrid. Dos pasadas: el desfase depende del instante (cambio de hora). */
function madridWallToUtc(y: number, mo: number, d: number, minutes: number): number {
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let utc = wall - madridOffsetMs(wall);
  utc = wall - madridOffsetMs(utc);
  return utc;
}

/**
 * Inicio y fin del evento (ms UTC) con hora; null sin hora o sin fecha válida.
 * Fin: inicio + 8 h, o el último momento del programa si empieza más tarde
 * (un momento con hora anterior al inicio, p. ej. «01:00», es del día siguiente).
 */
export function weddingEventSpan(input: Pick<WeddingIcsInput, "weddingDate" | "time" | "programTimes">): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.weddingDate);
  const startMinutes = /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.time ?? "") ? clockMinutes(input.time!) : null;
  if (!m || startMinutes === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = madridWallToUtc(y, mo, d, startMinutes);
  let end = start + WEDDING_EVENT_HOURS * HOUR_MS;
  const times = (input.programTimes ?? []).map(clockMinutes).filter((n): n is number => n !== null);
  const last = times[times.length - 1];
  if (last !== undefined) {
    // Pasada la medianoche, del día siguiente.
    const lastAt = last < startMinutes ? madridWallToUtc(y, mo, d, last + 24 * 60) : madridWallToUtc(y, mo, d, last);
    end = Math.max(end, lastAt);
  }
  return { start, end };
}

function icsUtc(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/**
 * Evento .ics de la boda (RFC 5545), con:
 *  - DTEND: con hora, inicio + 8 h o el último momento del programa si es
 *    más tarde (`weddingEventSpan`); sin hora, día completo (fin exclusivo al
 *    día siguiente).
 *  - Un aviso el día antes (VALARM, TRIGGER:-P1D).
 *  - DTSTAMP: `stamp` (la ruta /b/[slug]/calendario.ics pasa la hora real);
 *    sin él, la fecha de la boda, para que servidor y cliente coincidan.
 */
export function buildWeddingIcs(input: WeddingIcsInput): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.weddingDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const dateCompact = `${m[1]}${m[2]}${m[3]}`;

  const span = weddingEventSpan(input);
  const ymd = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const when = span
    ? [`DTSTART:${icsUtc(span.start)}`, `DTEND:${icsUtc(span.end)}`]
    : [`DTSTART;VALUE=DATE:${dateCompact}`, `DTEND;VALUE=DATE:${ymd(new Date(check.getTime() + 86_400_000))}`];

  const names = [input.partnerName1.trim(), input.partnerName2.trim()].filter(Boolean).join(" y ");
  const summary = names ? `Boda de ${names}` : "Boda";
  const location = [input.venue?.trim(), input.address?.trim()].filter(Boolean).join(", ");
  const uidSeed = `${names}-${dateCompact}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//vinklo//invitacion//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uidSeed || "boda"}@vinklo.es`,
    `DTSTAMP:${input.stamp ? icsUtc(input.stamp.getTime()) : `${dateCompact}T000000Z`}`,
    ...when,
    `SUMMARY:${icsText(summary)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`Mañana: ${summary}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Enlace directo «Añadir a Google Calendar» (plantilla TEMPLATE). Mismo
 * criterio que el .ics: sin fecha válida no hay enlace. Con hora, se envía la
 * hora de pared de Madrid con ctz=Europe/Madrid (Google resuelve el cambio de
 * hora) y el mismo fin que el .ics (`weddingEventSpan`); sin hora, evento de
 * día completo con fin exclusivo al día siguiente.
 */
export function buildGoogleCalendarUrl(input: WeddingIcsInput): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.weddingDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ymd = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.time ?? "");

  let dates: string;
  const span = weddingEventSpan(input);
  if (time && span) {
    // Hora de pared: el inicio tal cual y el fin desplazado lo mismo que en el .ics.
    const start = new Date(Date.UTC(y, mo - 1, d, Number(time[1]), Number(time[2])));
    const end = new Date(start.getTime() + (span.end - span.start));
    const wall = (date: Date) => `${ymd(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00`;
    dates = `${wall(start)}/${wall(end)}`;
  } else {
    const start = new Date(Date.UTC(y, mo - 1, d));
    dates = `${ymd(start)}/${ymd(new Date(start.getTime() + 86_400_000))}`;
  }

  const names = [input.partnerName1.trim(), input.partnerName2.trim()].filter(Boolean).join(" y ");
  const location = [input.venue?.trim(), input.address?.trim()].filter(Boolean).join(", ");
  const params = new URLSearchParams({ action: "TEMPLATE", text: names ? `Boda de ${names}` : "Boda", dates });
  if (time) params.set("ctz", "Europe/Madrid");
  if (input.url) params.set("details", input.url);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** `data:` URL del .ics (funciona sin JavaScript y en el HTML del servidor). */
export function icsDataUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

/** Nombre de archivo legible: «boda-lucia-y-juan.ics». */
export function icsFileName(partnerName1: string, partnerName2: string): string {
  const slug = `boda-${partnerName1}-y-${partnerName2}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "boda"}.ics`;
}

/**
 * Días que faltan para la boda, contados en fecha civil de Madrid.
 * null si no hay fecha o si ya ha pasado (se omite la línea con gracia).
 */
export function daysUntilWedding(weddingDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!weddingDate) return null;
  const todayMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now); // YYYY-MM-DD
  const target = Date.parse(`${weddingDate}T00:00:00Z`);
  const today = Date.parse(`${todayMadrid}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;
  const days = Math.round((target - today) / 86_400_000);
  return days >= 1 ? days : null;
}

/** "sábado, 12 de septiembre de 2026" a partir de una fecha civil (YYYY-MM-DD). */
export function formatWeddingDate(weddingDate: string): string | null {
  if (!weddingDate) return null;
  const parsed = Date.parse(`${weddingDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}
