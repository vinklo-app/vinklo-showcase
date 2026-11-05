import { describe, expect, it } from "vitest";

import { chapterIsCompact, peelRange } from "./web-scenes";

// #3: el corte de una columna es el mismo que el `@container (min-width: 48rem)` del CSS.
describe("chapterIsCompact", () => {
  it("por debajo de 48 rem (móvil): compacto, sin sticky", () => {
    expect(chapterIsCompact(390)).toBe(true);
    expect(chapterIsCompact(767.5)).toBe(true);
  });
  it("desde 48 rem (dos columnas): el recorrido de siempre", () => {
    expect(chapterIsCompact(768)).toBe(false);
    expect(chapterIsCompact(1440)).toBe(false);
  });
  it("respeta el tamaño de letra raíz (rem)", () => {
    expect(chapterIsCompact(800, 20)).toBe(true);
    expect(chapterIsCompact(960, 20)).toBe(false);
  });
});

// Las polaroids se retiran también en móvil (13-oct-2026), cada una en su tramo.
describe("peelRange", () => {
  it("la última foto no se retira", () => {
    expect(peelRange(0, 1, true)).toBeNull();
    expect(peelRange(2, 3, false)).toBeNull();
  });
  it("dos columnas: el tramo de siempre del capítulo sticky", () => {
    expect(peelRange(0, 2, false)).toEqual([0.275, 0.5]);
  });
  it("una columna: tramos seguidos entre 0,15 y 0,9 del paso del montón", () => {
    expect(peelRange(0, 3, true)).toEqual([0.15, 0.525]);
    expect(peelRange(1, 3, true)).toEqual([0.525, 0.9]);
  });
});
