import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { addVendorContact, listVendorContacts, removeVendorContact, updateVendorContact } from "./wedding-vendors";

const weddingId = "11111111-1111-4111-8111-111111111111";
const vendorId = "33333333-3333-4333-8333-333333333333";
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
  return { auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) }, from: chainFor };
}
const owner = { data: { id: weddingId }, error: null };
const row = { id: vendorId, name: "Foto Luz", category: "fotografia", contact_name: "Marta", phone: "612345678", email: "marta@example.com", status: "en_conversacion", payment_note: "Señal antes de marzo", notes: null, created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T10:00:00Z" };
const scoped = (method: string) => calls.filter((call) => call.table === "wedding_vendor_contacts" && call.method === method);
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("autorización y validación", () => {
  it("sin sesión ninguna acción toca la tabla de proveedores", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [
      () => listVendorContacts(), () => addVendorContact({ name: "DJ" }), () => updateVendorContact(vendorId, { name: "DJ" }), () => removeVendorContact(vendorId),
    ]) expect(await action()).toEqual({ ok: false, error: "Volved a entrar para gestionar vuestra boda." });
    expect(calls).toEqual([]);
  });
  it("entrada inválida: error en español y no se crea cliente", async () => {
    expect(await addVendorContact({ name: " " })).toEqual({ ok: false, error: "Escribid el nombre del proveedor." });
    expect(await addVendorContact({ name: "DJ", email: "x@" })).toEqual({ ok: false, error: "Revisad el email: no parece válido." });
    expect(await addVendorContact({ name: "DJ", status: "pagado" as "contratado" })).toEqual({ ok: false, error: "Elegid un estado de la lista." });
    expect((await updateVendorContact("no-uuid", { name: "DJ" })).ok).toBe(false);
    expect(await updateVendorContact(vendorId, { name: "DJ", phone: "12" })).toEqual({ ok: false, error: "Revisad el teléfono: mínimo 6 caracteres." });
    expect((await removeVendorContact("no-uuid")).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("lista", () => {
  it("lee solo la boda de la sesión, en orden estable, y devuelve camelCase", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [row], error: null }]));
    const result = await listVendorContacts();
    expect(result).toEqual({ ok: true, contacts: [{ id: vendorId, name: "Foto Luz", category: "fotografia", contactName: "Marta", phone: "612345678", email: "marta@example.com", status: "en_conversacion", paymentNote: "Señal antes de marzo", notes: null, createdAt: row.created_at, updatedAt: row.updated_at }] });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(scoped("eq")).toEqual([{ table: "wedding_vendor_contacts", method: "eq", args: ["wedding_id", weddingId] }]);
    expect(scoped("order").map((call) => call.args[0])).toEqual(["created_at", "id"]);
  });
  it("error de base o fila corrupta → error de carga", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: { message: "x" } }]));
    expect(await listVendorContacts()).toEqual({ ok: false, error: "No hemos podido cargar los proveedores. Probad de nuevo." });
    mocks.client.mockResolvedValue(database([owner, { data: [{ ...row, status: "pagado" }], error: null }]));
    expect((await listVendorContacts()).ok).toBe(false);
  });
});

describe("escrituras", () => {
  it("alta con wedding_id de la sesión, vacíos a null y revalidación", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: { id: vendorId }, error: null }]));
    expect(await addVendorContact({ name: " Foto Luz ", category: "fotografia", email: "Marta@Example.com", paymentNote: "Señal 30 %" })).toEqual({ ok: true, id: vendorId });
    expect(scoped("insert")[0].args[0]).toEqual({ wedding_id: weddingId, name: "Foto Luz", category: "fotografia", contact_name: null, phone: null, email: "marta@example.com", status: "por_contactar", payment_note: "Señal 30 %", notes: null });
    expect(mocks.refresh.mock.calls.map((call) => call[0])).toEqual(["/panel/proveedores", "/panel"]);
  });
  it("alta fallida no revalida", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: { code: "23514" } }]));
    expect((await addVendorContact({ name: "DJ" })).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("edición acotada por id + wedding_id; sin fila = ya no disponible", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: { id: vendorId }, error: null }]));
    expect(await updateVendorContact(vendorId, { name: "DJ Sol", status: "contratado" })).toEqual({ ok: true });
    expect(scoped("update")[0].args[0]).not.toHaveProperty("wedding_id");
    expect(scoped("eq").map((call) => call.args)).toEqual([["id", vendorId], ["wedding_id", weddingId]]);
    calls = []; mocks.client.mockResolvedValue(database([owner, { data: null, error: null }]));
    expect(await updateVendorContact(vendorId, { name: "DJ Sol" })).toEqual({ ok: false, error: "No se ha guardado: el proveedor ya no está disponible." });
  });
  it("borrado acotado por id + wedding_id; sin fila = ya no disponible", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: { id: vendorId }, error: null }]));
    expect(await removeVendorContact(vendorId)).toEqual({ ok: true });
    expect(scoped("eq").map((call) => call.args)).toEqual([["id", vendorId], ["wedding_id", weddingId]]);
    mocks.client.mockResolvedValue(database([owner, { data: null, error: null }]));
    expect(await removeVendorContact(vendorId)).toEqual({ ok: false, error: "No se ha eliminado: el proveedor ya no está disponible." });
  });
});
