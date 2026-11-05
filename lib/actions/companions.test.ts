import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { addGuestApart, getGuestExtras, removeGuestApart, saveGuestCompanions } from "./companions";

const weddingId = "11111111-1111-4111-8111-111111111111";
const guestA = "22222222-2222-4222-8222-222222222222";
const guestB = "44444444-4444-4444-8444-444444444444";
const companion = "55555555-5555-4555-8555-555555555555";
type Reply = { data: unknown; error: unknown; count?: number };
let calls: Array<{ table: string; method: string; args: unknown[] }>;
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "order", "insert", "update", "delete", "in", "or"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve);
      return chain;
    },
    rpc(name: string, args: unknown) {
      calls.push({ table: "rpc", method: name, args: [args] });
      return Promise.resolve(next());
    },
  };
}
const owner = (): Reply => ({ data: { id: weddingId, slug: "ana-y-luis" }, error: null });
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("acompañantes con nombre (ficha del invitado)", () => {
  it("lee acompañantes y «no sentar con…» de la boda de la sesión", async () => {
    mocks.client.mockResolvedValue(database([
      owner(),
      { data: [{ id: companion, name: "Leo", is_kid: true, by_guest: true, table_id: null }], error: null },
      { data: [{ guest_a: guestA, guest_b: guestB }], error: null },
      { data: [{ id: guestB, name: "Bruno" }], error: null },
    ]));
    expect(await getGuestExtras(guestA)).toEqual({ ok: true, companions: [{ id: companion, name: "Leo", isKid: true, byGuest: true, tableId: null }], apart: [{ id: guestB, name: "Bruno" }] });
    for (const table of ["wedding_guest_companions", "wedding_guest_apart", "wedding_guests"]) {
      expect(calls.filter((call) => call.table === table && call.method === "eq").some((call) => call.args[0] === "wedding_id" && call.args[1] === weddingId)).toBe(true);
    }
  });
  it("sin la migración, `missing` (la ficha no muestra nada)", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST205" } }, { data: null, error: { code: "PGRST205" } }]));
    expect(await getGuestExtras(guestA)).toMatchObject({ ok: false, missing: true });
  });
  it("guarda la lista en una RPC con la boda de la sesión; valida antes de tocar nada", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: companion, name: "Leo Gil", is_kid: true, by_guest: false, table_id: null }], error: null }]));
    const result = await saveGuestCompanions(guestA, [{ id: companion, name: "  Leo   Gil ", kid: true }, { name: "Marta", kid: false }]);
    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.table === "rpc")).toEqual({ table: "rpc", method: "set_guest_companions", args: [{
      p_wedding_id: weddingId, p_guest_id: guestA, p_list: [{ id: companion, name: "Leo Gil", kid: true }, { name: "Marta", kid: false }],
    }] });
    mocks.client.mockClear();
    expect(await saveGuestCompanions(guestA, [{ name: "  ", kid: false }])).toEqual({ ok: false, error: expect.stringContaining("nombre") });
    expect(await saveGuestCompanions(guestA, [{ name: "Leo", kid: false }, { name: "leo", kid: true }])).toEqual({ ok: false, error: expect.stringContaining("mismo nombre") });
    expect((await saveGuestCompanions(guestA, Array.from({ length: 11 }, (_, i) => ({ name: `N${i}`, kid: false })))).ok).toBe(false);
    expect((await saveGuestCompanions("no-uuid", [])).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin sesión no toca nada", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect((await saveGuestCompanions(guestA, [])).ok).toBe(false);
    expect((await addGuestApart(guestA, guestB)).ok).toBe(false);
    expect(calls.filter((call) => call.table !== "weddings")).toEqual([]);
  });
});

describe("«No sentar con…»", () => {
  it("guarda el par ordenado (id menor primero) con la boda de la sesión", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 0 }, { data: null, error: null }]));
    expect(await addGuestApart(guestB, guestA)).toEqual({ ok: true });
    expect(calls.find((call) => call.table === "wedding_guest_apart" && call.method === "insert")?.args[0]).toEqual({ wedding_id: weddingId, guest_a: guestA, guest_b: guestB });
  });
  it("consigo mismo no; repetido no es error; borrar también va ordenado", async () => {
    expect((await addGuestApart(guestA, guestA)).ok).toBe(false);
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 1 }, { data: null, error: { code: "23505" } }]));
    expect(await addGuestApart(guestA, guestB)).toEqual({ ok: true });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await removeGuestApart(guestB, guestA)).toEqual({ ok: true });
    expect(calls.filter((call) => call.table === "wedding_guest_apart" && call.method === "eq").map((call) => call.args)).toEqual([["wedding_id", weddingId], ["guest_a", guestA], ["guest_b", guestB]]);
  });
  it("tope de 20 por invitado", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 20 }]));
    expect(await addGuestApart(guestA, guestB)).toEqual({ ok: false, error: expect.stringContaining("hasta 20") });
  });
});
