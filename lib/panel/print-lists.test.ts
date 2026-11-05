import { describe, expect, it } from "vitest";
import { attendingPeople, cateringRows, companionNamesByGuest, companionNamesText, entryList, initialOf, kidsSummary, printTables, tablesByGuest } from "@/lib/panel/print-lists";
import { withVisitors, type SeatGuest, type SeatingPlan } from "@/lib/crm/seating";

const guest = (id: string, name: string, rsvp_status: SeatGuest["rsvp_status"] = "si", companions = 0, notes: string | null = null): SeatGuest =>
  ({ id, name, rsvp_status, companions, notes, group_name: null });

const plan: SeatingPlan = {
  tables: [
    { id: "t1", name: "Mesa 1", seats: 10, position: 0, guests: [guest("g1", "Zoe", "si", 1, "Celíaca"), guest("g2", "Álvaro"), guest("g3", "Pepe", "pendiente"), guest("g4", "Nora", "no")] },
    { id: "t2", name: "Novios", seats: 2, position: 1, guests: [guest("g5", "Bea")] },
  ],
  unseated: [guest("g6", "Carla", "si", 2), guest("g7", "Dani", "pendiente")],
};

describe("printTables", () => {
  it("cada mesa con quien viene, A-Z, y cuántos pendientes quedan sentados", () => {
    const [first, second] = printTables(plan);
    expect(first.guests.map((g) => g.name)).toEqual(["Álvaro", "Zoe"]);
    expect(first.people).toBe(3);
    expect(first.pending).toBe(1);
    expect(second.people).toBe(1);
  });
});

describe("entryList", () => {
  it("quien viene, alfabético (las tildes no mandan al final), con su mesa o sin ella", () => {
    expect(entryList(plan).map((row) => [row.name, row.table])).toEqual([["Álvaro", "Mesa 1"], ["Bea", "Novios"], ["Carla", null], ["Zoe", "Mesa 1"]]);
    expect(attendingPeople(entryList(plan))).toBe(7);
  });
  it("iniciales sin tildes; lo que no es letra va en #", () => {
    expect(initialOf("Álvaro")).toBe("A");
    expect(initialOf(" ñoño")).toBe("N");
    expect(initialOf("3 primos")).toBe("#");
  });
});

describe("acompañantes con nombre y mesa infantil", () => {
  const kids: SeatingPlan = withVisitors({
    tables: [
      { id: "t1", name: "Mesa 1", seats: 10, position: 0, guests: [{ ...guest("g1", "Zoe", "si", 2), kids: 1, companion_list: [
        { id: "c1", name: "Pablo", is_kid: true, table_id: "ti" }, { id: "c2", name: "Irene", is_kid: false, table_id: null },
      ] }] },
      { id: "ti", name: "Mesa infantil", seats: 8, position: 1, guests: [] },
    ],
    unseated: [{ ...guest("g2", "Ana", "si", 1), kids: 1, companion_list: [{ id: "c3", name: "Leo", is_kid: true, table_id: null }] }, { ...guest("g3", "Eva", "si", 2), kids: 2 }],
  });
  it("la mesa infantil lista a los niños con su invitado y la de la familia no les guarda sitio", () => {
    const [mesa, infantil] = printTables(kids);
    expect(mesa.people).toBe(2);
    expect(companionNamesText(mesa.guests[0]!)).toBe("Irene");
    expect(infantil.visitors.map((v) => [v.name, v.guestName])).toEqual([["Pablo", "Zoe"]]);
    expect(infantil.people).toBe(1);
  });
  it("lista de entrada con nombres y quien se sienta en otra mesa", () => {
    const zoe = entryList(kids).find((row) => row.name === "Zoe")!;
    expect(zoe.names).toEqual(["Irene"]);
    expect(zoe.away).toEqual([{ name: "Pablo (niño/a)", table: "Mesa infantil" }]);
  });
  it("reducir acompañantes a cero los quita de entrada, nombres y mesa infantil sin borrar el original", () => {
    const reduced = withVisitors({ ...kids, tables: kids.tables.map(table => ({ ...table, guests: table.guests.map(guest => ({ ...guest, companions: 0 })) })) });
    const zoe = entryList(reduced).find(row => row.id === "g1")!;
    expect(zoe.names).toEqual([]); expect(zoe.away).toEqual([]);
    expect(companionNamesByGuest(reduced).has("g1")).toBe(false);
    expect(kidsSummary(reduced).named.some(kid => kid.with === "Zoe")).toBe(false);
    expect(reduced.tables[0].guests[0].companion_list).toHaveLength(2);
  });
  it("niños: total (con y sin nombres) y los que tienen nombre con su mesa", () => {
    const summary = kidsSummary(kids);
    expect(summary.total).toBe(4);
    expect(summary.named.map((kid) => [kid.name, kid.with, kid.table])).toEqual([["Leo", "Ana", null], ["Pablo", "Zoe", "Mesa infantil"]]);
    expect(companionNamesByGuest(kids).get("g1")).toBe("Pablo (niño/a) · Irene");
  });
});

describe("cateringRows", () => {
  it("solo quien tiene notas o menú, por mesa y nombre; sin mesa al final; notas vacías fuera", () => {
    const rows = cateringRows([
      { id: "g6", name: "Carla", companions: 2, notes: "Sin lactosa", menu: "" },
      { id: "g1", name: "Zoe", companions: 1, notes: "Celíaca", menu: "2 Pescado" },
      { id: "g5", name: "Bea", companions: 0, notes: "   ", menu: "1 Carne" },
      { id: "g2", name: "Álvaro", companions: 0, notes: "  ", menu: "" },
    ], tablesByGuest(plan));
    expect(rows.map((row) => [row.name, row.table, row.notes])).toEqual([["Zoe", "Mesa 1", "Celíaca"], ["Bea", "Novios", null], ["Carla", null, "Sin lactosa"]]);
  });
  it("sin plan de mesas, todo por nombre", () => {
    const rows = cateringRows([{ id: "b", name: "Bruno", companions: 0, notes: "Vegano", menu: "" }, { id: "a", name: "Ana", companions: 0, notes: "Frutos secos", menu: "" }], tablesByGuest(null));
    expect(rows.map((row) => row.name)).toEqual(["Ana", "Bruno"]);
  });
});
