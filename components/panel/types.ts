/** Tipos compartidos del panel (filas leídas de Supabase). */

export type ContributionMethod = "card" | "bizum_manual";
export type ContributionStatus = "pending" | "confirmed" | "failed";

export interface ContributionRow {
  id: string;
  guest_name: string;
  guest_email: string | null;
  n_cubiertos: number;
  cubierto_cents: number;
  gift_cents: number;
  total_cents: number;
  service_fee_cents: number;
  method: ContributionMethod;
  status: ContributionStatus;
  created_at: string;
}

export interface TrancheRow {
  id: string;
  vendor_id: string;
  label: string;
  amount_cents: number;
  due_date: string | null;
  status: "pending" | "paid";
}

export interface WeddingRow {
  id: string;
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  guest_count_est: number | null;
  cubierto_price_cents: number;
  bizum_phone: string | null;
  stripe_account_id: string | null;
  stripe_onboarded: boolean;
  plan: "free" | "premium";
  notify_contribution: "inmediato" | "semanal" | "nunca";
}

/**
 * Aportación neta para la pareja. `total_cents` ya excluye los gastos de
 * gestión (los paga el invitado encima: total que cobra Stripe =
 * total_cents + service_fee_cents), así que el neto es el propio total.
 */
export function netCents(row: {
  total_cents: number;
  service_fee_cents: number;
}): number {
  return row.total_cents;
}
