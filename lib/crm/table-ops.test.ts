import { describe, expect, it } from "vitest";
import { findGuestTable, sortGuests, tableOccupancy, withVisitors, type SeatGuest, type SeatingPlan } from "./seating";
import {
  TABLE_OP_ERRORS, applyChangeLocal, mergeTables, moveGroup, moveGuest, moveTable, previousAssignments, relieveOverfull, splitTable, swapTables,
  type SeatingChange, type TableOpResult,
} from "./table-ops";

const g = (id: string, companions = 0, group: string | null = null, status: SeatGuest["rsvp_status"] = "si"): SeatGuest => ({
  id, name: id.toUpperCase(), rsvp_status: status, companions, notes: null, group_name: group, tags: [], side: null, kids: 0, companion_list: [],
});

/** A (6 plazas): familia García (Ana +1 que es Pablo, aparte; Luis; Eva) + Bea = 4 personas. B (4): Carlos (2). C (10): vacía. Kids (6): Pablo, hijo de Ana (García), aparte. */
function plan(): SeatingPlan {
  const raw: SeatingPlan = {
    tables: [
      { id: "A", name: "Mesa A", seats: 6, position: 1, guests: [
        { ...g("ana", 1, "García"), companion_list: [{ id: "pablo", name: "Pablo", is_kid: true, table_id: "K" }] },
        g("luis", 0, "García"), g("eva", 0, "García"), g("bea"),
      ] },
      { id: "B", name: "Mesa B", seats: 4, position: 2, guests: [g("carlos", 1)] },
      { id: "C", name: "Mesa C", seats: 10, position: 3, guests: [] },
      { id: "K", name: "Mesa infantil", seats: 6, position: 4, guests: [] },
    ],
    unseated: [g("dani", 0, "García"), g("nora", 0, null, "no")],
    apart: [],
  };
  return withVisitors({ ...raw, tables: raw.tables.map((t) => ({ ...t, guests: sortGuests(t.guests) })), unseated: sortGuests(raw.unseated) });
}

function ok(result: TableOpResult): SeatingChange {
  if (!result.ok) throw new Error(result.error);
  return result.change;
}

const where = (p: SeatingPlan, id: string) => findGuestTable(p, id);
const occ = (p: SeatingPlan, id: string) => tableOccupancy(p.tables.find((t) => t.id === id)!).attending;

/** Aplica, deshace con las asignaciones previas y comprueba que todo vuelve a su sitio. */
function roundTrip(before: SeatingPlan, change: SeatingChange, created = new Map<string, string>()) {
  const previous = previousAssignments(before, change);
  const after = applyChangeLocal(before, change, created);
  const undone = applyChangeLocal(after, { newTables: [], assignments: previous }, new Map());
  const withoutCreated = { ...undone, tables: undone.tables.filter((t) => ![...created.values()].includes(t.id)) };
  expect(withoutCreated).toEqual(before);
  return after;
}

describe("swapTables", () => {
  it("todos los de A pasan a B y viceversa, con los acompañantes sentados aparte", () => {
    const p = { ...plan(), tables: plan().tables.map((t) => (t.id === "B" ? { ...t, seats: 6 } : t)) };
    const change = ok(swapTables(p, "A", "B"));
    const after = roundTrip(p, change);
    expect(["ana", "luis", "eva", "bea"].map((id) => where(after, id))).toEqual(["B", "B", "B", "B"]);
    expect(where(after, "carlos")).toBe("A");
    expect(occ(after, "B")).toBe(occ(p, "A"));
    expect(occ(after, "A")).toBe(occ(p, "B"));
    expect(change.people).toBe(occ(p, "A") + occ(p, "B"));
  });
  it("una mesa infantil intercambiada se lleva a sus niños", () => {
    const change = ok(swapTables(plan(), "K", "C"));
    expect(change.assignments).toEqual([{ companionId: "pablo", tableId: "C" }]);
    roundTrip(plan(), change);
  });
  it("error de capacidad si los de A no caben en B (y nada cambia)", () => {
    // A: Ana (Pablo, su hijo, se sienta en la infantil), Luis, Eva y Bea = 4.
    const small = { ...plan(), tables: plan().tables.map((t) => (t.id === "B" ? { ...t, seats: 3 } : t)) };
    const result = swapTables(small, "A", "B");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No caben: serían 4 personas en Mesa B, que tiene 3 plazas/);
  });
  it("misma mesa, mesa inexistente o las dos vacías", () => {
    expect(swapTables(plan(), "A", "A")).toEqual({ ok: false, error: TABLE_OP_ERRORS.same });
    expect(swapTables(plan(), "A", "Z")).toEqual({ ok: false, error: TABLE_OP_ERRORS.missing });
    const empty = { ...plan(), tables: [...plan().tables, { id: "D", name: "Mesa D", seats: 4, position: 5, guests: [] }] };
    expect(swapTables(empty, "C", "D")).toEqual({ ok: false, error: TABLE_OP_ERRORS.empty });
  });
});

describe("moveTable", () => {
  it("mueve la mesa entera a una vacía y se deshace", () => {
    const change = ok(moveTable(plan(), "A", "C"));
    const after = roundTrip(plan(), change);
    expect(after.tables.find((t) => t.id === "A")!.guests).toEqual([]);
    expect(occ(after, "C")).toBe(4);
  });
  it("solo a una mesa vacía y con plazas", () => {
    expect(moveTable(plan(), "A", "B")).toEqual({ ok: false, error: TABLE_OP_ERRORS.notEmpty });
    const small = { ...plan(), tables: [...plan().tables, { id: "S", name: "Mesa S", seats: 2, position: 5, guests: [] }] };
    expect(moveTable(small, "A", "S").ok).toBe(false);
    expect(moveTable(plan(), "C", "S")).toEqual({ ok: false, error: TABLE_OP_ERRORS.missing });
  });
});

describe("mergeTables", () => {
  it("fusiona si caben; la mesa de origen queda vacía (no se borra)", () => {
    const change = ok(mergeTables(plan(), "B", "C"));
    const after = roundTrip(plan(), change);
    expect(after.tables.map((t) => t.id)).toEqual(["A", "B", "C", "K"]);
    expect(where(after, "carlos")).toBe("C");
  });
  it("error si no caben juntas", () => {
    const result = mergeTables(plan(), "A", "B");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/serían 6 personas en Mesa B/);
  });
  it("origen vacío", () => {
    expect(mergeTables(plan(), "C", "A")).toEqual({ ok: false, error: TABLE_OP_ERRORS.empty });
  });
});

describe("splitTable", () => {
  it("divide por grupos sin partir ninguno, en una mesa nueva con las mismas plazas", () => {
    const change = ok(splitTable(plan(), "A"));
    expect(change.newTables).toEqual([{ key: "new:1", name: "Mesa 1", seats: 6 }]);
    const after = roundTrip(plan(), change, new Map([["new:1", "N1"]]));
    const garcia = ["ana", "luis", "eva"].map((id) => where(after, id));
    expect(new Set(garcia).size).toBe(1);
    expect(where(after, "bea")).not.toBe(garcia[0]);
    // La familia (4 personas) se queda; Bea pasa a la nueva.
    expect(garcia[0]).toBe("A");
    expect(where(after, "bea")).toBe("N1");
  });
  it("a una mesa vacía existente", () => {
    const change = ok(splitTable(plan(), "A", "C"));
    expect(change.newTables).toEqual([]);
    expect(change.assignments).toEqual([{ guestId: "bea", tableId: "C" }]);
  });
  it("una mesa con un solo grupo no se divide", () => {
    const one = { ...plan(), tables: plan().tables.map((t) => (t.id === "A" ? { ...t, guests: t.guests.filter((x) => x.group_name) } : t)) };
    expect(splitTable(one, "A")).toEqual({ ok: false, error: TABLE_OP_ERRORS.oneUnit });
    expect(splitTable(plan(), "C")).toEqual({ ok: false, error: TABLE_OP_ERRORS.empty });
    expect(splitTable(plan(), "A", "B")).toEqual({ ok: false, error: TABLE_OP_ERRORS.notEmpty });
  });
  it("es determinista", () => {
    expect(splitTable(plan(), "A")).toEqual(splitTable(plan(), "A"));
  });
});

describe("moveGroup y moveGuest", () => {
  it("mueve el grupo entero, también a quien estaba sin mesa, y se deshace", () => {
    const change = ok(moveGroup(plan(), "García", "C"));
    expect(change.assignments.map((a) => ("guestId" in a ? a.guestId : a.companionId))).toEqual(["ana", "dani", "eva", "luis"]);
    const after = roundTrip(plan(), change);
    expect(["ana", "luis", "eva", "dani"].map((id) => where(after, id))).toEqual(["C", "C", "C", "C"]);
  });
  it("error de capacidad del grupo y grupo inexistente", () => {
    expect(moveGroup(plan(), "García", "B").ok).toBe(false);
    expect(moveGroup(plan(), "Nadie", "C")).toEqual({ ok: false, error: TABLE_OP_ERRORS.nobody });
  });
  it("un invitado suelto, con sus acompañantes; a «sin mesa»; capacidad", () => {
    const change = ok(moveGuest(plan(), "carlos", "A"));
    expect(change.people).toBe(2);
    roundTrip(plan(), change);
    const unseat = ok(moveGuest(plan(), "bea", null));
    expect(where(applyChangeLocal(plan(), unseat, new Map()), "bea")).toBeNull();
    const full = { ...plan(), tables: plan().tables.map((t) => (t.id === "B" ? { ...t, seats: 2 } : t)) };
    expect(moveGuest(full, "bea", "B").ok).toBe(false);
    expect(moveGuest(plan(), "bea", "A")).toEqual({ ok: false, error: TABLE_OP_ERRORS.already });
  });
});

describe("relieveOverfull", () => {
  it("levanta la unidad más pequeña que basta, sin partir grupos", () => {
    // Mesa A con 4 personas y 3 plazas: sobra 1 → Bea (sola) se levanta, no la familia.
    const p = { ...plan(), tables: plan().tables.map((t) => (t.id === "A" ? { ...t, seats: 3 } : t)) };
    expect(relieveOverfull(p)).toEqual(["bea"]);
    // Con 1 plaza: sobran 3 → la familia entera (3), no Bea.
    const tight = { ...plan(), tables: plan().tables.map((t) => (t.id === "A" ? { ...t, seats: 1 } : t)) };
    expect(relieveOverfull(tight)).toEqual(["ana", "eva", "luis"]);
    expect(relieveOverfull(plan())).toEqual([]);
  });
});
