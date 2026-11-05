import { describe, expect, it } from "vitest";

import { decodeJwtClaims, isRecoveryAccessToken, isRecoverySession } from "./recovery-session";

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (claims: unknown) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.firma`;

describe("isRecoverySession", () => {
  it("true si amr trae el método recovery", () => {
    expect(isRecoverySession({ amr: [{ method: "otp", timestamp: 1 }, { method: "recovery", timestamp: 2 }] })).toBe(true);
    expect(isRecoverySession({ amr: ["recovery"] })).toBe(true);
  });
  it("false sin recovery, sin amr o con datos raros", () => {
    expect(isRecoverySession({ amr: [{ method: "otp" }, { method: "password" }] })).toBe(false);
    expect(isRecoverySession({ amr: [] })).toBe(false);
    expect(isRecoverySession({})).toBe(false);
    expect(isRecoverySession({ amr: "recovery" })).toBe(false);
    expect(isRecoverySession({ amr: [null, 3, {}] })).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
    expect(isRecoverySession(undefined)).toBe(false);
  });
});

describe("decodeJwtClaims / isRecoveryAccessToken", () => {
  it("decodifica base64url con caracteres no ASCII", () => {
    expect(decodeJwtClaims(jwt({ email: "ñandú@vinklo.es", amr: [] }))).toMatchObject({ email: "ñandú@vinklo.es" });
  });
  it("token inválido → null / false", () => {
    for (const t of [null, undefined, "", "abc", "a.!!!.c", `a.${b64url([1])}.c`]) {
      expect(decodeJwtClaims(t)).toBeNull();
      expect(isRecoveryAccessToken(t)).toBe(false);
    }
  });
  it("detecta recovery en un JWT completo", () => {
    expect(isRecoveryAccessToken(jwt({ amr: [{ method: "recovery", timestamp: 1 }] }))).toBe(true);
    expect(isRecoveryAccessToken(jwt({ amr: [{ method: "otp", timestamp: 1 }] }))).toBe(false);
  });
});
