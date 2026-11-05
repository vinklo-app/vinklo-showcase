import { z } from "zod";
import { MAX_CENTS } from "@/lib/planning/money";
import { isIsoDate, type IsoDate } from "@/lib/planning/dates";
import type { VendorCategory } from "@/lib/vendors/contacts";

/*
 * Presupuesto de la boda (20261014100000): lo que la pareja prevé, acuerda y
 * anota como pagado. ES UN REGISTRO: Vinklo no cobra, no factura, no custodia
 * ni mueve dinero. Importes enteros en céntimos. «Pagado» se deriva SOLO de
 * los pagos que la pareja marca (paidOn); no hay otra fuente.
 * Módulo puro: lo usan servidor y cliente.
 */

export const BUDGET_CATEGORIES = ["finca", "catering", "fotografia", "musica", "flores", "vestido", "traje", "otros"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  finca: "Finca",
  catering: "Catering",
  fotografia: "Fotografía",
  musica: "Música",
  flores: "Flores",
  vestido: "Vestido",
  traje: "Traje",
  otros: "Otros",
};
export function isBudgetCategory(value: unknown): value is BudgetCategory {
  return typeof value === "string" && (BUDGET_CATEGORIES as readonly string[]).includes(value);
}

/** Categoría de partida que se propone al enlazar un proveedor de la agenda (la pareja la cambia). */
export function budgetCategoryForVendor(category: VendorCategory): BudgetCategory {
  switch (category) {
    case "lugar": return "finca";
    case "catering": case "tarta": return "catering";
    case "fotografia": case "video": return "fotografia";
    case "musica": return "musica";
    case "flores": case "decoracion": return "flores";
    default: return "otros";
  }
}

export const BUDGET_LIMITS = { label: 120, notes: 500, paymentNote: 200 } as const;
export const BUDGET_ITEMS_LIMIT = 200;
export const BUDGET_PAYMENTS_LIMIT = 600;

// ------------------------------------------------------------ contratos

export interface BudgetItem {
  id: string;
  category: BudgetCategory;
  label: string;
  vendorContactId: string | null;
  budgetedCents: number | null;
  agreedCents: number | null;
  notes: string | null;
  position: number;
}

export interface BudgetPayment {
  id: string;
  itemId: string;
  amountCents: number;
  dueOn: IsoDate | null;
  paidOn: IsoDate | null;
  note: string | null;
}

export interface BudgetData {
  totalCents: number | null;
  items: BudgetItem[];
  payments: BudgetPayment[];
}

const cents = z.number({ error: "Revisad el importe." }).int("Los importes van en céntimos enteros.")
  .min(0, "Los importes no pueden ser negativos.").max(MAX_CENTS, "El importe es demasiado alto.");
const optionalDate = z.union([z.literal(""), z.string().refine(isIsoDate, "Revisad la fecha.")]).nullable().optional()
  .transform((value) => (value ? value : null));

export const budgetTotalSchema = cents.nullable();

export const budgetItemSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES, "Elegid una categoría de la lista.").default("otros"),
  label: z.string().trim().min(1, "Poned un concepto, por ejemplo «Finca» o «Reportaje».")
    .max(BUDGET_LIMITS.label, `El concepto admite hasta ${BUDGET_LIMITS.label} caracteres.`),
  vendorContactId: z.union([z.literal(""), z.uuid()]).nullable().optional().transform((value) => value || null),
  budgetedCents: cents.nullable().optional().transform((value) => value ?? null),
  agreedCents: cents.nullable().optional().transform((value) => value ?? null),
  notes: z.string().trim().max(BUDGET_LIMITS.notes, `Las notas admiten hasta ${BUDGET_LIMITS.notes} caracteres.`).optional().default(""),
});
export type BudgetItemInput = z.input<typeof budgetItemSchema>;

export const budgetPaymentSchema = z.object({
  amountCents: cents.refine((value) => value > 0, "Escribid cuánto es el pago."),
  dueOn: optionalDate,
  note: z.string().trim().max(BUDGET_LIMITS.paymentNote, `La nota admite hasta ${BUDGET_LIMITS.paymentNote} caracteres.`).optional().default(""),
});
export type BudgetPaymentInput = z.input<typeof budgetPaymentSchema>;

export const BUDGET_ITEM_COLUMNS = "id, category, label, vendor_contact_id, budgeted_cents, agreed_cents, notes, position";
export const BUDGET_PAYMENT_COLUMNS = "id, item_id, amount_cents, due_on, paid_on, note";

const itemRow = z.object({
  id: z.string(), category: z.enum(BUDGET_CATEGORIES), label: z.string(), vendor_contact_id: z.string().nullable(),
  budgeted_cents: z.number().int().nullable(), agreed_cents: z.number().int().nullable(), notes: z.string().nullable(), position: z.number().int(),
});
const paymentRow = z.object({
  id: z.string(), item_id: z.string(), amount_cents: z.number().int(), due_on: z.string().nullable(), paid_on: z.string().nullable(), note: z.string().nullable(),
});

export function parseBudgetItems(data: unknown): BudgetItem[] | null {
  const parsed = z.array(itemRow).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id, category: row.category, label: row.label, vendorContactId: row.vendor_contact_id,
    budgetedCents: row.budgeted_cents, agreedCents: row.agreed_cents, notes: row.notes, position: row.position,
  }));
}
export function parseBudgetPayments(data: unknown): BudgetPayment[] | null {
  const parsed = z.array(paymentRow).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id, itemId: row.item_id, amountCents: row.amount_cents, dueOn: row.due_on, paidOn: row.paid_on, note: row.note,
  }));
}

// ------------------------------------------------------------ resumen

export interface CategoryTotals { category: BudgetCategory; budgeted: number; committed: number; paid: number; items: number }
export interface UpcomingPayment extends BudgetPayment { itemLabel: string; category: BudgetCategory; overdue: boolean }

export interface BudgetSummary {
  /** Total previsto por la pareja (null = sin fijar). */
  total: number | null;
  /** Suma de lo presupuestado por partida. */
  budgeted: number;
  /** Comprometido = suma de lo acordado con proveedores. */
  committed: number;
  /** Pagado = suma de los pagos que la pareja ha marcado como pagados. */
  paid: number;
  /** Lo acordado que queda por pagar (nunca negativo). */
  toPay: number;
  /** Margen del total previsto frente a lo comprometido (negativo = os pasáis). */
  margin: number | null;
  byCategory: CategoryTotals[];
  upcoming: UpcomingPayment[];
}

export function paidForItem(itemId: string, payments: readonly BudgetPayment[]): number {
  return payments.reduce((sum, payment) => (payment.itemId === itemId && payment.paidOn ? sum + payment.amountCents : sum), 0);
}

/** Pagos anotados sin marcar como pagados, por fecha (sin fecha al final). */
export function upcomingPayments(data: BudgetData, today: IsoDate, limit = 5): UpcomingPayment[] {
  const items = new Map(data.items.map((item) => [item.id, item]));
  return data.payments
    .filter((payment) => !payment.paidOn && items.has(payment.itemId))
    .sort((a, b) => (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((payment) => {
      const item = items.get(payment.itemId)!;
      return { ...payment, itemLabel: item.label, category: item.category, overdue: Boolean(payment.dueOn && payment.dueOn < today) };
    });
}

export function summarizeBudget(data: BudgetData, today: IsoDate): BudgetSummary {
  const byCategory = new Map<BudgetCategory, CategoryTotals>();
  let budgeted = 0;
  let committed = 0;
  let paid = 0;
  let toPay = 0;
  for (const item of data.items) {
    const itemPaid = paidForItem(item.id, data.payments);
    const row = byCategory.get(item.category) ?? { category: item.category, budgeted: 0, committed: 0, paid: 0, items: 0 };
    row.budgeted += item.budgetedCents ?? 0;
    row.committed += item.agreedCents ?? 0;
    row.paid += itemPaid;
    row.items += 1;
    byCategory.set(item.category, row);
    budgeted += item.budgetedCents ?? 0;
    committed += item.agreedCents ?? 0;
    paid += itemPaid;
    toPay += Math.max(0, (item.agreedCents ?? 0) - itemPaid);
  }
  return {
    total: data.totalCents,
    budgeted,
    committed,
    paid,
    toPay,
    margin: data.totalCents === null ? null : data.totalCents - committed,
    byCategory: BUDGET_CATEGORIES.flatMap((category) => (byCategory.has(category) ? [byCategory.get(category)!] : [])),
    upcoming: upcomingPayments(data, today),
  };
}

/** Orden de las partidas: posición, luego categoría y concepto. */
export function sortBudgetItems(items: readonly BudgetItem[]): BudgetItem[] {
  return [...items].sort((a, b) => a.position - b.position
    || BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category)
    || a.label.localeCompare(b.label, "es"));
}
