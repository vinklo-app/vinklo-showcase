import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { applySeating, createTable, deleteTable, renameTable, seatGuests, setTablePinnedGroup, setTableSeats } from "./tables";
import { MAX_SEAT_MOVE, MAX_TABLES } from "@/lib/crm/seating";

const weddingId = "11111111-1111-4111-8111-111111111111";
const tableId = "33333333-3333-4333-8333-333333333333";
const guestA = "22222222-2222-4222-8222-222222222222";
const guestB = "44444444-4444-4444-8444-444444444444";
type Reply = { data: unknown; error: unknown };
let calls: Array<{ table: string; method: string; args: unknown[] }>;
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "order", "insert", "update", "delete", "in"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve);
      return chain;
    },
  };
}
const owner = (): Reply => ({ data: { id: weddingId, slug: "ana-y-luis" }, error: null });
const scoped = (table: string, method: string) => calls.filter((call) => call.table === table && call.method === method);
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("mesas: autorización y validación", () => {
  it("sin sesión no toca ninguna tabla de la boda", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [() => createTable({ name: "Mesa 1" }), () => renameTable(tableId, "Mesa 2"), () => setTableSeats(tableId, 8), () => deleteTable(tableId), () => seatGuests([guestA], tableId)]) {
      expect(await action()).toEqual({ ok: false, error: expect.stringContaining("Volved a entrar") });
    }
    expect(calls.filter((call) => call.table !== "weddings")).toEqual([]);
  });
  it("rechaza datos inválidos antes de crear un cliente", async () => {
    expect(await createTable({ name: "   " })).toEqual({ ok: false, error: "Poned un nombre a la mesa." });
    expect((await createTable({ name: "a".repeat(41) })).ok).toBe(false);
    expect((await createTable({ name: "Mesa", seats: 0 })).ok).toBe(false);
    expect((await createTable({ name: "Mesa", seats: 31 })).ok).toBe(false);
    expect((await createTable({ name: "Mesa", seats: 2.5 })).ok).toBe(false);
    expect((await renameTable("no-uuid", "Mesa")).ok).toBe(false);
    expect((await setTableSeats(tableId, 99)).ok).toBe(false);
    expect((await deleteTable("no-uuid")).ok).toBe(false);
    expect((await seatGuests([], tableId)).ok).toBe(false);
    expect((await seatGuests(["x"], tableId)).ok).toBe(false);
    expect((await seatGuests([guestA], "no-uuid")).ok).toBe(false);
    expect((await seatGuests(Array.from({ length: MAX_SEAT_MOVE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), tableId)).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("mesas: crear, renombrar, plazas y borrar", () => {
  it("crea en la boda de la sesión, normaliza el nombre y la pone al final", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ position: 4 }, { position: 2 }], error: null }, { data: { id: tableId }, error: null }]));
    expect(await createTable({ name: "  Mesa   de los primos ", seats: 8 })).toEqual({ ok: true, id: tableId });
    expect(scoped("wedding_tables", "eq")).toContainEqual({ table: "wedding_tables", method: "eq", args: ["wedding_id", weddingId] });
    expect(scoped("wedding_tables", "insert")[0]?.args[0]).toEqual({ wedding_id: weddingId, name: "Mesa de los primos", seats: 8, position: 5 });
    expect(mocks.refresh).toHaveBeenCalledWith("/panel/mesas");
  });
  it("10 plazas por defecto; nombre repetido y tope de mesas con mensaje propio", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }, { data: null, error: { code: "23505" } }]));
    expect(await createTable({ name: "Mesa 1" })).toEqual({ ok: false, error: "Ya tenéis una mesa con ese nombre." });
    expect(scoped("wedding_tables", "insert")[0]?.args[0]).toMatchObject({ seats: 10, position: 1 });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: Array.from({ length: MAX_TABLES }, () => ({ position: 1 })), error: null }]));
    expect((await createTable({ name: "Otra" })).ok).toBe(false);
    expect(scoped("wedding_tables", "insert")).toEqual([]);
  });
  it("sin la migración lo dice en vez de fallar en silencio", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST205" } }]));
    expect(await createTable({ name: "Mesa 1" })).toEqual({ ok: false, error: expect.stringContaining("migración") });
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST204" } }]));
    expect(await seatGuests([guestA], tableId)).toEqual({ ok: false, error: expect.stringContaining("migración") });
  });
  it.each([
    ["renombrar", () => renameTable(tableId, "Presidencial"), "update"],
    ["plazas", () => setTableSeats(tableId, 12), "update"],
    ["borrar", () => deleteTable(tableId), "delete"],
  ] as const)("%s exige id + wedding_id y no informa éxito sin fila (mesa ajena o borrada)", async (_label, action, method) => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await action()).toEqual({ ok: false, error: expect.stringContaining("ya no existe") });
    expect(scoped("wedding_tables", method)).toHaveLength(1);
    expect(scoped("wedding_tables", "eq")).toEqual(expect.arrayContaining([
      { table: "wedding_tables", method: "eq", args: ["id", tableId] },
      { table: "wedding_tables", method: "eq", args: ["wedding_id", weddingId] },
    ]));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("renombra y cambia plazas con solo esas columnas", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: tableId }, error: null }]));
    expect(await renameTable(tableId, " Presidencial ")).toEqual({ ok: true });
    expect(scoped("wedding_tables", "update")[0]?.args[0]).toEqual({ name: "Presidencial" });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: tableId }, error: null }]));
    expect(await setTableSeats(tableId, 12)).toEqual({ ok: true });
    expect(scoped("wedding_tables", "update")[0]?.args[0]).toEqual({ seats: 12 });
  });
});

describe("mesas: sentar y quitar invitados", () => {
  it("sienta a varios (sin repetidos) solo en la boda de la sesión y cuenta los que faltan", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestA }], error: null }]));
    expect(await seatGuests([guestA, guestB, guestA], tableId)).toEqual({ ok: true, moved: 1, missing: 1 });
    expect(scoped("wedding_guests", "update")[0]?.args[0]).toEqual({ table_id: tableId });
    expect(scoped("wedding_guests", "in")[0]?.args).toEqual(["id", [guestA, guestB]]);
    expect(scoped("wedding_guests", "eq")).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("quitar la mesa escribe null", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestA }], error: null }]));
    expect(await seatGuests([guestA], null)).toEqual({ ok: true, moved: 1, missing: 0 });
    expect(scoped("wedding_guests", "update")[0]?.args[0]).toEqual({ table_id: null });
  });
  it("0 filas (invitados ajenos o borrados) no es éxito", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }]));
    expect((await seatGuests([guestA], tableId)).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("mesa de otra boda o borrada (FK compuesta, 23503) → mensaje claro, sin detalles internos", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "23503", message: "private detail" } }]));
    const result = await seatGuests([guestA], tableId);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya no existe") });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
});

describe("applySeating (mesas automáticas, 20261020110000)", () => {
  function withRpc(replies: Reply[], signedIn = true) {
    const base = database(replies, signedIn);
    return {
      ...base,
      rpc(name: string, args: unknown) {
        calls.push({ table: "rpc", method: name, args: [args] });
        return Promise.resolve(replies.shift() ?? { data: null, error: null });
      },
    };
  }
  const created = { data: { created: [{ key: "new:1", id: tableId }], seated: 2 }, error: null };
  it("una sola RPC con la boda de la sesión, mesas nuevas y asignaciones", async () => {
    mocks.client.mockResolvedValue(withRpc([owner(), created]));
    const result = await applySeating([{ key: "new:1", name: "  Mesa   7 ", seats: 8 }], [{ guestId: guestA, tableId: "new:1" }, { guestId: guestB, tableId: null }]);
    expect(result).toEqual({ ok: true, created: [{ key: "new:1", id: tableId }], seated: 2 });
    expect(calls.find((call) => call.table === "rpc")).toEqual({ table: "rpc", method: "apply_seating", args: [{
      p_wedding_id: weddingId,
      p_new_tables: [{ key: "new:1", name: "Mesa 7", seats: 8 }],
      p_assignments: [{ guestId: guestA, tableId: "new:1" }, { guestId: guestB, tableId: null }],
    }] });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("acompañantes (mesa infantil) en la misma llamada; sin la migración, se avisa", async () => {
    mocks.client.mockResolvedValue(withRpc([owner(), created]));
    expect((await applySeating([], [{ companionId: guestB, tableId: tableId }, { companionId: guestA, tableId: null }])).ok).toBe(true);
    expect((calls.find((call) => call.table === "rpc")?.args[0] as { p_assignments: unknown }).p_assignments).toEqual([{ companionId: guestB, tableId }, { companionId: guestA, tableId: null }]);
    expect((await applySeating([], [{ companionId: guestA, guestId: guestB, tableId: null } as never])).ok).toBe(false);
    mocks.client.mockResolvedValue(withRpc([owner(), { data: null, error: { code: "22023" } }]));
    expect(await applySeating([], [{ companionId: guestA, tableId: null }])).toEqual({ ok: false, error: expect.stringContaining("migración de acompañantes") });
  });
  it("mesa fija para un grupo: limpia el nombre, vacío = ninguno, siempre con la boda de la sesión", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: tableId }, error: null }]));
    expect(await setTablePinnedGroup(tableId, "  Familia   de Ana ")).toEqual({ ok: true });
    expect(scoped("wedding_tables", "update")[0]?.args[0]).toEqual({ pinned_group: "Familia de Ana" });
    expect(scoped("wedding_tables", "eq").map((call) => call.args)).toEqual([["id", tableId], ["wedding_id", weddingId]]);
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: tableId }, error: null }]));
    expect(await setTablePinnedGroup(tableId, "  ")).toEqual({ ok: true });
    expect(scoped("wedding_tables", "update")[0]?.args[0]).toEqual({ pinned_group: null });
    expect((await setTablePinnedGroup("no-uuid", "X")).ok).toBe(false);
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST204" } }]));
    expect(await setTablePinnedGroup(tableId, "X")).toEqual({ ok: false, error: expect.stringContaining("migración") });
  });
  it("rechaza propuestas vacías o mal formadas sin crear cliente", async () => {
    expect((await applySeating([], [])).ok).toBe(false);
    expect((await applySeating([{ key: "x", name: "Mesa", seats: 10 }], [])).ok).toBe(false);
    expect((await applySeating([{ key: "new:1", name: "Mesa", seats: 31 }], [])).ok).toBe(false);
    expect((await applySeating([], [{ guestId: "no-uuid", tableId: null }])).ok).toBe(false);
    expect((await applySeating([], [{ guestId: guestA, tableId: "otra-cosa" }])).ok).toBe(false);
    expect((await applySeating(Array.from({ length: MAX_TABLES + 1 }, (_, i) => ({ key: `new:${i + 1}`, name: `M${i}`, seats: 10 })), [])).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("errores del servidor: sin migración, nombre repetido, invitado ajeno, sin sesión", async () => {
    for (const [code, text] of [["PGRST202", "migración"], ["23505", "nombre"], ["42501", "ya no está"], ["XX000", "conexión"]] as const) {
      mocks.client.mockResolvedValue(withRpc([owner(), { data: null, error: { code } }]));
      expect(await applySeating([], [{ guestId: guestA, tableId: null }])).toEqual({ ok: false, error: expect.stringContaining(text) });
    }
    calls = []; mocks.refresh.mockClear();
    mocks.client.mockResolvedValue(withRpc([], false));
    expect((await applySeating([], [{ guestId: guestA, tableId: null }])).ok).toBe(false);
    expect(calls.some((call) => call.table === "rpc")).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
