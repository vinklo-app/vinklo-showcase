import type { Metadata } from "next";
import { connection } from "next/server";

import { assertAdmin } from "@/lib/admin";
import { loadAdminOverview } from "@/lib/admin/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import { OverviewView } from "./_components/overview-view";

export const metadata: Metadata = {
  title: "Resumen · Admin",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * Resumen del fundador (producto v2: web gratis + CRM de invitados).
 * Frontera: assertAdmin() PRIMERO; solo después el cliente service_role.
 * Todo son agregados; ningún dato personal de invitados.
 */
export default async function AdminPage() {
  await assertAdmin();
  await connection();
  const data = await loadAdminOverview(createAdminClient());
  return <OverviewView data={data} />;
}
