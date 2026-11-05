import { describe, expect, it } from "vitest";
import { clampSeats, floorPlanModelSchema, floorPlanRowsError, matchExistingTables, normalizeFloorPlan, normalizeShape, tableNameFromLabel, toSaveRows } from "./floor-plan";

describe("floorPlanModelSchema", () => {
  it("acepta la salida esperada del modelo y rechaza formas desconocidas", () => {
    expect(floorPlanModelSchema.safeParse({ tables: [{ label: "1", shape: "redonda", seats: 10, x: 0.2, y: 0.3 }], notes: "" }).success).toBe(true);
    expect(floorPlanModelSchema.safeParse({ tables: [{ label: "1", shape: "ovalada", seats: 10, x: 0.2, y: 0.3 }], notes: "" }).success).toBe(false);
  });
});

describe("normalizeFloorPlan", () => {
  it("corrige plazas (1–30), posición (0–1), forma y nombres", () => {
    const reading = normalizeFloorPlan({
      tables: [
        { label: "1", shape: "redonda", seats: 10, x: 0.25, y: 0.5 },
        { label: " Presidencial ", shape: "imperial", seats: 44, x: 1.4, y: -0.2 },
        { label: "", shape: "round", seats: 0, x: 50, y: 25 },
        { label: "mesa nº 7", shape: "cuadrada", seats: null, x: "a", y: 0.1 },
        { label: "1", shape: "rectangular", seats: 8.6, x: 0.9, y: 0.9 },
      ],
      notes: "  No se leen   las plazas del fondo. ",
    });
    expect(reading.tables).toEqual([
      { key: "d1", id: null, name: "Mesa 1", shape: "redonda", seats: 10, x: 0.25, y: 0.5 },
      { key: "d2", id: null, name: "Presidencial", shape: "imperial", seats: 30, x: 1, y: 0 },
      { key: "d3", id: null, name: "Mesa 2", shape: "redonda", seats: 1, x: 0.5, y: 0.25 },
      { key: "d4", id: null, name: "Mesa 7", shape: "cuadrada", seats: 10, x: null, y: null },
      { key: "d5", id: null, name: "Mesa 1 (2)", shape: "rectangular", seats: 9, x: 0.9, y: 0.9 },
    ]);
    expect(reading.notes).toBe("No se leen las plazas del fondo.");
  });
  it("nunca lanza con basura y corta a 120 mesas", () => {
    expect(normalizeFloorPlan(null)).toEqual({ tables: [], notes: "" });
    expect(normalizeFloorPlan({ tables: "x" })).toEqual({ tables: [], notes: "" });
    expect(normalizeFloorPlan({ tables: [null, 3, { label: "A" }] }).tables).toHaveLength(1);
    const many = normalizeFloorPlan({ tables: Array.from({ length: 150 }, (_, i) => ({ label: String(i + 1), shape: "redonda", seats: 10, x: 0, y: 0 })) });
    expect(many.tables).toHaveLength(120);
  });
  it("piezas sueltas", () => {
    expect(normalizeShape("Rectangle")).toBe("rectangular");
    expect(normalizeShape("hexagonal")).toBe("otra");
    expect(clampSeats("12")).toBe(12);
    expect(clampSeats(Infinity)).toBe(10);
    expect(tableNameFromLabel("x".repeat(60))).toHaveLength(40);
    expect(tableNameFromLabel("  ")).toBeNull();
  });
});

describe("revisar y guardar", () => {
  const existing = [{ id: "t1", name: "Mesa 1" }, { id: "t2", name: "Novios" }];
  it("une con las mesas que ya existen por nombre (sin mayúsculas ni tildes)", () => {
    const rows = matchExistingTables(normalizeFloorPlan({ tables: [{ label: "1" }, { label: "NOVIOS" }, { label: "3" }] }).tables, existing);
    expect(rows.map((row) => row.id)).toEqual(["t1", "t2", null]);
  });
  it("valida nombres repetidos, choques con mesas no tocadas y plazas", () => {
    const rows = matchExistingTables(normalizeFloorPlan({ tables: [{ label: "1" }, { label: "3" }] }).tables, existing);
    expect(floorPlanRowsError(rows, existing)).toBeNull();
    expect(floorPlanRowsError([], existing)).toBe("No hay ninguna mesa que guardar.");
    expect(floorPlanRowsError([{ ...rows[1]!, name: "novios" }], existing)).toMatch(/Ya tenéis una mesa llamada «Novios»/);
    expect(floorPlanRowsError([rows[0]!, { ...rows[1]!, name: "mesa 1" }], existing)).toMatch(/Hay dos mesas llamadas/);
    expect(floorPlanRowsError([{ ...rows[1]!, seats: 31 }], existing)).toMatch(/de 1 a 30 plazas/);
    expect(floorPlanRowsError([{ ...rows[1]!, name: "  " }], existing)).toBe("Poned un nombre a cada mesa.");
  });
  it("filas para save_floor_plan", () => {
    expect(toSaveRows([{ key: "d1", id: null, name: "  Mesa   9 ", shape: "redonda", seats: 8, x: 0.1, y: 0.2 }])).toEqual([
      { id: null, name: "Mesa 9", shape: "redonda", seats: 8, x: 0.1, y: 0.2 },
    ]);
  });
});
