import { describe, expect, it } from "vitest";

import { installPlatform, isStandalone } from "./standalone";

const media = (matching: string[]) => (query: string) => ({ matches: matching.includes(query) });

describe("isStandalone", () => {
  it("detecta la app instalada por display-mode (Chrome, Edge, Safari moderno)", () => {
    expect(isStandalone({ matchMedia: media(["(display-mode: standalone)"]) })).toBe(true);
    expect(isStandalone({ matchMedia: media(["(display-mode: fullscreen)"]) })).toBe(true);
    expect(isStandalone({ matchMedia: media(["(display-mode: minimal-ui)"]) })).toBe(true);
  });

  it("detecta el icono de iOS por navigator.standalone", () => {
    expect(isStandalone({ matchMedia: media([]), navigator: { standalone: true } })).toBe(true);
  });

  it("en una pestaña normal, sin entorno o si matchMedia falla, es false", () => {
    expect(isStandalone({ matchMedia: media(["(display-mode: browser)"]), navigator: { standalone: false } })).toBe(false);
    expect(isStandalone(undefined)).toBe(false);
    expect(isStandalone({})).toBe(false);
    expect(isStandalone({ matchMedia: () => { throw new Error("no"); } })).toBe(false);
  });
});

describe("installPlatform", () => {
  it("iPhone, iPad y el iPad que se presenta como Mac", () => {
    expect(installPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("ios");
    expect(installPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ios");
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)).toBe("ios");
  });

  it("Android y el resto (un Mac de verdad no tiene pantalla táctil)", () => {
    expect(installPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0")).toBe("android");
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
    expect(installPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
    expect(installPlatform("")).toBe("other");
  });
});
