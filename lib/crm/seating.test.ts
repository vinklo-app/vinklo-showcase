import { describe, expect, it } from "vitest";
import {
  buildSeatingCsv, filterUnseated, groupToSeat, moveGuests, nextTableName, normalizeTableName, parseSeatingPlan,
  companionsAtHome, companionsAway, seatedAttending, hasSeatingRules, removeTable, seatCompanions, seatsTaken, sortGuests, tableMainTag, tableOccupancy, unseatedAttending, unseatedGroups,
  withVisitors, findPeople, searchKey, seatedDeclined, type SeatGuest, type SeatingPlan,
} from "./seating";

describe("acompañantes con nombre y mesa infantil (20261023110000)", () => {
  const kidsPlan = (): SeatingPlan => withVisitors({
    tables: [
      { id: "t1", name: "Mesa 1", seats: 4, position: 1, guests: [{ ...g("a", "Ana", "si", 2), companion_list: [
        { id: "c1", name: "Pablo", is_kid: true, table_id: "ti" },
        { id: "c2", name: "Irene", is_kid: false, table_id: null },
      ] }] },
      { id: "ti", name: "Mesa infantil", seats: 8, position: 2, guests: [] },
    ],
    unseated: [{ ...g("b", "Bea", "pendiente", 1), companion_list: [{ id: "c3", name: "Lola", is_kid: true, table_id: "ti" }] }],
    apart: [],
  });
  it("quien se sienta aparte ocupa en su mesa, no en la de su familia; los de pendientes no cuentan", () => {
    const p = kidsPlan();
    expect(seatsTaken(p.tables[0]!.guests[0]!)).toBe(2);
    expect(tableOccupancy(p.tables[0]!).attending).toBe(2);
    expect(p.tables[1]!.visitors?.map((v) => v.name)).toEqual(["Lola", "Pablo"]);
    expect(tableOccupancy(p.tables[1]!).attending).toBe(1);
    expect(companionsAway({ companions: 0, companion_list: [{ id: "x", name: "X", is_kid: true, table_id: "t" }] })).toBe(0);
  });
  it("con su familia de nuevo, y borrar la mesa infantil los devuelve", () => {
    const back = seatCompanions(kidsPlan(), [{ companionId: "c1", tableId: null }]);
    expect(seatsTaken(back.tables[0]!.guests[0]!)).toBe(3);
    expect(back.tables[1]!.visitors?.map((v) => v.id)).toEqual(["c3"]);
    const removed = removeTable(kidsPlan(), "ti");
    expect(removed.tables.map((t) => t.id)).toEqual(["t1"]);
    expect(seatsTaken(removed.tables[0]!.guests[0]!)).toBe(3);
    expect(removed.apart).toEqual([]);
  });
  it("mover invitados conserva los pares y a los niños sentados aparte", () => {
    const moved = moveGuests(kidsPlan(), ["a"], null);
    expect(moved.apart).toEqual([]);
    expect(moved.tables[1]!.visitors?.length).toBe(2);
  });
  it("lee companion_list, pinned_group y apart; sin la migración, apart no existe", () => {
    const raw = { tables: [{ id: "t", name: "Mesa 1", seats: 10, position: 0, pinned_group: "Primos", guests: [
      { id: "x", name: "Ana", rsvp_status: "si", companions: 1, notes: null, group_name: null, companion_list: [{ id: "c", name: "Leo", is_kid: true, table_id: null }] },
    ] }], unseated: [], apart: [["x", "y"]] };
    const parsed = parseSeatingPlan(raw)!;
    expect(parsed.tables[0]!.pinned_group).toBe("Primos");
    expect(parsed.tables[0]!.guests[0]!.companion_list).toEqual([{ id: "c", name: "Leo", is_kid: true, table_id: null }]);
    expect(hasSeatingRules(parsed)).toBe(true);
    expect(hasSeatingRules(parseSeatingPlan({ tables: [], unseated: [] })!)).toBe(false);
  });
  it("CSV: nombres de quien se sienta con cada uno y una fila por niño en la mesa infantil", () => {
    const csv = buildSeatingCsv(kidsPlan()).split("\n");
    expect(csv).toContain("\"Mesa 1\";4;\"Ana\";Viene;2;2;\"\";\"\";\"\";\"Irene\";");
    expect(csv).toContain("\"Mesa infantil\";8;\"Pablo (niño/a)\";Viene;0;1;\"\";;\"\";;\"Ana\"");
    expect(csv).toContain("\"Mesa infantil\";8;\"Lola (niño/a)\";Sin responder;0;0;\"\";;\"\";;\"Bea\"");
  });
});

const g = (id: string, name: string, rsvp_status: SeatGuest["rsvp_status"], companions = 0, group_name: string | null = null, notes: string | null = null): SeatGuest =>
  ({ id, name, rsvp_status, companions, group_name, notes });

const plan = (): SeatingPlan => ({
  tables: [
    { id: "t1", name: "Mesa 1", seats: 4, position: 1, guests: [g("a", "Tía Puri", "si", 2, "Familia", "Celíaca"), g("b", "Primo Luis", "no", 0, "Familia"), g("c", "Abuela", "pendiente", 0, "Familia")] },
    { id: "t2", name: "Mesa 2", seats: 2, position: 2, guests: [g("d", "Nacho", "si", 2, "Trabajo")] },
  ],
  unseated: [g("e", "Sara", "si", 1, "Trabajo", "=Vegana"), g("f", "Vecina", "pendiente"), g("h", "Lola", "no", 0, "Trabajo")],
});

describe("ocupación", () => {
  it("cuenta invitado + acompañantes de los que vienen; pendientes aparte; los que no vienen no ocupan", () => {
    expect(tableOccupancy(plan().tables[0]!)).toMatchObject({ attending: 3, pending: 1, declined: 1, free: 1, over: false, ratio: 0.75 });
    expect(seatsTaken({ rsvp_status: "pendiente", companions: 3 })).toBe(0);
  });
  it("avisa cuando una mesa supera sus plazas (la barra no pasa de 1)", () => {
    expect(tableOccupancy(plan().tables[1]!)).toMatchObject({ attending: 3, free: -1, over: true, ratio: 1 });
  });
  it("personas que vienen sin mesa", () => {
    expect(unseatedAttending(plan())).toBe(2);
  });
});

describe("bandeja «Sin mesa»", () => {
  it("prioriza a quien viene, luego pendientes, luego no; dentro, por grupo y nombre", () => {
    const sorted = sortGuests([g("1", "Zoe", "pendiente"), g("2", "Ana", "no"), g("3", "Bea", "si", 0, "B"), g("4", "Al", "si"), g("5", "Eva", "si", 0, "A")]);
    expect(sorted.map((x) => x.name)).toEqual(["Eva", "Bea", "Al", "Zoe", "Ana"]);
  });
  it("filtra por grupo y oculta a quien no viene salvo que se pida", () => {
    expect(filterUnseated(plan().unseated, { group: "all", showDeclined: false }).map((x) => x.id)).toEqual(["e", "f"]);
    expect(filterUnseated(plan().unseated, { group: "Trabajo", showDeclined: true }).map((x) => x.id)).toEqual(["e", "h"]);
    expect(filterUnseated(plan().unseated, { group: null, showDeclined: false }).map((x) => x.id)).toEqual(["f"]);
  });
  it("«Sentar a un grupo entero» toma a los que quedan sin mesa del grupo, sin los que no vienen", () => {
    expect(groupToSeat(plan(), "Trabajo")).toEqual(["e"]);
    expect(unseatedGroups(plan())).toEqual([{ name: "Trabajo", guests: 1, people: 2 }]);
  });
});

describe("operaciones locales", () => {
  it("mueve entre mesas y a «sin mesa», ignorando ids o mesas desconocidas", () => {
    let p = moveGuests(plan(), ["e", "a"], "t2");
    expect(p.tables[1]!.guests.map((x) => x.id)).toEqual(["a", "d", "e"]);
    expect(p.tables[0]!.guests.map((x) => x.id)).toEqual(["b", "c"]);
    expect(p.unseated.map((x) => x.id)).toEqual(["f", "h"]);
    expect(tableOccupancy(p.tables[1]!).attending).toBe(8);
    p = moveGuests(p, ["a"], null);
    expect(p.unseated[0]!.id).toBe("a");
    expect(moveGuests(plan(), ["e"], "no-existe")).toEqual(plan());
  });
  it("borrar una mesa devuelve sus invitados a «Sin mesa»", () => {
    const p = removeTable(plan(), "t1");
    expect(p.tables.map((t) => t.id)).toEqual(["t2"]);
    expect(p.unseated.map((x) => x.id)).toEqual(["a", "e", "c", "f", "b", "h"]);
  });
  it("siguiente nombre libre y nombres normalizados", () => {
    expect(nextTableName([{ name: "Mesa 1" }, { name: "mesa 3" }])).toBe("Mesa 2");
    expect(nextTableName([])).toBe("Mesa 1");
    expect(normalizeTableName("  Mesa   de los  primos ")).toBe("Mesa de los primos");
    expect(normalizeTableName("   ")).toBeNull();
  });
});

describe("lectura del RPC", () => {
  it("acepta el jsonb de wedding_seating y reordena", () => {
    const raw = { tables: [{ id: "t", name: "Mesa 1", seats: 10, position: 0, attending: 1, pending: 0, declined: 0, guests: [{ id: "x", name: "Ana", rsvp_status: "si", companions: 0, notes: null, group_name: null }] }], unseated: [] };
    expect(parseSeatingPlan(raw)?.tables[0]?.guests[0]?.name).toBe("Ana");
    expect(parseSeatingPlan({ tables: "x" })).toBeNull();
    expect(parseSeatingPlan(null)).toBeNull();
  });
});

describe("CSV para el catering", () => {
  it("mesa a mesa, después «Sin mesa»; sin quien no viene; celdas con fórmula neutralizadas", () => {
    const csv = buildSeatingCsv(plan()).split("\n");
    expect(csv[0]).toBe("Mesa;Plazas;Invitado;Asistencia;Acompañantes;Personas;Grupo;Alergias y notas;Etiqueta principal de la mesa;Nombres de acompañantes;Va con");
    expect(csv[1]).toBe("\"Mesa 1\";4;\"Tía Puri\";Viene;2;3;\"Familia\";\"Celíaca\";\"\";\"\";");
    expect(csv.some((line) => line.includes("Primo Luis") || line.includes("Lola"))).toBe(false);
    expect(csv).toContain("\"Sin mesa\";;\"Sara\";Viene;1;2;\"Trabajo\";\"'=Vegana\";\"\";\"\";");
    expect(csv).toContain("\"Mesa 1\";4;\"Abuela\";Sin responder;0;0;\"Familia\";\"\";\"\";\"\";");
    expect(csv.length).toBe(6);
  });
});

describe("etiquetas en el plano (20261020100000)", () => {
  it("lee tags, side y kids con valores por defecto", () => {
    const raw = { tables: [], unseated: [
      { id: "x", name: "Ana", rsvp_status: "si", companions: 1, notes: null, group_name: null, tags: ["Uni"], side: "p1", kids: 1 },
      { id: "y", name: "Bea", rsvp_status: "si", companions: 0, notes: null, group_name: null },
      { id: "z", name: "Ciro", rsvp_status: "si", companions: 0, notes: null, group_name: null, tags: "x", side: "novio", kids: -1 },
    ] };
    const parsed = parseSeatingPlan(raw)!;
    expect(parsed.unseated.find((x) => x.id === "x")).toMatchObject({ tags: ["Uni"], side: "p1", kids: 1 });
    expect(parsed.unseated.find((x) => x.id === "y")).toMatchObject({ tags: [], side: null, kids: 0 });
    expect(parsed.unseated.find((x) => x.id === "z")).toMatchObject({ tags: [], side: null, kids: 0 });
  });
  it("etiqueta principal: la de más personas que vienen; sin etiquetas, null; y va al CSV", () => {
    const table = { id: "t", name: "Mesa 1", seats: 10, position: 1, guests: [
      { ...g("a", "Ana", "si", 2), tags: ["Trabajo"] },
      { ...g("b", "Bea", "si"), tags: ["Uni"] },
      { ...g("c", "Ciro", "si"), tags: ["Uni"] },
      { ...g("d", "Dani", "no"), tags: ["Uni", "Uni2"] },
    ] };
    expect(tableMainTag(table)).toBe("Trabajo");
    expect(tableMainTag({ guests: [g("a", "Ana", "si")] })).toBeNull();
    const csv = buildSeatingCsv({ tables: [table], unseated: [] }).split("\n");
    expect(csv[1].endsWith(";\"Trabajo\";\"\";")).toBe(true);
  });
});


describe("regresión: reducir acompañantes confirmados", () => {
  const named = [
    { id: "adult", name: "Irene", is_kid: false, table_id: null },
    { id: "kid", name: "Pablo", is_kid: true, table_id: "kids" },
  ];
  const reduced = (count: number): SeatingPlan => withVisitors({
    tables: [
      { id: "adults", name: "Adultos", seats: 8, position: 1, guests: [{ ...g("a", "Ana", "si", count), companion_list: named }] },
      { id: "kids", name: "Infantil", seats: 8, position: 2, guests: [] },
    ], unseated: [], apart: [],
  });
  it.each([0, 1])("solo cuenta los %i acompañantes actuales sin borrar los nombres guardados", (count) => {
    const result = reduced(count);
    expect(seatedAttending(result)).toBe(1 + count);
    expect(result.tables[1].visitors).toEqual([]);
    expect(result.tables[0].guests[0].companion_list).toEqual(named);
    expect(companionsAway(result.tables[0].guests[0])).toBe(0);
    expect(companionsAtHome(result.tables[0].guests[0]).map((person) => person.name)).toEqual(count ? ["Irene"] : []);
    const csv = buildSeatingCsv(result);
    expect(csv).not.toContain("Pablo");
    if (count === 0) expect(csv).not.toContain("Irene");
  });
  it("un aumento recupera el nombre y la asignación guardados", () => {
    const result = reduced(2);
    expect(seatedAttending(result)).toBe(3);
    expect(result.tables[1].visitors?.map((person) => person.id)).toEqual(["kid"]);
  });
});

describe("«¿Dónde está…?» y sentados que no vienen (Bloque 4)", () => {
  const withKids = (): SeatingPlan => withVisitors({
    tables: [
      { id: "t1", name: "Mesa 1", seats: 8, position: 1, guests: [{ ...g("a", "José Ángel Ruiz", "si", 2), companion_list: [{ id: "k1", name: "Pablo", is_kid: true, table_id: "t2" }, { id: "k2", name: "Irene", is_kid: false, table_id: null }, { id: "k3", name: "Pablito", is_kid: true, table_id: null }] }, g("b", "Primo Luis", "no")] },
      { id: "t2", name: "Mesa infantil", seats: 8, position: 2, guests: [g("c", "Paula", "no")] },
    ],
    unseated: [g("d", "Pablo Sanz", "pendiente"), g("e", "Lola", "no")],
  });
  it("busca sin tildes ni mayúsculas, invitados y acompañantes, y dice su mesa", () => {
    expect(searchKey("  José   ÁNGEL ")).toBe("jose angel");
    expect(findPeople(withKids(), "jose angel")).toEqual([{ id: "a", kind: "guest", name: "José Ángel Ruiz", guestName: null, guestId: "a", rsvp_status: "si", tableId: "t1" }]);
    const pablo = findPeople(withKids(), "PABLO");
    // Pablo (acompañante sentado aparte) en la mesa infantil; Pablo Sanz sin mesa. Pablito no cuenta (fuera del recuento de 2).
    expect(pablo.map((p) => [p.id, p.tableId])).toEqual([["k1", "t2"], ["d", null]]);
    expect(pablo[0]).toMatchObject({ kind: "companion", name: "Pablo (niño/a)", guestName: "José Ángel Ruiz", guestId: "a" });
    expect(findPeople(withKids(), "irene")[0]).toMatchObject({ id: "k2", tableId: "t1" });
  });
  it("primero quien empieza por lo escrito; vacío no busca; respeta el límite", () => {
    expect(findPeople(withKids(), "la").map((p) => p.name)).toEqual(["Lola", "Paula"]);
    expect(findPeople(withKids(), "   ")).toEqual([]);
    expect(findPeople(withKids(), "a", 2)).toHaveLength(2);
  });
  it("sentados que no vienen: solo los de una mesa con «no»", () => {
    expect(seatedDeclined(withKids())).toEqual([{ id: "b", name: "Primo Luis", tableId: "t1" }, { id: "c", name: "Paula", tableId: "t2" }]);
    expect(seatedDeclined(plan()).map((x) => x.id)).toEqual(["b"]);
  });
});
