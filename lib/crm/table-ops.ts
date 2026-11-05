/**
 * Cambios de mesa entera (mesas con IA, 9-oct-2026). Puro, sin base de datos.
 * Cada operación devuelve un `SeatingChange` en la forma que consume
 * `apply_seating` (mesas nuevas «new:N» + asignaciones de invitados y
 * acompañantes): se aplica de una vez (todo o nada) y se deshace con el mismo
 * «Deshacer» que «Sentar automáticamente» (`previousAssignments`).
 *
 *  - swapTables: todos los de A pasan a B y los de B a A.
 *  - moveTable: todos los de A pasan a una mesa vacía.
 *  - mergeTables: los de A pasan a B si caben (A queda vacía, no se borra).
 *  - splitTable: reparte una mesa en dos por grupos (nunca parte un grupo).
 *  - moveGroup / moveGuest: un grupo entero o un invitado suelto a otra mesa.
 *
 * Capacidad: cuentan las personas que vienen (tableOccupancy). Ninguna
 * operación deja una mesa por encima de sus plazas: si no cabe, error y nada
 * cambia.
 */
import {
  MAX_TABLES, TABLE_SEATS_MAX, findGuestTable, companionTable, moveGuests, nextTableName, seatCompanions, seatsTaken, tableOccupancy,
  type SeatAssignment, type SeatGuest, type SeatTable, type SeatingPlan,
} from "@/lib/crm/seating";
import type { NewTableKey } from "@/lib/crm/auto-seating";

export interface SeatingChange {
  newTables: Array<{ key: NewTableKey; name: string; seats: number }>;
  /** tableId: mesa existente, clave «new:N» o null (sin mesa / con su invitado). */
  assignments: SeatAssignment[];
  /** Personas que cambian de mesa (las que vienen). */
  people: number;
  /** Frase para el aviso («Mesa 1 y Mesa 3 intercambiadas.»). */
  summary: string;
}

export type TableOpResult = { ok: true; change: SeatingChange } | { ok: false; error: string };

export const TABLE_OP_ERRORS = {
  same: "Elegid otra mesa.",
  missing: "Esa mesa ya no existe. Actualizad la página.",
  empty: "Esa mesa está vacía: no hay nadie que mover.",
  notEmpty: "La mesa de destino ya tiene gente. Elegid una vacía o usad «Fusionar con…».",
  oneUnit: "No se puede dividir: en esta mesa solo hay un grupo (y los grupos nunca se separan).",
  tooMany: `Podéis tener hasta ${MAX_TABLES} mesas.`,
  nobody: "No hay nadie de ese grupo para mover.",
  already: "Ya están en esa mesa.",
} as const;

const fullError = (name: string, people: number, seats: number) =>
  `No caben: serían ${people} ${people === 1 ? "persona" : "personas"} en ${name}, que tiene ${seats} ${seats === 1 ? "plaza" : "plazas"}. Añadid plazas o elegid otra mesa.`;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function tableOf(plan: SeatingPlan, id: string): SeatTable | null {
  return plan.tables.find((table) => table.id === id) ?? null;
}

const occupied = (table: SeatTable) => tableOccupancy(table).attending;
const isEmpty = (table: SeatTable) => table.guests.length === 0 && (table.visitors ?? []).length === 0;

/** Todos los de una mesa (invitados y acompañantes sentados aquí) a otra. */
function everyoneTo(table: SeatTable, target: string): SeatAssignment[] {
  return [
    ...table.guests.map((guest) => ({ guestId: guest.id, tableId: target })),
    ...(table.visitors ?? []).map((visitor) => ({ companionId: visitor.id, tableId: target })),
  ];
}

function sortAssignments(list: SeatAssignment[]): SeatAssignment[] {
  const key = (item: SeatAssignment) => ("guestId" in item ? `g:${item.guestId}` : `c:${item.companionId}`);
  return [...list].sort((a, b) => byText(key(a), key(b)));
}

// ---------------------------------------------------------------- operaciones

export function swapTables(plan: SeatingPlan, aId: string, bId: string): TableOpResult {
  if (aId === bId) return { ok: false, error: TABLE_OP_ERRORS.same };
  const a = tableOf(plan, aId), b = tableOf(plan, bId);
  if (!a || !b) return { ok: false, error: TABLE_OP_ERRORS.missing };
  if (isEmpty(a) && isEmpty(b)) return { ok: false, error: TABLE_OP_ERRORS.empty };
  const inA = occupied(a), inB = occupied(b);
  if (inA > b.seats) return { ok: false, error: fullError(b.name, inA, b.seats) };
  if (inB > a.seats) return { ok: false, error: fullError(a.name, inB, a.seats) };
  return {
    ok: true,
    change: { newTables: [], assignments: sortAssignments([...everyoneTo(a, b.id), ...everyoneTo(b, a.id)]), people: inA + inB, summary: `${a.name} y ${b.name}, intercambiadas.` },
  };
}

export function moveTable(plan: SeatingPlan, fromId: string, toId: string): TableOpResult {
  if (fromId === toId) return { ok: false, error: TABLE_OP_ERRORS.same };
  const from = tableOf(plan, fromId), to = tableOf(plan, toId);
  if (!from || !to) return { ok: false, error: TABLE_OP_ERRORS.missing };
  if (isEmpty(from)) return { ok: false, error: TABLE_OP_ERRORS.empty };
  if (!isEmpty(to)) return { ok: false, error: TABLE_OP_ERRORS.notEmpty };
  const people = occupied(from);
  if (people > to.seats) return { ok: false, error: fullError(to.name, people, to.seats) };
  return { ok: true, change: { newTables: [], assignments: sortAssignments(everyoneTo(from, to.id)), people, summary: `Los de ${from.name}, a ${to.name}.` } };
}

export function mergeTables(plan: SeatingPlan, fromId: string, intoId: string): TableOpResult {
  if (fromId === intoId) return { ok: false, error: TABLE_OP_ERRORS.same };
  const from = tableOf(plan, fromId), into = tableOf(plan, intoId);
  if (!from || !into) return { ok: false, error: TABLE_OP_ERRORS.missing };
  if (isEmpty(from)) return { ok: false, error: TABLE_OP_ERRORS.empty };
  const total = occupied(from) + occupied(into);
  if (total > into.seats) return { ok: false, error: fullError(into.name, total, into.seats) };
  return {
    ok: true,
    change: { newTables: [], assignments: sortAssignments(everyoneTo(from, into.id)), people: occupied(from), summary: `${from.name} fusionada con ${into.name} (${from.name} queda vacía).` },
  };
}

/** Unidad indivisible de una mesa: un grupo, un invitado sin grupo o un acompañante sentado aparte. */
interface Unit { id: string; people: number; weight: number; assignments: (target: string) => SeatAssignment[] }

function unitsOf(table: SeatTable): Unit[] {
  const groups = new Map<string, SeatGuest[]>();
  const units: Unit[] = [];
  for (const guest of table.guests) {
    if (guest.group_name) groups.set(guest.group_name, [...(groups.get(guest.group_name) ?? []), guest]);
    else units.push(guestUnit([guest], guest.id));
  }
  for (const [, members] of groups) units.push(guestUnit(members, [...members].sort((a, b) => byText(a.id, b.id))[0]!.id));
  for (const visitor of table.visitors ?? []) {
    const people = visitor.rsvp_status === "si" ? 1 : 0;
    units.push({ id: `c:${visitor.id}`, people, weight: Math.max(1, people), assignments: (target) => [{ companionId: visitor.id, tableId: target }] });
  }
  return units;
}

function guestUnit(members: SeatGuest[], id: string): Unit {
  const people = members.reduce((sum, guest) => sum + seatsTaken(guest), 0);
  // Para equilibrar, quien aún no ha respondido cuenta como 1 (ocupará sitio si viene).
  const weight = members.reduce((sum, guest) => sum + Math.max(1, seatsTaken(guest)), 0);
  return { id, people, weight, assignments: (target) => members.map((guest) => ({ guestId: guest.id, tableId: target })) };
}

/**
 * Divide una mesa en dos sin partir ningún grupo: reparto equilibrado (cada
 * unidad, de mayor a menor, al lado con menos gente). La mitad que se mueve
 * va a `targetId` (una mesa vacía) o, sin él, a una mesa nueva con las mismas
 * plazas.
 */
export function splitTable(plan: SeatingPlan, tableId: string, targetId?: string | null): TableOpResult {
  const table = tableOf(plan, tableId);
  if (!table) return { ok: false, error: TABLE_OP_ERRORS.missing };
  const units = unitsOf(table).sort((a, b) => b.weight - a.weight || byText(a.id, b.id));
  if (units.length < 2) return { ok: false, error: units.length === 0 ? TABLE_OP_ERRORS.empty : TABLE_OP_ERRORS.oneUnit };
  const stay: Unit[] = [], go: Unit[] = [];
  let stayWeight = 0, goWeight = 0;
  for (const unit of units) {
    if (goWeight < stayWeight) { go.push(unit); goWeight += unit.weight; } else { stay.push(unit); stayWeight += unit.weight; }
  }
  const people = go.reduce((sum, unit) => sum + unit.people, 0);
  let target: string;
  let targetName: string;
  const newTables: SeatingChange["newTables"] = [];
  if (targetId) {
    const other = tableOf(plan, targetId);
    if (!other) return { ok: false, error: TABLE_OP_ERRORS.missing };
    if (other.id === table.id) return { ok: false, error: TABLE_OP_ERRORS.same };
    if (!isEmpty(other)) return { ok: false, error: TABLE_OP_ERRORS.notEmpty };
    if (people > other.seats) return { ok: false, error: fullError(other.name, people, other.seats) };
    target = other.id; targetName = other.name;
  } else {
    if (plan.tables.length >= MAX_TABLES) return { ok: false, error: TABLE_OP_ERRORS.tooMany };
    targetName = nextTableName(plan.tables);
    newTables.push({ key: "new:1", name: targetName, seats: Math.min(TABLE_SEATS_MAX, Math.max(table.seats, people)) });
    target = "new:1";
  }
  return {
    ok: true,
    change: { newTables, assignments: sortAssignments(go.flatMap((unit) => unit.assignments(target))), people, summary: `${table.name} dividida: parte de la mesa pasa a ${targetName}.` },
  };
}

/** Un grupo entero (los que no vienen, no) a una mesa, esté donde esté cada uno. */
export function moveGroup(plan: SeatingPlan, group: string, toId: string): TableOpResult {
  const to = tableOf(plan, toId);
  if (!to) return { ok: false, error: TABLE_OP_ERRORS.missing };
  const members = [...plan.tables.flatMap((table) => table.guests), ...plan.unseated]
    .filter((guest) => guest.group_name === group && guest.rsvp_status !== "no");
  if (members.length === 0) return { ok: false, error: TABLE_OP_ERRORS.nobody };
  const moving = members.filter((guest) => findGuestTable(plan, guest.id) !== to.id);
  if (moving.length === 0) return { ok: false, error: TABLE_OP_ERRORS.already };
  const people = moving.reduce((sum, guest) => sum + seatsTaken(guest), 0);
  if (occupied(to) + people > to.seats) return { ok: false, error: fullError(to.name, occupied(to) + people, to.seats) };
  return {
    ok: true,
    change: { newTables: [], assignments: sortAssignments(moving.map((guest) => ({ guestId: guest.id, tableId: to.id }))), people, summary: `«${group}», a ${to.name}.` },
  };
}

/** Un invitado suelto (con sus acompañantes) a una mesa; null = sin mesa. */
export function moveGuest(plan: SeatingPlan, guestId: string, toId: string | null): TableOpResult {
  const guest = [...plan.tables.flatMap((table) => table.guests), ...plan.unseated].find((item) => item.id === guestId);
  if (!guest) return { ok: false, error: TABLE_OP_ERRORS.nobody };
  if (findGuestTable(plan, guestId) === toId) return { ok: false, error: TABLE_OP_ERRORS.already };
  const people = seatsTaken(guest);
  if (toId !== null) {
    const to = tableOf(plan, toId);
    if (!to) return { ok: false, error: TABLE_OP_ERRORS.missing };
    if (occupied(to) + people > to.seats) return { ok: false, error: fullError(to.name, occupied(to) + people, to.seats) };
    return { ok: true, change: { newTables: [], assignments: [{ guestId, tableId: to.id }], people, summary: `${guest.name}, a ${to.name}.` } };
  }
  return { ok: true, change: { newTables: [], assignments: [{ guestId, tableId: null }], people, summary: `${guest.name}, sin mesa.` } };
}

// ---------------------------------------------------------------- aplicar y deshacer

/** Dónde estaba cada uno antes del cambio: lo que hay que aplicar para deshacerlo. */
export function previousAssignments(plan: SeatingPlan, change: Pick<SeatingChange, "assignments">): SeatAssignment[] {
  return change.assignments.map((item) => ("guestId" in item
    ? { guestId: item.guestId, tableId: findGuestTable(plan, item.guestId) }
    : { companionId: item.companionId, tableId: companionTable(plan, item.companionId) }));
}

/** Mueve en local según una lista de asignaciones (mesas ya existentes o null). */
export function assignLocal(plan: SeatingPlan, assignments: readonly SeatAssignment[]): SeatingPlan {
  const byTable = new Map<string | null, string[]>();
  const companionMoves: Array<{ companionId: string; tableId: string | null }> = [];
  for (const item of assignments) {
    if ("companionId" in item) companionMoves.push(item);
    else byTable.set(item.tableId, [...(byTable.get(item.tableId) ?? []), item.guestId]);
  }
  let next = plan;
  for (const [tableId, ids] of byTable) next = moveGuests(next, ids, tableId);
  return seatCompanions(next, companionMoves);
}

/**
 * El plano tras aplicar un cambio, con los ids reales de las mesas creadas
 * (`created`: clave «new:N» → id). Las mesas nuevas van al final.
 */
export function applyChangeLocal(plan: SeatingPlan, change: Pick<SeatingChange, "newTables" | "assignments">, created: ReadonlyMap<string, string>): SeatingPlan {
  const lastPosition = plan.tables.at(-1)?.position ?? 0;
  const withTables: SeatingPlan = {
    ...plan,
    tables: [...plan.tables, ...change.newTables.flatMap((table, index) => {
      const id = created.get(table.key);
      return id ? [{ id, name: table.name, seats: table.seats, position: lastPosition + index + 1, guests: [] }] : [];
    })],
  };
  const resolved = change.assignments.flatMap((item): SeatAssignment[] => {
    if (item.tableId === null) return [item];
    const tableId = item.tableId.startsWith("new:") ? created.get(item.tableId) : item.tableId;
    if (!tableId) return [];
    return "guestId" in item ? [{ guestId: item.guestId, tableId }] : [{ companionId: item.companionId, tableId }];
  });
  return assignLocal(withTables, resolved);
}

// ---------------------------------------------------------------- mesas que se pasan

/**
 * Para la propuesta cuando una mesa supera sus plazas: a quién levantar de
 * cada mesa que se pasa para que quepa (grupos enteros o invitados sueltos;
 * nunca se parte un grupo). En cada mesa, la unidad más pequeña que basta
 * para dejarla en sus plazas; si ninguna basta, la más grande y se repite.
 * Determinista (desempate por id). «Sentar automáticamente» los vuelve a
 * colocar donde quepan.
 */
export function relieveOverfull(plan: SeatingPlan): string[] {
  const released: string[] = [];
  for (const table of plan.tables) {
    let excess = occupied(table) - table.seats;
    if (excess <= 0) continue;
    const units = unitsOf({ ...table, visitors: [] })
      .filter((unit) => unit.people > 0)
      .map((unit) => ({ unit, ids: unit.assignments("x").flatMap((item) => ("guestId" in item ? [item.guestId] : [])) }));
    while (excess > 0 && units.length > 0) {
      units.sort((a, b) => a.unit.people - b.unit.people || byText(a.unit.id, b.unit.id));
      const enough = units.find((item) => item.unit.people >= excess);
      const pick = enough ?? units[units.length - 1]!;
      units.splice(units.indexOf(pick), 1);
      released.push(...pick.ids);
      excess -= pick.unit.people;
    }
  }
  return released.sort(byText);
}
