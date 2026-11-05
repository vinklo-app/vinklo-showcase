/**
 * Importación masiva de invitados: reglas puras compartidas por el cliente
 * (pegar lista / selector de contactos → tabla de revisión) y por la server
 * action `bulkCreateGuests` (lib/actions/guests.ts). Sin "use server": un
 * archivo de server actions solo puede exportar funciones async.
 */

/** Tope de una importación (una boda media ronda los 120 invitados). */
export const MAX_IMPORT_ROWS = 300;
/** Límites de `schema` en lib/actions/guests.ts (nombre 2–120, teléfono 6–20). */
export const NAME_MAX = 120;
export const PHONE_MAX = 20;

export interface ImportRow { name: string; phone: string }
export interface BulkCreateRowError { line: number; message: string }
export type BulkCreateResult =
  | { ok: true; created: number; skipped: number; errors: BulkCreateRowError[] }
  | { ok: false; error: string; created: 0; skipped: number; errors: BulkCreateRowError[] };

export function tooManyRowsMessage(count: number): string {
  const n = String(Math.trunc(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Son ${n} invitados: como máximo ${MAX_IMPORT_ROWS} de una vez. Añadid los primeros ${MAX_IMPORT_ROWS} y después el resto.`;
}

const PHONE_CHARS = /^\+?[\d\s().-]+$/;
const digitsOf = (value: string) => value.replace(/\D/g, "");
/** ¿Parece un teléfono? Solo cifras y separadores, entre 6 y 15 cifras (E.164). */
export function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_CHARS.test(trimmed)) return false;
  const digits = digitsOf(trimmed).length;
  return digits >= 6 && digits <= 15;
}

/** Teléfono tal y como lo escribieron (espacios colapsados); sin espacios si no cabe en 20. */
export function cleanPhone(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length <= PHONE_MAX) return collapsed;
  return collapsed.replace(/[\s().-]/g, "").slice(0, PHONE_MAX);
}

/** Quita viñetas y numeración de listas copiadas de Notas/WhatsApp, comillas y espacios de más. */
export function cleanName(value: string): string {
  return value
    .replace(/^\s*(?:[-*•·–—]+|\d{1,3}[.)-])\s+/u, "")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Una línea → {nombre, teléfono}. Tabulador, coma/punto y coma, o cifras al final. */
export function parseLine(raw: string): ImportRow {
  const line = raw.replace(/\u00a0/g, " ").trim();
  // Tabulador (copiado de una hoja de cálculo): primera columna nombre, la primera que parezca teléfono.
  if (line.includes("\t")) {
    const cells = line.split("\t").map((cell) => cell.trim()).filter(Boolean);
    const phoneIndex = cells.findIndex((cell, index) => index > 0 && looksLikePhone(cell));
    const nameCells = cells.filter((_, index) => index !== phoneIndex);
    return { name: cleanName(nameCells[0] ?? ""), phone: phoneIndex > 0 ? cleanPhone(cells[phoneIndex]) : "" };
  }
  // Coma o punto y coma: «Nombre Apellido, 612 345 678».
  const separated = line.match(/^(.*?)[,;]\s*([^,;]*)$/);
  if (separated && looksLikePhone(separated[2])) {
    return { name: cleanName(separated[1]), phone: cleanPhone(separated[2]) };
  }
  // Cifras al final separadas por espacio: «Tía Puri 645 300 200», «Hugo +44 7700 900123».
  const trailing = line.match(/^(.*?\S)\s+(\+?\d[\d\s().-]*\d)$/);
  if (trailing && looksLikePhone(trailing[2])) {
    return { name: cleanName(trailing[1]), phone: cleanPhone(trailing[2]) };
  }
  // Solo un teléfono (sin nombre): queda como fila a corregir.
  if (looksLikePhone(line)) return { name: "", phone: cleanPhone(line) };
  return { name: cleanName(line), phone: "" };
}

const HEADER = /^\s*(nombre|name|invitad[oa]s?)\b.*\b(tel[eé]fono|m[oó]vil|phone|tel)\b/i;

/** Texto pegado → filas. Ignora líneas vacías y una cabecera tipo «Nombre, Teléfono». */
export function parseGuestList(text: string): ImportRow[] {
  const lines = text.split(/\r\n|\r|\n/);
  const rows: ImportRow[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    if (index === lines.findIndex((l) => l.trim()) && HEADER.test(line)) return;
    const row = parseLine(line);
    if (!row.name && !row.phone) return;
    rows.push(row);
  });
  return rows;
}

/** Validación de una fila, con los mismos mensajes que `schema` (guests.ts) más «no parece un nombre». */
export function rowProblem(row: ImportRow): string | null {
  const name = row.name.trim();
  const phone = row.phone.trim();
  if (name.length < 2) return name ? "Escribid el nombre (mínimo 2 letras)." : "Falta el nombre.";
  if (name.length > NAME_MAX) return `El nombre es demasiado largo (máximo ${NAME_MAX} caracteres).`;
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)) return "Esto no parece un nombre.";
  if (phone && phone.length < 6) return "Revisad el teléfono: mínimo 6 caracteres.";
  if (phone.length > PHONE_MAX) return `Revisad el teléfono: máximo ${PHONE_MAX} caracteres.`;
  return null;
}

/** Nombre comparable: sin tildes, minúsculas, solo letras/cifras/emoji separados por un espacio. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, " ")
    .trim();
}

/** Teléfono comparable: las 9 últimas cifras (quita +34/0034 y formatos). Null si no hay 6 cifras. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = digitsOf(phone ?? "");
  if (digits.length < 6) return null;
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export type DuplicateMark =
  | { kind: "existing"; match: string; by: "name" | "phone" }
  | { kind: "batch"; match: string; by: "name" | "phone" };

/**
 * Marca posibles repetidos: contra la lista ya guardada (mismo nombre
 * normalizado o mismo teléfono) y dentro de lo importado (a partir de la
 * segunda aparición). Solo marca: la pareja decide si los añade.
 */
export function markDuplicates(rows: ImportRow[], existing: ReadonlyArray<{ name: string; phone: string | null }>): Array<DuplicateMark | null> {
  const byName = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const guest of existing) {
    const n = nameKey(guest.name);
    if (n && !byName.has(n)) byName.set(n, guest.name);
    const p = phoneKey(guest.phone);
    if (p && !byPhone.has(p)) byPhone.set(p, guest.name);
  }
  const seenName = new Map<string, string>();
  const seenPhone = new Map<string, string>();
  return rows.map((row) => {
    const n = nameKey(row.name);
    const p = phoneKey(row.phone);
    let mark: DuplicateMark | null = null;
    if (p && byPhone.has(p)) mark = { kind: "existing", match: byPhone.get(p)!, by: "phone" };
    else if (n && byName.has(n)) mark = { kind: "existing", match: byName.get(n)!, by: "name" };
    else if (p && seenPhone.has(p)) mark = { kind: "batch", match: seenPhone.get(p)!, by: "phone" };
    else if (n && seenName.has(n)) mark = { kind: "batch", match: seenName.get(n)!, by: "name" };
    if (n && !seenName.has(n)) seenName.set(n, row.name.trim());
    if (p && !seenPhone.has(p)) seenPhone.set(p, row.name.trim() || row.phone.trim());
    return mark;
  });
}

/** Resultado del selector de contactos (Contact Picker API) → filas. */
export function rowsFromContacts(contacts: ReadonlyArray<{ name?: string[]; tel?: string[] }>): ImportRow[] {
  return contacts
    .map((contact) => {
      const name = cleanName((contact.name ?? []).find((value) => value.trim()) ?? "").slice(0, NAME_MAX);
      const tel = (contact.tel ?? []).find((value) => value.trim()) ?? "";
      return { name, phone: tel ? cleanPhone(tel) : "" };
    })
    .filter((row) => row.name || row.phone);
}
