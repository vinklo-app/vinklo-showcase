import { describe, expect, it } from "vitest";
import { AUTO_SEAT_DEFAULTS, autoSeat, hasAffinityData, isKidsTableName, isReservedTableName, nextKidsTableName, type AutoSeatGuest, type AutoSeatInput, type AutoSeatOptions } from "./auto-seating";

/** Medida robusta para CI y suite en paralelo: el mejor de `runs` y el último resultado. */
const PERF_BUDGET_MS = 150;
function bestOf<T>(runs: number, fn: () => T): { best: number; result: T } {
  let best = Infinity;
  let result!: T;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    result = fn();
    best = Math.min(best, performance.now() - start);
  }
  return { best, result };
}

let n = 0;
const id = (prefix: string) => `${prefix}-${String(++n).padStart(4, "0")}`;
function guest(over: Partial<AutoSeatGuest> = {}): AutoSeatGuest {
  const gid = over.id ?? id("g");
  return { id: gid, name: gid, seats: 1, group: null, tags: [], side: null, tableId: null, status: "si", ...over };
}
function family(size: number, over: Partial<AutoSeatGuest> = {}): AutoSeatGuest[] {
  const group = over.group ?? id("familia");
  return Array.from({ length: size }, () => guest({ ...over, group }));
}
const table = (tid: string, seats = 10, name = tid) => ({ id: tid, name, seats });
function run(tables: AutoSeatInput["tables"], guests: AutoSeatGuest[], options: Partial<AutoSeatOptions> = {}, apart?: AutoSeatInput["apart"]) {
  return autoSeat({ tables, guests, options: { ...AUTO_SEAT_DEFAULTS, ...options }, apart });
}
/** Invitado con hijos con nombre (y adultos sin marcar). */
function parent(kids: number, over: Partial<AutoSeatGuest> = {}, adults = 0): AutoSeatGuest {
  const companions = [
    ...Array.from({ length: kids }, () => ({ id: id("k"), isKid: true, tableId: null as string | null })),
    ...Array.from({ length: adults }, () => ({ id: id("c"), isKid: false, tableId: null as string | null })),
  ];
  return guest({ seats: 1 + kids + adults, companions, ...over });
}
/** Mesa final de cada invitado (la propuesta encima de la actual). */
function finalSeats(guests: AutoSeatGuest[], result: ReturnType<typeof autoSeat>) {
  const map = new Map(guests.map((g) => [g.id, g.tableId as string | null]));
  for (const a of result.assignments) map.set(a.guestId, a.tableId);
  return map;
}

describe("mesas automáticas", () => {
  it("la presidencial no se rellena sola: es la mesa de los novios", () => {
    expect(isReservedTableName("PRESIDENCIAL")).toBe(true);
    expect(isReservedTableName("Mesa presidencial")).toBe(true);
    expect(isReservedTableName("Mesa 1")).toBe(false);
    const guests = Array.from({ length: 6 }, () => guest());
    const result = run([table("pres", 8, "PRESIDENCIAL"), table("t1", 10, "Mesa 1")], guests, { allowNewTables: false });
    const seats = finalSeats(guests, result);
    for (const g of guests) expect(seats.get(g.id)).toBe("t1");
  });

  it("la presidencial sí recibe al grupo para el que la pareja la ha fijado", () => {
    const fam = family(4, { group: "Padres" });
    const result = run([{ ...table("pres", 8, "Presidencial"), pinnedGroup: "Padres" }, table("t1", 10, "Mesa 1")], fam, { allowNewTables: false });
    const seats = finalSeats(fam, result);
    for (const g of fam) expect(seats.get(g.id)).toBe("pres");
  });

  it("un grupo de 6 nunca acaba en dos mesas", () => {
    const fam = family(6);
    const others = Array.from({ length: 7 }, () => guest());
    const guests = [...others, ...fam];
    const result = run([table("t1", 8), table("t2", 8)], guests, { allowNewTables: false });
    const seats = finalSeats(guests, result);
    expect(new Set(fam.map((g) => seats.get(g.id))).size).toBe(1);
    expect(seats.get(fam[0].id)).not.toBeNull();
  });

  it("dos grupos con la misma etiqueta comparten mesa si caben", () => {
    const a = family(3, { tags: ["Uni"] });
    const b = family(4, { tags: ["Uni"] });
    const c = family(4, { tags: ["Trabajo"] });
    const guests = [...a, ...c, ...b];
    const result = run([table("t1"), table("t2")], guests);
    const seats = finalSeats(guests, result);
    expect(seats.get(a[0].id)).toBe(seats.get(b[0].id));
    expect(seats.get(c[0].id)).not.toBe(seats.get(a[0].id));
    expect(result.tables.find((t) => t.tableId === seats.get(a[0].id))?.mainTag).toBe("Uni");
  });

  it("sin etiquetas, agrupa por lado", () => {
    const p1 = [guest({ side: "p1" }), guest({ side: "p1" })];
    const p2 = [guest({ side: "p2" }), guest({ side: "p2" })];
    const guests = [p1[0], p2[0], p1[1], p2[1]];
    const seats = finalSeats(guests, run([table("t1", 2), table("t2", 2)], guests));
    expect(seats.get(p1[0].id)).toBe(seats.get(p1[1].id));
    expect(seats.get(p2[0].id)).toBe(seats.get(p2[1].id));
  });

  it("respeta la capacidad y crea mesas nuevas si hace falta", () => {
    const guests = Array.from({ length: 25 }, () => guest({ seats: 1 }));
    const result = run([table("t1", 10)], guests, { newTableSeats: 8 });
    expect(result.unplaced).toEqual([]);
    for (const t of result.tables) expect(t.used).toBeLessThanOrEqual(t.seats);
    expect(result.newTables.map((t) => t.seats)).toEqual([8, 8]);
    expect(result.newTables.map((t) => t.key)).toEqual(["new:1", "new:2"]);
    expect(result.newTables.map((t) => t.name)).toEqual(["Mesa 1", "Mesa 2"]);
    expect(result.seatedPeople).toBe(25);
  });

  it("sin mesas nuevas, quien no cabe queda en unplaced como no_room", () => {
    const guests = Array.from({ length: 5 }, () => guest({ seats: 1 }));
    const result = run([table("t1", 3)], guests, { allowNewTables: false });
    expect(result.assignments).toHaveLength(3);
    expect(result.unplaced.map((u) => u.reason)).toEqual(["no_room", "no_room"]);
  });

  it("un grupo más grande que las mesas nuevas recibe una mesa a su medida", () => {
    const fam = family(12);
    const result = run([], fam, { newTableSeats: 10 });
    expect(result.newTables).toEqual([{ key: "new:1", name: "Mesa 1", seats: 12 }]);
    expect(result.unplaced).toEqual([]);
  });

  it("un grupo de 31 sale en unplaced como group_too_big y no se parte", () => {
    const fam = family(31);
    const result = run([table("t1", 30)], fam);
    expect(result.assignments).toEqual([]);
    expect(result.unplaced).toHaveLength(31);
    expect(new Set(result.unplaced.map((u) => u.reason))).toEqual(new Set(["group_too_big"]));
  });

  it("keepCurrent no mueve a nadie ya sentado y cuenta su sitio", () => {
    const seated = Array.from({ length: 8 }, () => guest({ tableId: "t1", tags: ["Trabajo"] }));
    const fresh = Array.from({ length: 4 }, () => guest({ tags: ["Trabajo"] }));
    const guests = [...seated, ...fresh];
    const result = run([table("t1", 10), table("t2", 10)], guests);
    expect(result.assignments.some((a) => seated.some((g) => g.id === a.guestId))).toBe(false);
    const t1 = result.tables.find((t) => t.tableId === "t1")!;
    expect(t1.used).toBeLessThanOrEqual(10);
  });

  it("«Reorganizar todo» sí recoloca a los ya sentados", () => {
    const seated = Array.from({ length: 3 }, () => guest({ tableId: "t1", tags: ["Uni"] }));
    const others = Array.from({ length: 3 }, () => guest({ tableId: "t2", tags: ["Uni"] }));
    const guests = [...seated, ...others];
    const result = run([table("t1", 10), table("t2", 10)], guests, { keepCurrent: false });
    const seats = finalSeats(guests, result);
    expect(new Set(guests.map((g) => seats.get(g.id))).size).toBe(1);
  });

  it("un grupo con alguien ya sentado va a esa mesa si cabe", () => {
    const fam = family(3);
    fam[0] = { ...fam[0], tableId: "t2" };
    const result = run([table("t1"), table("t2")], fam);
    const seats = finalSeats(fam, result);
    expect(fam.map((g) => seats.get(g.id))).toEqual(["t2", "t2", "t2"]);
  });

  it("los pendientes solo entran con includePending (y ocupan al menos 1)", () => {
    const yes = guest();
    const maybe = guest({ status: "pendiente", seats: 0 });
    const no = guest({ status: "no", seats: 0 });
    const guests = [yes, maybe, no];
    expect(run([table("t1")], guests).assignments.map((a) => a.guestId)).toEqual([yes.id]);
    const withPending = run([table("t1")], guests, { includePending: true });
    expect(withPending.assignments.map((a) => a.guestId).sort()).toEqual([yes.id, maybe.id].sort());
    expect(withPending.tables[0].used).toBe(2);
  });

  it("quien no viene nunca se mueve, ni con «Reorganizar todo»", () => {
    const no = guest({ status: "no", seats: 0, tableId: "t1" });
    const result = run([table("t1"), table("t2")], [no, guest()], { keepCurrent: false });
    expect(result.assignments.some((a) => a.guestId === no.id)).toBe(false);
  });

  it("tagPriority desempata la etiqueta principal de una unidad", () => {
    const fam = [guest({ group: "F", tags: ["Uni", "Pueblo"] }), guest({ group: "F", tags: ["Pueblo", "Uni"] })];
    const plain = run([table("t1")], fam);
    expect(plain.tables[0].mainTag).toBe("Pueblo");
    const prio = run([table("t1")], fam, { tagPriority: ["Uni"] });
    expect(prio.tables[0].mainTag).toBe("Uni");
  });

  it("los sueltos de una etiqueta no quedan en otra mesa si caben con los suyos", () => {
    // Uni: un grupo de 9 y dos sueltos. Con mesas de 10, el 9 llena una casi entera;
    // los 2 sueltos acaban juntos en otra mesa si no caben, nunca solos si hay sitio.
    const fam = family(8, { tags: ["Uni"] });
    const solo = [guest({ tags: ["Uni"] }), guest({ tags: ["Uni"] })];
    const guests = [...fam, ...solo];
    const result = run([table("t1", 10), table("t2", 10)], guests);
    const seats = finalSeats(guests, result);
    expect(new Set(guests.map((g) => seats.get(g.id))).size).toBe(1);
  });

  it("es determinista (dos llamadas, mismo resultado; el orden de entrada no importa)", () => {
    const guests = [...family(4, { tags: ["Uni"] }), ...Array.from({ length: 30 }, (_, i) => guest({ tags: i % 3 ? ["Trabajo"] : [], side: i % 2 ? "p1" : "p2" }))];
    const tables = [table("t1"), table("t2", 6)];
    const first = run(tables, guests);
    const second = run(tables, [...guests].reverse());
    expect(second).toEqual(first);
  });

  it("rendimiento: 1.000 invitados y 100 mesas en menos de 150 ms (mejor de 5)", () => {
    const TAGS = ["Uni", "Trabajo de Juan", "Familia de Lucía", "Pueblo", "Pádel", "Amigos de los dos"];
    const tables = Array.from({ length: 100 }, (_, i) => table(`t${String(i).padStart(3, "0")}`, 10, `Mesa ${i + 1}`));
    const guests: AutoSeatGuest[] = Array.from({ length: 1000 }, (_, i) => guest({
      seats: 1 + (i % 3 === 0 ? 1 : 0),
      group: i % 4 === 0 ? `G${Math.floor(i / 8)}` : null,
      tags: i % 5 === 0 ? [] : [TAGS[i % TAGS.length]],
      side: (["p1", "p2", "ambos", null] as const)[i % 4],
      status: i % 10 === 0 ? "pendiente" : "si",
    }));
    autoSeat({ tables, guests, options: AUTO_SEAT_DEFAULTS }); // calentamiento
    // Mejor de 5 con margen: con la suite en paralelo una sola medida fluctúa.
    const { best, result } = bestOf(5, () => autoSeat({ tables, guests, options: AUTO_SEAT_DEFAULTS }));
    expect(best).toBeLessThan(PERF_BUDGET_MS);
    expect(result.assignments.length).toBeGreaterThan(800);
  });

  it("no pasa de 120 mesas en total", () => {
    const guests = Array.from({ length: 200 }, () => guest());
    const tables = Array.from({ length: 118 }, (_, i) => table(`x${i}`, 1));
    const result = run(tables, guests, { newTableSeats: 10 });
    expect(result.newTables.length).toBe(2);
    expect(result.unplaced.length).toBe(200 - 118 - 20);
  });

  describe("restricciones (§3.5)", () => {
    it("«no sentar con…»: nunca en la misma mesa aunque compartan etiqueta", () => {
      const a = guest({ tags: ["Uni"] });
      const b = guest({ tags: ["Uni"] });
      const others = Array.from({ length: 3 }, () => guest({ tags: ["Uni"] }));
      const guests = [a, b, ...others];
      const result = run([table("t1"), table("t2")], guests, {}, [[a.id, b.id]]);
      const seats = finalSeats(guests, result);
      expect(seats.get(a.id)).not.toBeNull();
      expect(seats.get(b.id)).not.toBeNull();
      expect(seats.get(a.id)).not.toBe(seats.get(b.id));
      expect(result.conflicts).toEqual([]);
    });

    it("«no sentar con…» respeta a quien ya está sentado (keepCurrent) y crea mesa si hace falta", () => {
      const seated = guest({ tableId: "t1" });
      const ex = guest();
      const result = run([table("t1")], [seated, ex], {}, [[ex.id, seated.id]]);
      expect(result.assignments).toEqual([{ guestId: ex.id, tableId: "new:1" }]);
    });

    it("«no sentar con…» sin mesas nuevas: queda sin sitio con el motivo «apart»", () => {
      const seated = guest({ tableId: "t1" });
      const ex = guest();
      const result = run([table("t1")], [seated, ex], { allowNewTables: false }, [[seated.id, ex.id]]);
      expect(result.unplaced).toEqual([{ guestId: ex.id, reason: "apart" }]);
    });

    it("dos del mismo grupo que no deben sentarse juntos: gana el grupo y se avisa", () => {
      const fam = family(2);
      const result = run([table("t1")], fam, {}, [[fam[0].id, fam[1].id]]);
      const seats = finalSeats(fam, result);
      expect(seats.get(fam[0].id)).toBe(seats.get(fam[1].id));
      const [a, b] = [fam[0].id, fam[1].id].sort();
      expect(result.conflicts).toEqual([{ a, b }]);
    });

    it("el equilibrio final no junta a dos que no deben sentarse juntos", () => {
      const a = guest({ tags: ["Uni"], tableId: "t1" });
      const b = guest({ tags: ["Uni"] });
      const result = run([table("t1", 10), table("t2", 10)], [a, b], {}, [[a.id, b.id]]);
      const seats = finalSeats([a, b], result);
      expect(seats.get(b.id)).toBe("t2");
    });

    it("mesa fija: el grupo va a su mesa antes que nadie", () => {
      const fam = family(4, { group: "Familia de Lucía", tags: ["Pueblo"] });
      const pueblo = Array.from({ length: 8 }, () => guest({ tags: ["Pueblo"] }));
      const guests = [...pueblo, ...fam];
      const result = run([table("t1"), { ...table("t2"), pinnedGroup: "Familia de Lucía" }], guests);
      const seats = finalSeats(guests, result);
      expect(fam.every((g) => seats.get(g.id) === "t2")).toBe(true);
      expect(result.pinMissed).toEqual([]);
    });

    it("mesa fija que no basta: se coloca como siempre y se avisa", () => {
      const fam = family(6, { group: "Primos" });
      const result = run([{ ...table("t1", 4), pinnedGroup: "Primos" }, table("t2", 10)], fam);
      const seats = finalSeats(fam, result);
      expect(new Set(fam.map((g) => seats.get(g.id)))).toEqual(new Set(["t2"]));
      expect(result.pinMissed).toEqual(["Primos"]);
    });

    it("mesa fija: el equilibrio no saca a su grupo aunque sean dos", () => {
      const couple = family(2, { group: "Abuelos", tags: ["Familia"] });
      const others = Array.from({ length: 4 }, () => guest({ tags: ["Familia"] }));
      const guests = [...couple, ...others];
      const result = run([{ ...table("t1"), pinnedGroup: "Abuelos" }, table("t2")], guests);
      const seats = finalSeats(guests, result);
      expect(couple.every((g) => seats.get(g.id) === "t1")).toBe(true);
    });

    it("mesa infantil: los niños con nombre se sientan juntos y liberan sitio en la mesa de su familia", () => {
      const p1 = parent(2, { tags: ["Uni"] });
      const p2 = parent(1, { tags: ["Trabajo"] }, 1);
      const result = run([table("t1", 10), table("t2", 10)], [p1, p2], { kidsTable: true });
      expect(result.newTables).toEqual([{ key: "new:1", name: "Mesa infantil", seats: 10 }]);
      const kidIds = [...p1.companions!, p2.companions![0]].map((c) => c.id).sort();
      expect(result.companionAssignments).toEqual(kidIds.map((companionId) => ({ companionId, tableId: "new:1" })));
      expect(result.tables.find((t) => t.kids)!.used).toBe(3);
      // Los adultos ocupan solo lo suyo: 1 + (1 + el adulto acompañante de p2).
      expect(result.tables.filter((t) => !t.kids).reduce((sum, t) => sum + t.used, 0)).toBe(3);
      expect(result.seatedPeople).toBe(6);
    });

    it("mesa infantil: usa la que ya existe y nunca sienta adultos en ella", () => {
      const kidsParent = parent(2);
      const adults = Array.from({ length: 5 }, () => guest());
      const guests = [kidsParent, ...adults];
      const result = run([table("ti", 8, "Mesa infantil"), table("t1", 10)], guests, { kidsTable: true });
      expect(result.newTables).toEqual([]);
      const seats = finalSeats(guests, result);
      expect(guests.every((g) => seats.get(g.id) === "t1")).toBe(true);
      expect(result.companionAssignments.map((a) => a.tableId)).toEqual(["ti", "ti"]);
    });

    it("mesa infantil desactivada: «Reorganizar todo» devuelve a los niños con su familia", () => {
      const p = parent(1);
      p.companions![0].tableId = "ti";
      const result = run([table("ti", 8, "Mesa infantil"), table("t1")], [p], { keepCurrent: false, kidsTable: false });
      expect(result.companionAssignments).toEqual([{ companionId: p.companions![0].id, tableId: null }]);
      expect(result.tables.reduce((sum, t) => sum + t.used, 0)).toBe(2);
    });

    it("con la opción apagada, la mesa llamada «Mesa infantil» tampoco recibe adultos", () => {
      const adult = { ...parent(0), companions: [] };
      const result = run([table("ti", 8, "Mesa infantil"), table("t1", 10)], [adult], { kidsTable: false });
      expect(result.assignments).toEqual([{ guestId: adult.id, tableId: "t1" }]);
    });

    it("mesa infantil con keepCurrent: el niño ya sentado aparte no se mueve y su familia no le guarda sitio", () => {
      const p = parent(1, { tableId: "t1" });
      p.companions![0].tableId = "ti";
      const result = run([table("ti", 8, "Mesa infantil"), table("t1", 10)], [p], { kidsTable: true });
      expect(result.companionAssignments).toEqual([]);
      expect(result.tables.find((t) => t.tableId === "t1")!.used).toBe(1);
      expect(result.tables.find((t) => t.tableId === "ti")!.used).toBe(1);
    });

    it("mesa infantil sin sitio ni mesas nuevas: los niños se quedan con su familia", () => {
      const p = parent(2);
      const result = run([table("t1", 10)], [p], { kidsTable: true, allowNewTables: false });
      expect(result.kidsWithFamily).toBe(2);
      expect(result.companionAssignments).toEqual([]);
      expect(result.tables[0].used).toBe(3);
    });

    it("mesa infantil: más niños que plazas abre «Mesa infantil 2» y los hermanos no se separan", () => {
      const parents = Array.from({ length: 4 }, () => parent(3));
      const result = run([], parents, { kidsTable: true, newTableSeats: 8 });
      expect(result.newTables.filter((t) => t.name.startsWith("Mesa infantil")).map((t) => t.name)).toEqual(["Mesa infantil", "Mesa infantil 2"]);
      for (const p of parents) {
        const targets = new Set(result.companionAssignments.filter((a) => p.companions!.some((c) => c.id === a.companionId)).map((a) => a.tableId));
        expect(targets.size).toBe(1);
      }
    });

    it("pendientes sin incluir: sus niños no se mueven", () => {
      const p = parent(2, { status: "pendiente" });
      const result = run([table("t1")], [p], { kidsTable: true });
      expect(result.companionAssignments).toEqual([]);
      expect(result.newTables).toEqual([]);
    });

    it("nombres de la mesa infantil", () => {
      expect(isKidsTableName("Mesa Infantil")).toBe(true);
      expect(isKidsTableName("mesa infantil 3")).toBe(true);
      expect(isKidsTableName("Mesa 1")).toBe(false);
      expect(nextKidsTableName([{ name: "Mesa 1" }])).toBe("Mesa infantil");
      expect(nextKidsTableName([{ name: "Mesa infantil" }, { name: "Mesa infantil 2" }])).toBe("Mesa infantil 3");
    });

    it("rendimiento con restricciones: 1.000 invitados, 100 mesas, 200 pares y mesa infantil en menos de 150 ms (mejor de 5)", () => {
      const TAGS = ["Uni", "Trabajo de Juan", "Familia de Lucía", "Pueblo", "Pádel", "Amigos de los dos"];
      const tables = Array.from({ length: 100 }, (_, i) => ({ ...table(`t${String(i).padStart(3, "0")}`, 10, `Mesa ${i + 1}`), pinnedGroup: i < 5 ? `G${i}` : null }));
      const guests: AutoSeatGuest[] = Array.from({ length: 1000 }, (_, i) => (i % 7 === 0
        ? parent(1 + (i % 2), { group: i % 4 === 0 ? `G${Math.floor(i / 8)}` : null, tags: [TAGS[i % TAGS.length]] })
        : guest({ seats: 1 + (i % 3 === 0 ? 1 : 0), group: i % 4 === 0 ? `G${Math.floor(i / 8)}` : null, tags: i % 5 === 0 ? [] : [TAGS[i % TAGS.length]], side: (["p1", "p2", "ambos", null] as const)[i % 4] })));
      const apart: Array<[string, string]> = Array.from({ length: 200 }, (_, i) => [guests[i * 5].id, guests[i * 5 + 3].id]);
      const input = { tables, guests, options: { ...AUTO_SEAT_DEFAULTS, kidsTable: true }, apart };
      autoSeat(input); // calentamiento
      const { best, result } = bestOf(5, () => autoSeat(input));
      expect(best).toBeLessThan(PERF_BUDGET_MS);
      expect(result.companionAssignments.length).toBeGreaterThan(100);
      // Ningún par prohibido acaba junto salvo que sean del mismo grupo.
      const seats = finalSeats(guests, result);
      const groupOf = new Map(guests.map((g) => [g.id, g.group]));
      for (const [a, b] of apart) {
        if (seats.get(a) && seats.get(a) === seats.get(b)) expect(groupOf.get(a) !== null && groupOf.get(a) === groupOf.get(b)).toBe(true);
      }
    });
  });

  it("hasAffinityData", () => {
    expect(hasAffinityData([{ tags: [], side: null }])).toBe(false);
    expect(hasAffinityData([{ tags: [], side: "p1" }])).toBe(true);
  });
});

describe("invariantes con bodas generadas (semilla fija)", () => {
  /** Generador congruente: mismas semillas, mismas bodas. */
  function rng(seed: number) {
    let s = seed;
    return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  }
  const TAGS = ["Uni", "Trabajo", "Pueblo", "Familia de Lucía", "Familia de Juan"];
  const SIDES = ["p1", "p2", "ambos", null] as const;
  for (const seed of [1, 7, 42, 99, 2026]) {
    it(`semilla ${seed}: grupos enteros, plazas respetadas, sentados a mano quietos y determinista`, () => {
      const r = rng(seed);
      const tables = Array.from({ length: 6 }, (_, i) => table(`t${i}`, 6 + Math.floor(r() * 7)));
      const guests: AutoSeatGuest[] = [];
      for (let i = 0; i < 40; i += 1) {
        const tags = r() < 0.7 ? [TAGS[Math.floor(r() * TAGS.length)]!] : [];
        const side = SIDES[Math.floor(r() * SIDES.length)]!;
        const status = r() < 0.75 ? "si" : r() < 0.5 ? "pendiente" : "no";
        const group = r() < 0.5 ? `G${Math.floor(r() * 10)}` : null;
        const seated = r() < 0.15 ? tables[Math.floor(r() * tables.length)]!.id : null;
        guests.push(guest({ id: `s${seed}-${String(i).padStart(2, "0")}`, seats: 1 + Math.floor(r() * 3), tags, side, status, group, tableId: seated }));
      }
      const result = run(tables, guests);
      expect(run(tables, [...guests].reverse())).toEqual(result);
      const seats = finalSeats(guests, result);
      // Los sentados a mano no se mueven.
      for (const g of guests) if (g.tableId) expect(seats.get(g.id)).toBe(g.tableId);
      // Los de un mismo grupo que la propuesta coloca van a una sola mesa.
      const moved = new Set(result.assignments.map((a) => a.guestId));
      const byGroup = new Map<string, Set<string | null>>();
      for (const g of guests) if (g.group && moved.has(g.id)) byGroup.set(g.group, (byGroup.get(g.group) ?? new Set()).add(seats.get(g.id) ?? null));
      for (const [, set] of byGroup) expect(set.size).toBe(1);
      // Ninguna mesa que la propuesta toca acaba por encima de sus plazas.
      for (const t of result.tables) if (t.added > 0) expect(t.used).toBeLessThanOrEqual(t.seats);
    });
  }
});
