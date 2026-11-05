/**
 * Importar cualquier Excel al CRM (backlog 13-oct-2026, punto 13): reglas
 * puras, sin dependencias, compartidas por el diálogo (navegador) y probadas
 * en guest-excel-import.test.ts. El archivo se lee en el navegador; aquí
 * llegan sus hojas como texto (string[][]) y salen las invitaciones que
 * recibe la server action `importGuestsFromExcel`.
 *
 * Pasos: (1) localizar la fila de títulos (puede no ser la 1 o no existir);
 * (2) asignar a cada columna un campo del CRM por sinónimos de su título y,
 * sin título, por el aspecto de sus valores; (3) lo que no encaja se guarda
 * como campo propio (extra_fields): nada del archivo se pierde; (4) «Ana y
 * Pablo» o una columna de invitación/familia compartida = UNA invitación con
 * acompañantes.
 *
 * Nada de esto sale del navegador salvo las invitaciones confirmadas. No hay
 * IA: el mapeo es determinista.
 */
import { cleanName, looksLikePhone, markDuplicates, type DuplicateMark } from "@/lib/actions/guest-import";
import { GROUP_NAME_MAX, normalizeGroupName } from "@/lib/crm/groups";
import { TAGS_PER_GUEST, TAG_MAX, normalizeTag, normalizeTags, type GuestSide } from "@/lib/crm/tags";

// ---------------------------------------------------------------- topes

/** Tope de invitaciones por importación (y de filas leídas). */
export const EXCEL_MAX_ROWS = 2000;
/** Tope del archivo (se comprueba antes de leerlo). */
export const EXCEL_MAX_BYTES = 5 * 1024 * 1024;
/** Topes de extra_fields (mismos que el CHECK guest_extra_fields_valid de 20261031100000). */
export const EXTRA_MAX_KEYS = 25;
export const EXTRA_KEY_MAX = 40;
export const EXTRA_VALUE_MAX = 300;
export const EXTRA_MAX_BYTES = 6144;
/** Presupuesto en JSON compacto (navegador y zod): Postgres mide el texto con espacios, ~2 bytes más por campo. */
export const EXTRA_BUDGET_BYTES = 5800;
export const NOTES_MAX = 500;
export const NAME_MAX = 120;
export const PHONE_MAX = 20;
export const COMPANIONS_MAX = 10;
export const COMPANION_NAME_MAX = 80;
export const EXCEL_ACCEPT = ".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt";

// ---------------------------------------------------------------- campos

export const IMPORT_FIELDS = [
  "name", "surname", "phone", "email", "attendance", "companions", "people", "kids", "companion_names",
  "household", "group", "side", "tags", "notes", "table", "menu", "bus", "custom", "ignore",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Texto del selector de cada columna. */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Nombre",
  surname: "Apellidos",
  phone: "Teléfono",
  email: "Email (campo propio)",
  attendance: "Asistencia",
  companions: "Nº de acompañantes",
  people: "Nº de personas (con el invitado)",
  kids: "Nº de niños",
  companion_names: "Nombres de acompañantes",
  household: "Invitación / familia (une filas)",
  group: "Grupo",
  side: "Lado (de quién)",
  tags: "Etiquetas",
  notes: "Alergias / dieta",
  table: "Mesa (campo propio)",
  menu: "Menú (campo propio)",
  bus: "Autobús (campo propio)",
  custom: "Campo propio",
  ignore: "No importar",
};

/** Nombre del campo propio de los campos sin columna en el CRM. */
const CANONICAL_EXTRA: Partial<Record<ImportField, string>> = { email: "Email", table: "Mesa", menu: "Menú", bus: "Autobús" };

/** Campos que solo pueden ir en UNA columna (el resto se acumula). */
const SINGLE: ReadonlySet<ImportField> = new Set(["phone", "attendance", "companions", "people", "kids", "household", "group", "side"]);

/** Texto comparable: minúsculas, sin tildes, solo letras/cifras separadas por un espacio. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[º°ª]/g, " ")
    .replace(/\+\s*1/g, " plusone ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Sinónimos de títulos (ES/EN), ya normalizados. El orden importa: gana el
 * primero que encaja, así «nombre del acompañante» va antes que «nombre».
 */
const HEADER_RULES: ReadonlyArray<{ field: ImportField; exact?: readonly string[]; pattern?: RegExp }> = [
  { field: "ignore", exact: ["n", "no", "num", "numero", "id", "orden"] },
  { field: "companion_names", pattern: /^(nombres? (de )?(los )?acompanantes?|nombre (del )?acompanante|acompanantes? nombres?|pareja|nombre pareja|nombre de la pareja|partner|plus one name|companion names?)$/ },
  { field: "kids", pattern: /^((n|num|numero) (de )?)?(ninos|ninas|nenes|hijos|kids|children|infantil|menores)( menores)?$/ },
  { field: "people", pattern: /^((n|num|numero|total|cantidad) (de )?)?(personas|pax|asistentes|adultos|comensales|invitados totales|people|guests count|party size|plazas)$|^(cuantos|cuantas|cuantos son|total)$/ },
  // Abreviaturas habituales: «acomp», «acomp.», «acompañ», «nº acomp» (normalizadas, sin punto ni tilde).
  { field: "companions", pattern: /^((n|num|numero|cantidad) (de )?)?(acompanantes?|acomps?|acompan|plusone|plus ones?|companions?|invitados extra|extras?)$/ },
  { field: "household", pattern: /^((n|num|numero|id|codigo) (de )?)?(invitacion|invitaciones|familia|unidad familiar|hogar|household|party|casa|sobre)$/ },
  { field: "surname", pattern: /^(apellidos?|primer apellido|segundo apellido|apellido \d|surnames?|last name|family name)$/ },
  { field: "name", pattern: /^(nombre|nombres|nombre y apellidos|nombre completo|nombre invitado|nombre del invitado|nombre de invitado|nombre y apellido|invitado|invitada|invitados|invitadas|persona|name|first name|full name|guest|guest name|guests)$/ },
  { field: "phone", pattern: /^((n|num|numero) (de )?)?(telefono|telefonos|tel|tlf|tlfn|tfno|telf|movil|moviles|celular|whatsapp|phone|mobile|cell|contacto telefono|telefono movil|movil whatsapp)$/ },
  { field: "email", pattern: /^(e ?mail|correo|correo electronico|mail|email address)$/ },
  { field: "attendance", pattern: /^(asistencia|asiste|asistira|confirmado|confirmada|confirmacion|confirma|rsvp|viene|vienen|respuesta|estado|attending|attendance|status|va)$/ },
  { field: "group", pattern: /^(grupo|grupos|categoria|relacion|tipo|circulo|procedencia|de donde|grupo de invitados|group|category|relationship|amistad)$/ },
  { field: "side", pattern: /^(lado|parte|de parte de|invitado de|invitada de|de quien|novio novia|side|bando)$/ },
  { field: "tags", pattern: /^(etiquetas?|tags?|labels?)$/ },
  // Solo alergias y dieta van a la nota del invitado (catering y hoja impresa la
  // pintan como aviso). «Notas», «Observaciones»… quedan como campo propio.
  { field: "notes", pattern: /^(alergias?|intolerancias?|alergias e intolerancias|alergias o intolerancias|dieta|dietas|restricciones( alimentarias)?|allergies|allergy|dietary( requirements)?|diet)$/ },
  { field: "table", pattern: /^((n|num|numero) (de )?)?(mesa|mesas|table|table number)$/ },
  { field: "menu", pattern: /^(menu|menus|menu elegido|tipo de menu|plato|plato principal|comida|meal|menu choice)$/ },
  { field: "bus", pattern: /^(autobus|autobuses|bus|transporte|autocar|shuttle|traslado)$/ },
];

/**
 * Palabras clave para títulos que no son un sinónimo exacto («Teléfono
 * móvil del invitado», «Confirmación asistencia»). Más específicas primero.
 */
const HEADER_KEYWORDS: ReadonlyArray<{ field: ImportField; pattern: RegExp }> = [
  { field: "companion_names", pattern: /\b(acompanantes?|acomps?|acompan)\b.*\bnombres?\b|\bnombres?\b.*\b(acompanantes?|acomps?|acompan)\b/ },
  { field: "kids", pattern: /\b(ninos?|ninas?|infantil|kids|children)\b/ },
  { field: "people", pattern: /\b(personas|pax|adultos|comensales)\b/ },
  { field: "companions", pattern: /\b(acompanantes?|acomps?|acompan|plusone|plus ones?)\b/ },
  { field: "surname", pattern: /\b(apellidos?|surnames?)\b/ },
  { field: "phone", pattern: /\b(telefonos?|tel|tlf|tfno|movil|moviles|celular|whatsapp|phone|mobile)\b/ },
  { field: "email", pattern: /\b(e ?mail|correo|mail)\b/ },
  { field: "attendance", pattern: /\b(asistencia|asiste|asistira|confirmacion|confirmado|confirmada|rsvp|respuesta)\b/ },
  { field: "notes", pattern: /\b(alergias?|intolerancias?|dieta|celiac[oa]s?|allerg(y|ies))\b/ },
  { field: "table", pattern: /\b(mesa|mesas)\b/ },
  { field: "menu", pattern: /\b(menu|menus|plato)\b/ },
  { field: "bus", pattern: /\b(autobus|bus|transporte|autocar)\b/ },
  { field: "household", pattern: /\b(invitacion|unidad familiar|hogar)\b/ },
  { field: "group", pattern: /\b(grupo|categoria|relacion)\b/ },
  { field: "side", pattern: /\b(lado|bando)\b/ },
  { field: "tags", pattern: /\b(etiquetas?|tags?)\b/ },
  { field: "name", pattern: /\b(nombres?|invitad[oa]s?|name)\b/ },
];

/** Campo por el título: `exact` = sinónimo conocido; si no, por palabra clave. null = desconocido. */
export function matchHeader(header: string): { field: ImportField; exact: boolean } | null {
  const key = normalizeHeader(header);
  if (!key) return null;
  for (const rule of HEADER_RULES) {
    if (rule.exact?.includes(key) || rule.pattern?.test(key)) return { field: rule.field, exact: true };
  }
  if (key.split(" ").length > 6) return null;
  for (const rule of HEADER_KEYWORDS) if (rule.pattern.test(key)) return { field: rule.field, exact: false };
  return null;
}

/** Campo por el título (null = título desconocido). */
export function fieldForHeader(header: string): ImportField | null {
  return matchHeader(header)?.field ?? null;
}

// ---------------------------------------------------------------- valores

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YES = new Set(["si", "s", "yes", "y", "x", "ok", "vale", "confirmado", "confirmada", "confirmados", "confirmadas", "asiste", "asisten", "viene", "vienen", "va", "van", "true", "verdadero", "1", "acepta", "aceptado", "aceptada"]);
const NO = new Set(["no", "n", "false", "falso", "0", "declina", "declinado", "declinada", "rechaza", "rechazado", "rechazada"]);
const PENDING = new Set(["pendiente", "pendientes", "sin respuesta", "sin confirmar", "quiza", "quizas", "tal vez", "duda", "?", "pending", "maybe"]);
/** «No confirmado», «No sabe», «No contesta»… = pendiente (en español es la forma habitual de escribirlo). */
const PENDING_NO = /^no (confirmad[oa]s?|sabe|saben|contesta|contestan|responde|responden|ha (respondido|contestado|confirmado)|han (respondido|contestado|confirmado)|lo sabe|lo saben|se sabe)\b/;
/** Negativas claras: «no», «no viene», «no asisten», «no puede»… Lo demás que empiece por «no» no se adivina. */
const NO_PHRASE = /^no( (viene|vienen|va|van|asiste|asisten|asistira|asistiran|puede|pueden|acude|acuden))?$/;

/** Asistencia de una celda: si / no / pendiente; null = no se entiende (se guarda tal cual como campo propio). */
export function parseAttendance(value: string): "si" | "no" | "pendiente" | null {
  const raw = value.trim();
  if (!raw) return "pendiente";
  if (/^[✓✔☑👍]+$/u.test(raw)) return "si";
  if (/^[✗✘✕❌👎]+$/u.test(raw)) return "no";
  const key = normalizeHeader(raw);
  // Pendiente primero: «No confirmado» no es «No viene».
  if (PENDING.has(key) || PENDING_NO.test(key) || !key) return "pendiente";
  if (YES.has(key) || /^(si|confirmad[oa]s?)\b/.test(key)) return "si";
  if (NO.has(key) || NO_PHRASE.test(key)) return "no";
  return null;
}

/** Entero pequeño de una celda («2», «2.0», «+1», «2 personas»); null si no lo es. */
export function parseCount(value: string): number | null {
  const match = value.trim().match(/^\+?(\d{1,3})(?:[.,]0+)?(?:\s*\p{L}*)?$/u);
  return match ? Number(match[1]) : null;
}

/** ¿Celda con pinta de nombre? Letras, 1–6 palabras, sin cifras ni @. */
function looksLikeName(value: string): boolean {
  const v = value.trim();
  return v.length >= 2 && v.length <= NAME_MAX && /\p{L}/u.test(v) && !/[\d@]/.test(v) && v.split(/\s+/).length <= 6;
}

export interface PhoneResult { phone: string | null; valid: boolean; others: string[] }

/** Agrupa cifras de 3 en 3 (612 345 678). */
const groupDigits = (digits: string) => digits.replace(/(\d{3})(?=\d)/g, "$1 ");

/**
 * Teléfono de una celda. Españoles con o sin +34/0034, con espacios, puntos
 * o guiones → «612 345 678» / «+34 612 345 678» (los dos sirven a WhatsApp).
 * Extranjeros con + o 00 se conservan limpios. Varios en una celda: el
 * primero; el resto en `others` (van a un campo propio). Lo que no parece
 * un teléfono: valid = false y phone = null (la celda se guarda aparte).
 */
export function normalizePhone(value: string): PhoneResult {
  const raw = value.replace(/ /g, " ").trim();
  if (!raw) return { phone: null, valid: true, others: [] };
  const parts = raw.split(/\s*(?:[/;,|]|\s-\s|\by\b|\bo\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  const [first, ...rest] = parts.length > 1 && parts.every((p) => looksLikePhone(p)) ? parts : [raw];
  const clean = first.replace(/^(tel[eé]fono|tel|tlf|m[oó]vil)[.:]?\s*/i, "");
  if (!looksLikePhone(clean)) return { phone: null, valid: false, others: [] };
  const digits = clean.replace(/\D/g, "");
  const plus = clean.trim().startsWith("+");
  const intl = plus ? digits : digits.startsWith("00") ? digits.slice(2) : null;
  let phone: string | null = null;
  if (!intl && /^[6789]\d{8}$/.test(digits)) phone = groupDigits(digits);
  else if (!intl && /^34[6789]\d{8}$/.test(digits)) phone = `+34 ${groupDigits(digits.slice(2))}`;
  else if (intl && /^34[6789]\d{8}$/.test(intl)) phone = `+34 ${groupDigits(intl.slice(2))}`;
  else if (intl && /^[1-9]\d{6,14}$/.test(intl)) {
    const spaced = clean.trim().replace(/^00/, "+").replace(/[^\d+ ]/g, " ").replace(/\s+/g, " ").trim();
    phone = spaced.length <= PHONE_MAX ? spaced : `+${intl}`;
  }
  if (!phone || phone.length > PHONE_MAX) return { phone: null, valid: false, others: [] };
  return { phone, valid: true, others: rest };
}

// ---------------------------------------------------------------- nombres

const COMPANION_WORD = /^(acompa[nñ]ante|pareja|novi[oa]|marido|mujer|esposo|esposa|amig[oa]|invitad[oa]|\+1|plus one|partner)$/i;

/**
 * «Ana y Pablo», «Ana, Pablo y Lucía», «Ana & Pablo García», «Ana +1»,
 * «Ana (+2)», «Ana y acompañante» → titular + acompañantes con nombre +
 * acompañantes sin nombre. Si alguna parte no parece un nombre, la celda se
 * queda como un solo nombre («Familia García», «Juan Pérez y Hnos. S.A.»).
 */
export function splitPeople(value: string): { lead: string; companions: string[]; unnamed: number } {
  let text = cleanName(value);
  let plusCount = 0;
  const plus = text.match(/\s*\(?\s*\+\s*(\d{1,2})\s*\)?\s*$/);
  if (plus && plus.index! > 0) { plusCount = Number(plus[1]); text = text.slice(0, plus.index).trim(); }
  const single = { lead: text, companions: [], unnamed: plusCount };
  // «García, Ana» (exportaciones de agendas): una persona, no dos. La coma
  // solo separa personas si hay 3 o más partes o también un «y» / «&».
  const conjunction = /\s(?:y|e|and)\s|[&+/]/i.test(text);
  const commaParts = text.split(/\s*,\s*/).filter(Boolean);
  if (!conjunction && commaParts.length === 2) {
    const [surname, first] = commaParts;
    return looksLikeName(surname) && looksLikeName(first) ? { lead: `${first} ${surname}`, companions: [], unnamed: plusCount } : single;
  }
  const parts = text.split(/\s*,\s*|\s+(?:y|e|and)\s+|\s*[&+/]\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return single;
  const short = (part: string) => looksLikeName(part) && part.split(/\s+/).length <= 4;
  if (!short(parts[0])) return single;
  const named: string[] = [];
  let unnamed = plusCount;
  for (const part of parts.slice(1)) {
    if (COMPANION_WORD.test(part)) { unnamed += 1; continue; }
    if (!short(part)) return single;
    named.push(part);
  }
  return { lead: parts[0], companions: named, unnamed };
}

/** Lista de nombres de una celda («Pablo, Lucía y Leo»). */
function splitNames(value: string): string[] {
  return value.split(/\s*[,;/]\s*|\s+(?:y|e|and)\s+|\s*[&+]\s*/i).map((p) => cleanName(p)).filter((p) => p.length > 0 && !COMPANION_WORD.test(p));
}

// ---------------------------------------------------------------- hojas

export interface RawSheet { name: string; rows: string[][] }

export interface ColumnStats { filled: number; phones: number; emails: number; yesNo: number; smallInts: number; names: number; distinct: number }

export interface ColumnInfo {
  index: number;
  /** Título tal cual (o «Columna C» si no hay fila de títulos). */
  header: string;
  /** Campo propuesto. */
  field: ImportField;
  /** Hasta 3 valores de ejemplo (solo para pintarlos en el navegador). */
  samples: string[];
  stats: ColumnStats;
}

export interface SheetAnalysis {
  name: string;
  /** Índice de la fila de títulos en `rows` (-1 = sin títulos). */
  headerRow: number;
  columns: ColumnInfo[];
  /** Filas de datos (después de la de títulos), sin las vacías. */
  dataRows: string[][];
  /** Número de fila en el archivo (1 = primera) de cada fila de datos. */
  dataLines: number[];
  /** Filas con datos por encima de los títulos (no se importan; se avisa). */
  above: number[];
  /** Mapeo propuesto por columna (editable en la confirmación). */
  mapping: ImportField[];
}

const cell = (row: readonly string[] | undefined, index: number) => (row?.[index] ?? "").toString().replace(/ /g, " ").trim();
const nonEmpty = (row: readonly string[]) => row.some((value) => cell([value], 0) !== "");
const columnLetter = (index: number): string => (index >= 26 ? columnLetter(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));

/** Estadísticas anónimas de una columna (cuántos parecen teléfono, email, sí/no…). */
export function columnStats(values: readonly string[]): ColumnStats {
  const filled = values.filter(Boolean);
  return {
    filled: filled.length,
    phones: filled.filter((v) => normalizePhone(v).phone !== null).length,
    emails: filled.filter((v) => EMAIL.test(v)).length,
    yesNo: filled.filter((v) => { const k = normalizeHeader(v); return (YES.has(k) || NO.has(k)) && !/^\d$/.test(k); }).length,
    smallInts: filled.filter((v) => { const n = parseCount(v); return n !== null && n <= COMPANIONS_MAX && /^\+?\d{1,2}$/.test(v.trim()); }).length,
    names: filled.filter(looksLikeName).length,
    distinct: new Set(filled.map((v) => v.toLowerCase())).size,
  };
}

/** Campo por el aspecto de los valores (columnas sin título reconocible). */
function fieldFromValues(stats: ColumnStats, noHeader: boolean): ImportField | null {
  if (stats.filled === 0) return null;
  const share = (n: number) => n / stats.filled;
  if (share(stats.emails) >= 0.6) return "email";
  if (share(stats.phones) >= 0.6 && share(stats.smallInts) < 0.5) return "phone";
  if (share(stats.yesNo) >= 0.6) return "attendance";
  if (noHeader && share(stats.smallInts) >= 0.8) return "companions";
  return null;
}

/** Puntuación de una fila como fila de títulos: títulos conocidos (exactos y por palabra clave) y celdas con pinta de dato. */
function headerScore(row: readonly string[]): { exact: number; keyword: number; cells: number; data: number } {
  const cells = row.map((v) => cell([v], 0)).filter(Boolean);
  let exact = 0;
  let keyword = 0;
  let data = 0;
  for (const value of cells) {
    const match = matchHeader(value);
    if (match && match.field !== "ignore") { if (match.exact) exact += 1; else keyword += 1; }
    if (EMAIL.test(value) || normalizePhone(value).phone || /^\d+([.,]\d+)?$/.test(value)) data += 1;
  }
  return { exact, keyword, cells: cells.length, data };
}

/**
 * Busca la fila de títulos entre las 15 primeras con datos; -1 si no hay.
 * Una fila de títulos no lleva teléfonos, emails ni números; con varias
 * celdas, al menos dos y la mayoría son títulos conocidos (o hay un «Nombre»
 * exacto); con una sola, debe ser «Nombre» o parecido. Y sus valores no se repiten debajo en la misma
 * columna («Familia» o «Mesa» como DATO de una lista sin títulos no cuenta).
 */
export function detectHeaderRow(rows: readonly string[][]): number {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i += 1) {
    if (!nonEmpty(rows[i])) continue;
    const { exact, keyword, cells, data } = headerScore(rows[i]);
    const hits = exact + keyword;
    if (data > 0) continue;
    if (cells === 1) {
      const only = rows[i].map((v) => cell([v], 0)).find(Boolean) ?? "";
      const match = matchHeader(only);
      if (!match?.exact || (match.field !== "name" && match.field !== "surname")) continue;
    } else {
      // Un «Nombre» exacto basta aunque el resto de títulos sean propios («Nombre | Dato 1 | Dato 2…»).
      const nameHeader = rows[i].some((value) => { const m = matchHeader(cell([value], 0)); return m?.exact && m.field === "name"; });
      if (!nameHeader && (hits < 2 || hits * 2 < cells)) continue;
    }
    // Unos títulos sin nada debajo no son títulos (es la última fila de datos).
    if (!rows.slice(i + 1).some(nonEmpty)) continue;
    const recurs = rows[i].some((value, column) => {
      const key = normalizeHeader(cell([value], 0));
      return key !== "" && rows.slice(i + 1).some((row) => normalizeHeader(cell(row, column)) === key && row.join("|") !== rows[i].join("|"));
    });
    if (recurs) continue;
    const score = hits * 10 + cells;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** Propone un campo por columna: título, después valores; lo demás, campo propio. */
export function proposeMapping(headers: readonly string[], columns: readonly string[][], noHeader: boolean): ImportField[] {
  const used = new Set<ImportField>();
  const stats = columns.map(columnStats);
  const mapping: ImportField[] = headers.map((header, index) => {
    if (stats[index].filled === 0) return "ignore";
    let field = noHeader || !header.trim() ? null : fieldForHeader(header);
    // Un título de nombre con valores de teléfono, email o números: mandan los valores.
    const st = stats[index];
    if ((field === "name" || field === "surname") && (st.phones >= st.filled * 0.6 || st.emails >= st.filled * 0.6 || st.smallInts >= st.filled * 0.6)) field = fieldFromValues(st, false) ?? "custom";
    // «Acompañante(s)» con nombres en vez de números → nombres de acompañantes.
    if (field === "companions" && stats[index].names > stats[index].smallInts) field = "companion_names";
    if (field === "people" && stats[index].smallInts < stats[index].filled * 0.6) field = "custom";
    // «Nº», «Id»: si es una numeración (enteros sin repetir) no se importa; si no, campo propio.
    if (field === "ignore" && !(columns[index].every((v) => !v || /^\d+$/.test(v)) && stats[index].distinct === stats[index].filled)) field = "custom";
    field ??= fieldFromValues(stats[index], noHeader);
    if (!field) return "custom";
    if (SINGLE.has(field) && used.has(field)) return "custom";
    used.add(field);
    return field;
  });
  // Dos columnas de nombre: se queda la que más parece de nombres; la otra, campo propio.
  const nameColumns = mapping.flatMap((field, index) => (field === "name" ? [index] : []));
  if (nameColumns.length > 1) {
    const share = (i: number) => stats[i].names / Math.max(1, stats[i].filled);
    const keep = nameColumns.reduce((a, b) => (share(b) > share(a) ? b : a));
    for (const index of nameColumns) if (index !== keep) mapping[index] = "custom";
  }
  // Sin columna de nombre: la columna con más celdas con pinta de nombre (y variadas).
  if (!mapping.includes("name")) {
    let best = -1;
    let bestScore = 0;
    stats.forEach((s, index) => {
      if (mapping[index] !== "custom" || s.filled === 0) return;
      const score = s.names / s.filled + s.distinct / s.filled;
      if (s.names / s.filled >= 0.6 && score > bestScore) { best = index; bestScore = score; }
    });
    if (best >= 0) mapping[best] = "name";
  }
  return mapping;
}

/** Analiza una hoja: fila de títulos, columnas, ejemplos y mapeo propuesto. */
export function analyzeSheet(sheet: RawSheet, forcedHeaderRow?: number): SheetAnalysis {
  const rows = sheet.rows.map((row) => (Array.isArray(row) ? row.map((v) => (v ?? "").toString()) : []));
  const headerRow = forcedHeaderRow !== undefined ? Math.min(Math.max(-1, forcedHeaderRow), rows.length - 1) : detectHeaderRow(rows);
  const headerCells = headerRow >= 0 ? rows[headerRow] : [];
  const headerKey = headerCells.map((v) => normalizeHeader(cell([v], 0))).join("|");
  // Filas de datos: tras los títulos, sin vacías ni títulos repetidos (hojas pegadas una tras otra).
  const kept = rows.map((row, index) => ({ row, line: index + 1 })).slice(headerRow + 1)
    .filter(({ row }) => nonEmpty(row) && (headerRow < 0 || row.map((v) => normalizeHeader(cell([v], 0))).join("|") !== headerKey));
  const dataRows = kept.map((item) => item.row);
  const dataLines = kept.map((item) => item.line);
  // Encima de los títulos suele ir el título del documento (una celda); más de una celda = posibles invitados.
  const above = rows.slice(0, Math.max(0, headerRow)).flatMap((row, index) => (row.filter((v) => cell([v], 0)).length > 1 ? [index + 1] : []));
  const width = Math.max(headerCells.length, ...dataRows.map((row) => row.length), 0);
  const headers = Array.from({ length: width }, (_, index) => {
    const title = cell(headerCells, index).replace(/\s+/g, " ");
    return title || `Columna ${columnLetter(index)}`;
  });
  const columns = headers.map((_, index) => dataRows.map((row) => cell(row, index)));
  const mapping = proposeMapping(headerRow >= 0 ? headers.map((h, i) => (cell(headerCells, i) ? h : "")) : headers, columns, headerRow < 0);
  return {
    name: sheet.name,
    headerRow,
    dataRows,
    dataLines,
    above,
    mapping,
    columns: headers.map((header, index) => ({
      index,
      header,
      field: mapping[index],
      samples: Array.from(new Set(columns[index].filter(Boolean))).slice(0, 3),
      stats: columnStats(columns[index]),
    })),
  };
}

// ---------------------------------------------------------------- invitaciones

export interface ImportGuest {
  name: string;
  phone: string | null;
  status: "pendiente" | "si" | "no";
  /** Acompañantes de la invitación (0–10). Se cuentan como confirmados solo con «si». */
  companions: number;
  /** Tope de acompañantes: el número del Excel; null = el archivo no lo dice (sin límite). */
  max_companions: number | null;
  notes: string | null;
  group: string | null;
  tags: string[];
  side: GuestSide | null;
  extra: Record<string, string>;
  companion_names: string[];
}

export interface ImportWarning { kind: "no_name" | "phone" | "attendance" | "too_many" | "above_header" | "household_split" | "household_status" | "extra_full"; row?: number; sheet?: string; text: string }

export interface BuildResult {
  /** Filas de datos leídas (todas las hojas incluidas). */
  rows: number;
  guests: ImportGuest[];
  /** Hoja y fila del archivo de cada invitación (para señalarla si el servidor la rechaza). */
  origins: Array<{ sheet: string; line: number }>;
  /** Personas: cada invitación + sus acompañantes. */
  people: number;
  warnings: ImportWarning[];
}

export interface BuildOptions {
  /** Nombres de la pareja (partner_name_1/2) para entender la columna de lado. */
  partners?: { p1?: string | null; p2?: string | null };
  /** Cuando se importan varias hojas: el nombre de la hoja hace de grupo si la fila no trae uno. */
  sheetAsGroup?: boolean;
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Clave de campo propio válida: recortada, ≤ 40, nunca una clave especial de JS. */
export function extraKey(header: string): string {
  let key = header.replace(/\s+/g, " ").trim().slice(0, EXTRA_KEY_MAX).trim() || "Campo";
  if (RESERVED_KEYS.has(key)) key = `Campo ${key.replace(/_/g, "")}`.trim();
  return key;
}

/** Lado de una celda con los nombres de la pareja; null = no se entiende. */
export function parseSide(value: string, partners: BuildOptions["partners"] = {}): GuestSide | "none" | null {
  const key = normalizeHeader(value);
  if (!key) return "none";
  if (/^(ambos|los dos|las dos|comun|comunes|both|de los dos|de ambos)$/.test(key)) return "ambos";
  const first = (name: string | null | undefined) => normalizeHeader(name ?? "").split(" ")[0] ?? "";
  const p1 = first(partners?.p1);
  const p2 = first(partners?.p2);
  const words = key.replace(/^(de|del|de la|parte de|invitado de|invitada de|lado de)\s+/, "").split(" ");
  const hit1 = Boolean(p1) && words.includes(p1);
  const hit2 = Boolean(p2) && words.includes(p2);
  if (hit1 && hit2) return "ambos";
  if (hit1) return "p1";
  if (hit2) return "p2";
  return null;
}

interface PersonRow {
  sheet: string;
  line: number;
  lead: string;
  named: string[];
  unnamed: number;
  phone: string | null;
  status: "pendiente" | "si" | "no";
  /** La fila trae una asistencia explícita (no vacía). */
  statusGiven: boolean;
  count: number | null;
  notes: string[];
  group: string | null;
  tags: string[];
  side: GuestSide | null;
  /** Texto de lado tal cual (para conservarlo si difiere del de la titular). */
  sideText: string | null;
  household: string | null;
  extra: Array<[string, string]>;
}

/** Contexto de una fila para los avisos: «Fila 7» o «Novia, fila 7» con varias hojas. */
const where = (sheet: string, line: number, many: boolean) => (many ? `${sheet}, fila ${line}` : `Fila ${line}`);

/**
 * Hojas analizadas (con el mapeo que haya elegido la pareja) → invitaciones.
 * Nunca descarta datos en silencio: lo que no cabe en un campo del CRM va a
 * un campo propio y cada fila sin nombre, valor raro o dato que no cabe deja
 * un aviso.
 */
export function buildGuests(sheets: readonly SheetAnalysis[], options: BuildOptions = {}): BuildResult {
  const warnings: ImportWarning[] = [];
  const people: PersonRow[] = [];
  const many = sheets.length > 1;
  let rowCount = 0;
  for (const sheet of sheets) {
    const mapping = sheet.mapping;
    const headerOf = (index: number) => sheet.columns[index]?.header ?? `Columna ${columnLetter(index)}`;
    if (sheet.above.length > 0) {
      warnings.push({ kind: "above_header", sheet: sheet.name, text: `${many ? `${sheet.name}: ` : ""}${sheet.above.length === 1 ? "la fila" : "las filas"} ${sheet.above.join(", ")} ${sheet.above.length === 1 ? "está" : "están"} por encima de los títulos y no se ${sheet.above.length === 1 ? "importa" : "importan"}. Si son invitados, elegid otra «Fila de títulos».` });
    }
    // Un «Familia» con grupos de más de 11 filas no es una invitación: se trata como grupo.
    let householdAsGroup = false;
    const householdIndex = mapping.indexOf("household");
    if (householdIndex >= 0) {
      const sizes = new Map<string, number>();
      for (const row of sheet.dataRows) {
        const key = normalizeHeader(cell(row, householdIndex));
        if (key) sizes.set(key, (sizes.get(key) ?? 0) + 1);
      }
      if ([...sizes.values()].some((n) => n > COMPANIONS_MAX + 1)) {
        householdAsGroup = true;
        warnings.push({ kind: "household_split", sheet: sheet.name, text: `«${headerOf(householdIndex)}» agrupa a más de ${COMPANIONS_MAX + 1} personas: lo usamos como grupo, no como invitación.` });
      }
    }
    // «Adultos» + «Niños» se suman; «Personas» ya incluye a los niños.
    const peopleIndex = mapping.indexOf("people");
    const adultsOnly = peopleIndex >= 0 && /adult/.test(normalizeHeader(headerOf(peopleIndex)));
    sheet.dataRows.forEach((row, rowIndex) => {
      rowCount += 1;
      const line = sheet.dataLines[rowIndex] ?? rowIndex + 1;
      const at = where(sheet.name, line, many);
      const person: PersonRow = { sheet: sheet.name, line, lead: "", named: [], unnamed: 0, phone: null, status: "pendiente", statusGiven: false, count: null, notes: [], group: null, tags: [], side: null, sideText: null, household: null, extra: [] };
      const names: string[] = [];
      const surnames: string[] = [];
      let companions: number | null = null;
      let total: number | null = null;
      let kids: number | null = null;
      let totalHeader = "";
      const keep = (header: string, value: string) => { const flat = value.replace(/\s+/g, " ").trim(); if (flat) person.extra.push([extraKey(header), flat]); };
      mapping.forEach((field, index) => {
        const value = cell(row, index);
        if (!value || field === "ignore") return;
        const header = headerOf(index);
        switch (field) {
          case "name": names.push(value); break;
          case "surname": surnames.push(value); break;
          case "phone": {
            const result = normalizePhone(value);
            if (!person.phone && result.phone) person.phone = result.phone;
            else if (result.phone) keep(`Otros teléfonos`, result.phone);
            if (!result.valid) { keep(`${header} (revisar)`, value); warnings.push({ kind: "phone", sheet: sheet.name, row: line, text: `${at}: «${value}» no parece un teléfono; lo guardamos aparte para que lo reviséis.` }); }
            result.others.forEach((other) => keep("Otros teléfonos", other));
            break;
          }
          case "attendance": {
            const status = parseAttendance(value);
            if (status) { person.status = status; person.statusGiven = true; break; }
            keep(header, value);
            warnings.push({ kind: "attendance", sheet: sheet.name, row: line, text: `${at}: «${value}» no es sí, no ni pendiente; queda como pendiente y guardamos el texto aparte.` });
            break;
          }
          case "companions": case "people": case "kids": {
            const n = parseCount(value);
            if (n === null) { keep(header, value); break; }
            if (field === "companions") companions = n;
            else if (field === "people") { total = n; totalHeader = header; }
            else { kids = n; keep(header, value); } // El nº de niños se conserva siempre (menú infantil).
            break;
          }
          case "companion_names": person.named.push(...splitNames(value)); break;
          case "household":
            if (householdAsGroup) { if (!person.group) person.group = value; else keep(header, value); } else person.household = normalizeHeader(value) || null;
            if (!householdAsGroup) person.extra.push(["__household_label", value]);
            break;
          case "group": person.group = value; break;
          case "side": {
            const side = parseSide(value, options.partners);
            if (side === null) keep(header, value); else if (side !== "none") { person.side = side; person.sideText = value; }
            break;
          }
          case "tags": person.tags.push(...value.split(/\s*[,;·|]\s*/).filter(Boolean)); break;
          case "notes": person.notes.push(sheet.headerRow >= 0 && mapping.filter((f) => f === "notes").length > 1 ? `${header}: ${value}` : value); break;
          case "email": case "table": case "menu": case "bus": keep(CANONICAL_EXTRA[field]!, value); break;
          default: keep(header, value);
        }
      });
      const fullName = [names.join(" "), surnames.join(" ")].join(" ").replace(/\s+/g, " ").trim();
      if (!fullName) {
        if (row.some((v) => cell([v], 0))) warnings.push({ kind: "no_name", sheet: sheet.name, row: line, text: `${at}: sin nombre, no se importa.` });
        return;
      }
      // «Ana y Pablo» (+ apellidos de su columna): titular + acompañantes.
      const split = splitPeople(names.length ? names.join(" ") : fullName);
      const surname = surnames.join(" ").replace(/\s+/g, " ").trim();
      const withSurname = (part: string) => {
        // La columna de apellidos es explícita, también para «María José».
        // Solo se omite cuando ya aparece como sufijo completo del nombre.
        const normalized = part.normalize("NFC").toLocaleLowerCase("es");
        const suffix = surname.normalize("NFC").toLocaleLowerCase("es");
        return surname && normalized !== suffix && !normalized.endsWith(` ${suffix}`) ? `${part} ${surname}` : part;
      };
      person.lead = names.length ? withSurname(split.lead) : split.lead;
      if (split.companions.length > 0) person.named.unshift(...split.companions.map(withSurname));
      person.unnamed = split.unnamed;
      if (person.lead.length > NAME_MAX) { keep("Nombre completo", person.lead); person.lead = person.lead.slice(0, NAME_MAX).trim(); }
      if (cleanName(person.lead).length < 2) {
        warnings.push({ kind: "no_name", sheet: sheet.name, row: line, text: `${at}: «${person.lead}» es demasiado corto para un nombre, no se importa.` });
        return;
      }
      // Acompañantes por número: «Personas» incluye al invitado (y a los niños);
      // «Adultos» + «Niños» se suman; sin total, acompañantes + niños.
      const fromTotal = total !== null ? Math.max(0, total - 1) + (adultsOnly && kids !== null ? kids : 0) : null;
      const fromKids = total === null && kids !== null ? (companions ?? 0) + kids : null;
      const counts = [companions, fromTotal, fromKids].filter((n): n is number => n !== null);
      person.count = counts.length ? Math.max(...counts) : null;
      // El total del Excel se conserva si no se deduce solo del resultado (p. ej. con niños aparte).
      if (total !== null && (kids !== null || (companions !== null && total !== companions + 1))) keep(totalHeader, String(total));
      if (!person.group && options.sheetAsGroup) person.group = sheet.name;
      people.push(person);
    });
  }

  // Filas con la misma invitación/familia → una invitación (en el orden del archivo).
  const invitations: PersonRow[][] = [];
  const byHousehold = new Map<string, PersonRow[]>();
  for (const person of people) {
    if (!person.household) { invitations.push([person]); continue; }
    const key = `${person.sheet}\u0000${person.household}`;
    const existing = byHousehold.get(key);
    if (existing) existing.push(person);
    else { const list = [person]; byHousehold.set(key, list); invitations.push(list); }
  }

  const guests = invitations.map((members) => toGuest(members, warnings, many));
  return {
    rows: rowCount,
    guests,
    origins: invitations.map(([lead]) => ({ sheet: lead.sheet, line: lead.line })),
    people: guests.reduce((sum, guest) => sum + 1 + guest.companions, 0),
    warnings,
  };
}

/** Una invitación desde sus filas: la primera es la titular, las demás, acompañantes. */
function toGuest(members: PersonRow[], warnings: ImportWarning[], many: boolean): ImportGuest {
  const [lead, ...rest] = members;
  const at = where(lead.sheet, lead.line, many);
  const named = [...lead.named];
  let unnamed = lead.unnamed;
  const extraPairs: Array<[string, string]> = [];
  let householdLabel: string | null = null;
  const take = (pairs: Array<[string, string]>) => {
    for (const [key, value] of pairs) {
      if (key === "__household_label") { householdLabel ??= value; continue; }
      extraPairs.push([key, value]);
    }
  };
  take(lead.extra);
  let phone = lead.phone;
  const notes = [...lead.notes];
  const tags = [...lead.tags];
  let count = lead.count;
  const declined: string[] = [];
  let mixed = false;
  for (const member of rest) {
    // Cada uno conserva su respuesta: quien dice «no» no cuenta como acompañante.
    if (member.statusGiven && member.status !== lead.status) mixed = true;
    if (member.status === "no" && lead.status !== "no") declined.push(member.lead);
    else named.push(member.lead);
    named.push(...member.named);
    unnamed += member.unnamed;
    if (!phone && member.phone) phone = member.phone;
    else if (member.phone && member.phone !== phone) extraPairs.push(["Otros teléfonos", `${member.lead}: ${member.phone}`]);
    // Lo que comparte con la titular (misma mesa, misma dirección) no se repite.
    take(member.extra
      .filter(([key, value]) => key === "__household_label" || !lead.extra.some(([k, v]) => k === key && v === value))
      .map(([key, value]) => (key === "__household_label" ? [key, value] : [key, `${member.lead}: ${value}`])));
    if (member.group && member.group !== lead.group) extraPairs.push(["Grupo", `${member.lead}: ${member.group}`]);
    if (member.side && member.side !== lead.side) extraPairs.push(["Lado", `${member.lead}: ${member.sideText ?? member.side}`]);
    notes.push(...member.notes.map((note) => `${member.lead}: ${note}`));
    tags.push(...member.tags);
    if (member.count !== null) count = Math.max(count ?? 0, member.count);
  }
  if (declined.length) extraPairs.unshift(["No vienen", declined.join(", ")]);
  if (mixed) warnings.push({ kind: "household_status", sheet: lead.sheet, row: lead.line, text: `${at}: en la invitación de ${lead.lead} no todos responden lo mismo; queda con la respuesta de ${lead.lead}${declined.length ? ` y quien no viene (${declined.join(", ")}) no cuenta como acompañante` : ""}.` });
  // Acompañantes: el mayor entre los nombrados (+ sin nombre) y el número del Excel (sin quien no viene).
  const uniqueNamed = Array.from(new Map(named.map((n) => [n.toLocaleLowerCase("es"), n.replace(/\s+/g, " ").trim().slice(0, COMPANION_NAME_MAX).trim()])).values()).filter(Boolean);
  let companions = Math.max(uniqueNamed.length + unnamed, (count ?? 0) - declined.length);
  if (companions > COMPANIONS_MAX) {
    warnings.push({ kind: "too_many", sheet: lead.sheet, row: lead.line, text: `${at}: ${lead.lead} trae ${companions} acompañantes; una invitación admite ${COMPANIONS_MAX}. Guardamos los nombres que sobran aparte.` });
    const overflow = uniqueNamed.slice(COMPANIONS_MAX);
    if (overflow.length) extraPairs.push(["Más acompañantes", overflow.join(", ")]);
    companions = COMPANIONS_MAX;
  }
  const companionNames = uniqueNamed.slice(0, COMPANIONS_MAX);
  const hasCount = count !== null || uniqueNamed.length + unnamed > 0;

  // Grupo: el de la fila; si no, el nombre de la invitación/familia.
  // Un número de invitación («12») no es un buen grupo: se queda como campo propio.
  if (householdLabel && /^[\d\s.#-]+$/.test(householdLabel)) { extraPairs.unshift(["Invitación", householdLabel]); householdLabel = null; }
  // Con grupo propio, el nombre de la invitación/familia se guarda aparte (nada se pierde).
  if (householdLabel && lead.group) { extraPairs.unshift(["Invitación", householdLabel]); householdLabel = null; }
  let group = normalizeGroupName(lead.group ?? householdLabel ?? "");
  if (group && group.length > GROUP_NAME_MAX) { extraPairs.push(["Grupo", group]); group = null; }

  const cleanTags = normalizeTags(tags.map((tag) => normalizeTag(tag)).filter((tag): tag is string => tag !== null && tag.length <= TAG_MAX));
  const droppedTags = tags.filter((tag) => !cleanTags.some((kept) => kept.toLowerCase() === (normalizeTag(tag) ?? "").toLowerCase()));
  if (droppedTags.length) extraPairs.push(["Otras etiquetas", droppedTags.join(", ")]);

  // Alergias/dieta: las primeras 500 letras en la nota; el resto, en «Más notas» (troceado si hace falta).
  const noteText = notes.join(" · ").replace(/\s+/g, " ").trim();
  // Se corta en un espacio (si lo hay cerca) para no partir palabras.
  const space = noteText.length > NOTES_MAX ? noteText.lastIndexOf(" ", NOTES_MAX) : -1;
  const cut = noteText.length <= NOTES_MAX ? noteText.length : space > NOTES_MAX - 60 ? space : NOTES_MAX;
  const notesHead = noteText.slice(0, cut).trim();
  const notesTail = noteText.slice(cut).trim();
  if (notesTail) extraPairs.push(["Más notas", notesTail]);

  return {
    name: cleanName(lead.lead).slice(0, NAME_MAX),
    phone,
    status: lead.status,
    companions,
    max_companions: hasCount ? companions : null,
    notes: notesHead || null,
    group,
    tags: cleanTags.slice(0, TAGS_PER_GUEST),
    side: lead.side,
    extra: packExtra(extraPairs, warnings, lead, at),
    companion_names: companionNames,
  };
}

/** Tamaño en bytes de un texto (UTF-8). */
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Tamaño de los campos propios tal y como los mide el servidor (zod): JSON
 * compacto. Postgres los guarda con «": "» y «", "» (≈ 2 bytes más por
 * campo), por eso el presupuesto (5800) queda por debajo del CHECK (6144).
 */
export function extraBytes(extra: Record<string, string>): number {
  return byteLength(JSON.stringify(extra));
}

/**
 * Pares → objeto de campos propios con los topes del CHECK. Claves repetidas
 * se unen con « · »; un valor de más de 300 caracteres se trocea en «Clave»,
 * «Clave (2)»… en vez de recortarse. Lo que no cabe deja un aviso.
 */
function packExtra(pairs: Array<[string, string]>, warnings: ImportWarning[], lead: PersonRow, at: string): Record<string, string> {
  const merged = new Map<string, string>();
  for (const [key, value] of pairs) {
    if (!value) continue;
    const previous = merged.get(key);
    if (previous === undefined) merged.set(key, value);
    else if (!previous.split(" · ").includes(value)) merged.set(key, `${previous} · ${value}`);
  }
  const entries: Array<[string, string]> = [];
  for (const [key, raw] of merged) {
    const flat = raw.replace(/\s+/g, " ").trim();
    for (let start = 0, part = 1; start < flat.length; start += EXTRA_VALUE_MAX, part += 1) {
      const chunk = flat.slice(start, start + EXTRA_VALUE_MAX).trim();
      if (!chunk) continue;
      const suffix = part === 1 ? "" : ` (${part})`;
      entries.push([`${key.slice(0, EXTRA_KEY_MAX - suffix.length).trim()}${suffix}`, chunk]);
    }
  }
  const out: Record<string, string> = {};
  let bytes = 2;
  const dropped: string[] = [];
  for (const [key, value] of entries) {
    // "clave":"valor", → claves y valores en JSON + «:» + «,».
    const size = byteLength(JSON.stringify(key) + JSON.stringify(value)) + 2;
    if (Object.hasOwn(out, key) || Object.keys(out).length >= EXTRA_MAX_KEYS || bytes + size > EXTRA_BUDGET_BYTES) { dropped.push(key); continue; }
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    bytes += size;
  }
  if (dropped.length > 0) warnings.push({ kind: "extra_full", sheet: lead.sheet, row: lead.line, text: `${at}: ${lead.lead} tiene demasiados datos extra; no caben ${dropped.length} (${dropped.slice(0, 4).join(", ")}${dropped.length > 4 ? "…" : ""}). Como mucho ${EXTRA_MAX_KEYS} campos propios por invitado.` });
  return out;
}

// ---------------------------------------------------------------- repetidos

/** Marca repetidos contra la lista guardada y dentro del propio archivo (mismas reglas que «Añadir varios»). */
export function markGuestDuplicates(guests: readonly ImportGuest[], existing: ReadonlyArray<{ name: string; phone: string | null }>): Array<DuplicateMark | null> {
  return markDuplicates(guests.map((guest) => ({ name: guest.name, phone: guest.phone ?? "" })), existing);
}

/** «Hemos leído N filas: X invitaciones y Y personas». */
export function readSummary(result: Pick<BuildResult, "rows" | "people"> & { guests: number }): string {
  const n = (value: number, one: string, many: string) => `${value.toLocaleString("es-ES")} ${value === 1 ? one : many}`;
  return `Hemos leído ${n(result.rows, "fila", "filas")}: ${n(result.guests, "invitación", "invitaciones")} y ${n(result.people, "persona", "personas")}`;
}
