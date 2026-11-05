import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBudget, getTaskCounts, getTasks, getVendorContacts, getWeddingDate } from "./planning";
import { isMissingMigration } from "@/lib/planning/errors";

type Reply = { data: unknown; error: unknown };
function client(replies: Record<string, Reply>): SupabaseClient {
  return {
    from(table: string) {
      const reply = replies[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "not"]) chain[method] = () => chain;
      chain.maybeSingle = async () => reply;
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(reply).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
}
const task = { id: "t1", title: "Flores", notes: null, due_on: "2026-10-08", done: false, done_at: null, category: null, position: 0, template_key: null, created_at: "2026-10-01T00:00:00Z" };

describe("lecturas de Planificar", () => {
  it("detecta la migración sin aplicar", () => {
    for (const code of ["PGRST205", "PGRST204", "42P01", "42703"]) expect(isMissingMigration({ code })).toBe(true);
    expect(isMissingMigration({ code: "42501" })).toBe(false);
    expect(isMissingMigration(null)).toBe(false);
  });
  it("tareas: ok, missing, error y recuentos", async () => {
    expect(await getTasks(client({ wedding_tasks: { data: [task], error: null } }), "w")).toMatchObject({ status: "ok", data: [{ id: "t1", dueOn: "2026-10-08" }] });
    expect(await getTasks(client({ wedding_tasks: { data: null, error: { code: "PGRST205" } } }), "w")).toEqual({ status: "missing" });
    expect(await getTasks(client({ wedding_tasks: { data: null, error: { code: "500" } } }), "w")).toEqual({ status: "error" });
    expect(await getTasks(client({ wedding_tasks: { data: [{ id: 1 }], error: null } }), "w")).toEqual({ status: "error" });
    expect(await getTaskCounts(client({ wedding_tasks: { data: [{ done: false, due_on: "2026-10-01" }, { done: false, due_on: "2026-10-08" }], error: null } }), "w", "2026-10-06"))
      .toMatchObject({ thisWeek: 1, overdue: 1 });
    expect(await getTaskCounts(client({ wedding_tasks: { data: null, error: { code: "PGRST205" } } }), "w", "2026-10-06")).toBeNull();
  });
  it("presupuesto: junta total, partidas y pagos; missing si falta cualquiera", async () => {
    const ok = await getBudget(client({
      wedding_budgets: { data: { total_cents: 100 }, error: null },
      wedding_budget_items: { data: [{ id: "i", category: "finca", label: "Finca", vendor_contact_id: null, budgeted_cents: 1, agreed_cents: null, notes: null, position: 1 }], error: null },
      wedding_budget_payments: { data: [], error: null },
    }), "w");
    expect(ok).toMatchObject({ status: "ok", data: { totalCents: 100, items: [{ id: "i" }], payments: [] } });
    expect(await getBudget(client({ wedding_budget_items: { data: null, error: { code: "42P01" } } }), "w")).toEqual({ status: "missing" });
    expect(await getBudget(client({ wedding_budget_payments: { data: null, error: { code: "57014" } } }), "w")).toEqual({ status: "error" });
    expect(await getBudget(client({}), "w")).toMatchObject({ status: "ok", data: { totalCents: null, items: [], payments: [] } });
  });
  it("agenda y fecha de la boda", async () => {
    expect(await getVendorContacts(client({ wedding_vendor_contacts: { data: [], error: null } }), "w")).toEqual({ status: "ok", data: [] });
    expect(await getVendorContacts(client({ wedding_vendor_contacts: { data: null, error: { code: "PGRST205" } } }), "w")).toEqual({ status: "missing" });
    expect(await getWeddingDate(client({ weddings: { data: { wedding_date: "2027-06-12" }, error: null } }), "w")).toBe("2027-06-12");
    expect(await getWeddingDate(client({ weddings: { data: { wedding_date: null }, error: null } }), "w")).toBeNull();
  });
});
