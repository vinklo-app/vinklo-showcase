import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn(), sync: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/data/site", () => ({ syncDraftFromLegacy: mocks.sync }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { addAgendaItem, deleteAgendaItem, updateAgendaItem } from "./agenda";

const weddingId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Record<string, Reply[]>) {
  const next = (table: string): Reply => replies[table]?.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "insert", "update", "delete", "order"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => next(table);
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next(table)).then(resolve);
      return chain;
    },
  };
}
const owner = (): Reply => ({ data: { id: weddingId, slug: "ana-y-luis" }, error: null });

beforeEach(() => { vi.clearAllMocks(); calls = []; mocks.sync.mockResolvedValue({ ok: true, draftVersion: 2, changed: true }); });

describe("agenda → borrador de la web (S-01)", () => {
  it.each([
    ["addAgendaItem", () => addAgendaItem({ title: "Ceremonia", timeLabel: "13:00" })],
    ["updateAgendaItem", () => updateAgendaItem({ id: itemId, title: "Cóctel" })],
    ["deleteAgendaItem", () => deleteAgendaItem(itemId)],
  ])("%s sincroniza el borrador tras escribir y no revalida la web pública", async (_name, action) => {
    // Update y delete exigen la fila afectada (R07); add no la lee.
    mocks.client.mockImplementation(async () => database({ weddings: [owner(), owner()], wedding_agenda_items: [{ data: { id: itemId }, error: null }] }));
    expect(await action()).toEqual({ ok: true });
    const writeIndex = calls.findIndex((c) => c.table === "wedding_agenda_items" && ["insert", "update", "delete"].includes(c.method));
    expect(writeIndex).toBeGreaterThan(-1);
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), weddingId);
    expect(mocks.revalidate.mock.calls.flat()).toEqual(expect.arrayContaining(["/panel/dia", "/panel/ajustes"]));
    expect(mocks.revalidate.mock.calls.flat()).not.toContain("/b/ana-y-luis");
  });
  it.each([
    ["updateAgendaItem", () => updateAgendaItem({ id: itemId, title: "Cóctel" })],
    ["deleteAgendaItem", () => deleteAgendaItem(itemId)],
  ])("%s sobre un momento que ya no existe falla sin tocar el borrador y filtra por wedding_id", async (_name, action) => {
    mocks.client.mockImplementation(async () => database({ weddings: [owner(), owner()] }));
    expect((await action()).ok).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(calls).toContainEqual({ table: "wedding_agenda_items", method: "eq", args: ["wedding_id", weddingId] });
  });
  it("si la escritura falla no sincroniza", async () => {
    mocks.client.mockImplementation(async () => database({ weddings: [owner()], wedding_agenda_items: [{ data: null, error: null }, { data: null, error: { code: "42501" } }] }));
    expect((await addAgendaItem({ title: "Ceremonia" })).ok).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("los límites coinciden con la escena agenda del documento (240/400/20)", async () => {
    expect((await addAgendaItem({ title: "Ceremonia", address: "a".repeat(241) })).ok).toBe(false);
    expect((await addAgendaItem({ title: "Ceremonia", notes: "n".repeat(401) })).ok).toBe(false);
    expect((await addAgendaItem({ title: "Ceremonia", timeLabel: "t".repeat(21) })).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
