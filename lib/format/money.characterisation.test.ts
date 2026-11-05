/**
 * Caracterización (Tarea 9): salida de los formateadores de dinero ANTES de
 * consolidarlos en lib/format/money.ts. Los literales se capturaron de las
 * implementaciones originales (NBSP = \u00a0, signo menos = \u2212); si
 * cambia un byte, esta prueba falla.
 */
import { describe, expect, it } from "vitest";
import { centsToInput as giftsCentsToInput } from "@/components/panel/gifts";
import { formatEuros as giftsEuros } from "@/lib/format/money";
import { formatEuros as planningEuros, centsToInput as planningCentsToInput } from "@/lib/planning/money";
import { fmtEur } from "@/app/admin/_components/format";
import { formatEurCents } from "@/lib/fees";
import { centsToDecimalComma, formatEuros } from "@/lib/format/money";

type Row = [number, string];
const GIFTS: Row[] = [
  [0, "0 \u20ac"],
  [1, "0,01 \u20ac"],
  [5, "0,05 \u20ac"],
  [10, "0,10 \u20ac"],
  [99, "0,99 \u20ac"],
  [100, "1 \u20ac"],
  [101, "1,01 \u20ac"],
  [150, "1,50 \u20ac"],
  [1500, "15 \u20ac"],
  [15000, "150 \u20ac"],
  [99999, "999,99 \u20ac"],
  [100000, "1.000 \u20ac"],
  [100001, "1.000,01 \u20ac"],
  [123450, "1.234,50 \u20ac"],
  [125050, "1.250,50 \u20ac"],
  [1234567, "12.345,67 \u20ac"],
  [10000000, "100.000 \u20ac"],
  [999999999, "9.999.999,99 \u20ac"],
  [-1, "-0,01 \u20ac"],
  [-50, "-0,50 \u20ac"],
  [-99, "-0,99 \u20ac"],
  [-100, "-1 \u20ac"],
  [-101, "-1,01 \u20ac"],
  [-12345, "-123,45 \u20ac"],
  [-125050, "-1.250,50 \u20ac"],
];
const PLANNING: Row[] = [
  [0, "0 \u20ac"],
  [1, "0,01 \u20ac"],
  [5, "0,05 \u20ac"],
  [10, "0,10 \u20ac"],
  [99, "0,99 \u20ac"],
  [100, "1 \u20ac"],
  [101, "1,01 \u20ac"],
  [150, "1,50 \u20ac"],
  [1500, "15 \u20ac"],
  [15000, "150 \u20ac"],
  [99999, "999,99 \u20ac"],
  [100000, "1.000 \u20ac"],
  [100001, "1.000,01 \u20ac"],
  [123450, "1.234,50 \u20ac"],
  [125050, "1.250,50 \u20ac"],
  [1234567, "12.345,67 \u20ac"],
  [10000000, "100.000 \u20ac"],
  [999999999, "9.999.999,99 \u20ac"],
  [-1, "\u22120,01 \u20ac"],
  [-50, "\u22120,50 \u20ac"],
  [-99, "\u22120,99 \u20ac"],
  [-100, "\u22121 \u20ac"],
  [-101, "\u22121,01 \u20ac"],
  [-12345, "\u2212123,45 \u20ac"],
  [-125050, "\u22121.250,50 \u20ac"],
];
const PLANNING_INPUT: Row[] = [
  [0, "0"],
  [1, "0,01"],
  [5, "0,05"],
  [10, "0,10"],
  [99, "0,99"],
  [100, "1"],
  [101, "1,01"],
  [150, "1,50"],
  [1500, "15"],
  [15000, "150"],
  [99999, "999,99"],
  [100000, "1.000"],
  [100001, "1.000,01"],
  [123450, "1.234,50"],
  [125050, "1.250,50"],
  [1234567, "12.345,67"],
  [10000000, "100.000"],
  [999999999, "9.999.999,99"],
  [-1, "\u22120,01"],
  [-50, "\u22120,50"],
  [-99, "\u22120,99"],
  [-100, "\u22121"],
  [-101, "\u22121,01"],
  [-12345, "\u2212123,45"],
  [-125050, "\u22121.250,50"],
];
const ADMIN: Row[] = [
  [0, "0,00 \u20ac"],
  [1, "0,01 \u20ac"],
  [5, "0,05 \u20ac"],
  [10, "0,10 \u20ac"],
  [99, "0,99 \u20ac"],
  [100, "1,00 \u20ac"],
  [101, "1,01 \u20ac"],
  [150, "1,50 \u20ac"],
  [1500, "15,00 \u20ac"],
  [15000, "150,00 \u20ac"],
  [99999, "999,99 \u20ac"],
  [100000, "1.000,00 \u20ac"],
  [100001, "1.000,01 \u20ac"],
  [123450, "1.234,50 \u20ac"],
  [125050, "1.250,50 \u20ac"],
  [1234567, "12.345,67 \u20ac"],
  [10000000, "100.000,00 \u20ac"],
  [999999999, "9.999.999,99 \u20ac"],
  [-1, "-0,01 \u20ac"],
  [-50, "-0,50 \u20ac"],
  [-99, "-0,99 \u20ac"],
  [-100, "-1,00 \u20ac"],
  [-101, "-1,01 \u20ac"],
  [-12345, "-123,45 \u20ac"],
  [-125050, "-1.250,50 \u20ac"],
];
const FEES: Row[] = [
  [0, "0,00\u00a0\u20ac"],
  [1, "0,01\u00a0\u20ac"],
  [5, "0,05\u00a0\u20ac"],
  [10, "0,10\u00a0\u20ac"],
  [99, "0,99\u00a0\u20ac"],
  [100, "1,00\u00a0\u20ac"],
  [101, "1,01\u00a0\u20ac"],
  [150, "1,50\u00a0\u20ac"],
  [1500, "15,00\u00a0\u20ac"],
  [15000, "150,00\u00a0\u20ac"],
  [99999, "999,99\u00a0\u20ac"],
  [100000, "1000,00\u00a0\u20ac"],
  [100001, "1000,01\u00a0\u20ac"],
  [123450, "1234,50\u00a0\u20ac"],
  [125050, "1250,50\u00a0\u20ac"],
  [1234567, "12.345,67\u00a0\u20ac"],
  [10000000, "100.000,00\u00a0\u20ac"],
  [999999999, "9.999.999,99\u00a0\u20ac"],
  [-1, "-0,01\u00a0\u20ac"],
  [-50, "-0,50\u00a0\u20ac"],
  [-99, "-0,99\u00a0\u20ac"],
  [-100, "-1,00\u00a0\u20ac"],
  [-101, "-1,01\u00a0\u20ac"],
  [-12345, "-123,45\u00a0\u20ac"],
  [-125050, "-1250,50\u00a0\u20ac"],
];

describe("caracterización del dinero", () => {
  it("components/panel/gifts formatEuros", () => { for (const [c, out] of GIFTS) expect(giftsEuros(c), String(c)).toBe(out); });
  it("lib/planning/money formatEuros (signo menos U+2212)", () => { for (const [c, out] of PLANNING) expect(planningEuros(c), String(c)).toBe(out); });
  it("lib/planning/money centsToInput", () => { for (const [c, out] of PLANNING_INPUT) expect(planningCentsToInput(c), String(c)).toBe(out); });
  it("admin fmtEur (siempre dos decimales)", () => { for (const [c, out] of ADMIN) expect(fmtEur(c), String(c)).toBe(out); });
  it("lib/fees formatEurCents (Intl: NBSP, sin miles en 4 cifras)", () => { for (const [c, out] of FEES) expect(formatEurCents(c), String(c)).toBe(out); });
  it("gifts centsToInput", () => {
    expect(giftsCentsToInput(125050)).toBe("1250,50");
    expect(giftsCentsToInput(15000)).toBe("150");
    expect(giftsCentsToInput(null)).toBe("");
  });
  it("gifts: céntimos fraccionarios se redondean; no finito = «0 €»", () => {
    expect(giftsEuros(150.6)).toBe("1,51 €");
    expect(giftsEuros(150.4)).toBe("1,50 €");
    expect(giftsEuros(-150.6)).toBe("-1,51 €");
    expect(giftsEuros(Number.NaN)).toBe("0 €");
    expect(giftsEuros(Number.POSITIVE_INFINITY)).toBe("0 €");
  });
  it("planning: céntimos fraccionarios se truncan", () => {
    expect(planningEuros(150.6)).toBe("1,50 €");
    expect(planningEuros(-150.6)).toBe("\u22121,50 €");
  });
});

describe("fmtEur: único cambio deliberado", () => {
  // Antes, de -1 a -99 céntimos perdía el signo («0,50 €» para -50): el admin
  // solo suma cobros confirmados (>= 0), así que se corrige al unificar.
  it("conserva el signo entre -1 y -99", () => {
    expect(fmtEur(-50)).toBe("-0,50 €");
    expect(fmtEur(-1)).toBe("-0,01 €");
  });
});

describe("opciones de formatEuros", () => {
  it("cents never / always", () => {
    expect(formatEuros(125050, { cents: "never" })).toBe("1.250 €");
    expect(formatEuros(15000, { cents: "always" })).toBe("150,00 €");
  });
});

describe("caracterización de los CSV (coma decimal, sin símbolo)", () => {
  const reference = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  it("centsToDecimalComma = la expresión original de los cuatro sitios", () => {
    for (const c of [0, 1, 5, 99, 100, 15000, 125050, 10_000_000, -12345, 150.6]) expect(centsToDecimalComma(c), String(c)).toBe(reference(c));
    expect(centsToDecimalComma(15000)).toBe("150,00");
    expect(centsToDecimalComma(125050)).toBe("1250,50");
  });
});
