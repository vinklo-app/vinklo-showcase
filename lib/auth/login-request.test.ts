import { describe, expect, it } from "vitest";

import {
  clearLoginRequestCookie,
  hasLoginRequestCookie,
  loginRequestCookie,
  tokenHashCallbackDecision,
} from "./login-request";

describe("cookie vk_login_req", () => {
  it("se emite con path, 1 h y SameSite=Lax; Secure solo si se pide", () => {
    expect(loginRequestCookie(false)).toBe("vk_login_req=1; path=/; max-age=3600; SameSite=Lax");
    expect(loginRequestCookie(true)).toBe("vk_login_req=1; path=/; max-age=3600; SameSite=Lax; Secure");
    expect(clearLoginRequestCookie(true)).toContain("max-age=0");
  });
  it("hasLoginRequestCookie lee la cabecera Cookie", () => {
    expect(hasLoginRequestCookie("a=b; vk_login_req=1; c=d")).toBe(true);
    expect(hasLoginRequestCookie("vk_login_req=1")).toBe(true);
    expect(hasLoginRequestCookie("vk_login_req=0")).toBe(false);
    expect(hasLoginRequestCookie("xvk_login_req=1")).toBe(false);
    expect(hasLoginRequestCookie("")).toBe(false);
    expect(hasLoginRequestCookie(null)).toBe(false);
    expect(hasLoginRequestCookie(undefined)).toBe(false);
  });
});

describe("tokenHashCallbackDecision", () => {
  it("con cookie → verificar", () => {
    expect(tokenHashCallbackDecision({ cookieHeader: "vk_login_req=1", tokenHash: "abc", type: "email" })).toEqual({ action: "verify" });
  });
  it("sin cookie → /auth/confirm con los mismos parámetros (codificados)", () => {
    expect(tokenHashCallbackDecision({ cookieHeader: null, tokenHash: "a+b/c=", type: "recovery" })).toEqual({
      action: "confirm",
      path: "/auth/confirm?token_hash=a%2Bb%2Fc%3D&type=recovery",
    });
  });
});
