import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUDGET_ITEM_COLUMNS, BUDGET_ITEMS_LIMIT, BUDGET_PAYMENT_COLUMNS, BUDGET_PAYMENTS_LIMIT,
  parseBudgetItems, parseBudgetPayments, type BudgetData,
} from "@/lib/planning/budget";
import { countTasks, parseTaskRows, TASK_COLUMNS, TASKS_LIMIT, type TaskCounts, type WeddingTask } from "@/lib/planning/tasks";
import { isMissingMigration, type PlanningRead } from "@/lib/planning/errors";
import { isIsoDate, type IsoDate } from "@/lib/planning/dates";
import { parseVendorRows, VENDOR_CONTACT_COLUMNS, VENDOR_LIST_LIMIT, type VendorContact } from "@/lib/vendors/contacts";

/**
 * Lecturas de «Planificar» (tareas, presupuesto y agenda de proveedores) con
 * el cliente de SESIÓN: RLS (owns_wedding) es la frontera y además se filtra
 * por wedding_id. Sin la migración, `missing` (la página avisa; el resumen calla).
 */

export async function getWeddingDate(supabase: SupabaseClient, weddingId: string): Promise<IsoDate | null> {
  const { data } = await supabase.from("weddings").select("wedding_date").eq("id", weddingId).maybeSingle();
  const value = (data as { wedding_date: string | null } | null)?.wedding_date ?? null;
  return isIsoDate(value) ? value : null;
}

export async function getTasks(supabase: SupabaseClient, weddingId: string): Promise<PlanningRead<WeddingTask[]>> {
  const { data, error } = await supabase.from("wedding_tasks").select(TASK_COLUMNS).eq("wedding_id", weddingId)
    .order("due_on", { ascending: true, nullsFirst: false }).order("position", { ascending: true }).order("created_at", { ascending: true })
    .limit(TASKS_LIMIT);
  if (error) return isMissingMigration(error) ? { status: "missing" } : { status: "error" };
  const tasks = parseTaskRows(data);
  return tasks ? { status: "ok", data: tasks } : { status: "error" };
}

/** «Lo que toca hoy»: tareas de esta semana y vencidas. null = sin la migración o sin poder leer. */
export async function getTaskCounts(supabase: SupabaseClient, weddingId: string, today: IsoDate): Promise<TaskCounts | null> {
  const { data, error } = await supabase.from("wedding_tasks").select("done, due_on").eq("wedding_id", weddingId)
    .eq("done", false).not("due_on", "is", null).limit(TASKS_LIMIT);
  if (error || !Array.isArray(data)) return null;
  return countTasks((data as { done: boolean; due_on: string | null }[]).map((row) => ({ done: row.done, dueOn: row.due_on })), today);
}

export async function getBudget(supabase: SupabaseClient, weddingId: string): Promise<PlanningRead<BudgetData>> {
  const [total, items, payments] = await Promise.all([
    supabase.from("wedding_budgets").select("total_cents").eq("wedding_id", weddingId).maybeSingle(),
    supabase.from("wedding_budget_items").select(BUDGET_ITEM_COLUMNS).eq("wedding_id", weddingId)
      .order("position", { ascending: true }).order("created_at", { ascending: true }).limit(BUDGET_ITEMS_LIMIT),
    supabase.from("wedding_budget_payments").select(BUDGET_PAYMENT_COLUMNS).eq("wedding_id", weddingId)
      .order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).limit(BUDGET_PAYMENTS_LIMIT),
  ]);
  const errors = [total.error, items.error, payments.error];
  if (errors.some(isMissingMigration)) return { status: "missing" };
  if (errors.some(Boolean)) return { status: "error" };
  const parsedItems = parseBudgetItems(items.data);
  const parsedPayments = parseBudgetPayments(payments.data);
  if (!parsedItems || !parsedPayments) return { status: "error" };
  const totalCents = (total.data as { total_cents: number | null } | null)?.total_cents ?? null;
  return { status: "ok", data: { totalCents, items: parsedItems, payments: parsedPayments } };
}

/** La agenda de proveedores (20261005100000, ya aplicada en producción). */
export async function getVendorContacts(supabase: SupabaseClient, weddingId: string): Promise<PlanningRead<VendorContact[]>> {
  const { data, error } = await supabase.from("wedding_vendor_contacts").select(VENDOR_CONTACT_COLUMNS).eq("wedding_id", weddingId)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(VENDOR_LIST_LIMIT);
  if (error) return isMissingMigration(error) ? { status: "missing" } : { status: "error" };
  const contacts = parseVendorRows(data);
  return contacts ? { status: "ok", data: contacts } : { status: "error" };
}
