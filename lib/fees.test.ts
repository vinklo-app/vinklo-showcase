import { describe, expect, it } from "vitest";

import {
  SERVICE_FEE_FIXED_CENTS,
  SERVICE_FEE_MIN_CENTS,
  SERVICE_FEE_RATE,
  formatEurCents,
  serviceFeeCents,
  totalChargeCents,
} from "./fees";

/** Intl es-ES uses NBSP (U+00A0) before "€" — normalize to plain spaces. */
function normalizeSpaces(value: string): string {
  return value.replace(/[\u00A0\u202F]/g, " ");
}

describe("constants", () => {
  it("match the published pricing (1,9 % + 0,95 €, mínimo 1,50 €)", () => {
    expect(SERVICE_FEE_RATE).toBe(0.019);
    expect(SERVICE_FEE_FIXED_CENTS).toBe(95);
    expect(SERVICE_FEE_MIN_CENTS).toBe(150);
  });

  it("stays above the structural floor (Stripe ~1,5 % + 0,25 €) at any amount", () => {
    // margen = fee − 1,5 % × (contribución + fee) − 25¢ debe ser > 0
    for (const cents of [1000, 6000, 15000, 30000, 50000, 100000]) {
      const fee = serviceFeeCents(cents);
      const stripeCost = Math.round((cents + fee) * 0.015) + 25;
      expect(fee).toBeGreaterThan(stripeCost);
    }
  });
});

describe("serviceFeeCents", () => {
  it("applies the 1,50 € minimum on small amounts", () => {
    // 0 → 0 + 95 = 95 < 150 → mínimo
    expect(serviceFeeCents(0)).toBe(150);
    // 1 * 0.019 ≈ 0 → 95 → mínimo
    expect(serviceFeeCents(1)).toBe(150);
    // 2000 * 0.019 = 38 → 133 → mínimo
    expect(serviceFeeCents(2000)).toBe(150);
    // justo por encima del mínimo: 3000 * 0.019 = 57 → 152
    expect(serviceFeeCents(3000)).toBe(152);
  });

  it("computes the canonical €150 example: fee is 3,80 €", () => {
    // 15000 * 0.019 = 285 (exact) → 285 + 95 = 380
    expect(serviceFeeCents(15000)).toBe(380);
  });

  it("computes typical cubierto prices", () => {
    // 16000 * 0.019 = 304 → 304 + 95 = 399
    expect(serviceFeeCents(16000)).toBe(399);
    // 30000 * 0.019 = 570 → 570 + 95 = 665
    expect(serviceFeeCents(30000)).toBe(665);
  });

  it("rounds half up at .5 boundaries (Math.round)", () => {
    // 4500 * 0.019 = 85.5 → 86 → 181
    expect(serviceFeeCents(4500)).toBe(181);
    // 500 * 0.019 = 9.5 → 10 → 105 → mínimo 150
    expect(serviceFeeCents(500)).toBe(150);
  });

  it("rounds down just below the boundary and up just above it", () => {
    // 4499 * 0.019 = 85.481 → 85 → 180
    expect(serviceFeeCents(4499)).toBe(180);
    // 4501 * 0.019 = 85.519 → 86 → 181
    expect(serviceFeeCents(4501)).toBe(181);
  });

  it("throws RangeError on non-integer input", () => {
    expect(() => serviceFeeCents(150.5)).toThrow(RangeError);
    expect(() => serviceFeeCents(0.01)).toThrow(RangeError);
    expect(() => serviceFeeCents(Number.NaN)).toThrow(RangeError);
  });

  it("throws RangeError on negative input", () => {
    expect(() => serviceFeeCents(-1)).toThrow(RangeError);
    expect(() => serviceFeeCents(-15000)).toThrow(RangeError);
  });
});

describe("totalChargeCents", () => {
  it("is contribution + fee", () => {
    expect(totalChargeCents(0)).toBe(150);
    expect(totalChargeCents(15000)).toBe(15380);
    expect(totalChargeCents(16000)).toBe(16399);
    expect(totalChargeCents(30000)).toBe(30665);
  });

  it("propagates validation errors", () => {
    expect(() => totalChargeCents(-1)).toThrow(RangeError);
    expect(() => totalChargeCents(1.5)).toThrow(RangeError);
  });
});

describe("formatEurCents", () => {
  it("formats whole euros the es-ES way", () => {
    expect(normalizeSpaces(formatEurCents(15000))).toBe("150,00 €");
    expect(normalizeSpaces(formatEurCents(0))).toBe("0,00 €");
  });

  it("formats cents and thousands", () => {
    expect(normalizeSpaces(formatEurCents(380))).toBe("3,80 €");
    expect(normalizeSpaces(formatEurCents(15380))).toBe("153,80 €");
    expect(normalizeSpaces(formatEurCents(123456))).toBe("1234,56 €");
  });

  it("throws RangeError on non-integer cents", () => {
    expect(() => formatEurCents(10.5)).toThrow(RangeError);
  });
});
