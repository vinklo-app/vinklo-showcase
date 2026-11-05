/** Tipos de las filas que lee el admin del fundador (service role). */

import type {
  ContributionMethod,
  ContributionStatus,
} from "@/components/panel/types";

export type WaitlistKind = "pareja" | "planner" | "proveedor" | "otro";

export interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  kind: WaitlistKind;
  wedding_date: string | null;
  source: string | null;
  created_at: string;
}

export const WAITLIST_KIND_LABELS: Record<WaitlistKind, string> = {
  pareja: "Pareja",
  planner: "Planner",
  proveedor: "Proveedor",
  otro: "Otro",
};

export interface AdminWeddingRow {
  id: string;
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  plan: "free" | "premium";
  stripe_onboarded: boolean;
  created_at: string;
}

/** Columnas mínimas de contributions para agregar en memoria. */
export interface AdminContributionAgg {
  wedding_id: string;
  total_cents: number;
  service_fee_cents: number;
  method: ContributionMethod;
  status: ContributionStatus;
}

/** Aportación reciente para el feed del resumen (con el slug de su boda). */
export interface AdminRecentContribution {
  id: string;
  guest_name: string;
  total_cents: number;
  method: ContributionMethod;
  status: ContributionStatus;
  created_at: string;
  weddings: { slug: string } | null;
}
