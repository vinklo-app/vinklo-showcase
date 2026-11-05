import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { createGift, deleteGift, exportGiftsCsv, setGiftThanked, setGuestNoGift, updateGift } from "./gifts";

const weddingId = "11111111-1111-4111-8111-111111111111";
const giftId = "33333333-3333-4333-8333-333333333333";
const guestA = "44444444-4444-4444-8444-444444444444";
const guestB = "55555555-5555-4555-8555-555555555555";
type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "insert", "update", "delete"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => next();
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve);
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from: chainFor,
    rpc: (name: string, args: unknown) => { calls.push({ table: "rpc", method: name, args: [args] }); return Promise.resolve(next()); },
  };
}
const owner = { data: { id: weddingId }, error: null };
const rpcCall = (name: string) => calls.find((call) => call.table === "rpc" && call.method === name)?.args[0] as Record<string, unknown> | undefined;
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("validación (antes de tocar la base)", () => {
  it.each([
    [{ guestIds: [], kind: "bizum" }, "Elegid al menos un invitado."],
    [{ guestIds: [guestA, guestA], kind: "bizum" }, "Hay un invitado repetido."],
    [{ guestIds: ["no-uuid"], kind: "bizum" }, "Algún invitado no es válido. Recargad la página."],
    [{ guestIds: [guestA], kind: "dinero" }, "Elegid un tipo de regalo."],
    [{ guestIds: [guestA], kind: "bizum", amountCents: -1 }, "El importe no puede ser negativo."],
    [{ guestIds: [guestA], kind: "bizum", amountCents: 10_000_001 }, "El importe máximo es 100.000 €."],
    [{ guestIds: [guestA], kind: "bizum", amountCents: 10.5 }, "Revisad el importe."],
    [{ guestIds: [guestA], kind: "objeto", description: "x".repeat(201) }, "La descripción puede tener como máximo 200 caracteres."],
    [{ guestIds: [guestA], kind: "objeto", note: "x".repeat(501) }, "La nota puede tener como máximo 500 caracteres."],
    [{ guestIds: [guestA], kind: "objeto", receivedOn: "2026-02-30" }, "Revisad la fecha."],
  ])("%j → %s", async (input, error) => {
    expect(await createGift(input as never)).toEqual({ ok: false, error });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("ids inválidos en editar/borrar/agradecer/sin regalo", async () => {
    for (const result of [
      await updateGift("x", { guestIds: [guestA], kind: "bizum" }), await deleteGift("x"),
      await setGiftThanked("x", true), await setGiftThanked(giftId, "sí" as never), await setGuestNoGift("x", true),
    ]) expect(result.ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("pertenencia", () => {
  it("sin sesión: ninguna acción llega a la base", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [
      () => createGift({ guestIds: [guestA], kind: "bizum" }), () => updateGift(giftId, { guestIds: [guestA], kind: "bizum" }),
      () => deleteGift(giftId), () => setGiftThanked(giftId, true), () => setGuestNoGift(guestA, true),
    ]) expect(await action()).toEqual({ ok: false, error: "Volved a entrar para gestionar vuestra boda." });
    expect(calls).toEqual([]);
  });
  it("la boda sale de la sesión (membresía), nunca del cliente", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: giftId, error: null }]));
    await createGift({ guestIds: [guestA], kind: "bizum", weddingId: "99999999-9999-4999-8999-999999999999" } as never);
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(rpcCall("create_wedding_gift")?.p_wedding_id).toBe(weddingId);
  });
  it("invitado ajeno o borrado (la RPC devuelve null) → error y sin revalidar", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: null }]));
    expect(await createGift({ guestIds: [guestA], kind: "bizum" })).toEqual({ ok: false, error: "Algún invitado ya no está en vuestra lista. Recargad la página." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("borrar y agradecer van acotados por id + wedding_id; sin fila = no disponible", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: null }]));
    expect((await deleteGift(giftId)).ok).toBe(false);
    expect(calls.filter((c) => c.table === "wedding_gifts" && c.method === "eq").map((c) => c.args)).toEqual([["id", giftId], ["wedding_id", weddingId]]);
    calls = [];
    mocks.client.mockResolvedValue(database([owner, { data: { id: giftId }, error: null }]));
    expect(await setGiftThanked(giftId, false)).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({ thanked_at: null });
    expect(calls.filter((c) => c.table === "wedding_gifts" && c.method === "eq").map((c) => c.args)).toEqual([["id", giftId], ["wedding_id", weddingId]]);
  });
  it("migración sin aplicar → mensaje claro", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: { code: "PGRST202" } }]));
    expect(await createGift({ guestIds: [guestA], kind: "otro" })).toEqual({ ok: false, error: "Los regalos requieren aplicar la migración del CRM en Supabase." });
  });
});

describe("regla del importe y ≥ 1 invitado", () => {
  it("importe solo en tipos monetarios; en el resto se guarda null", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: giftId, error: null }]));
    expect(await createGift({ guestIds: [guestA, guestB], kind: "objeto", amountCents: 5000, description: "  Vajilla ", note: "  ", receivedOn: "2026-10-04" }))
      .toEqual({ ok: true, data: { id: giftId } });
    expect(rpcCall("create_wedding_gift")).toEqual({
      p_wedding_id: weddingId, p_guest_ids: [guestA, guestB], p_kind: "objeto", p_amount_cents: null,
      p_description: "Vajilla", p_note: null, p_received_on: "2026-10-04",
    });
    expect(mocks.refresh.mock.calls.map((call) => call[0])).toEqual(["/panel", "/panel/invitados"]);
  });
  it("transferencia, Bizum y efectivo conservan el importe en céntimos", async () => {
    for (const kind of ["transferencia", "bizum", "efectivo"] as const) {
      calls = [];
      mocks.client.mockResolvedValue(database([owner, { data: giftId, error: null }]));
      await createGift({ guestIds: [guestA], kind, amountCents: 15000 });
      expect(rpcCall("create_wedding_gift")?.p_amount_cents).toBe(15000);
    }
  });
  it("editar sustituye invitados en una sola RPC; false = no disponible", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: true, error: null }]));
    expect(await updateGift(giftId, { guestIds: [guestB], kind: "efectivo", amountCents: 2000 })).toEqual({ ok: true });
    expect(rpcCall("update_wedding_gift")).toMatchObject({ p_gift_id: giftId, p_guest_ids: [guestB], p_amount_cents: 2000 });
    calls = [];
    mocks.client.mockResolvedValue(database([owner, { data: false, error: null }]));
    expect((await updateGift(giftId, { guestIds: [guestB], kind: "efectivo" })).ok).toBe(false);
    // Editar a 0 invitados ni siquiera llega a la base.
    calls = [];
    expect(await updateGift(giftId, { guestIds: [], kind: "efectivo" })).toEqual({ ok: false, error: "Elegid al menos un invitado." });
    expect(calls).toEqual([]);
  });
});

describe("sin regalo", () => {
  it("no se puede marcar a quien ya tiene un regalo", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [{ gift_id: giftId }], error: null }]));
    const result = await setGuestNoGift(guestA, true);
    expect(result).toEqual({ ok: false, error: "Este invitado ya tiene un regalo anotado. Borrad el regalo antes de marcarlo «sin regalo»." });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });
  it("marca y desmarca acotado por la boda de la sesión", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [], error: null }, { data: { id: guestA }, error: null }]));
    expect(await setGuestNoGift(guestA, true)).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "update")).toEqual({ table: "wedding_guests", method: "update", args: [{ gift_none: true }] });
    expect(calls.filter((c) => c.table === "wedding_guests" && c.method === "eq").map((c) => c.args)).toEqual([["id", guestA], ["wedding_id", weddingId]]);
    calls = [];
    // Desmarcar no necesita comprobar regalos.
    mocks.client.mockResolvedValue(database([owner, { data: { id: guestA }, error: null }]));
    expect(await setGuestNoGift(guestA, false)).toEqual({ ok: true });
    expect(calls.some((c) => c.table === "wedding_gift_givers")).toBe(false);
  });
});

describe("exportGiftsCsv (regalos y agradecimientos)", () => {
  const listed = {
    id: giftId, kind: "efectivo", amount_cents: 20000, description: null, note: "=1+1", received_on: "2026-05-01",
    thanked_at: null, created_at: "2026-05-02T09:00:00+00:00", givers: [{ guestId: guestA, name: "Tía Puri" }],
  };
  it("sin sesión: error y no llega a la base", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect(await exportGiftsCsv()).toEqual({ ok: false, error: "Volved a entrar para gestionar vuestra boda." });
    expect(calls).toEqual([]);
  });
  it("sin boda (ni dueño ni pareja): error de sesión, sin leer regalos", async () => {
    mocks.client.mockResolvedValue(database([{ data: null, error: null }]));
    expect(await exportGiftsCsv()).toEqual({ ok: false, error: "Volved a entrar para gestionar vuestra boda." });
    expect(rpcCall("wedding_gift_list")).toBeUndefined();
  });
  it("lee los regalos de la boda de la sesión (membresía) y devuelve el CSV", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [listed], error: null }]));
    const result = await exportGiftsCsv();
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(rpcCall("wedding_gift_list")).toEqual({ p_wedding_id: weddingId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toBe(1);
    expect(result.filename).toBe("regalos-y-agradecimientos-vinklo.csv");
    expect(result.csv.split("\r\n")[1]).toBe("2026-05-01;\"Tía Puri\";\"Sobre en efectivo\";200,00;\"\";\"'=1+1\";No;;2026-05-02");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("sin regalos: CSV con cabecera y 0 filas", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [], error: null }]));
    const result = await exportGiftsCsv();
    expect(result).toMatchObject({ ok: true, rows: 0 });
  });
  it("si la lectura falla: error, nunca un CSV vacío", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: { code: "42501" } }]));
    expect(await exportGiftsCsv()).toEqual({ ok: false, error: "No hemos podido preparar el archivo. Probad de nuevo." });
  });
});
