import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { addSuggestedTasks, createTask, deleteTask, setTaskDone, updateTask } from "./tasks";
import {
  addBudgetItem, addBudgetPayment, removeBudgetItem, removeBudgetPayment, setBudgetPaymentPaid, setBudgetTotal, updateBudgetItem, updateBudgetPayment,
} from "./budget";

const weddingId = "11111111-1111-4111-8111-111111111111";
const rowId = "33333333-3333-4333-8333-333333333333";
const vendorId = "44444444-4444-4444-8444-444444444444";
type Reply = { data: unknown; error: unknown; count?: number };
let calls: Array<{ table: string; method: string; args: unknown[] }>;
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "order", "insert", "update", "delete", "in", "not"]) {
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

describe("tareas y presupuesto: sesión y validación", () => {
  it("sin sesión no toca ninguna tabla de la boda", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [
      () => createTask({ title: "Flores" }), () => updateTask(rowId, { title: "Flores" }), () => setTaskDone(rowId, true), () => deleteTask(rowId),
      () => addSuggestedTasks(["reservar-finca"]), () => setBudgetTotal(100), () => addBudgetItem({ label: "Finca" }),
      () => updateBudgetItem(rowId, { label: "Finca" }), () => removeBudgetItem(rowId), () => addBudgetPayment(rowId, { amountCents: 100 }),
      () => updateBudgetPayment(rowId, { amountCents: 100 }), () => setBudgetPaymentPaid(rowId, true), () => removeBudgetPayment(rowId),
    ]) {
      expect(await action()).toEqual({ ok: false, error: expect.stringContaining("Volved a entrar") });
    }
    expect(calls.filter((call) => call.table !== "weddings")).toEqual([]);
  });
  it("rechaza datos inválidos antes de crear un cliente", async () => {
    expect(await createTask({ title: "  " })).toEqual({ ok: false, error: "Escribid la tarea." });
    expect((await createTask({ title: "x", dueOn: "2026-02-30" })).ok).toBe(false);
    expect((await updateTask("no-uuid", { title: "x" })).ok).toBe(false);
    expect((await setTaskDone(rowId, "si" as unknown as boolean)).ok).toBe(false);
    expect((await addSuggestedTasks([])).ok).toBe(false);
    expect((await addSuggestedTasks(["inventada"])).ok).toBe(false);
    expect((await setBudgetTotal(-1)).ok).toBe(false);
    expect((await setBudgetTotal(10.5)).ok).toBe(false);
    expect((await addBudgetItem({ label: "Finca", agreedCents: -5 })).ok).toBe(false);
    expect((await addBudgetItem({ label: "Finca", category: "joyas" as never })).ok).toBe(false);
    expect((await addBudgetItem({ label: "Finca", vendorContactId: "ajeno" })).ok).toBe(false);
    expect((await addBudgetPayment(rowId, { amountCents: 0 })).ok).toBe(false);
    expect((await addBudgetPayment("no-uuid", { amountCents: 100 })).ok).toBe(false);
    expect((await setBudgetPaymentPaid("no-uuid", true)).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("tareas", () => {
  it("crea en la boda de la sesión con solo sus columnas", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 3 }, { data: { id: rowId }, error: null }]));
    expect(await createTask({ title: " Probar el menú ", dueOn: "2027-05-01", category: "proveedores", notes: "" })).toEqual({ ok: true, id: rowId });
    expect(scoped("wedding_tasks", "insert")[0]?.args[0]).toEqual({ wedding_id: weddingId, title: "Probar el menú", notes: null, due_on: "2027-05-01", category: "proveedores" });
    expect(mocks.refresh).toHaveBeenCalledWith("/panel/tareas");
  });
  it.each([
    ["editar", () => updateTask(rowId, { title: "Otra" }), "update"],
    ["marcar", () => setTaskDone(rowId, true), "update"],
    ["borrar", () => deleteTask(rowId), "delete"],
  ] as const)("%s exige id + wedding_id y no informa éxito sin fila", async (_label, action, method) => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await action()).toEqual({ ok: false, error: expect.stringContaining("ya no existe") });
    expect(scoped("wedding_tasks", method)).toHaveLength(1);
    expect(scoped("wedding_tasks", "eq")).toEqual(expect.arrayContaining([
      { table: "wedding_tasks", method: "eq", args: ["id", rowId] },
      { table: "wedding_tasks", method: "eq", args: ["wedding_id", weddingId] },
    ]));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("marcar hecha solo escribe done (done_at es del trigger)", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: rowId }, error: null }]));
    expect(await setTaskDone(rowId, true)).toEqual({ ok: true });
    expect(scoped("wedding_tasks", "update")[0]?.args[0]).toEqual({ done: true });
  });
  it("sugerencias: fechas del servidor desde la boda y sin duplicar las que ya estaban", async () => {
    mocks.client.mockResolvedValue(database([
      owner(), { data: { wedding_date: "2027-06-12" }, error: null }, { data: [{ template_key: "reservar-finca" }], error: null },
      { data: [{ id: "n1" }], error: null },
    ]));
    expect(await addSuggestedTasks(["reservar-finca", "enviar-invitaciones", "enviar-invitaciones"])).toEqual({ ok: true, added: 1, skipped: 1, tasks: [] });
    const rows = scoped("wedding_tasks", "insert")[0]?.args[0] as Record<string, unknown>[];
    expect(rows).toEqual([expect.objectContaining({ wedding_id: weddingId, template_key: "enviar-invitaciones", due_on: "2027-03-12", title: "Enviar las invitaciones", category: "invitados" })]);
    expect(rows[0]).not.toHaveProperty("done");
  });
  it("sugerencias sin fecha de boda: sin fecha; todas ya añadidas: no inserta", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { wedding_date: null }, error: null }, { data: [], error: null }, { data: [{ id: "n1" }], error: null }]));
    await addSuggestedTasks(["plan-mesas"]);
    expect((scoped("wedding_tasks", "insert")[0]?.args[0] as Record<string, unknown>[])[0].due_on).toBeNull();
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { wedding_date: "2027-06-12" }, error: null }, { data: [{ template_key: "plan-mesas" }], error: null }]));
    expect(await addSuggestedTasks(["plan-mesas"])).toEqual({ ok: true, added: 0, skipped: 1, tasks: [] });
    expect(scoped("wedding_tasks", "insert")).toEqual([]);
  });
  it("sin la migración lo dice", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST205" } }]));
    expect(await createTask({ title: "Flores" })).toEqual({ ok: false, error: expect.stringContaining("todavía no están disponibles") });
  });
});

describe("presupuesto", () => {
  it("total: actualiza y, si no había fila, la crea", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }, { data: null, error: null }]));
    expect(await setBudgetTotal(2_500_000)).toEqual({ ok: true });
    expect(scoped("wedding_budgets", "update")[0]?.args[0]).toEqual({ total_cents: 2_500_000 });
    expect(scoped("wedding_budgets", "insert")[0]?.args[0]).toEqual({ wedding_id: weddingId, total_cents: 2_500_000 });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: [{ wedding_id: weddingId }], error: null }]));
    expect(await setBudgetTotal(null)).toEqual({ ok: true });
    expect(scoped("wedding_budgets", "insert")).toEqual([]);
  });
  it("partida: columnas propias, al final y proveedor de la agenda", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ position: 7 }], error: null }, { data: { id: rowId }, error: null }]));
    expect(await addBudgetItem({ category: "finca", label: " Finca ", vendorContactId: vendorId, budgetedCents: 800_000, agreedCents: 850_000 })).toEqual({ ok: true, id: rowId });
    expect(scoped("wedding_budget_items", "insert")[0]?.args[0]).toEqual({
      wedding_id: weddingId, category: "finca", label: "Finca", vendor_contact_id: vendorId, budgeted_cents: 800_000, agreed_cents: 850_000, notes: null, position: 8,
    });
  });
  it("proveedor de otra boda (FK compuesta 23503) → mensaje claro, sin detalles internos", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }, { data: null, error: { code: "23503", message: "private detail" } }]));
    const result = await addBudgetItem({ label: "Finca", vendorContactId: vendorId });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("agenda") });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
  it.each([
    ["editar partida", () => updateBudgetItem(rowId, { label: "Finca" }), "wedding_budget_items", "update"],
    ["borrar partida", () => removeBudgetItem(rowId), "wedding_budget_items", "delete"],
    ["editar pago", () => updateBudgetPayment(rowId, { amountCents: 100 }), "wedding_budget_payments", "update"],
    ["marcar pago", () => setBudgetPaymentPaid(rowId, true), "wedding_budget_payments", "update"],
    ["borrar pago", () => removeBudgetPayment(rowId), "wedding_budget_payments", "delete"],
  ] as const)("%s exige id + wedding_id y no informa éxito sin fila", async (_label, action, table, method) => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await action()).toEqual({ ok: false, error: expect.stringContaining("ya no existe") });
    expect(scoped(table, method)).toHaveLength(1);
    expect(scoped(table, "eq")).toEqual(expect.arrayContaining([
      { table, method: "eq", args: ["id", rowId] },
      { table, method: "eq", args: ["wedding_id", weddingId] },
    ]));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("pago: en la boda de la sesión; partida ajena o borrada → ya no existe", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 0 }, { data: { id: "p1" }, error: null }]));
    expect(await addBudgetPayment(rowId, { amountCents: 255_000, dueOn: "2027-01-15", note: "Señal" })).toEqual({ ok: true, id: "p1" });
    expect(scoped("wedding_budget_payments", "insert")[0]?.args[0]).toEqual({ wedding_id: weddingId, item_id: rowId, amount_cents: 255_000, due_on: "2027-01-15", note: "Señal" });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null, count: 0 }, { data: null, error: { code: "23503" } }]));
    expect(await addBudgetPayment(rowId, { amountCents: 100 })).toEqual({ ok: false, error: expect.stringContaining("partida ya no existe") });
  });
  it("marcar pagado escribe la fecha de hoy; deshacer, null", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: rowId }, error: null }]));
    await setBudgetPaymentPaid(rowId, true);
    expect((scoped("wedding_budget_payments", "update")[0]?.args[0] as { paid_on: string }).paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: rowId }, error: null }]));
    await setBudgetPaymentPaid(rowId, false);
    expect(scoped("wedding_budget_payments", "update")[0]?.args[0]).toEqual({ paid_on: null });
  });
  it("sin la migración lo dice", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "42P01" } }]));
    expect(await setBudgetTotal(100)).toEqual({ ok: false, error: expect.stringContaining("todavía no está disponible") });
  });
});
