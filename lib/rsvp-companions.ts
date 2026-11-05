/**
 * Nombres de acompañantes (plan maestro §4.3). Puro y sin dependencias (lo
 * usan el formulario del invitado, la server action y la ficha del CRM):
 * nada de zod aquí para no engordar el formulario público.
 *
 * Reglas:
 *  - Opcionales: una fila sin nombre no se guarda (pero «es niño/a» sí cuenta
 *    para el número de niños del formulario).
 *  - Recortados, espacios colapsados, 1-80 caracteres, sin repetir (sin
 *    distinguir mayúsculas) y como mucho tantos como acompañantes (máx. 10).
 */
export const COMPANION_NAME_MAX = 80;
export const COMPANIONS_MAX = 10;

export interface CompanionRow { name: string; kid: boolean }

export function normalizeCompanionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, COMPANION_NAME_MAX).trim();
  return clean === "" ? null : clean;
}

/** Filas del formulario → lista para guardar (solo las que tienen nombre, en orden, sin repetidas). */
export function companionListFromRows(rows: readonly Partial<CompanionRow>[], companions: number): CompanionRow[] {
  const limit = Math.max(0, Math.min(COMPANIONS_MAX, Math.trunc(companions) || 0));
  const seen = new Set<string>();
  const list: CompanionRow[] = [];
  for (const row of rows.slice(0, limit)) {
    const name = normalizeCompanionName(row.name);
    if (!name) continue;
    const key = name.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ name, kid: row.kid === true });
  }
  return list;
}

/** Niños entre los acompañantes del formulario (filas marcadas, con o sin nombre). */
export function kidsFromRows(rows: readonly Partial<CompanionRow>[], companions: number): number {
  const limit = Math.max(0, Math.min(COMPANIONS_MAX, Math.trunc(companions) || 0));
  return rows.slice(0, limit).filter((row) => row.kid === true).length;
}

/** Ajusta las filas del formulario al número de acompañantes (conserva lo escrito). */
export function resizeCompanionRows(rows: readonly CompanionRow[], companions: number): CompanionRow[] {
  const size = Math.max(0, Math.min(COMPANIONS_MAX, Math.trunc(companions) || 0));
  const next = rows.slice(0, size).map((row) => ({ ...row }));
  while (next.length < size) next.push({ name: "", kid: false });
  return next;
}

/** jsonb de guest_rsvp_current.companion_list → filas (lo que no encaje, fuera). */
export function parseCompanionList(raw: unknown): CompanionRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: CompanionRow[] = [];
  for (const item of raw.slice(0, COMPANIONS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const name = normalizeCompanionName((item as { name?: unknown }).name);
    if (name) rows.push({ name, kid: (item as { kid?: unknown }).kid === true });
  }
  return rows;
}
