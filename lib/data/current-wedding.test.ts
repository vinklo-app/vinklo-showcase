import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), cookie: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
import { getCurrentWeddingFresh, isMissingMembership } from "./current-wedding";
import { postLoginPath } from "@/lib/auth/post-login";

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Reply[], user: { id: string; email?: string } | null = { id: "user-b", email: "luis@ejemplo.es" }) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => replies.shift() ?? { data: null, error: null };
      return chain;
    },
  };
}
const weddingId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); calls = []; mocks.cookie.mockReturnValue(undefined); });

describe("getCurrentWedding (segunda cuenta de pareja)", () => {
  it("resuelve la boda por membresía y devuelve el rol de la pareja invitada", async () => {
    mocks.client.mockResolvedValue(database([{ data: { id: weddingId, slug: "ana-y-luis", wedding_members: [{ role: "partner" }] }, error: null }]));
    const context = await getCurrentWeddingFresh();
    expect(context).toMatchObject({ userId: "user-b", userEmail: "luis@ejemplo.es", role: "partner", wedding: { id: weddingId, slug: "ana-y-luis" } });
    expect(calls).toContainEqual({ table: "weddings", method: "select", args: ["id, slug, wedding_members!inner(role)"] });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "user-b"] });
    // Nunca por couple_id si la membresía responde.
    expect(calls.some((c) => c.args[0] === "couple_id")).toBe(false);
  });

  it("sin fila de miembro: null (la pareja invitada que aún no aceptó no ve nada)", async () => {
    mocks.client.mockResolvedValue(database([{ data: null, error: null }]));
    expect(await getCurrentWeddingFresh()).toBeNull();
    expect(calls.some((c) => c.args[0] === "couple_id")).toBe(false);
  });

  it.each(["PGRST200", "PGRST205", "42P01"])("sin la migración (%s) cae al dueño original por couple_id", async (code) => {
    mocks.client.mockResolvedValue(database([{ data: null, error: { code } }, { data: { id: weddingId, slug: "ana-y-luis" }, error: null }], { id: "owner-a" }));
    const context = await getCurrentWeddingFresh();
    expect(context).toMatchObject({ role: "owner", wedding: { id: weddingId } });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["couple_id", "owner-a"] });
  });

  it("otro error no cae al respaldo (fail-closed)", async () => {
    mocks.client.mockResolvedValue(database([{ data: null, error: { code: "42501" } }]));
    expect(await getCurrentWeddingFresh()).toBeNull();
    expect(calls.some((c) => c.args[0] === "couple_id")).toBe(false);
  });

  it("sin sesión no consulta tablas", async () => {
    mocks.client.mockResolvedValue(database([], null));
    expect(await getCurrentWeddingFresh()).toBeNull();
    expect(calls).toEqual([]);
  });

  it("isMissingMembership solo reconoce tabla/relación/columna ausente", () => {
    expect(isMissingMembership({ code: "PGRST200" })).toBe(true);
    expect(isMissingMembership({ code: "42501" })).toBe(false);
    expect(isMissingMembership(null)).toBe(false);
  });
});

describe("postLoginPath", () => {
  it("con invitación de pareja pendiente va a /unirse aunque ya tenga boda", async () => {
    mocks.cookie.mockReturnValue({ value: "x".repeat(43) });
    const client = database([{ data: { id: weddingId, slug: "s", wedding_members: [{ role: "owner" }] }, error: null }]);
    expect(await postLoginPath(client as never)).toBe("/unirse");
  });
  it("con boda por membresía va a /panel; sin ella a /onboarding", async () => {
    expect(await postLoginPath(database([{ data: { id: weddingId, slug: "s", wedding_members: [{ role: "partner" }] }, error: null }]) as never)).toBe("/panel");
    expect(await postLoginPath(database([{ data: null, error: null }]) as never)).toBe("/onboarding");
  });
});
