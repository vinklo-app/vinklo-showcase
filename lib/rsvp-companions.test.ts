import { describe, expect, it } from "vitest";
import { companionListFromRows, kidsFromRows, normalizeCompanionName, parseCompanionList, resizeCompanionRows } from "./rsvp-companions";

describe("nombres de acompañantes", () => {
  it("normaliza nombres: recorta, colapsa espacios, vacío = null, máximo 80", () => {
    expect(normalizeCompanionName("  Lucía   García ")).toBe("Lucía García");
    expect(normalizeCompanionName("   ")).toBeNull();
    expect(normalizeCompanionName(3)).toBeNull();
    expect(normalizeCompanionName("x".repeat(90))).toHaveLength(80);
  });
  it("solo filas con nombre, sin repetidas y como mucho tantas como acompañantes", () => {
    const rows = [{ name: "Leo", kid: true }, { name: "", kid: true }, { name: "leo ", kid: false }, { name: "Marta", kid: false }];
    expect(companionListFromRows(rows, 4)).toEqual([{ name: "Leo", kid: true }, { name: "Marta", kid: false }]);
    expect(companionListFromRows(rows, 1)).toEqual([{ name: "Leo", kid: true }]);
    expect(companionListFromRows(rows, 0)).toEqual([]);
  });
  it("los niños cuentan aunque no tengan nombre, dentro del número de acompañantes", () => {
    const rows = [{ name: "", kid: true }, { name: "Ana", kid: true }, { name: "", kid: true }];
    expect(kidsFromRows(rows, 2)).toBe(2);
    expect(kidsFromRows(rows, 3)).toBe(3);
  });
  it("redimensiona conservando lo escrito", () => {
    expect(resizeCompanionRows([{ name: "Leo", kid: true }], 3)).toEqual([{ name: "Leo", kid: true }, { name: "", kid: false }, { name: "", kid: false }]);
    expect(resizeCompanionRows([{ name: "Leo", kid: true }, { name: "Ana", kid: false }], 1)).toEqual([{ name: "Leo", kid: true }]);
    expect(resizeCompanionRows([], 20)).toHaveLength(10);
  });
  it("lee la lista de guest_rsvp_current y descarta lo que no encaja", () => {
    expect(parseCompanionList([{ name: "Leo", kid: true }, { name: "" }, null, { name: "Ana" }])).toEqual([{ name: "Leo", kid: true }, { name: "Ana", kid: false }]);
    expect(parseCompanionList("x")).toEqual([]);
  });
});
