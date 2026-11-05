import { afterEach, describe, expect, it, vi } from "vitest";

import { googleLoginEnabled, googleLoginFlag, googleOAuthOptions, showGoogleLogin } from "./google-login";

describe("«Continuar con Google» (apagado por defecto)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("solo se enciende con NEXT_PUBLIC_GOOGLE_LOGIN=on", () => {
    expect(googleLoginFlag(undefined)).toBe(false);
    expect(googleLoginFlag("")).toBe(false);
    expect(googleLoginFlag("true")).toBe(false);
    expect(googleLoginFlag("1")).toBe(false);
    expect(googleLoginFlag("off")).toBe(false);
    expect(googleLoginFlag("on")).toBe(true);
    expect(googleLoginFlag(" ON ")).toBe(true);
  });

  it("lee NEXT_PUBLIC_GOOGLE_LOGIN del entorno", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_LOGIN", "");
    expect(googleLoginEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_LOGIN", "on");
    expect(googleLoginEnabled()).toBe(true);
  });

  it("nunca en el icono de la pantalla de inicio ni en el acceso con contraseña", () => {
    expect(showGoogleLogin({ enabled: true, standalone: false, passwordMode: false })).toBe(true);
    expect(showGoogleLogin({ enabled: true, standalone: true, passwordMode: false })).toBe(false);
    expect(showGoogleLogin({ enabled: true, standalone: false, passwordMode: true })).toBe(false);
    expect(showGoogleLogin({ enabled: false, standalone: false, passwordMode: false })).toBe(false);
  });

  it("vuelve a /auth/callback de la app", () => {
    expect(googleOAuthOptions("https://vinklo.es/")).toEqual({ redirectTo: "https://vinklo.es/auth/callback", queryParams: { prompt: "select_account" } });
  });
});
