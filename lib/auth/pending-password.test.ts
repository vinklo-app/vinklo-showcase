import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  set: vi.fn(),
  adminUpdate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined),
    set: (name: string, value: string, options: unknown) => {
      mocks.set(name, value, options);
      if (value) mocks.jar.set(name, value);
      else mocks.jar.delete(name);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.adminUpdate } } }),
}));

import {
  PENDING_PASSWORD_COOKIE,
  finishEmailVerification,
  openPendingPassword,
  rememberPendingPassword,
  sealPendingPassword,
} from "./pending-password";

const SECRET = "secreto-de-prueba";
const NOW = Date.parse("2026-10-14T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
  mocks.adminUpdate.mockResolvedValue({ error: null });
  vi.stubEnv("RATE_LIMIT_SECRET", SECRET);
});

describe("sealPendingPassword / openPendingPassword", () => {
  it("ida y vuelta, con el correo normalizado; el token no deja ver la contraseña", () => {
    const token = sealPendingPassword(" Ana@Ejemplo.es ", "girasoles7", NOW, SECRET)!;
    expect(token).not.toContain("girasoles7");
    expect(openPendingPassword(token, NOW + 1000, SECRET)).toEqual({ email: "ana@ejemplo.es", password: "girasoles7" });
  });

  it("caduca a la hora, no se abre con otra clave y rechaza manipulaciones", () => {
    const token = sealPendingPassword("ana@ejemplo.es", "girasoles7", NOW, SECRET)!;
    expect(openPendingPassword(token, NOW + 61 * 60 * 1000, SECRET)).toBeNull();
    expect(openPendingPassword(token, NOW, "otra-clave")).toBeNull();
    const raw = Buffer.from(token, "base64url");
    raw[raw.length - 1] ^= 1;
    expect(openPendingPassword(raw.toString("base64url"), NOW, SECRET)).toBeNull();
    expect(openPendingPassword("basura", NOW, SECRET)).toBeNull();
    expect(openPendingPassword(undefined, NOW, SECRET)).toBeNull();
  });

  it("sin secreto de servidor no guarda nada (y no rompe)", () => {
    expect(sealPendingPassword("ana@ejemplo.es", "girasoles7", NOW, null)).toBeNull();
  });
});

describe("rememberPendingPassword", () => {
  it("cookie httpOnly, SameSite=Lax, 1 hora", async () => {
    await rememberPendingPassword("ana@ejemplo.es", "girasoles7");
    expect(mocks.set).toHaveBeenCalledWith(
      PENDING_PASSWORD_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 3600 }),
    );
    expect(mocks.set.mock.calls[0][1]).not.toContain("girasoles7");
  });
});

describe("finishEmailVerification", () => {
  const supabase = () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    return { client: { auth: { updateUser } } as never, updateUser };
  };
  const fresh = new Date(NOW - 30 * 1000).toISOString();
  const old = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString();

  it("con la contraseña pendiente de ESE correo la aplica, borra la cookie y no la resetea", async () => {
    mocks.jar.set(PENDING_PASSWORD_COOKIE, sealPendingPassword("ana@ejemplo.es", "girasoles7", NOW, SECRET)!);
    const { client, updateUser } = supabase();
    await finishEmailVerification(client, { id: "u1", email: "Ana@Ejemplo.es", email_confirmed_at: fresh }, NOW);
    expect(updateUser).toHaveBeenCalledWith({ password: "girasoles7" });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
    expect(mocks.jar.has(PENDING_PASSWORD_COOKIE)).toBe(false);
  });

  it("cuenta de toda la vida sin cookie: no toca nada", async () => {
    const { client, updateUser } = supabase();
    await finishEmailVerification(client, { id: "u1", email: "ana@ejemplo.es", email_confirmed_at: old }, NOW);
    expect(updateUser).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
  });

  it("pre-secuestro: correo confirmado ahora mismo sin contraseña de este navegador → aleatoria con el cliente admin", async () => {
    const { client, updateUser } = supabase();
    await finishEmailVerification(client, { id: "u1", email: "ana@ejemplo.es", email_confirmed_at: fresh }, NOW);
    expect(updateUser).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).toHaveBeenCalledWith("u1", { password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  });

  it("cookie de OTRO correo: no se aplica (y si la confirmación es de ahora, aleatoria)", async () => {
    mocks.jar.set(PENDING_PASSWORD_COOKIE, sealPendingPassword("otro@ejemplo.es", "girasoles7", NOW, SECRET)!);
    const { client, updateUser } = supabase();
    await finishEmailVerification(client, { id: "u1", email: "ana@ejemplo.es", email_confirmed_at: fresh }, NOW);
    expect(updateUser).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.jar.has(PENDING_PASSWORD_COOKIE)).toBe(false);
  });

  it("si el cliente admin falla, se entra igual", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.adminUpdate.mockRejectedValue(new Error("red"));
    const { client } = supabase();
    await expect(
      finishEmailVerification(client, { id: "u1", email: "ana@ejemplo.es", email_confirmed_at: fresh }, NOW),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("sin usuario no hace nada", async () => {
    const { client, updateUser } = supabase();
    await finishEmailVerification(client, null, NOW);
    expect(updateUser).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
  });
});
