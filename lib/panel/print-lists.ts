/**
 * Listas para imprimir (plan maestro §4.7). Puro: del plan de mesas y de las
 * respuestas salen la hoja de mesas, la lista de entrada alfabética y la hoja
 * del catering. Solo cuenta a quien VIENE (rsvp «si»): el día de la boda los
 * pendientes no ocupan sitio (misma regla que lib/crm/seating.ts).
 *
 * Acompañantes con nombre (§4.3): cada invitado lleva los nombres de quien se
 * sienta con él; los que se sientan aparte (la mesa infantil) salen en su mesa
 * con «con {invitado}» y su invitado cuenta solo las personas de su mesa.
 */
import { companionLabel, activeCompanions, companionsAtHome, seatsTaken, type SeatGuest, type SeatVisitor, type SeatingPlan } from "@/lib/crm/seating";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);
const people = (guest: { companions: number }) => 1 + Math.max(0, guest.companions);
const cleanNotes = (notes: string | null) => (notes && notes.trim() ? notes.trim() : null);

export interface PrintTable {
  id: string;
  name: string;
  seats: number;
  /** Quien viene, por nombre. */
  guests: SeatGuest[];
  /** Acompañantes de otras mesas sentados aquí (la mesa infantil), por nombre. */
  visitors: SeatVisitor[];
  /** Personas que vienen sentadas aquí (invitado + acompañantes de su mesa + los de otras mesas). */
  people: number;
  /** Sentados que aún no han respondido (no ocupan sitio). */
  pending: number;
}

/** Mesas en su orden, cada una con quien viene por orden alfabético. */
export function printTables(plan: SeatingPlan): PrintTable[] {
  return plan.tables.map((table) => {
    const coming = table.guests.filter((guest) => guest.rsvp_status === "si").sort(byName);
    const visitors = (table.visitors ?? []).filter((visitor) => visitor.rsvp_status === "si").sort(byName);
    return {
      id: table.id, name: table.name, seats: table.seats, guests: coming, visitors,
      people: coming.reduce((sum, guest) => sum + seatsTaken(guest), 0) + visitors.length,
      pending: table.guests.filter((guest) => guest.rsvp_status === "pendiente").length,
    };
  });
}

/** Nombres de quien se sienta con este invitado («Pablo (niño/a) · Irene»); vacío si no hay. */
export function companionNamesText(guest: Pick<SeatGuest, "companion_list" | "companions">): string {
  return companionsAtHome(guest).map(companionLabel).join(" · ");
}

export interface EntryRow {
  id: string;
  name: string;
  companions: number;
  table: string | null;
  /** Acompañantes con nombre que se sientan con él. */
  names: string[];
  /** Acompañantes con nombre sentados en otra mesa («Pablo (niño/a)» en «Mesa infantil»). */
  away: Array<{ name: string; table: string }>;
}

/** Lista de entrada: quien viene, A-Z, con su mesa (null = sin mesa) y sus acompañantes. */
export function entryList(plan: SeatingPlan): EntryRow[] {
  const tableName = new Map(plan.tables.map((table) => [table.id, table.name]));
  const row = (guest: SeatGuest, table: string | null): EntryRow => ({
    id: guest.id, name: guest.name, companions: guest.companions, table,
    names: companionsAtHome(guest).map(companionLabel),
    away: activeCompanions(guest).flatMap((companion) => {
      const name = companion.table_id ? tableName.get(companion.table_id) : undefined;
      return name ? [{ name: companionLabel(companion), table: name }] : [];
    }),
  });
  const rows: EntryRow[] = [];
  for (const table of plan.tables) {
    for (const guest of table.guests) if (guest.rsvp_status === "si") rows.push(row(guest, table.name));
  }
  for (const guest of plan.unseated) if (guest.rsvp_status === "si") rows.push(row(guest, null));
  return rows.sort(byName);
}

/** Inicial para separar la lista de entrada (sin tildes: «Á» va con la «A»). */
export function initialOf(name: string): string {
  const first = name.trim().charAt(0).normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("es");
  return /\p{L}/u.test(first) ? first : "#";
}

export interface CateringGuest { id: string; name: string; companions: number; notes: string | null; menu: string; companionNames?: string }
export interface CateringRow extends CateringGuest { table: string | null }

/**
 * Hoja del catering: quien viene con alergias/notas o menú elegido, por mesa
 * (en el orden de las mesas; «sin mesa» al final) y por nombre. `tableOf`
 * vacío = aún no hay mesas.
 */
export function cateringRows(guests: readonly CateringGuest[], tableOf: ReadonlyMap<string, { name: string; position: number }>): CateringRow[] {
  return guests
    .map((guest) => ({ ...guest, notes: cleanNotes(guest.notes), menu: guest.menu.trim() }))
    .filter((guest) => guest.notes || guest.menu)
    .map((guest) => ({ guest, table: tableOf.get(guest.id) ?? null }))
    .sort((a, b) => {
      if (a.table && b.table && a.table.position !== b.table.position) return a.table.position - b.table.position;
      if (a.table && !b.table) return -1;
      if (!a.table && b.table) return 1;
      return byName(a.guest, b.guest);
    })
    .map(({ guest, table }) => ({ ...guest, table: table?.name ?? null }));
}

/** Mesa de cada invitado (id → nombre y posición) a partir del plan. */
export function tablesByGuest(plan: SeatingPlan | null): Map<string, { name: string; position: number }> {
  const map = new Map<string, { name: string; position: number }>();
  plan?.tables.forEach((table, index) => { for (const guest of table.guests) map.set(guest.id, { name: table.name, position: index }); });
  return map;
}

/** Nombres de los acompañantes de cada invitado (id → «Pablo (niño/a) · Irene»), estén donde estén. */
export function companionNamesByGuest(plan: SeatingPlan | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!plan) return map;
  for (const guest of [...plan.tables.flatMap((table) => table.guests), ...plan.unseated]) {
    const names = activeCompanions(guest).map(companionLabel).join(" · ");
    if (names) map.set(guest.id, names);
  }
  return map;
}

export interface KidRow { id: string; name: string; with: string; table: string | null }

/**
 * Niños para el catering y la mesa infantil: los que vienen con nombre (con
 * su mesa: la infantil o la de su familia) y cuántos hay en total (con
 * nombre, los marcados; sin nombres, el número que dio el invitado).
 */
export function kidsSummary(plan: SeatingPlan | null): { total: number; named: KidRow[] } {
  if (!plan) return { total: 0, named: [] };
  const tableName = new Map(plan.tables.map((table) => [table.id, table.name]));
  let total = 0;
  const named: KidRow[] = [];
  const visit = (guest: SeatGuest, home: string | null) => {
    if (guest.rsvp_status !== "si") return;
    total += Math.min(Math.max(0, guest.kids ?? 0), Math.max(0, guest.companions));
    for (const companion of activeCompanions(guest)) {
      if (!companion.is_kid) continue;
      named.push({ id: companion.id, name: companion.name, with: guest.name, table: (companion.table_id ? tableName.get(companion.table_id) : undefined) ?? home });
    }
  };
  for (const table of plan.tables) for (const guest of table.guests) visit(guest, table.name);
  for (const guest of plan.unseated) visit(guest, null);
  return { total, named: named.sort(byName) };
}

/** Total de personas que vienen (invitado + acompañantes). */
export function attendingPeople(rows: readonly { companions: number }[]): number {
  return rows.reduce((sum, row) => sum + people(row), 0);
}
