import { describe, expect, it } from "vitest";
import { parseCompanionLimit } from "./companion-limit";

describe("tope de acompañantes (puro)", () => {
  it("vacío = sin límite; acota a 0–10 y trunca", () => {
    expect(parseCompanionLimit("")).toBeNull();
    expect(parseCompanionLimit("  ")).toBeNull();
    expect(parseCompanionLimit("0")).toBe(0);
    expect(parseCompanionLimit("3")).toBe(3);
    expect(parseCompanionLimit("2.7")).toBe(2);
    expect(parseCompanionLimit("25")).toBe(10);
    expect(parseCompanionLimit("-4")).toBe(0);
    expect(parseCompanionLimit("abc")).toBeNull();
  });
});
