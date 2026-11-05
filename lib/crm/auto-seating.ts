/**
 * Mesas automáticas (plan maestro 8-oct-2026, §3.4). Puro y sin base de datos:
 * propone un plano que la pareja revisa antes de aplicar (apply_seating,
 * 20261020110000).
 *
 * Reglas, por orden:
 *  1. Nunca separa un grupo (familia o pareja): cada grupo es una unidad.
 *  2. Junta a quien comparte etiqueta; sin etiquetas, por lado.
 *  3. Respeta las plazas de cada mesa.
 *  4. Con `keepCurrent`, no mueve a quien ya está sentado.
 *  5. Determinista: mismo input, mismo output (desempate final por id).
 *
 * Restricciones (§3.5, 20261023100000):
 *  - «No sentar con…» (`apart`): una mesa con uno de los dos no admite al
 *    otro. Si los dos son del mismo grupo, gana el grupo y se avisa
 *    (`conflicts`); lo mismo si la pareja ya los sentó juntos a mano.
 *  - Mesa fija para un grupo (`pinnedGroup` de la mesa): el grupo va allí
 *    antes que nadie si cabe; si no, se coloca como siempre y se avisa
 *    (`pinMissed`).
 *  - Mesa infantil (`kidsTable`): los acompañantes con nombre marcados como
 *    niño/a se sientan juntos en «Mesa infantil» (la que ya exista con ese
 *    nombre o una nueva) y dejan de ocupar sitio en la mesa de su familia.
 *    Los hermanos van juntos. Si no caben, se quedan con su familia.
 *
 * Decisiones (escritas también en la ayuda del panel):
 *  - Una unidad más grande que las mesas nuevas, pero de 30 o menos, recibe
 *    una mesa nueva a su medida. Más de 30 (la mesa más grande posible) va a
 *    `unplaced` como `group_too_big`: no se parte, decide la pareja.
 *  - Los pendientes, con `includePending`, ocupan 1 + acompañantes (mínimo 1).
 *  - Quien no viene nunca se mueve ni ocupa sitio.
 *  - El clúster «sin etiqueta» se coloca el último (rellena huecos).
 */
import { MAX_TABLES, TABLE_SEATS_MAX, nextTableName } from "@/lib/crm/seating";
import type { GuestSide } from "@/lib/crm/tags";

export const AUTO_SEAT_NO_TAG = "sin-etiqueta";
/** Clave interna de los niños en la mesa infantil (no es una etiqueta). */
const KIDS_KEY = "mesa-infantil";

/** Acompañante con nombre (wedding_guest_companions). tableId null = con su invitado. */
export interface AutoSeatCompanion {
  id: string;
  isKid: boolean;
  tableId: string | null;
}

export interface AutoSeatGuest {
  id: string;
  name: string;
  /** seatsTaken(g): 1 + acompañantes si «sí»; 0 si no. */
  seats: number;
  group: string | null;
  tags: string[];
  side: GuestSide | null;
  /** Asignación actual. */
  tableId: string | null;
  status: "si" | "pendiente" | "no";
  /** Acompañantes con nombre, en orden (opcional: sin la migración no llegan). */
  companions?: AutoSeatCompanion[];
}

export interface AutoSeatOptions {
  /** Por defecto false: solo confirmados. */
  includePending: boolean;
  /** Por defecto true: no mover a los ya sentados. */
  keepCurrent: boolean;
  /** Orden de etiquetas que elige la pareja (opcional). */
  tagPriority: string[];
  /** Plazas de las mesas que haya que crear (por defecto 10). */
  newTableSeats: number;
  /** Por defecto true. */
  allowNewTables: boolean;
  /** Mesa infantil: sentar juntos a los niños con nombre (por defecto false). */
  kidsTable?: boolean;
}

export const AUTO_SEAT_DEFAULTS: AutoSeatOptions = { includePending: false, keepCurrent: true, tagPriority: [], newTableSeats: 10, allowNewTables: true, kidsTable: false };

export const KIDS_TABLE_NAME = "Mesa infantil";

export interface AutoSeatInput {
  /** pinnedGroup: grupo con mesa fija (opcional). */
  tables: Array<{ id: string; name: string; seats: number; pinnedGroup?: string | null }>;
  guests: AutoSeatGuest[];
  options: AutoSeatOptions;
  /** Pares «no sentar con…» (ids de invitado). */
  apart?: ReadonlyArray<readonly [string, string]>;
}

export type NewTableKey = `new:${number}`;

export interface AutoSeatResult {
  /** Solo quien cambia de mesa. */
  assignments: Array<{ guestId: string; tableId: string | NewTableKey }>;
  /** Acompañantes que cambian de sitio (null = vuelven con su invitado). */
  companionAssignments: Array<{ companionId: string; tableId: string | NewTableKey | null }>;
  newTables: Array<{ key: NewTableKey; name: string; seats: number }>;
  unplaced: Array<{ guestId: string; reason: AutoSeatUnplacedReason }>;
  /** Todas las mesas tras la propuesta, en orden (las nuevas al final). */
  tables: Array<{ tableId: string; label: string; used: number; seats: number; mainTag: string | null; added: number; isNew: boolean; kids: boolean }>;
  /** Personas sentadas por la propuesta. */
  seatedPeople: number;
  /** Pares «no sentar con…» que quedan en la misma mesa (mismo grupo o sentados a mano). */
  conflicts: Array<{ a: string; b: string }>;
  /** Grupos con mesa fija que no cupieron en ella. */
  pinMissed: string[];
  /** Niños que no cupieron en la mesa infantil (se quedan con su familia). */
  kidsWithFamily: number;
}

export type AutoSeatUnplacedReason = "group_too_big" | "no_room" | "apart";

// ---------------------------------------------------------------- piezas

interface Unit {
  id: string;
  members: AutoSeatGuest[];
  seats: number;
  key: string;
  side: GuestSide | null;
  /** Mesa donde ya hay alguien de su grupo sentado (keepCurrent). */
  anchor: string | null;
}

interface TableState {
  id: string;
  label: string;
  seats: number;
  order: number;
  isNew: boolean;
  /** Mesa infantil (solo con la opción): los adultos no van aquí. */
  kids: boolean;
  pinned: string | null;
  /** Mesa presidencial: la de los novios; el reparto automático no la rellena (salvo grupo fijado). */
  reserved: boolean;
  /** Invitados sentados aquí (para «no sentar con…»). */
  members: Set<string>;
  used: number;
  added: number;
  keys: Map<string, number>;
  sides: Map<GuestSide, number>;
  units: Unit[];
  /** Cachés de la clave y el lado predominantes (undefined = por recalcular). */
  main?: string | null;
  mainSideCache?: GuestSide | null;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const lower = (value: string) => value.toLocaleLowerCase("es");

/** Plazas que ocupa una persona en la propuesta. */
function weight(guest: AutoSeatGuest, includePending: boolean): number {
  if (guest.status === "si") return Math.max(1, guest.seats);
  if (guest.status === "pendiente" && includePending) return Math.max(1, guest.seats);
  return 0;
}

function isCandidate(guest: AutoSeatGuest, includePending: boolean): boolean {
  return guest.status === "si" || (includePending && guest.status === "pendiente");
}

/** El más frecuente; desempate por prioridad de la pareja y después alfabético. */
function topOf<T extends string>(counts: Map<T, number>, priority: (value: T) => number): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (best === null || count > bestCount
      || (count === bestCount && (priority(value) - priority(best) || byText(lower(value), lower(best)) || byText(value, best)) < 0)) {
      best = value; bestCount = count;
    }
  }
  return best;
}

/** Clave de afinidad de una persona o unidad. */
function affinityKey(members: readonly AutoSeatGuest[], priority: (tag: string) => number): { key: string; side: GuestSide | null } {
  const tags = new Map<string, number>();
  const sides = new Map<GuestSide, number>();
  for (const member of members) {
    for (const tag of member.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (member.side) sides.set(member.side, (sides.get(member.side) ?? 0) + 1);
  }
  const side = topOf(sides, () => 0);
  const tag = topOf(tags, priority);
  if (tag) return { key: tag, side };
  if (side) return { key: `lado:${side}`, side };
  return { key: AUTO_SEAT_NO_TAG, side: null };
}

function addTo(table: TableState, unit: Pick<Unit, "seats" | "key" | "side">, people: number, added: boolean) {
  table.main = undefined; table.mainSideCache = undefined;
  table.used += people;
  if (added) table.added += people;
  table.keys.set(unit.key, (table.keys.get(unit.key) ?? 0) + people);
  if (unit.side) table.sides.set(unit.side, (table.sides.get(unit.side) ?? 0) + people);
}

function removeFrom(table: TableState, unit: Unit) {
  table.main = undefined; table.mainSideCache = undefined;
  table.used -= unit.seats;
  table.added -= unit.seats;
  table.keys.set(unit.key, (table.keys.get(unit.key) ?? 0) - unit.seats);
  if (unit.side) table.sides.set(unit.side, (table.sides.get(unit.side) ?? 0) - unit.seats);
  table.units = table.units.filter((item) => item !== unit);
  for (const member of unit.members) table.members.delete(member.id);
}

function mainKey(table: TableState): string | null {
  if (table.main === undefined) table.main = topOf(new Map([...table.keys].filter(([, n]) => n > 0)), () => 0);
  return table.main;
}

function mainSide(table: TableState): GuestSide | null {
  if (table.mainSideCache === undefined) table.mainSideCache = topOf(new Map([...table.sides].filter(([, n]) => n > 0)), () => 0);
  return table.mainSideCache;
}

const free = (table: TableState) => (table.reserved ? 0 : table.seats - table.used);

/** La que mejor encaja: menos sitio libre que baste; desempate por orden. Nunca la infantil (salvo `kids`). */
function bestFit(tables: readonly TableState[], seats: number, accept: (table: TableState) => boolean, kids = false): TableState | null {
  let best: TableState | null = null;
  for (const table of tables) {
    if (table.kids !== kids || free(table) < seats || !accept(table)) continue;
    if (!best || free(table) < free(best) || (free(table) === free(best) && table.order < best.order)) best = table;
  }
  return best;
}

/** «Presidencial» / «Mesa presidencial» (con o sin número): la mesa de los novios. */
export function isReservedTableName(name: string): boolean {
  return /(^|\s)presidencial(\s|$)/.test(name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("es"));
}

/** «Mesa infantil» (con o sin número, sin mayúsculas ni tildes). */
export function isKidsTableName(name: string): boolean {
  return /^mesa infantil(?: \d+)?$/.test(name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("es"));
}

/** «Mesa infantil», «Mesa infantil 2»… el primer nombre libre. */
export function nextKidsTableName(tables: readonly { name: string }[]): string {
  const used = new Set(tables.map((table) => table.name.toLocaleLowerCase("es")));
  if (!used.has(KIDS_TABLE_NAME.toLocaleLowerCase("es"))) return KIDS_TABLE_NAME;
  let n = 2;
  while (used.has(`${KIDS_TABLE_NAME.toLocaleLowerCase("es")} ${n}`)) n += 1;
  return `${KIDS_TABLE_NAME} ${n}`;
}

// ---------------------------------------------------------------- algoritmo

export function autoSeat(input: AutoSeatInput): AutoSeatResult {
  const options = { ...AUTO_SEAT_DEFAULTS, ...input.options };
  const kidsOn = Boolean(options.kidsTable);
  const newSeats = Math.min(TABLE_SEATS_MAX, Math.max(1, Math.trunc(options.newTableSeats) || AUTO_SEAT_DEFAULTS.newTableSeats));
  const priorityIndex = new Map(options.tagPriority.map((tag, index) => [lower(tag), index]));
  const priority = (tag: string) => priorityIndex.get(lower(tag)) ?? Number.MAX_SAFE_INTEGER;

  const tables: TableState[] = input.tables.map((table, order) => ({
    id: table.id, label: table.name, seats: table.seats, order, isNew: false,
    // Una mesa llamada «Mesa infantil» nunca recibe adultos, aunque la opción esté apagada.
    kids: isKidsTableName(table.name), pinned: table.pinnedGroup?.trim() || null,
    // La presidencial es de los novios: solo recibe un grupo si la pareja la ha fijado para él.
    reserved: isReservedTableName(table.name) && !table.pinnedGroup?.trim(), members: new Set(),
    used: 0, added: 0, keys: new Map(), sides: new Map(), units: [],
  }));
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const guests = [...input.guests].sort((a, b) => byText(a.id, b.id));

  // «No sentar con…»: vecinos prohibidos de cada invitado.
  const apart = new Map<string, Set<string>>();
  for (const [a, b] of input.apart ?? []) {
    if (a === b) continue;
    apart.set(a, (apart.get(a) ?? new Set<string>()).add(b));
    apart.set(b, (apart.get(b) ?? new Set<string>()).add(a));
  }
  const clashes = (table: TableState, members: readonly AutoSeatGuest[]) => {
    if (apart.size === 0) return false;
    for (const member of members) {
      const avoid = apart.get(member.id);
      if (avoid) for (const other of avoid) if (table.members.has(other)) return true;
    }
    return false;
  };

  // 0. Acompañantes con nombre de quien ocupa sitio: fijos donde ya están
  //    (keepCurrent), a la cola de la mesa infantil o con su familia.
  const away = new Map<string, number>();
  const companionTarget = new Map<string, { companion: AutoSeatCompanion; tableId: string | null }>();
  const fixedAway: Array<{ guest: AutoSeatGuest; table: TableState }> = [];
  const kidQueue = new Map<string, { guest: AutoSeatGuest; kids: AutoSeatCompanion[] }>();
  for (const guest of guests) {
    if (weight(guest, options.includePending) === 0 || !guest.companions?.length) continue;
    const named = guest.companions.slice(0, Math.max(0, guest.seats - 1));
    for (const companion of named) {
      const current = companion.tableId ? tableById.get(companion.tableId) ?? null : null;
      if (current && options.keepCurrent) {
        fixedAway.push({ guest, table: current });
        away.set(guest.id, (away.get(guest.id) ?? 0) + 1);
        companionTarget.set(companion.id, { companion, tableId: current.id });
      } else if (kidsOn && companion.isKid) {
        const entry = kidQueue.get(guest.id) ?? { guest, kids: [] };
        entry.kids.push(companion);
        kidQueue.set(guest.id, entry);
        away.set(guest.id, (away.get(guest.id) ?? 0) + 1);
      } else {
        companionTarget.set(companion.id, { companion, tableId: null });
      }
    }
  }
  /** Plazas que ocupa el invitado en la mesa de su familia (sin quien se sienta aparte). */
  const home = (guest: AutoSeatGuest) => {
    const people = weight(guest, options.includePending);
    return people === 0 ? 0 : Math.max(1, people - (away.get(guest.id) ?? 0));
  };

  // 1. Candidatos. Fijos: con keepCurrent, cualquiera ya sentado en una mesa
  //    que existe (ocupa su sitio). Sin keepCurrent, solo quedan fijos quienes
  //    no son candidatos (no vienen o pendientes sin incluir): no se tocan.
  const movable: AutoSeatGuest[] = [];
  const groupAnchors = new Map<string, Map<string, number>>();
  const fixedAt = new Map<string, TableState>();
  for (const guest of guests) {
    const seatedAt = guest.tableId ? tableById.get(guest.tableId) ?? null : null;
    const candidate = isCandidate(guest, options.includePending);
    const fixed = seatedAt !== null && (options.keepCurrent || !candidate);
    if (fixed && seatedAt) {
      const people = home(guest);
      addTo(seatedAt, { seats: people, ...affinityKey([guest], priority) }, people, false);
      seatedAt.members.add(guest.id);
      fixedAt.set(guest.id, seatedAt);
      if (guest.group && people > 0) {
        const anchors = groupAnchors.get(guest.group) ?? new Map<string, number>();
        anchors.set(seatedAt.id, (anchors.get(seatedAt.id) ?? 0) + 1);
        groupAnchors.set(guest.group, anchors);
      }
      continue;
    }
    if (candidate) movable.push(guest);
  }
  for (const { guest, table } of fixedAway) addTo(table, { seats: 1, ...affinityKey([guest], priority) }, 1, false);

  const unplaced: AutoSeatResult["unplaced"] = [];
  const newTables: TableState[] = [];
  const createTable = (seats: number, kids = false): TableState | null => {
    if (!options.allowNewTables || tables.length >= MAX_TABLES) return null;
    const names = tables.map((table) => ({ name: table.label }));
    const table: TableState = {
      id: `new:${newTables.length + 1}`, label: kids ? nextKidsTableName(names) : nextTableName(names),
      seats, order: tables.length, isNew: true, kids, pinned: null, reserved: false, members: new Set(),
      used: 0, added: 0, keys: new Map(), sides: new Map(), units: [],
    };
    tables.push(table);
    newTables.push(table);
    return table;
  };

  // Mesa infantil: los hermanos juntos, por grupo de la familia y por id.
  let kidsPlaced = 0;
  let kidsWithFamily = 0;
  const kidUnits = [...kidQueue.values()].sort((a, b) =>
    Number(a.guest.group === null) - Number(b.guest.group === null)
    || byText(a.guest.group ?? "", b.guest.group ?? "") || byText(a.guest.id, b.guest.id));
  for (const { guest, kids } of kidUnits) {
    const size = kids.length;
    const target = bestFit(tables, size, () => true, true)
      ?? (size <= TABLE_SEATS_MAX ? createTable(Math.max(newSeats, size), true) : null);
    if (target) {
      addTo(target, { seats: size, key: KIDS_KEY, side: null }, size, true);
      kidsPlaced += size;
      for (const kid of kids) companionTarget.set(kid.id, { companion: kid, tableId: target.id });
    } else {
      // No caben: se quedan con su familia (vuelven a ocupar allí).
      kidsWithFamily += size;
      away.set(guest.id, (away.get(guest.id) ?? 0) - size);
      const host = fixedAt.get(guest.id);
      if (host) addTo(host, { seats: size, ...affinityKey([guest], priority) }, size, false);
      for (const kid of kids) companionTarget.set(kid.id, { companion: kid, tableId: null });
    }
  }

  // 2. Unidades: un grupo entero o una persona sin grupo.
  const byGroup = new Map<string, AutoSeatGuest[]>();
  const units: Unit[] = [];
  for (const guest of movable) {
    if (guest.group) {
      const list = byGroup.get(guest.group) ?? [];
      list.push(guest);
      byGroup.set(guest.group, list);
    } else {
      units.push({ id: guest.id, members: [guest], seats: home(guest), anchor: null, ...affinityKey([guest], priority) });
    }
  }
  for (const [group, members] of byGroup) {
    const anchors = groupAnchors.get(group);
    // Si el grupo ya tiene a alguien sentado: la mesa con más de los suyos (desempate por id).
    const anchor = anchors ? [...anchors].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0][0] : null;
    units.push({
      id: members[0].id, members, anchor,
      seats: members.reduce((sum, member) => sum + home(member), 0),
      ...affinityKey(members, priority),
    });
  }

  const place = (unit: Unit, table: TableState) => {
    addTo(table, unit, unit.seats, true);
    table.units.push(unit);
    for (const member of unit.members) table.members.add(member.id);
  };

  // Primero, los grupos con mesa fija; después, los que ya tienen a alguien
  // sentado: a esa mesa si caben (y sin «no sentar con…»).
  const pinnedTable = new Map<string, TableState>();
  for (const table of tables) if (table.pinned && !table.kids && !pinnedTable.has(lower(table.pinned))) pinnedTable.set(lower(table.pinned), table);
  const pinMissed = new Set<string>();
  const pending: Unit[] = [];
  for (const unit of units.sort((a, b) => byText(a.id, b.id))) {
    const group = unit.members[0].group;
    const pin = group ? pinnedTable.get(lower(group)) : undefined;
    if (group && pin) {
      if (free(pin) >= unit.seats && !clashes(pin, unit.members)) { place(unit, pin); continue; }
      pinMissed.add(group);
    }
    const anchor = unit.anchor ? tableById.get(unit.anchor) : undefined;
    if (anchor && !anchor.kids && free(anchor) >= unit.seats && !clashes(anchor, unit.members)) place(unit, anchor);
    else pending.push(unit);
  }

  // 3–4. Clústeres por clave; de mayor a menor (el «sin etiqueta», al final) y,
  //      dentro, unidades de mayor a menor (first-fit decreasing).
  const clusters = new Map<string, Unit[]>();
  for (const unit of pending) {
    const list = clusters.get(unit.key) ?? [];
    list.push(unit);
    clusters.set(unit.key, list);
  }
  const ordered = [...clusters].map(([key, list]) => ({
    key,
    seats: list.reduce((sum, unit) => sum + unit.seats, 0),
    units: list.sort((a, b) => b.seats - a.seats || byText(a.id, b.id)),
  })).sort((a, b) => Number(a.key === AUTO_SEAT_NO_TAG) - Number(b.key === AUTO_SEAT_NO_TAG)
    || b.seats - a.seats || priority(a.key) - priority(b.key) || byText(a.key, b.key));

  // 5. Colocación.
  for (const cluster of ordered) {
    for (const unit of cluster.units) {
      if (unit.seats > TABLE_SEATS_MAX) {
        for (const member of unit.members) unplaced.push({ guestId: member.id, reason: "group_too_big" });
        continue;
      }
      const ok = (table: TableState) => !clashes(table, unit.members);
      const target =
        // 5.1 Mesas donde ya predomina esta clave.
        bestFit(tables, unit.seats, (table) => mainKey(table) === unit.key && ok(table))
        // 5.2 Mesas vacías, la menor que baste.
        ?? bestFit(tables, unit.seats, (table) => table.used === 0 && table.units.length === 0 && ok(table))
        // 5.3 Cualquiera con sitio, mejor del mismo lado.
        ?? (unit.side ? bestFit(tables, unit.seats, (table) => table.used > 0 && mainSide(table) === unit.side && ok(table)) : null)
        ?? bestFit(tables, unit.seats, ok)
        // 5.4 Una mesa nueva (a su medida si es más grande que las nuevas).
        ?? createTable(Math.max(newSeats, unit.seats));
      if (target) place(unit, target);
      else {
        // ¿Había sitio y lo impidió «no sentar con…»?
        const reason = apart.size > 0 && bestFit(tables, unit.seats, () => true) ? "apart" : "no_room";
        for (const member of unit.members) unplaced.push({ guestId: member.id, reason });
      }
    }
  }

  // 6. Equilibrio: una mesa con 1–2 personas solo de esta propuesta se junta
  //    con otra de la misma clave que tenga sitio (nunca la infantil ni una mesa fija).
  for (const table of [...tables].sort((a, b) => a.order - b.order)) {
    if (table.kids || table.pinned || table.used < 1 || table.used > 2 || table.added !== table.used) continue;
    const key = mainKey(table);
    const moving = table.units.flatMap((unit) => unit.members);
    const into = bestFit(tables, table.used, (other) => other !== table && other.used > 0 && mainKey(other) === key && !clashes(other, moving));
    if (!into) continue;
    for (const unit of [...table.units]) { removeFrom(table, unit); place(unit, into); }
  }

  // Mesas nuevas que se han quedado vacías: fuera, y se renumeran las claves.
  const keptNew = newTables.filter((table) => table.used > 0 || table.units.length > 0);
  const rename = new Map<string, NewTableKey>();
  keptNew.forEach((table, index) => rename.set(table.id, `new:${index + 1}`));
  const finalTables = tables.filter((table) => !table.isNew || rename.has(table.id));
  // Los nombres se recalculan en orden para que no queden huecos («Mesa 4, Mesa 6»).
  const existingNames = finalTables.filter((table) => !table.isNew).map((table) => ({ name: table.label }));
  for (const table of keptNew) {
    table.label = table.kids ? nextKidsTableName(existingNames) : nextTableName(existingNames);
    existingNames.push({ name: table.label });
  }
  const finalId = (table: TableState) => (table.isNew ? rename.get(table.id)! : table.id);

  const assignments: AutoSeatResult["assignments"] = [];
  const seatOf = new Map<string, string>();
  for (const [guestId, table] of fixedAt) seatOf.set(guestId, table.id);
  let seatedPeople = kidsPlaced;
  for (const table of finalTables) {
    const tableId = finalId(table);
    for (const unit of table.units) {
      for (const member of unit.members) {
        seatOf.set(member.id, tableId);
        if (member.tableId === tableId) continue;
        assignments.push({ guestId: member.id, tableId });
      }
      seatedPeople += unit.seats;
    }
  }
  assignments.sort((a, b) => byText(a.guestId, b.guestId));

  const companionAssignments: AutoSeatResult["companionAssignments"] = [];
  for (const { companion, tableId } of companionTarget.values()) {
    const target = tableId && tableId.startsWith("new:") ? rename.get(tableId) ?? null : tableId;
    if ((companion.tableId ?? null) === target) continue;
    companionAssignments.push({ companionId: companion.id, tableId: target });
  }
  companionAssignments.sort((a, b) => byText(a.companionId, b.companionId));

  // Pares que, aun así, comparten mesa (mismo grupo o sentados a mano).
  const conflicts: AutoSeatResult["conflicts"] = [];
  for (const [a, others] of apart) {
    for (const b of others) {
      if (a < b && seatOf.has(a) && seatOf.get(a) === seatOf.get(b)) conflicts.push({ a, b });
    }
  }
  conflicts.sort((x, y) => byText(x.a, y.a) || byText(x.b, y.b));

  return {
    assignments,
    companionAssignments,
    newTables: keptNew.map((table) => ({ key: rename.get(table.id)!, name: table.label, seats: table.seats })),
    unplaced: unplaced.sort((a, b) => byText(a.guestId, b.guestId)),
    tables: finalTables.map((table) => {
      const key = mainKey(table);
      return {
        tableId: finalId(table),
        label: table.label, used: table.used, seats: table.seats, added: table.added, isNew: table.isNew, kids: table.kids,
        mainTag: key && key !== AUTO_SEAT_NO_TAG && key !== KIDS_KEY && !key.startsWith("lado:") ? key : null,
      };
    }),
    seatedPeople,
    conflicts,
    pinMissed: [...pinMissed].sort(byText),
    kidsWithFamily,
  };
}

/** ¿Hay algo con lo que agrupar además de los grupos? (aviso «Sin etiquetas…»). */
export function hasAffinityData(guests: readonly Pick<AutoSeatGuest, "tags" | "side">[]): boolean {
  return guests.some((guest) => guest.tags.length > 0 || guest.side !== null);
}
