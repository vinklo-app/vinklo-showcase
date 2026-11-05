import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rateLimit: vi.fn(),
  send: vi.fn(),
  refresh: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/emails/send", () => ({ sendEmail: mocks.send }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet, delete: mocks.cookieDelete, get: () => undefined }) }));
import { acceptPartnerInvite, cancelPartnerInvite, continueToLogin, invitePartner, removePartner, resendPartnerInvite } from "./partner";
import { JOIN_COOKIE } from "@/lib/partner/join";

const weddingId = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Reply[], opts: { role?: "owner" | "partner"; user?: { id: string; email: string } | null; rpc?: Reply } = {}) {
  const user = opts.user === undefined ? { id: "owner-a", email: "ana@ejemplo.es" } : opts.user;
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "limit", "insert", "update", "delete"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => replies.shift() ?? { data: null, error: null };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(replies.shift() ?? { data: null, error: null }).then(resolve);
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: chainFor,
    rpc: async (name: string, args: unknown) => { calls.push({ table: "rpc", method: name, args: [args] }); return opts.rpc ?? { data: null, error: null }; },
    role: opts.role ?? "owner",
  };
}
const member = (role: "owner" | "partner" = "owner") => ({ data: { id: weddingId, slug: "ana-y-luis", wedding_members: [{ role }] }, error: null });
const token43 = "A".repeat(43);
const form = (entries: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(entries)) fd.set(k, v); return fd; };

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  mocks.rateLimit.mockResolvedValue(true);
  mocks.send.mockResolvedValue({ skipped: false, id: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("invitePartner", () => {
  it("valida el correo antes de tocar nada", async () => {
    expect(await invitePartner("no-es-correo")).toEqual({ ok: false, error: "Escribid un correo válido." });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("guarda solo el hash del token, en la boda de la sesión, y envía el enlace /unirse", async () => {
    mocks.client.mockResolvedValue(database([member(), { data: null, error: null }]));
    expect(await invitePartner("  Luis@Ejemplo.ES ")).toEqual({ ok: true, emailed: true });
    const insert = calls.find((c) => c.table === "wedding_member_invites" && c.method === "insert")?.args[0] as Record<string, string>;
    expect(insert).toMatchObject({ wedding_id: weddingId, email: "luis@ejemplo.es", created_by: "owner-a" });
    expect(insert.token_hash).toMatch(/^[a-f0-9]{64}$/);
    const mail = mocks.send.mock.calls[0]![0] as { to: string; html: string };
    expect(mail.to).toBe("luis@ejemplo.es");
    const token = /unirse\?token=([A-Za-z0-9_-]+)/.exec(mail.html)![1]!;
    expect(token).toHaveLength(43);
    expect(createHash("sha256").update(token).digest("hex")).toBe(insert.token_hash);
    expect(JSON.stringify(insert)).not.toContain(token);
    expect(mocks.rateLimit).toHaveBeenCalledWith("pareja-invitar", "owner-a", 5, 3600);
  });

  it("no se invita a sí misma", async () => {
    mocks.client.mockResolvedValue(database([member()]));
    expect((await invitePartner("ana@ejemplo.es")).ok).toBe(false);
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("rate limit: no inserta ni envía", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    mocks.client.mockResolvedValue(database([member()]));
    expect(await invitePartner("luis@ejemplo.es")).toMatchObject({ ok: false, error: expect.stringMatching(/Esperad/) });
    expect(calls.some((c) => c.method === "insert")).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "23505" }, /pendiente/],
    [{ code: "23514", message: "wedding_members_full" }, /dos/],
  ])("traduce el error %o", async (error, text) => {
    mocks.client.mockResolvedValue(database([member(), { data: null, error }]));
    expect(await invitePartner("luis@ejemplo.es")).toMatchObject({ ok: false, error: expect.stringMatching(text) });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("si el correo falla, retira la invitación para poder repetir", async () => {
    mocks.send.mockRejectedValue(new Error("resend down"));
    mocks.client.mockResolvedValue(database([member(), { data: null, error: null }, { data: null, error: null }]));
    expect((await invitePartner("luis@ejemplo.es")).ok).toBe(false);
    expect(calls).toContainEqual({ table: "wedding_member_invites", method: "delete", args: [] });
    expect(calls).toContainEqual({ table: "wedding_member_invites", method: "eq", args: ["wedding_id", weddingId] });
  });

  it("sin RESEND (local) devuelve el enlace solo fuera de producción", async () => {
    mocks.send.mockResolvedValue({ skipped: true });
    mocks.client.mockResolvedValue(database([member(), { data: null, error: null }]));
    const result = await invitePartner("luis@ejemplo.es");
    expect(result).toMatchObject({ ok: true, emailed: false });
    expect((result as { devLink?: string }).devLink).toMatch(/\/unirse\?token=/);
  });
});

describe("reenviar, cancelar y quitar", () => {
  it("reenviar rota el hash de la invitación pendiente de SU boda", async () => {
    mocks.client.mockResolvedValue(database([member(), { data: { email: "luis@ejemplo.es" }, error: null }]));
    expect(await resendPartnerInvite()).toEqual({ ok: true, emailed: true });
    const update = calls.find((c) => c.method === "update")?.args[0] as Record<string, string>;
    expect(update.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toContainEqual({ table: "wedding_member_invites", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_member_invites", method: "is", args: ["accepted_at", null] });
  });
  it("cancelar borra solo la pendiente de su boda", async () => {
    mocks.client.mockResolvedValue(database([member(), { data: null, error: null }]));
    expect(await cancelPartnerInvite()).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "wedding_member_invites", method: "is", args: ["accepted_at", null] });
  });
  it("quitar acceso: solo quien creó la boda", async () => {
    mocks.client.mockResolvedValue(database([member("partner")]));
    expect((await removePartner()).ok).toBe(false);
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
    mocks.client.mockResolvedValue(database([member("owner")]));
    expect(await removePartner()).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "rpc", method: "remove_wedding_partner", args: [undefined] });
  });
});

describe("/unirse", () => {
  it("sin sesión guarda el token en cookie httpOnly y lleva a /login?unirse=1", async () => {
    await expect(continueToLogin(form({ token: token43 }))).rejects.toMatchObject({ to: "/login?unirse=1" });
    expect(mocks.cookieSet).toHaveBeenCalledWith(JOIN_COOKIE, token43, expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 86400 }));
  });
  it("no guarda tokens mal formados", async () => {
    await expect(continueToLogin(form({ token: "<script>" }))).rejects.toMatchObject({ to: "/login?unirse=1" });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
  it("token mal formado: no llama a la RPC", async () => {
    mocks.client.mockResolvedValue(database([]));
    expect(await acceptPartnerInvite({ error: null, code: null }, form({ token: "corto" }))).toMatchObject({ code: "invalid" });
    expect(calls).toEqual([]);
  });
  it("aceptar: RPC con el token, borra la cookie y entra en el panel", async () => {
    mocks.client.mockResolvedValue(database([], { rpc: { data: "ok", error: null } }));
    await expect(acceptPartnerInvite({ error: null, code: null }, form({ token: token43 }))).rejects.toMatchObject({ to: "/panel?pareja=1" });
    expect(calls).toContainEqual({ table: "rpc", method: "accept_wedding_invite", args: [{ p_token: token43 }] });
    expect(mocks.cookieDelete).toHaveBeenCalledWith(JOIN_COOKIE);
    expect(mocks.rateLimit).toHaveBeenCalledWith("pareja-unirse", "owner-a", 10, 900);
  });
  it.each([
    ["expired", /caducado/],
    ["email_mismatch", /correo distinto/],
    ["has_wedding", /otra boda/],
    ["full", /dos personas/],
    ["used", /ya se ha usado/],
  ])("%s: mensaje claro y sin redirigir", async (code, text) => {
    mocks.client.mockResolvedValue(database([], { rpc: { data: code, error: null } }));
    const state = await acceptPartnerInvite({ error: null, code: null }, form({ token: token43 }));
    expect(state).toMatchObject({ code, error: expect.stringMatching(text) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("sin sesión no llama a la RPC", async () => {
    mocks.client.mockResolvedValue(database([], { user: null }));
    expect(await acceptPartnerInvite({ error: null, code: null }, form({ token: token43 }))).toMatchObject({ code: "unauthenticated" });
    expect(calls).toEqual([]);
  });
});
