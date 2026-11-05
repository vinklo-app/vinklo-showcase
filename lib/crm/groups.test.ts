import { describe, expect, it } from "vitest";
import { canonicalGroupName, groupNames, groupRpcParam, normalizeGroupName, parseGroupFilter, sameGroupFilter } from "./groups";

describe("grupos (puro)", () => {
  it("normaliza: espacios colapsados, recortado, vacío → null", () => {
    expect(normalizeGroupName("  Familia \t de  Elena ")).toBe("Familia de Elena");
    expect(normalizeGroupName("   ")).toBeNull();
    expect(normalizeGroupName(undefined)).toBeNull();
  });
  it("reutiliza la forma de un grupo existente sin distinguir mayúsculas ni tildes", () => {
    expect(canonicalGroupName("familia de elena", ["Familia de Elena", "Trabajo"])).toBe("Familia de Elena");
    expect(canonicalGroupName("Vecinos del 3.º", ["Vecinos"])).toBe("Vecinos del 3.º");
    expect(canonicalGroupName("amigos de ines", ["Amigos de Inés"])).toBe("Amigos de Inés");
    expect(canonicalGroupName(" ", ["Trabajo"])).toBeNull();
  });
  it("URL → filtro y filtro → p_group", () => {
    expect(parseGroupFilter({ grupo: "Trabajo" })).toEqual({ kind: "named", name: "Trabajo" });
    expect(parseGroupFilter({ singrupo: "1", grupo: "Trabajo" })).toEqual({ kind: "none" });
    expect(parseGroupFilter({ grupo: "x".repeat(41) })).toEqual({ kind: "all" });
    expect(parseGroupFilter({ grupo: ["a"] })).toEqual({ kind: "all" });
    expect(groupRpcParam(undefined)).toBeUndefined();
    expect(groupRpcParam({ kind: "none" })).toBe("");
    expect(groupRpcParam({ kind: "named", name: "Trabajo" })).toBe("Trabajo");
  });
  it("compara filtros y saca los nombres en uso", () => {
    expect(sameGroupFilter(undefined, { kind: "all" })).toBe(true);
    expect(sameGroupFilter({ kind: "named", name: "A" }, { kind: "named", name: "B" })).toBe(false);
    expect(groupNames([{ name: "A", guests: 1, confirmed: 0, declined: 0, pending: 1, attendees: 0 }, { name: null, guests: 2, confirmed: 0, declined: 0, pending: 2, attendees: 0 }])).toEqual(["A"]);
  });
});
