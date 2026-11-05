import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getPrintWedding } from "@/lib/data/print-wedding";
import { getSeatingPlan } from "@/lib/data/seating";
import { SeatingPrintView } from "@/components/panel/print-views";

export const metadata: Metadata = {
  title: "Mesas para imprimir",
  robots: { index: false, follow: false },
};

/** Mesas con sus invitados y lista de entrada alfabética (plan maestro §4.7). */
export default async function PanelMesasImprimirPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/login");
  const [read, wedding] = await Promise.all([
    getSeatingPlan(context.supabase, context.wedding.id),
    getPrintWedding(context.supabase, context.wedding.id),
  ]);
  if (read.status !== "ok") {
    return (
      <main className="pn-wrap pn-page pn-page--tight">
        <p role="alert" className="pn-note pn-note--warn">
          {read.status === "missing"
            ? "El plan de mesas todavía no está disponible en vuestra cuenta."
            : "No hemos podido cargar las mesas. Actualizad la página para volver a intentarlo."}{" "}
          <Link href="/panel/mesas" className="underline underline-offset-4">Volver a mesas</Link>
        </p>
      </main>
    );
  }
  return <SeatingPrintView wedding={wedding} plan={read.plan} back={{ href: "/panel/mesas", label: "Mesas" }} />;
}
