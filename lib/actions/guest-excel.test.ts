import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { importGuestsFromExcel } from "./guest-excel";
import type { ImportGuest } from "@/lib/crm/guest-excel-import";

const weddingId = "11111111-1111-4111-8111-111111111111";
const importId = "33333333-3333-4333-8333-333333333333";
type Reply = { data: unknown; error: unknown };
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
const guest = (over: Partial<ImportGuest> = {}): ImportGuest => ({
  name: "Ana García", phone: "612 345 678", status: "si", companions: 1, max_companions: 1, notes: null,
  group: "Uni", tags: ["Uni"], side: "p1", extra: { Email: "ana@ejemplo.es", Mesa: "3" }, companion_names: ["Pablo García"], ...over,
});
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("importGuestsFromExcel", () => {
  it("manda todo en UNA llamada a la RPC con la boda de la sesión y el id de la importación", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { status: "ok", guests: 2, people: 3 }, error: null }]));
    const result = await importGuestsFromExcel(importId, [guest(), guest({ name: "  Tío   Ramón ", phone: null, status: "pendiente", companions: 0, max_companions: null, group: null, tags: [], side: null, extra: {}, companion_names: [] })]);
    expect(result).toEqual({ ok: true, guests: 2, people: 3, repeated: false });
    const rpcs = calls.filter((call) => call.table === "rpc");
    expect(rpcs).toHaveLength(1);
    const args = rpcs[0].args[0] as { p_wedding_id: string; p_import_id: string; p_rows: ImportGuest[] };
    expect(rpcs[0].method).toBe("import_wedding_guests");
    expect(args.p_wedding_id).toBe(weddingId);
    expect(args.p_import_id).toBe(importId);
    expect(args.p_rows[1].name).toBe("Tío Ramón");
    expect(args.p_rows[0]).toMatchObject({ extra: { Email: "ana@ejemplo.es", Mesa: "3" }, companion_names: ["Pablo García"] });
    // Nunca escribe en tablas directamente: todo pasa por la RPC (una transacción).
    expect(calls.filter((call) => ["insert", "update", "delete"].includes(call.method))).toEqual([]);
    expect(mocks.refresh).toHaveBeenCalledWith("/panel/invitados");
  });

  it("un reintento con el mismo id devuelve el resumen sin duplicar (repeated)", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { status: "duplicate", guests: 2, people: 3 }, error: null }]));
    expect(await importGuestsFromExcel(importId, [guest()])).toEqual({ ok: true, guests: 2, people: 3, repeated: true });
  });

  it("valida antes de tocar la base: id, topes y forma de cada invitación", async () => {
    const bad: Array<[string, ImportGuest[]]> = [
      ["no-uuid", [guest()]],
      [importId, []],
      [importId, Array.from({ length: 2001 }, () => guest())],
      [importId, [guest({ name: "A" })]],
      [importId, [guest({ phone: "12" })]],
      [importId, [guest({ companions: 11 })]],
      [importId, [guest({ tags: ["Uni", "uni"] })]],
      [importId, [guest({ extra: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, "v"])) })]],
      [importId, [guest({ extra: { Nota: "x".repeat(301) } })]],
      // Por encima del presupuesto compacto (5800 bytes), aunque el CHECK admita 6144 con espacios.
      [importId, [guest({ extra: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Campo ${String(i).padStart(2, "0")}`, "v".repeat(285)])) })]],
      [importId, [guest({ extra: { Mesa: 3 as unknown as string } })]],
      [importId, [guest({ companion_names: Array.from({ length: 11 }, (_, i) => `N${i}`) })]],
      [importId, [{ ...guest(), wedding_id: "otra" } as unknown as ImportGuest]],
    ];
    for (const [id, guests] of bad) {
      const result = await importGuestsFromExcel(id, guests);
      expect(result.ok).toBe(false);
    }
    expect(mocks.client).not.toHaveBeenCalled();
    expect(await importGuestsFromExcel(importId, [guest(), guest({ name: "A" })])).toEqual({ ok: false, error: expect.stringContaining("(invitación 2)"), row: 2 });
  });

  it("sin sesión no importa nada", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect((await importGuestsFromExcel(importId, [guest()])).ok).toBe(false);
    expect(calls.filter((call) => call.table === "rpc")).toEqual([]);
  });

  it("traduce los errores de la RPC", async () => {
    const run = async (error: { code: string; message?: string }) => {
      mocks.client.mockResolvedValue(database([owner(), { data: null, error }]));
      return importGuestsFromExcel(importId, [guest()]);
    };
    expect(await run({ code: "PGRST202" })).toEqual({ ok: false, error: expect.stringContaining("migración") });
    expect(await run({ code: "22023", message: "fila 7" })).toEqual({ ok: false, error: expect.stringContaining("invitación 7"), row: 7 });
    expect(await run({ code: "42501" })).toEqual({ ok: false, error: expect.stringContaining("Volved a entrar") });
    expect(await run({ code: "XX000" })).toEqual({ ok: false, error: expect.stringContaining("No se ha importado nadie") });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
