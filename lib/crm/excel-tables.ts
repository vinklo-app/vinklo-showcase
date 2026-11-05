/**
 * «Crear N mesas y sentar según vuestro Excel» (Bloque 4, 17-oct-2026). La
 * importación de Excel guarda la columna Mesa como campo propio «Mesa»
 * (CANONICAL_EXTRA de guest-excel-import.ts). Con ella se arma un cambio de
 * mesas (SeatingChange) que se aplica de una vez con apply_seating y se
 * deshace con el mismo «Deshacer» que el resto del plano. Puro.
 *
 * Reglas (las mínimas para no pisar nada):
 *  - Solo invitados SIN mesa y que no han dicho que no vienen: a quien la
 *    pareja ya sentó no se le mueve.
 *  - «3» o «3.0» → «Mesa 3»; cualquier otro texto, tal cual («Presidencial»).
 *  - Si ya hay una mesa con ese nombre (sin mayúsculas), se usa esa.
 *  - Mesas nuevas de 10 plazas, o las que hagan falta para quien viene, hasta 30.
 */
import { MAX_TABLES, TABLE_NAME_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, normalizeTableName, seatsTaken, type SeatingPlan } from "@/lib/crm/seating";
import type { SeatingChange } from "@/lib/crm/table-ops";
import type { NewTableKey } from "@/lib/crm/auto-seating";

/** Clave del campo propio donde la importación guarda la columna Mesa. */
export const EXCEL_TABLE_FIELD = "Mesa";

const numeric = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Valor de la columna Mesa → nombre de la mesa (null = vacío o demasiado largo). */
export function excelTableName(value: string): string | null {
  const clean = normalizeTableName(value);
  if (!clean) return null;
  const number = /^\d{1,4}(?:[.,]0+)?$/.test(clean) ? String(Number.parseInt(clean, 10)) : null;
  const name = number ? `Mesa ${number}` : clean;
  return name.length <= TABLE_NAME_MAX ? name : null;
}

export interface ExcelTablesProposal {
  change: SeatingChange;
  /** Mesas que se crean y mesas que ya existían y se usan. */
  created: number;
  reused: number;
  /** Invitados que se sientan. */
  guests: number;
}

/**
 * Propuesta a partir de `mesaByGuest` (id del invitado → valor de su columna
 * Mesa). null = no hay nadie que sentar, o se pasaría del tope de mesas.
 */
export function excelTablesProposal(plan: SeatingPlan, mesaByGuest: ReadonlyMap<string, string>): ExcelTablesProposal | null {
  const existing = new Map(plan.tables.map((table) => [table.name.toLocaleLowerCase("es"), table.id]));
  const byName = new Map<string, { name: string; ids: string[]; people: number }>();
  for (const guest of plan.unseated) {
    if (guest.rsvp_status === "no") continue;
    const raw = mesaByGuest.get(guest.id);
    const name = raw === undefined ? null : excelTableName(raw);
    if (!name) continue;
    const key = name.toLocaleLowerCase("es");
    const entry = byName.get(key) ?? { name, ids: [], people: 0 };
    entry.ids.push(guest.id);
    entry.people += Math.max(seatsTaken(guest), 1);
    byName.set(key, entry);
  }
  if (byName.size === 0) return null;
  const entries = [...byName.entries()].sort((a, b) => numeric.compare(a[1].name, b[1].name));
  const newTables: SeatingChange["newTables"] = [];
  const assignments: SeatingChange["assignments"] = [];
  let reused = 0;
  let people = 0;
  for (const [key, entry] of entries) {
    let tableId: string | undefined = existing.get(key);
    if (tableId) reused += 1;
    else {
      const newKey: NewTableKey = `new:${newTables.length + 1}`;
      newTables.push({ key: newKey, name: entry.name, seats: Math.min(TABLE_SEATS_MAX, Math.max(TABLE_SEATS_DEFAULT, entry.people)) });
      tableId = newKey;
    }
    for (const guestId of entry.ids) assignments.push({ guestId, tableId });
    people += entry.people;
  }
  if (plan.tables.length + newTables.length > MAX_TABLES) return null;
  return {
    change: { newTables, assignments, people, summary: "" },
    created: newTables.length,
    reused,
    guests: assignments.length,
  };
}
