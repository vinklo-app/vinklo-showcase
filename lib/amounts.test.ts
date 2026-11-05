import { describe, expect, it } from "vitest";
import { parseEsAmountToCents } from "./amounts";

describe("parseEsAmountToCents", () => {
  it("enteros y decimales con coma (es-ES)", () => {
    expect(parseEsAmountToCents("150")).toBe(15000);
    expect(parseEsAmountToCents("150,5")).toBe(15050);
    expect(parseEsAmountToCents("150,50")).toBe(15050);
  });

  it("punto de miles es-ES", () => {
    expect(parseEsAmountToCents("1.000")).toBe(100000);
    expect(parseEsAmountToCents("1.000,00")).toBe(100000);
    expect(parseEsAmountToCents("1.000,50")).toBe(100050);
    expect(parseEsAmountToCents("12.345.678")).toBe(1234567800);
  });

  it("punto decimal estilo teclado anglo", () => {
    expect(parseEsAmountToCents("150.50")).toBe(15050);
    expect(parseEsAmountToCents("150.5")).toBe(15050);
    // "1.0000" no agrupa de tres en tres ni es decimal válido → null
    expect(parseEsAmountToCents("1.0000")).toBeNull();
  });

  it("espacios y símbolo de euro", () => {
    expect(parseEsAmountToCents("1 000,50")).toBe(100050);
    expect(parseEsAmountToCents("150 €")).toBe(15000);
    expect(parseEsAmountToCents(" 150€ ")).toBe(15000);
  });

  it("entradas inválidas → null", () => {
    expect(parseEsAmountToCents("")).toBeNull();
    expect(parseEsAmountToCents("abc")).toBeNull();
    expect(parseEsAmountToCents("150,555")).toBeNull();
    expect(parseEsAmountToCents("-150")).toBeNull();
    expect(parseEsAmountToCents("1,000.50")).toBeNull(); // formato en-US con coma de miles: ambiguo, rechazado
    expect(parseEsAmountToCents("1.00,5")).toBeNull();
  });
});
