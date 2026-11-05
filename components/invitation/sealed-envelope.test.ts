import { describe, expect, it } from "vitest";
import { cardGeometry, envelopeOpenedThisSession, rememberEnvelopeOpened } from "./sealed-envelope";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("sobre: «abierto una vez por sesión»", () => {
  it("la primera visita ve el sobre cerrado (nada guardado aún)", () => {
    expect(envelopeOpenedThisSession(memory(), "/b/ana-y-luis")).toBe(false);
  });
  it("tras abrirlo, no vuelve a cerrarse en esa sesión y solo para esa web", () => {
    const storage = memory();
    rememberEnvelopeOpened(storage, "/b/ana-y-luis");
    expect(envelopeOpenedThisSession(storage, "/b/ana-y-luis")).toBe(true);
    expect(envelopeOpenedThisSession(storage, "/b/otra-boda")).toBe(false);
  });
  it("sin almacenamiento (modo privado o bloqueado) se enseña el sobre", () => {
    const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    expect(envelopeOpenedThisSession(broken, "/b/ana-y-luis")).toBe(false);
    expect(() => rememberEnvelopeOpened(broken, "/b/ana-y-luis")).not.toThrow();
    expect(envelopeOpenedThisSession(null, "/b/ana-y-luis")).toBe(false);
  });
});

describe("sobre: la tarjeta se centra y llena la pantalla", () => {
  // Móvil de 390×844: sobre de 328×234 centrado en (195, 400); tarjeta 6% 7% 8%.
  const envelope = { left: 31, top: 283, width: 328, height: 234, offsetWidth: 328, offsetHeight: 234 };
  const card = { offsetLeft: 23, offsetTop: 14, offsetWidth: 282, offsetHeight: 201 };
  const overlay = { left: 0, top: 0, width: 390, offsetWidth: 390, offsetHeight: 844 };

  it("mueve la tarjeta al centro del overlay y la escala para cubrirlo", () => {
    const g = cardGeometry({ overlay, envelope, card });
    // Centro de la tarjeta: x = 195 + 23 + 141 - 164 = 195; y = 400 + 14 + 100,5 - 117 = 397,5.
    expect(g["--card-dx"]).toBe("0px");
    expect(g["--card-dy"]).toBe("24.5px");
    expect(Number(g["--card-fill-x"])).toBeGreaterThan(390 / 282);
    expect(Number(g["--card-fill-y"])).toBeGreaterThan(844 / 201);
    // A la vista: casi todo el ancho, nunca más de 1,6×.
    expect(Number(g["--card-hero"])).toBeCloseTo((390 * 0.9) / 282, 2);
  });

  it("dentro del marco escalado del creador da lo mismo en px locales", () => {
    const k = 0.6;
    const scaled = cardGeometry({
      overlay: { ...overlay, left: 100, top: 50, width: 390 * k },
      envelope: { ...envelope, left: 100 + 31 * k, top: 50 + 283 * k, width: 328 * k, height: 234 * k },
      card,
    });
    expect(scaled).toEqual(cardGeometry({ overlay, envelope, card }));
  });

  it("en pantallas grandes no pasa de 1,6×", () => {
    const g = cardGeometry({ overlay: { ...overlay, width: 1440, offsetWidth: 1440, offsetHeight: 900 }, envelope: { ...envelope, left: 556 }, card });
    expect(Number(g["--card-hero"])).toBe(1.6);
  });
});
