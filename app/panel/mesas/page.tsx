import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getExcelTables, getSeatingPlan } from "@/lib/data/seating";
import { PageHead } from "@/components/panel/page-head";
import { SeatingPlanLive } from "@/components/panel/seating-wired";

export const metadata: Metadata = {
  title: "Mesas",
  robots: { index: false, follow: false },
};

/**
 * Plan de mesas (módulo de «Planificar», 2026-10-06). Lee `wedding_seating`
 * (20261013100000) con la sesión y, aparte, la forma y posición de cada mesa
 * (20261028100000; sin esa migración, sin plano). Sin la migración de mesas,
 * lo avisa y no pinta nada más (el resto del panel sigue igual).
 * `?propuesta=1` (desde «Lo que toca hoy») abre ya la propuesta de mesas.
 */
export default async function PanelMesasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getCurrentWedding();
  if (!context) redirect("/login");
  const params = await searchParams;
  const [read, excel, names] = await Promise.all([
    getSeatingPlan(context.supabase, context.wedding.id, { layout: true }),
    // Columna Mesa de un Excel importado (campo propio): «Crear N mesas y sentar según vuestro Excel».
    getExcelTables(context.supabase, context.wedding.id),
    context.supabase.from("weddings").select("partner_name_1, partner_name_2").eq("id", context.wedding.id).maybeSingle(),
  ]);
  const couple = (names.error ? null : names.data) as { partner_name_1?: string | null; partner_name_2?: string | null } | null;
  const partners = { p1: couple?.partner_name_1 ?? "", p2: couple?.partner_name_2 ?? "" };

  return (
    <main className="pn-wrap pn-page pn-page--tight">
      <PageHead eyebrow="Mesas" back={{ href: "/panel/planificar", label: "Planificar" }} title={<>Quién se sienta <em>con quién</em></>}
        lead="Cread las mesas y sentad a vuestros invitados: cada mesa cuenta a quien viene y sus acompañantes, y las alergias quedan a la vista para el catering.">
        {read.status === "ok" && read.plan.tables.length > 0 && (
          <p className="pn-head-meta"><Link href="/panel/mesas/imprimir" className="pn-link">Imprimir las mesas y la lista de entrada</Link></p>
        )}
      </PageHead>
      {read.status === "ok" ? (
        <SeatingPlanLive initial={read.plan} weddingKey={context.wedding.id} partners={partners} openProposal={params.propuesta === "1"} excelTables={excel && excel.size > 0 ? Object.fromEntries(excel) : undefined} />
      ) : (
        <p role="alert" className="pn-note pn-note--warn">
          {read.status === "missing"
            ? "El plan de mesas todavía no está disponible en vuestra cuenta. Volved en un rato; vuestra lista de invitados no cambia."
            : "No hemos podido cargar las mesas. Actualizad la página para volver a intentarlo."}{" "}
          <Link href="/panel/invitados" className="underline underline-offset-4">Ir a la lista de invitados</Link>
        </p>
      )}
    </main>
  );
}
