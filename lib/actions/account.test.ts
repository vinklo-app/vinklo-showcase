import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  rateLimit: vi.fn(),
  mark: vi.fn(),
  finish: vi.fn(),
  queueUser: vi.fn(),
  plan: vi.fn(),
  transfer: vi.fn(),
  leftovers: vi.fn(),
  cookieSet: vi.fn(),
  sentry: vi.fn(),
  ban: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.sentry }));
vi.mock("@/lib/data/current-wedding", () => ({ getCurrentWedding: mocks.current }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/data/account-deletion", () => ({
  markWeddingDeleted: mocks.mark,
  finishPendingDeletion: mocks.finish,
  queueUserDeletion: mocks.queueUser,
  planAccountDeletion: mocks.plan,
  transferWedding: mocks.transfer,
  purgeEmailLeftovers: mocks.leftovers,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet }) }));
import { deleteAccount, deleteWedding } from "./account";
import { DELETION_NOTICE_COOKIE } from "@/lib/deletion-notice";

const weddingId = "11111111-1111-4111-8111-111111111111";
const form = (confirm: string) => {
  const fd = new FormData();
  fd.set("confirm", confirm);
  return fd;
};

const signOut = vi.fn();
const fakeAdmin = { fake: "admin", auth: { admin: { updateUserById: mocks.ban } } };

function sessionClient(user: { id: string; email: string } | null = { id: "user-a", email: "Ana@Ejemplo.es" }) {
  return {
    auth: { getUser: async () => ({ data: { user } }), signOut },
    // Con la marca, el borrado ya no va por la sesión: cualquier from() es un error del test.
    from: () => { throw new Error("la acción no debe leer ni borrar tablas con la sesión"); },
  };
}

function context(role: "owner" | "partner" = "owner") {
  return { supabase: sessionClient(), userId: "user-a", userEmail: "ana@ejemplo.es", role, wedding: { id: weddingId, slug: "ana-y-luis" } };
}

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { to?: string }).to ?? null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.client.mockResolvedValue(sessionClient());
  mocks.admin.mockReturnValue(fakeAdmin);
  mocks.ban.mockResolvedValue({ data: null, error: null });
  mocks.mark.mockResolvedValue("ok");
  mocks.finish.mockResolvedValue({ ok: true });
  mocks.queueUser.mockResolvedValue(true);
  mocks.transfer.mockResolvedValue(true);
  mocks.leftovers.mockResolvedValue(undefined);
});

describe("deleteWedding", () => {
  it("sin sesión no hace nada", async () => {
    mocks.current.mockResolvedValue(null);
    expect(await deleteWedding({ error: null }, form("ana-y-luis"))).toEqual({ error: expect.stringContaining("sesión") });
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("la pareja secundaria no puede borrar la boda", async () => {
    mocks.current.mockResolvedValue(context("partner"));
    const result = await deleteWedding({ error: null }, form("ana-y-luis"));
    expect(result.error).toMatch(/Solo quien creó la boda/);
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("exige escribir la dirección exacta de la boda", async () => {
    mocks.current.mockResolvedValue(context());
    const result = await deleteWedding({ error: null }, form("ana-y-lui"));
    expect(result.error).toContain("ana-y-luis");
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("respeta el rate limit", async () => {
    mocks.current.mockResolvedValue(context());
    mocks.rateLimit.mockResolvedValue(false);
    const result = await deleteWedding({ error: null }, form("ana-y-luis"));
    expect(result.error).toMatch(/Demasiados intentos/);
    expect(mocks.rateLimit).toHaveBeenCalledWith("borrar-boda", "user-a", expect.any(Number), expect.any(Number));
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("fase 1 con la SESIÓN, después fase 2; cierra sesión y vuelve a / con aviso", async () => {
    const ctx = context();
    mocks.current.mockResolvedValue(ctx);
    const order: string[] = [];
    mocks.mark.mockImplementation(async () => { order.push("mark"); return "ok"; });
    mocks.finish.mockImplementation(async () => { order.push("finish"); return { ok: true }; });
    const to = await redirectOf(deleteWedding({ error: null }, form("  Ana-y-Luis ")));
    expect(to).toBe("/");
    expect(mocks.mark).toHaveBeenCalledWith(ctx.supabase, weddingId);
    expect(mocks.finish).toHaveBeenCalledWith("wedding", weddingId);
    expect(order).toEqual(["mark", "finish"]);
    expect(signOut).toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(DELETION_NOTICE_COOKIE, "boda", expect.objectContaining({ httpOnly: false, path: "/" }));
    expect(mocks.sentry).not.toHaveBeenCalled();
  });

  it("si la marca falla no se borra nada y se puede reintentar", async () => {
    mocks.current.mockResolvedValue(context());
    mocks.mark.mockResolvedValue("error");
    const result = await deleteWedding({ error: null }, form("ana-y-luis"));
    expect(result.error).toMatch(/No se ha borrado nada/);
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.sentry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.sentry.mock.calls)).not.toMatch(/ana|@|1111/i);
  });

  it("la RPC niega a quien no es dueño", async () => {
    mocks.current.mockResolvedValue(context());
    mocks.mark.mockResolvedValue("forbidden");
    expect((await deleteWedding({ error: null }, form("ana-y-luis"))).error).toMatch(/Solo quien creó la boda/);
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("si la fase 2 falla (Storage, fila) la boda ya no se sirve: aviso a Sentry y salida igual (el cron termina)", async () => {
    mocks.current.mockResolvedValue(context());
    mocks.finish.mockResolvedValue({ ok: false, phase: "wedding-photos" });
    const to = await redirectOf(deleteWedding({ error: null }, form("ana-y-luis")));
    expect(to).toBe("/");
    expect(mocks.sentry).toHaveBeenCalledWith(expect.stringContaining("cron"), expect.objectContaining({ extra: { phase: "wedding-photos", code: null } }));
    expect(JSON.stringify(mocks.sentry.mock.calls)).not.toMatch(/ana|@|1111/i);
  });
});

describe("deleteAccount", () => {
  it("exige escribir el propio correo", async () => {
    const result = await deleteAccount({ error: null }, form("otra@ejemplo.es"));
    expect(result.error).toMatch(/correo/);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.queueUser).not.toHaveBeenCalled();
  });

  it("pareja secundaria: apunta y borra solo su usuario", async () => {
    mocks.plan.mockResolvedValue({ kind: "partner", weddingId });
    const to = await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")));
    expect(to).toBe("/");
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.queueUser).toHaveBeenCalledWith("user-a", fakeAdmin);
    expect(mocks.finish.mock.calls).toEqual([["user", "user-a", fakeAdmin]]);
    expect(mocks.leftovers).toHaveBeenCalledWith("ana@ejemplo.es", expect.anything());
    expect(mocks.cookieSet).toHaveBeenCalledWith(DELETION_NOTICE_COOKIE, "cuenta", expect.anything());
  });

  it("dueño con pareja: transfiere la boda antes de tocar el usuario", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-with-partner", weddingId, partnerId: "user-b" });
    const order: string[] = [];
    mocks.transfer.mockImplementation(async () => { order.push("transfer"); return true; });
    mocks.queueUser.mockImplementation(async () => { order.push("queue"); return true; });
    mocks.finish.mockImplementation(async (kind: string) => { order.push(`finish:${kind}`); return { ok: true }; });
    await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")));
    expect(mocks.transfer).toHaveBeenCalledWith(weddingId, "user-a", "user-b", expect.anything());
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(order).toEqual(["transfer", "queue", "finish:user"]);
  });

  it("dueño con pareja: si la transferencia falla no apunta ni borra nada", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-with-partner", weddingId, partnerId: "user-b" });
    mocks.transfer.mockResolvedValue(false);
    const result = await deleteAccount({ error: null }, form("ana@ejemplo.es"));
    expect(result.error).toBeTruthy();
    expect(mocks.queueUser).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("dueño sin pareja: marca la boda (sesión), la termina y después el usuario, en ese orden", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-alone", weddingId });
    const order: string[] = [];
    mocks.mark.mockImplementation(async () => { order.push("mark"); return "ok"; });
    mocks.queueUser.mockImplementation(async () => { order.push("queue"); return true; });
    mocks.finish.mockImplementation(async (kind: string) => { order.push(`finish:${kind}`); return { ok: true }; });
    const to = await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")));
    expect(to).toBe("/");
    expect(mocks.mark.mock.calls[0]![1]).toBe(weddingId);
    expect(order).toEqual(["mark", "finish:wedding", "queue", "finish:user"]);
  });

  it("dueño sin pareja: si la marca falla, conserva boda y cuenta", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-alone", weddingId });
    mocks.mark.mockResolvedValue("error");
    const result = await deleteAccount({ error: null }, form("ana@ejemplo.es"));
    expect(result.error).toMatch(/No se ha borrado nada/);
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.queueUser).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.sentry.mock.calls)).not.toMatch(/ana|@/i);
  });

  it("dueño sin pareja: si la purga de la boda falla sigue con la cuenta (el cron la termina)", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-alone", weddingId });
    mocks.finish.mockImplementation(async (kind: string) => (kind === "wedding" ? { ok: false, phase: "invoices" } : { ok: true }));
    expect(await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")))).toBe("/");
    expect(mocks.sentry).toHaveBeenCalledTimes(1);
  });

  it("si Auth falla pero quedó apuntado: sale igual y el cron lo reintenta", async () => {
    mocks.plan.mockResolvedValue({ kind: "none" });
    mocks.finish.mockResolvedValue({ ok: false, phase: "auth", code: "unexpected_failure" });
    expect(await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")))).toBe("/");
    expect(mocks.sentry).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ extra: { phase: "auth", code: "unexpected_failure" } }));
  });

  it("si Auth falla pero quedó apuntado: bloquea el acceso hasta que el cron lo borre", async () => {
    mocks.plan.mockResolvedValue({ kind: "none" });
    mocks.finish.mockResolvedValue({ ok: false, phase: "auth", code: "unexpected_failure" });
    expect(await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")))).toBe("/");
    expect(mocks.ban).toHaveBeenCalledWith("user-a", { ban_duration: "876000h" });
  });

  it("si el bloqueo también falla (error o excepción), sale igual", async () => {
    mocks.plan.mockResolvedValue({ kind: "none" });
    mocks.finish.mockResolvedValue({ ok: false, phase: "auth" });
    mocks.ban.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    expect(await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")))).toBe("/");
    mocks.ban.mockRejectedValueOnce(new Error("red"));
    expect(await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")))).toBe("/");
    expect(mocks.ban).toHaveBeenCalledTimes(2);
  });

  it("si Auth borra bien no hace falta bloquear", async () => {
    mocks.plan.mockResolvedValue({ kind: "none" });
    await redirectOf(deleteAccount({ error: null }, form("ana@ejemplo.es")));
    expect(mocks.ban).not.toHaveBeenCalled();
  });

  it("si Auth falla y no se pudo apuntar, no redirige: hay que reintentarlo", async () => {
    mocks.plan.mockResolvedValue({ kind: "owner-alone", weddingId });
    mocks.queueUser.mockResolvedValue(false);
    mocks.finish.mockImplementation(async (kind: string) => (kind === "user" ? { ok: false, phase: "auth" } : { ok: true }));
    const result = await deleteAccount({ error: null }, form("ana@ejemplo.es"));
    expect(result.error).toMatch(/no la cuenta/);
    expect(mocks.redirect).not.toHaveBeenCalled();
    // Sin apunte no hay cron que lo termine: bloquearlo lo dejaría fuera para siempre.
    expect(mocks.ban).not.toHaveBeenCalled();
  });

  it("respeta el rate limit", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    const result = await deleteAccount({ error: null }, form("ana@ejemplo.es"));
    expect(result.error).toMatch(/Demasiados intentos/);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
