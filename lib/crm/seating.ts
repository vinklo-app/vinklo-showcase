/**
 * Plan de mesas (2026-10-06). Puro (cliente y servidor): tipos, lectura del
 * jsonb de `wedding_seating` (20261013100000), ocupación, operaciones locales
 * (para el estado optimista y el borrador) y el CSV para el catering.
 *
 * Reglas:
 *  - Ocupan sitio las personas que VIENEN: invitado + acompañantes de los «si».
 *    Los pendientes se muestran aparte («+2 sin responder»); los que no vienen
 *    no ocupan aunque sigan sentados.
 *  - Superar las plazas se permite (la pareja decide) y se avisa.
 *  - «Sin mesa» prioriza a quien viene, luego a quien no ha respondido.
 */
import { z } from "zod";
import { csvCell } from "@/lib/messages/guest-csv";
import { GUEST_SIDES, type GuestSide } from "@/lib/crm/tags";

export const TABLE_NAME_MAX = 40;
export const TABLE_SEATS_MIN = 1;
export const TABLE_SEATS_MAX = 30;
export const TABLE_SEATS_DEFAULT = 10;
/** Tope de mesas por boda (una boda de 500 personas a 10 por mesa son 50). */
export const MAX_TABLES = 120;
/** Tope de invitados movidos en una sola escritura. */
export const MAX_SEAT_MOVE = 500;
/** Tope de asignaciones de «Sentar automáticamente» en una sola escritura (apply_seating). */
export const MAX_AUTO_ASSIGNMENTS = 2000;

export type SeatRsvp = "si" | "pendiente" | "no";

export interface SeatGuest {
  id: string;
  name: string;
  rsvp_status: SeatRsvp;
  companions: number;
  /** Alergias o notas que dejó al confirmar (rsvp_notes). */
  notes: string | null;
  group_name: string | null;
  /** Etiquetas, lado y niños (20261020100000). Opcionales: sin la migración no llegan. */
  tags?: string[];
  side?: GuestSide | null;
  /** Niños dentro de sus acompañantes (con nombres, los marcados; si no, rsvp_answers.kids). */
  kids?: number;
  /** Acompañantes con nombre (20261023110000). Opcional: sin la migración no llegan. */
  companion_list?: SeatCompanion[];
}

/** Acompañante con nombre. table_id null = se sienta con su invitado. */
export interface SeatCompanion {
  id: string;
  name: string;
  is_kid: boolean;
  table_id: string | null;
}

/** Acompañante sentado en una mesa distinta de la de su invitado (la mesa infantil). */
export interface SeatVisitor extends SeatCompanion {
  guestId: string;
  guestName: string;
  rsvp_status: SeatRsvp;
  group_name: string | null;
}

export interface SeatTable {
  id: string;
  name: string;
  seats: number;
  position: number;
  guests: SeatGuest[];
  /** Grupo con mesa fija (20261023100000). */
  pinned_group?: string | null;
  /** Acompañantes de otros invitados sentados aquí (derivado de companion_list: withVisitors). */
  visitors?: SeatVisitor[];
  /** Forma y centro en el plano del salón, 0–1 (20261028100000). Opcionales: sin la migración no llegan. */
  shape?: TableShape | null;
  pos_x?: number | null;
  pos_y?: number | null;
}

/** Formas de mesa del plano del salón (CHECK de 20261028100000). */
export const TABLE_SHAPES = ["redonda", "rectangular", "cuadrada", "imperial", "otra"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];
export const TABLE_SHAPE_LABELS: Record<TableShape, string> = {
  redonda: "Redonda", rectangular: "Rectangular", cuadrada: "Cuadrada", imperial: "Imperial", otra: "Otra",
};

/** Invitado o acompañante (mesa infantil) a una mesa; null = sin mesa / con su invitado. Forma de apply_seating. */
export type SeatAssignment = { guestId: string; tableId: string | null } | { companionId: string; tableId: string | null };

/** Forma y posición de cada mesa (lectura aparte de wedding_tables; sin la migración, vacío). */
export interface TableLayout { id: string; shape: TableShape | null; pos_x: number | null; pos_y: number | null }

/** Añade la forma y la posición a las mesas del plano (las que no vienen, sin tocar). */
export function withLayout(plan: SeatingPlan, layout: readonly TableLayout[]): SeatingPlan {
  if (layout.length === 0) return plan;
  const byId = new Map(layout.map((item) => [item.id, item]));
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      const item = byId.get(table.id);
      return item ? { ...table, shape: item.shape, pos_x: item.pos_x, pos_y: item.pos_y } : table;
    }),
  };
}

/** ¿Alguna mesa tiene posición en el plano? */
export function hasLayout(plan: Pick<SeatingPlan, "tables">): boolean {
  return plan.tables.some((table) => typeof table.pos_x === "number" && typeof table.pos_y === "number");
}

export interface SeatingPlan {
  tables: SeatTable[];
  unseated: SeatGuest[];
  /**
   * Pares «no sentar con…». undefined = la base aún no tiene la migración
   * 20261023110000 (sin nombres, mesa infantil ni restricciones en el panel).
   */
  apart?: Array<[string, string]>;
}

const guestSchema = z.object({
  id: z.string(),
  name: z.string(),
  rsvp_status: z.enum(["si", "pendiente", "no"]),
  companions: z.number().int().min(0).catch(0),
  notes: z.string().nullable().catch(null),
  group_name: z.string().nullable().catch(null),
  tags: z.array(z.string()).catch([]).default([]),
  side: z.enum(GUEST_SIDES).nullable().catch(null).default(null),
  kids: z.number().int().min(0).catch(0).default(0),
  companion_list: z.array(z.object({
    id: z.string(),
    name: z.string(),
    is_kid: z.boolean().catch(false),
    table_id: z.string().nullable().catch(null),
  })).catch([]).default([]),
});
const planSchema = z.object({
  tables: z.array(z.object({
    id: z.string(),
    name: z.string(),
    seats: z.number().int(),
    position: z.number().int(),
    pinned_group: z.string().nullable().catch(null).default(null),
    guests: z.array(guestSchema),
  })),
  unseated: z.array(guestSchema),
  apart: z.array(z.tuple([z.string(), z.string()])).optional().catch(undefined),
});

/** jsonb de `wedding_seating` → plan; null si no encaja. Ignora los agregados del SQL: se recalculan aquí. */
export function parseSeatingPlan(value: unknown): SeatingPlan | null {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) return null;
  return withVisitors({
    tables: parsed.data.tables.map((table) => ({ ...table, guests: sortGuests(table.guests) })),
    unseated: sortGuests(parsed.data.unseated),
    ...(parsed.data.apart ? { apart: parsed.data.apart } : {}),
  });
}

/** ¿La base ya tiene nombres de acompañantes y restricciones (20261023110000)? */
export function hasSeatingRules(plan: Pick<SeatingPlan, "apart">): boolean {
  return Array.isArray(plan.apart);
}

/**
 * Recalcula los acompañantes sentados aparte de cada mesa (los que tienen
 * table_id de una mesa que existe). Con table_id de una mesa que ya no está,
 * cuentan con su invitado.
 */
export function withVisitors(plan: SeatingPlan): SeatingPlan {
  const ids = new Set(plan.tables.map((table) => table.id));
  const byTable = new Map<string, SeatVisitor[]>();
  for (const guest of [...plan.tables.flatMap((table) => table.guests), ...plan.unseated]) {
    for (const companion of activeCompanions(guest)) {
      if (!companion.table_id || !ids.has(companion.table_id)) continue;
      const list = byTable.get(companion.table_id) ?? [];
      list.push({ ...companion, guestId: guest.id, guestName: guest.name, rsvp_status: guest.rsvp_status, group_name: guest.group_name });
      byTable.set(companion.table_id, list);
    }
  }
  return {
    ...plan,
    tables: plan.tables.map((table) => ({
      ...table,
      visitors: (byTable.get(table.id) ?? []).sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1)),
    })),
  };
}

// ---------------------------------------------------------------- ocupación

/**
 * Solo los primeros nombres cubiertos por el recuento actual participan en
 * mesas y catering, igual que en «Sentar automáticamente». La lista original
 * se conserva: reducir el número no identifica a quién se ha retirado.
 */
export function activeCompanions(guest: Pick<SeatGuest, "companions" | "companion_list">): SeatCompanion[] {
  return (guest.companion_list ?? []).slice(0, Math.max(0, guest.companions));
}

/** Acompañantes actuales de este invitado sentados en otra mesa. */
export function companionsAway(guest: Pick<SeatGuest, "companions" | "companion_list">): number {
  return activeCompanions(guest).filter((companion) => companion.table_id !== null).length;
}

/**
 * Personas que ocupan sitio por este invitado EN SU MESA: él + acompañantes
 * si viene (sin los que se sientan aparte, p. ej. en la mesa infantil); 0 si no.
 */
export function seatsTaken(guest: Pick<SeatGuest, "rsvp_status" | "companions" | "companion_list">): number {
  return guest.rsvp_status === "si" ? 1 + guest.companions - companionsAway(guest) : 0;
}

/** Personas que vienen por esta invitación, estén donde estén: él + acompañantes. */
export function partySize(guest: Pick<SeatGuest, "rsvp_status" | "companions">): number {
  return guest.rsvp_status === "si" ? 1 + guest.companions : 0;
}

/** Acompañantes con nombre que se sientan con su invitado. */
export function companionsAtHome(guest: Pick<SeatGuest, "companions" | "companion_list">): SeatCompanion[] {
  return activeCompanions(guest).filter((companion) => companion.table_id === null);
}

/** «Pablo (niño/a)». */
export function companionLabel(companion: Pick<SeatCompanion, "name" | "is_kid">): string {
  return companion.is_kid ? `${companion.name} (niño/a)` : companion.name;
}

export interface TableOccupancy {
  /** Personas que vienen sentadas aquí. */
  attending: number;
  /** Invitados sentados sin respuesta. */
  pending: number;
  /** Invitados sentados que no vienen. */
  declined: number;
  seats: number;
  /** Plazas libres (negativo = se pasa). */
  free: number;
  over: boolean;
  /** 0–1 para la barra (tope 1). */
  ratio: number;
}

export function tableOccupancy(table: Pick<SeatTable, "seats" | "guests" | "visitors">): TableOccupancy {
  let attending = 0, pending = 0, declined = 0;
  for (const guest of table.guests) {
    attending += seatsTaken(guest);
    if (guest.rsvp_status === "pendiente") pending += 1;
    if (guest.rsvp_status === "no") declined += 1;
  }
  // Acompañantes de otras mesas sentados aquí: ocupan si su invitado viene.
  for (const visitor of table.visitors ?? []) if (visitor.rsvp_status === "si") attending += 1;
  const free = table.seats - attending;
  return { attending, pending, declined, seats: table.seats, free, over: free < 0, ratio: table.seats > 0 ? Math.min(attending / table.seats, 1) : 0 };
}

/** Personas que vienen y aún no tienen mesa. */
export function unseatedAttending(plan: Pick<SeatingPlan, "unseated">): number {
  return plan.unseated.reduce((sum, guest) => sum + seatsTaken(guest), 0);
}

export function seatedAttending(plan: Pick<SeatingPlan, "tables">): number {
  return plan.tables.reduce((sum, table) => sum + tableOccupancy(table).attending, 0);
}

// ---------------------------------------------------------------- orden y filtros

const RANK: Record<SeatRsvp, number> = { si: 0, pendiente: 1, no: 2 };
const collator = new Intl.Collator("es", { sensitivity: "base" });

/** Viene → pendiente → no viene; luego grupo (sin grupo al final) y nombre. */
export function sortGuests<T extends Pick<SeatGuest, "rsvp_status" | "group_name" | "name">>(guests: readonly T[]): T[] {
  return [...guests].sort((a, b) =>
    RANK[a.rsvp_status] - RANK[b.rsvp_status]
    || Number(a.group_name === null) - Number(b.group_name === null)
    || collator.compare(a.group_name ?? "", b.group_name ?? "")
    || collator.compare(a.name, b.name));
}

/** Grupos presentes entre los invitados sin mesa (los que no vienen no cuentan), con cuántos quedan por sentar. */
export function unseatedGroups(plan: Pick<SeatingPlan, "unseated">): { name: string; guests: number; people: number }[] {
  const map = new Map<string, { guests: number; people: number }>();
  for (const guest of plan.unseated) {
    if (!guest.group_name || guest.rsvp_status === "no") continue;
    const entry = map.get(guest.group_name) ?? { guests: 0, people: 0 };
    entry.guests += 1;
    entry.people += Math.max(seatsTaken(guest), 1);
    map.set(guest.group_name, entry);
  }
  return [...map.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => collator.compare(a.name, b.name));
}

/** Filtro de la bandeja «Sin mesa»: todos, un grupo o sin grupo. Por defecto oculta a quien no viene. */
export type TrayFilter = { group: string | null | "all"; showDeclined: boolean };

export function filterUnseated(guests: readonly SeatGuest[], filter: TrayFilter): SeatGuest[] {
  return guests.filter((guest) =>
    (filter.showDeclined || guest.rsvp_status !== "no")
    && (filter.group === "all" || guest.group_name === filter.group));
}

/** Ids de un grupo que quedan por sentar (sin los que no vienen): «Sentar a un grupo entero». */
export function groupToSeat(plan: Pick<SeatingPlan, "unseated">, group: string): string[] {
  return plan.unseated.filter((guest) => guest.group_name === group && guest.rsvp_status !== "no").map((guest) => guest.id);
}

// ---------------------------------------------------------------- operaciones locales

/** Mueve invitados a una mesa (o a «sin mesa» con null). Ids desconocidos se ignoran. */
export function moveGuests(plan: SeatingPlan, ids: readonly string[], tableId: string | null): SeatingPlan {
  const wanted = new Set(ids);
  const moving: SeatGuest[] = [];
  const take = (guests: SeatGuest[]) => guests.filter((guest) => (wanted.has(guest.id) ? (moving.push(guest), false) : true));
  const tables = plan.tables.map((table) => ({ ...table, guests: take(table.guests) }));
  const unseated = take(plan.unseated);
  if (tableId === null) return { ...plan, tables, unseated: sortGuests([...unseated, ...moving]) };
  if (!tables.some((table) => table.id === tableId)) return plan;
  return { ...plan, tables: tables.map((table) => (table.id === tableId ? { ...table, guests: sortGuests([...table.guests, ...moving]) } : table)), unseated };
}

/**
 * Quita la mesa: sus invitados vuelven a «Sin mesa» y los acompañantes
 * sentados en ella, con su invitado (como on delete set null).
 */
export function removeTable(plan: SeatingPlan, tableId: string): SeatingPlan {
  const table = plan.tables.find((item) => item.id === tableId);
  if (!table) return plan;
  const next = { ...plan, tables: plan.tables.filter((item) => item.id !== tableId), unseated: sortGuests([...plan.unseated, ...table.guests]) };
  const back = (table.visitors ?? []).map((visitor) => ({ companionId: visitor.id, tableId: null }));
  return back.length > 0 ? seatCompanions(next, back) : withVisitors(next);
}

/** Sienta acompañantes aparte (tableId) o de vuelta con su invitado (null). Ids desconocidos se ignoran. */
export function seatCompanions(plan: SeatingPlan, assignments: ReadonlyArray<{ companionId: string; tableId: string | null }>): SeatingPlan {
  if (assignments.length === 0) return plan;
  const target = new Map(assignments.map((item) => [item.companionId, item.tableId]));
  const update = (guest: SeatGuest): SeatGuest => {
    if (!guest.companion_list?.some((companion) => target.has(companion.id))) return guest;
    return { ...guest, companion_list: guest.companion_list.map((companion) => (target.has(companion.id) ? { ...companion, table_id: target.get(companion.id) ?? null } : companion)) };
  };
  return withVisitors({
    ...plan,
    tables: plan.tables.map((table) => ({ ...table, guests: table.guests.map(update) })),
    unseated: plan.unseated.map(update),
  });
}

/** Mesa donde se sienta aparte un acompañante (null = con su invitado). */
export function companionTable(plan: SeatingPlan, companionId: string): string | null {
  for (const table of plan.tables) if (table.visitors?.some((visitor) => visitor.id === companionId)) return table.id;
  return null;
}

export function findGuestTable(plan: SeatingPlan, guestId: string): string | null {
  return plan.tables.find((table) => table.guests.some((guest) => guest.id === guestId))?.id ?? null;
}

/** «Mesa 1», «Mesa 2»… el primer número libre. */
export function nextTableName(tables: readonly Pick<SeatTable, "name">[]): string {
  const used = new Set(tables.map((table) => table.name.toLocaleLowerCase("es")));
  let n = 1;
  while (used.has(`mesa ${n}`)) n += 1;
  return `Mesa ${n}`;
}

/** «  Mesa   de los primos » → «Mesa de los primos»; vacío → null. */
export function normalizeTableName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean;
}

/**
 * Etiqueta principal de una mesa: la que más personas comparten (las que
 * vienen; si nadie viene aún, los sentados). Desempate alfabético. null = sin etiquetas.
 */
export function tableMainTag(table: Pick<SeatTable, "guests">): string | null {
  const counts = new Map<string, number>();
  for (const guest of table.guests) {
    if (guest.rsvp_status === "no") continue;
    const weight = Math.max(seatsTaken(guest), 1);
    for (const tag of guest.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + weight);
  }
  let best: string | null = null;
  for (const [tag, count] of counts) {
    const top = best === null ? -1 : counts.get(best)!;
    if (count > top || (count === top && collator.compare(tag, best!) < 0)) best = tag;
  }
  return best;
}

// ---------------------------------------------------------------- buscar y avisos

/** «José Ángel» → «jose angel»: sin tildes ni mayúsculas, espacios colapsados. */
export function searchKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

/** Una persona encontrada con «¿Dónde está…?». tableId null = sin mesa. */
export interface FoundPerson {
  /** Id del invitado o del acompañante. */
  id: string;
  kind: "guest" | "companion";
  name: string;
  /** Invitado con quien va (solo acompañantes). */
  guestName: string | null;
  /** Invitado de la fila (el propio, o el del acompañante). */
  guestId: string;
  rsvp_status: SeatRsvp;
  tableId: string | null;
}

/**
 * «¿Dónde está…?»: invitados y acompañantes con nombre (los que cuentan,
 * activeCompanions) cuyo nombre contiene lo escrito, sin tildes ni
 * mayúsculas. El acompañante está en su mesa aparte si la tiene; si no, en
 * la de su invitado. Primero quien empieza por lo escrito; luego por nombre.
 */
export function findPeople(plan: SeatingPlan, query: string, limit = 8): FoundPerson[] {
  const needle = searchKey(query);
  if (needle.length === 0) return [];
  const tableIds = new Set(plan.tables.map((table) => table.id));
  const found: Array<FoundPerson & { rank: number }> = [];
  const visit = (guest: SeatGuest, tableId: string | null) => {
    const own = searchKey(guest.name);
    if (own.includes(needle)) found.push({ id: guest.id, kind: "guest", name: guest.name, guestName: null, guestId: guest.id, rsvp_status: guest.rsvp_status, tableId, rank: own.startsWith(needle) ? 0 : 1 });
    for (const companion of activeCompanions(guest)) {
      const key = searchKey(companion.name);
      if (!key.includes(needle)) continue;
      const apart = companion.table_id && tableIds.has(companion.table_id) ? companion.table_id : null;
      found.push({ id: companion.id, kind: "companion", name: companionLabel(companion), guestName: guest.name, guestId: guest.id, rsvp_status: guest.rsvp_status, tableId: apart ?? tableId, rank: key.startsWith(needle) ? 0 : 1 });
    }
  };
  for (const table of plan.tables) for (const guest of table.guests) visit(guest, table.id);
  for (const guest of plan.unseated) visit(guest, null);
  return found
    .sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((person): FoundPerson => ({ id: person.id, kind: person.kind, name: person.name, guestName: person.guestName, guestId: person.guestId, rsvp_status: person.rsvp_status, tableId: person.tableId }));
}

/** Invitados sentados en una mesa que han respondido que no vienen (el aviso «N sentados ya no vienen»). */
export function seatedDeclined(plan: Pick<SeatingPlan, "tables">): Array<{ id: string; name: string; tableId: string }> {
  return plan.tables.flatMap((table) => table.guests.filter((guest) => guest.rsvp_status === "no").map((guest) => ({ id: guest.id, name: guest.name, tableId: table.id })));
}

// ---------------------------------------------------------------- CSV para el catering

const RSVP_CSV: Record<SeatRsvp, string> = { si: "Viene", pendiente: "Sin responder", no: "No viene" };

export const SEATING_CSV_HEADER = ["Mesa", "Plazas", "Invitado", "Asistencia", "Acompañantes", "Personas", "Grupo", "Alergias y notas", "Etiqueta principal de la mesa", "Nombres de acompañantes", "Va con"] as const;

/**
 * Una fila por invitado, mesa a mesa y después «Sin mesa». Quien no viene no
 * sale (al catering no le sirve). Los acompañantes sentados aparte (la mesa
 * infantil) salen en su mesa con «Va con» = su invitado, y su invitado cuenta
 * solo las personas de su mesa. Separador «;» y sin BOM (lo pone quien crea
 * el Blob), como el resto de CSV del panel.
 */
export function buildSeatingCsv(plan: SeatingPlan): string {
  const row = (table: string, seats: string, guest: SeatGuest, mainTag: string) => [
    csvCell(table), seats, csvCell(guest.name), RSVP_CSV[guest.rsvp_status],
    String(guest.rsvp_status === "si" ? guest.companions : 0), String(seatsTaken(guest)),
    csvCell(guest.group_name ?? ""), csvCell((guest.notes ?? "").replace(/\s+/g, " ").trim()), csvCell(mainTag),
    csvCell(companionsAtHome(guest).map(companionLabel).join(" · ")), "",
  ].join(";");
  const visitorRow = (table: SeatTable, visitor: SeatVisitor, mainTag: string) => [
    csvCell(table.name), String(table.seats), csvCell(companionLabel(visitor)), RSVP_CSV[visitor.rsvp_status],
    "0", visitor.rsvp_status === "si" ? "1" : "0", csvCell(visitor.group_name ?? ""), "", csvCell(mainTag), "", csvCell(visitor.guestName),
  ].join(";");
  const lines: string[] = [];
  for (const table of plan.tables) {
    const mainTag = tableMainTag(table) ?? "";
    for (const guest of table.guests) if (guest.rsvp_status !== "no") lines.push(row(table.name, String(table.seats), guest, mainTag));
    for (const visitor of table.visitors ?? []) if (visitor.rsvp_status !== "no") lines.push(visitorRow(table, visitor, mainTag));
  }
  for (const guest of plan.unseated) if (guest.rsvp_status !== "no") lines.push(row("Sin mesa", "", guest, ""));
  return [SEATING_CSV_HEADER.join(";"), ...lines].join("\n");
}
