/**
 * Guardas contra datos inventados (puro, sin red). Lo comparten el editor por
 * texto (`site-edit-patch.ts`) y el pulido de la historia (`story-polish.ts`).
 *
 * Dos clases de campo:
 *  - LITERALES (lugar, dirección, hora, parada, hotel, código, enlace): solo
 *    aceptan un valor que la pareja haya escrito en la petición o que ya esté
 *    en la web (`isKnownLiteral`).
 *  - TEXTO LIBRE (preguntas, respuestas, capítulos, títulos…): se puede
 *    reescribir, pero cualquier dato nuevo (número, mes, día de la semana,
 *    enlace o nombre propio) tiene que salir de la petición, del texto
 *    anterior o de la web (`newFacts`).
 */

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS = [...MONTH_NAMES, "setiembre"];
/** Indexado por Date.getUTCDay() (0 = domingo). */
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export function monthName(index: number): string {
  return MONTH_NAMES[index] ?? "";
}
export function weekdayName(index: number): string {
  return WEEKDAYS[index] ?? "";
}

/** minúsculas, sin acentos, espacios colapsados; 18.30 / 18h30 / 9:00 → 18:30 / 09:00. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(\d{1,2})\s*(?:[:.]|h)\s*(\d{2})\b/g, (_m, h: string, m: string) => `${h.padStart(2, "0")}:${m}`)
    .replace(/\s+/g, " ")
    .trim();
}

/** true si `value` (no vacío) aparece literalmente en la petición. */
export function instructionContains(instruction: string, value: string): boolean {
  const needle = normalizeForMatch(value);
  return needle.length > 0 && normalizeForMatch(instruction).includes(needle);
}

const URL_RE = /https?:\/\/[^\s<>"«»]+/gi;
const trimUrl = (url: string) => url.replace(/[.,;:!?)\]]+$/, "");

/** Enlaces de un texto, tal cual (sin normalizar: la normalización de horas podría alterar rutas). */
export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map(trimUrl);
}

/**
 * Un valor literal es conocido si la pareja lo escribió en la petición o si ya
 * está en la web. Los enlaces se comparan sin normalizar.
 */
export function isKnownLiteral(value: string, instruction: string, knownText: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return instruction.includes(v) || knownText.includes(v);
  const needle = normalizeForMatch(v);
  return instructionContains(instruction, v) || normalizeForMatch(knownText).includes(needle);
}

const LETTERS = /[\p{L}][\p{L}\p{M}'’-]*/gu;
/** Signos que pueden abrir una frase antes de la primera palabra. */
const OPENERS = /[¡¿«"“'(\[—–\-•*\s]+$/u;

/** Palabras con mayúscula que no empiezan frase: posibles nombres propios. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const noUrls = text.replace(URL_RE, " ");
  for (const match of noUrls.matchAll(LETTERS)) {
    const word = match[0];
    if (!/^\p{Lu}/u.test(word)) continue;
    const before = noUrls.slice(0, match.index);
    const stripped = before.replace(OPENERS, "");
    const sentenceStart = stripped === "" || /[.!?:;…]$/.test(stripped) || /\n/.test(before.slice(stripped.length));
    if (!sentenceStart) out.push(word);
  }
  return out;
}

const TIME_RE = /\b(\d{2}):(\d{2})\b/g;

/** Datos de un texto: horas, números, meses, días de la semana, enlaces y nombres propios. */
function factTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const url of urlsIn(text)) tokens.push(`url:${url}`);
  // Una hora es un dato entero: «03:00» no se justifica con un «0» suelto de otra hora.
  const withTimes = normalizeForMatch(text.replace(URL_RE, " "));
  for (const m of withTimes.matchAll(TIME_RE)) tokens.push(`time:${m[1]}:${m[2]}`);
  const norm = withTimes.replace(TIME_RE, " ");
  for (const n of norm.match(/\d+/g) ?? []) tokens.push(String(Number(n)));
  for (const word of norm.match(/[a-z]+/g) ?? []) if (MONTHS.includes(word) || WEEKDAYS.includes(word)) tokens.push(word);
  for (const noun of properNouns(text)) tokens.push(`name:${normalizeForMatch(noun)}`);
  return tokens;
}

/** Todo lo que el texto permitido aporta: sus datos y TODAS sus palabras (un nombre propio puede venir en minúsculas). */
function allowedTokens(allowed: string): Set<string> {
  const set = new Set<string>();
  for (const url of urlsIn(allowed)) set.add(`url:${url}`);
  const withTimes = normalizeForMatch(allowed.replace(URL_RE, " "));
  for (const m of withTimes.matchAll(TIME_RE)) {
    set.add(`time:${m[1]}:${m[2]}`);
    // «a las 18:30» también justifica decir «a las 18».
    set.add(String(Number(m[1])));
  }
  const norm = withTimes.replace(TIME_RE, " ");
  for (const n of norm.match(/\d+/g) ?? []) {
    const value = Number(n);
    set.add(String(value));
    // «a las 19» justifica «19:00».
    if (value <= 23) set.add(`time:${String(value).padStart(2, "0")}:00`);
  }
  for (const word of norm.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
    set.add(word);
    set.add(`name:${word}`);
  }
  return set;
}

/**
 * Datos de `next` que no aparecen en ninguno de los textos permitidos
 * (texto anterior, petición, web…). Vacío = no inventa nada.
 */
export function newFacts(next: string, ...allowed: string[]): string[] {
  const known = allowedTokens(allowed.join("\n"));
  return [...new Set(factTokens(next))].filter((token) => !known.has(token));
}

export function introducesNewFacts(next: string, ...allowed: string[]): boolean {
  return newFacts(next, ...allowed).length > 0;
}

/** Claves técnicas que no son contenido (sus dígitos no justifican nada). */
const TECHNICAL_KEYS = new Set(["id", "type", "schemaVersion", "templateId", "templateVersion", "locale"]);

/** Todos los textos de contenido de un valor JSON (para «ya está en la web»), sin ids ni claves técnicas. */
export function collectText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectText(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) if (!TECHNICAL_KEYS.has(key)) collectText(item, out);
  }
  return out;
}
