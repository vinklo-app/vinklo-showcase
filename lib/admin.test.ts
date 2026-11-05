import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));

import { assertAdmin, isAdminEmail, isAdminUser } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAILS", "Admin@Vinklo.es, otro@vinklo.es");
});
afterEach(() => vi.unstubAllEnvs());

describe("isAdminEmail (solo allowlist)", () => {
  it("compara sin mayúsculas y rechaza vacío", () => {
    expect(isAdminEmail("admin@vinklo.es")).toBe(true);
    expect(isAdminEmail("nadie@vinklo.es")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

describe("isAdminUser", () => {
  it("exige email en la lista Y confirmado", () => {
    expect(isAdminUser({ email: "admin@vinklo.es", email_confirmed_at: "2026-10-01T10:00:00Z" })).toBe(true);
    expect(isAdminUser({ email: "admin@vinklo.es", email_confirmed_at: null })).toBe(false);
    expect(isAdminUser({ email: "admin@vinklo.es" })).toBe(false);
    expect(isAdminUser({ email: "nadie@vinklo.es", email_confirmed_at: "2026-10-01T10:00:00Z" })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });
});

describe("assertAdmin", () => {
  it("usuario sin confirmar en ADMIN_EMAILS → notFound", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: "admin@vinklo.es", email_confirmed_at: null } } });
    await expect(assertAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("admin confirmado pasa", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: "admin@vinklo.es", email_confirmed_at: "2026-10-01T10:00:00Z" } } });
    await expect(assertAdmin()).resolves.toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
