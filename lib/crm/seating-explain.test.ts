import { describe, expect, it } from "vitest";
import { autoSeat, AUTO_SEAT_DEFAULTS, type AutoSeatGuest } from "./auto-seating";
import {
  KIDS_TABLE_EXPLANATION, buildExplainTables, cleanExplanation, explainTablesSchema, sideNames, templateExplanation, withPartnerNames,
  type ExplainTable,
} from "./seating-explain";

const guest = (id: string, opts: Partial<AutoSeatGuest> = {}): AutoSeatGuest => ({
  id, name: `Nombre ${id}`, seats: 1, group: null, tags: [], side: null, tableId: null, status: "si", ...opts,
});
const sides = sideNames("Lucía", "Juan");

describe("buildExplainTables", () => {
  const guests = [
    guest("a1", { group: "García", seats: 3, tags: ["Familia de Lucía"], side: "p1" }),
    guest("a2", { group: "García", tags: ["Familia de Lucía"], side: "p1" }),
    guest("b1", { tags: ["Familia de Lucía"], side: "p1" }),
    guest("c1", { tags: ["Trabajo de Juan"], side: "p2", seats: 2 }),
    guest("n1", { status: "no", tags: ["Trabajo de Juan"] }),
  ];
  const input = { tables: [{ id: "t1", name: "Mesa 1", seats: 6 }, { id: "t2", name: "Mesa 2", seats: 6 }], guests, options: AUTO_SEAT_DEFAULTS };
  it("una entrada anónima por mesa tocada: alias, grupos (tamaño, etiquetas, lado), dominantes y lados", () => {
    const result = autoSeat(input);
    const { tables, aliases } = buildExplainTables(guests, result, false);
    expect(tables).toEqual([
      { tableId: "m1", groups: [{ size: 4, tags: ["Familia de Lucía"], side: "p1" }, { size: 1, tags: ["Familia de Lucía"], side: "p1" }], dominantTags: ["Familia de Lucía"], sides: ["p1"] },
      { tableId: "m2", groups: [{ size: 2, tags: ["Trabajo de Juan"], side: "p2" }], dominantTags: ["Trabajo de Juan"], sides: ["p2"] },
    ]);
    expect([...aliases]).toEqual([["m1", "t1"], ["m2", "t2"]]);
    expect(explainTablesSchema.safeParse(tables).success).toBe(true);
  });
  it("no lleva nombres, ids reales ni nada fuera de la lista blanca", () => {
    const { tables } = buildExplainTables(guests, autoSeat(input), false);
    const json = JSON.stringify(tables);
    for (const leak of ["Nombre", "a1", "t1", "García", "Mesa 1", "notes", "name"]) expect(json).not.toContain(leak);
  });
  it("las etiquetas de salud, dieta o discapacidad no salen del navegador", () => {
    const sensitive = [
      guest("s1", { tags: ["Celíacos", "Amigos de la uni"] }),
      guest("s2", { tags: ["Vegetariano", "Amigos de la uni"] }),
      guest("s3", { tags: ["ALÉRGICO al marisco", "Amigos de la uni"] }),
    ];
    const { tables } = buildExplainTables(sensitive, autoSeat({ ...input, guests: sensitive }), false);
    const json = JSON.stringify(tables);
    expect(json).toContain("Amigos de la uni");
    for (const leak of ["Celíac", "Vegetarian", "lérgic", "marisco"]) expect(json).not.toContain(leak);
  });
  it("determinista", () => {
    expect(buildExplainTables(guests, autoSeat(input), false)).toEqual(buildExplainTables(guests, autoSeat(input), false));
  });
});

describe("templateExplanation (sin IA)", () => {
  const t = (groups: ExplainTable["groups"], dominantTags: string[], s: ExplainTable["sides"] = []): ExplainTable => ({ tableId: "m1", groups, dominantTags, sides: s });
  it("una frase corta para cada caso", () => {
    expect(templateExplanation(t([{ size: 6, tags: ["Uni"], side: null }], ["Uni"]), sides)).toBe("Un grupo de 6 que no se separa, con la etiqueta «Uni».");
    expect(templateExplanation(t([{ size: 4, tags: ["Uni"], side: null }, { size: 2, tags: ["Uni", "Pueblo"], side: null }], ["Uni", "Pueblo"]), sides)).toBe("Juntamos 2 grupos que comparten «Uni».");
    expect(templateExplanation(t([{ size: 4, tags: ["Uni"], side: null }, { size: 2, tags: ["Pueblo"], side: null }], ["Uni", "Pueblo"]), sides)).toBe("La mayoría comparte «Uni»; el resto, «Pueblo» u otras afinidades.");
    expect(templateExplanation(t([{ size: 2, tags: [], side: "p1" }, { size: 1, tags: [], side: "p1" }], [], ["p1"]), sides)).toBe("Sin etiquetas en común: juntamos a invitados de Lucía.");
    expect(templateExplanation(t([{ size: 2, tags: [], side: "p1" }, { size: 1, tags: [], side: "p2" }], [], ["p1", "p2"]), sides)).toMatch(/de los dos lados/);
    expect(templateExplanation(t([{ size: 3, tags: [], side: null }], []), sides)).toBe("Un grupo de 3 que no se separa.");
    expect(KIDS_TABLE_EXPLANATION).toMatch(/niños/);
  });
});

describe("cleanExplanation y withPartnerNames", () => {
  it("una línea, sin enlaces ni marcas, recortada; {p1}/{p2} se respetan y los pone el navegador", () => {
    expect(cleanExplanation("  Amigos de\n la uni  juntos. ")).toBe("Amigos de la uni juntos.");
    expect(cleanExplanation("Mirad https://x.y")).toBeNull();
    expect(cleanExplanation("Escribid a a@b.c")).toBeNull();
    expect(cleanExplanation("<b>hola</b>")).toBeNull();
    expect(cleanExplanation("Hola {nombre}")).toBeNull();
    expect(cleanExplanation(42)).toBeNull();
    expect(cleanExplanation("x ".repeat(200))!.length).toBeLessThanOrEqual(160);
    expect(withPartnerNames(cleanExplanation("Invitados de {p1} y de {p2}.")!, "Lucía", "Juan")).toBe("Invitados de Lucía y de Juan.");
  });
});
