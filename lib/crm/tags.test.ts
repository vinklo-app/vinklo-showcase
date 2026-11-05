import { describe, expect, it } from "vitest";
import {
  SIDE_LABELS, TAGS_PER_GUEST, TAG_MAX, canonicalTag, isGuestSide, normalizeTag, normalizeTags, parseSideFilter, parseTagFilter,
  sideRpcParam, suggestedTags, tagNames, visibleTags,
} from "./tags";

describe("etiquetas (puro)", () => {
  it("normaliza: espacios colapsados, recortada, vacía → null", () => {
    expect(normalizeTag("  Amigos \t de  la uni ")).toBe("Amigos de la uni");
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag(42)).toBeNull();
  });
  it("reutiliza la forma existente sin distinguir mayúsculas ni tildes", () => {
    expect(canonicalTag("amigos de la uni", ["Amigos de la Uni"])).toBe("Amigos de la Uni");
    expect(canonicalTag("familia de ines", ["Familia de Inés"])).toBe("Familia de Inés");
    expect(canonicalTag("Pueblo", ["Trabajo"])).toBe("Pueblo");
    expect(canonicalTag("", ["Trabajo"])).toBeNull();
  });
  it("normalizeTags: canónicas, sin repetidas, sin vacías ni largas y como mucho 8", () => {
    expect(normalizeTags([" uni ", "Uni", "UNI", "", "Trabajo"], ["Uni"])).toEqual(["Uni", "Trabajo"]);
    expect(normalizeTags(["x".repeat(TAG_MAX + 1), "ok"])).toEqual(["ok"]);
    expect(normalizeTags(["x".repeat(TAG_MAX)])).toHaveLength(1);
    expect(normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(TAGS_PER_GUEST);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags([null, 3, "a"])).toEqual(["a"]);
  });
  it("sugerencias con los nombres de la pareja (y un respaldo sin nombres)", () => {
    expect(suggestedTags("Lucía", "Juan")).toEqual([
      "Familia de Lucía", "Familia de Juan", "Amigos de Lucía", "Amigos de Juan", "Amigos de los dos",
      "Trabajo de Lucía", "Trabajo de Juan", "Pueblo",
    ]);
    expect(suggestedTags("Lucía Pérez", "")[0]).toBe("Familia de Lucía");
    // Caben en una etiqueta aunque el nombre sea largo.
    for (const tag of suggestedTags("Maximiliana-Concepción", "Bartolomeo")) expect(tag.length).toBeLessThanOrEqual(TAG_MAX);
  });
  it("etiquetas del lado", () => {
    expect(SIDE_LABELS("Lucía", "Juan")).toEqual({ p1: "De Lucía", p2: "De Juan", ambos: "De los dos" });
    expect(isGuestSide("p1")).toBe(true);
    expect(isGuestSide("novio")).toBe(false);
  });
  it("filtros de URL y parámetros de la RPC", () => {
    expect(parseSideFilter("p2")).toBe("p2");
    expect(parseSideFilter("sin")).toBe("none");
    expect(parseSideFilter("x")).toBeNull();
    expect(sideRpcParam(null)).toBeUndefined();
    expect(sideRpcParam("none")).toBe("");
    expect(sideRpcParam("ambos")).toBe("ambos");
    expect(parseTagFilter("  Uni ")).toBe("Uni");
    expect(parseTagFilter("x".repeat(31))).toBeNull();
    expect(parseTagFilter(["Uni"])).toBeNull();
  });
  it("fichas visibles y «+N»", () => {
    expect(visibleTags(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], more: 2 });
    expect(visibleTags(["a"], 1)).toEqual({ shown: ["a"], more: 0 });
    expect(visibleTags(undefined)).toEqual({ shown: [], more: 0 });
    expect(tagNames([{ tag: "Uni", guests: 1, confirmed: 0, attendees: 0 }])).toEqual(["Uni"]);
  });
});
