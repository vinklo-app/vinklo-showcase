"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { isMissingMigration } from "@/lib/planning/errors";
import { todayIn } from "@/lib/planning/dates";
import {
  BUDGET_ITEMS_LIMIT, BUDGET_PAYMENTS_LIMIT, budgetItemSchema, budgetPaymentSchema, budgetTotalSchema,
  type BudgetItemInput, type BudgetPaymentInput,
} from "@/lib/planning/budget";

/**
 * Presupuesto de la boda (20261014100000). ES UN REGISTRO de la pareja:
 * nada de esto cobra, factura ni mueve dinero; solo guarda lo que anotan.
 * La boda sale de la sesión (getCurrentWedding); cada escritura lleva
 * `.eq("wedding_id")` además de RLS y exige filas afectadas. Las FK
 * compuestas impiden enlazar un proveedor o una partida de otra boda.
 */
export type BudgetActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const MIGRATION_ERROR = "El presupuesto todavía no está disponible en vuestra cuenta. Volved en un rato.";
const GONE_ITEM = "Esa partida ya no existe. Actualizad la página.";
const GONE_PAYMENT = "Ese pago ya no existe. Actualizad la página.";
const GONE_VENDOR = "Ese proveedor ya no está en vuestra agenda. Actualizad la página.";

function refresh() { revalidatePath("/panel/proveedores"); revalidatePath("/panel"); }
function firstIssue(error: z.ZodError) { return error.issues[0]?.message ?? GENERIC_ERROR; }
type Failure = { ok: false; error: string };
function failure(error: { code?: string } | null, gone: string): Failure {
  if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
  if (error?.code === "23503") return { ok: false, error: gone };
  return { ok: false, error: GENERIC_ERROR };
}

/** Total previsto (null = quitarlo). Sin upsert: update y, si no había fila, insert. */
export async function setBudgetTotal(totalCents: number | null): Promise<BudgetActionResult> {
  const parsed = budgetTotalSchema.safeParse(totalCents);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const { data, error } = await supabase.from("wedding_budgets").update({ total_cents: parsed.data })
      .eq("wedding_id", wedding.id).select("wedding_id");
    if (error) return failure(error, GENERIC_ERROR);
    if (!Array.isArray(data) || data.length === 0) {
      const { error: insertError } = await supabase.from("wedding_budgets").insert({ wedding_id: wedding.id, total_cents: parsed.data });
      // Dos pestañas a la vez: la otra creó la fila; se reintenta el update.
      if (insertError?.code === "23505") {
        const retry = await supabase.from("wedding_budgets").update({ total_cents: parsed.data }).eq("wedding_id", wedding.id);
        if (retry.error) return failure(retry.error, GENERIC_ERROR);
      } else if (insertError) return failure(insertError, GENERIC_ERROR);
    }
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

function itemColumns(values: z.output<typeof budgetItemSchema>) {
  return {
    category: values.category, label: values.label, vendor_contact_id: values.vendorContactId,
    budgeted_cents: values.budgetedCents, agreed_cents: values.agreedCents, notes: values.notes || null,
  };
}

export async function addBudgetItem(input: BudgetItemInput): Promise<BudgetActionResult<{ id: string }>> {
  const parsed = budgetItemSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const { data: existing, error: readError } = await supabase.from("wedding_budget_items")
      .select("position").eq("wedding_id", wedding.id).order("position", { ascending: false }).limit(BUDGET_ITEMS_LIMIT);
    if (readError) return failure(readError, GENERIC_ERROR);
    const rows = (existing ?? []) as { position: number }[];
    if (rows.length >= BUDGET_ITEMS_LIMIT) return { ok: false, error: `Podéis anotar hasta ${BUDGET_ITEMS_LIMIT} partidas.` };
    const { data, error } = await supabase.from("wedding_budget_items")
      .insert({ wedding_id: wedding.id, ...itemColumns(parsed.data), position: (rows[0]?.position ?? 0) + 1 })
      .select("id").maybeSingle();
    if (error || !data) return failure(error, GONE_VENDOR);
    refresh();
    return { ok: true, id: (data as { id: string }).id };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function updateBudgetItem(id: string, input: BudgetItemInput): Promise<BudgetActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  const parsed = budgetItemSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_budget_items").update(itemColumns(parsed.data))
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error) return failure(error, GONE_VENDOR);
    if (!data) return { ok: false, error: GONE_ITEM };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** Borra la partida y sus pagos anotados (on delete cascade). */
export async function removeBudgetItem(id: string): Promise<BudgetActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_budget_items").delete()
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error) return failure(error, GONE_ITEM);
    if (!data) return { ok: false, error: GONE_ITEM };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

function paymentColumns(values: z.output<typeof budgetPaymentSchema>) {
  return { amount_cents: values.amountCents, due_on: values.dueOn, note: values.note || null };
}

export async function addBudgetPayment(itemId: string, input: BudgetPaymentInput): Promise<BudgetActionResult<{ id: string }>> {
  if (!z.uuid().safeParse(itemId).success) return { ok: false, error: GENERIC_ERROR };
  const parsed = budgetPaymentSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const { count, error: countError } = await supabase.from("wedding_budget_payments")
      .select("id", { count: "exact", head: true }).eq("wedding_id", wedding.id);
    if (countError) return failure(countError, GENERIC_ERROR);
    if ((count ?? 0) >= BUDGET_PAYMENTS_LIMIT) return { ok: false, error: `Podéis anotar hasta ${BUDGET_PAYMENTS_LIMIT} pagos.` };
    const { data, error } = await supabase.from("wedding_budget_payments")
      .insert({ wedding_id: wedding.id, item_id: itemId, ...paymentColumns(parsed.data) }).select("id").maybeSingle();
    // FK compuesta (item_id, wedding_id): partida borrada o de otra boda.
    if (error || !data) return failure(error, GONE_ITEM);
    refresh();
    return { ok: true, id: (data as { id: string }).id };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

async function patchPayment(id: string, values: Record<string, unknown>): Promise<BudgetActionResult> {
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_budget_payments").update(values)
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error) return failure(error, GONE_PAYMENT);
    if (!data) return { ok: false, error: GONE_PAYMENT };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function updateBudgetPayment(id: string, input: BudgetPaymentInput): Promise<BudgetActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  const parsed = budgetPaymentSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return patchPayment(id, paymentColumns(parsed.data));
}

/**
 * La pareja anota que ya lo ha pagado (fecha de hoy en Madrid) o lo deshace.
 * Es su anotación: Vinklo no ejecuta ni comprueba el pago.
 */
export async function setBudgetPaymentPaid(id: string, paid: boolean): Promise<BudgetActionResult> {
  if (!z.uuid().safeParse(id).success || typeof paid !== "boolean") return { ok: false, error: GENERIC_ERROR };
  return patchPayment(id, { paid_on: paid ? todayIn() : null });
}

export async function removeBudgetPayment(id: string): Promise<BudgetActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_budget_payments").delete()
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error) return failure(error, GONE_PAYMENT);
    if (!data) return { ok: false, error: GONE_PAYMENT };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
