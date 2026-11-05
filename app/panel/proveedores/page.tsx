import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getBudget, getVendorContacts } from "@/lib/data/planning";
import { todayIn } from "@/lib/planning/dates";
import { isVendorCategory } from "@/lib/vendors/contacts";
import { PageHead } from "@/components/panel/page-head";
import { PlanningTabs } from "@/components/panel/planning-tabs";
import { BudgetBoardLive, VendorsBoardLive } from "@/components/panel/vendors-wired";
import "@/components/panel/planning.css";

export const metadata: Metadata = {
  title: "Proveedores y presupuesto",
  robots: { index: false, follow: false },
};

type View = "agenda" | "presupuesto";

/**
 * Proveedores y presupuesto (módulo de «Planificar», 2026-10-06).
 *  - Agenda: wedding_vendor_contacts (20261005100000), sin dinero.
 *  - Presupuesto: wedding_budget_* (20261014100000), anotaciones de la pareja.
 * Sustituye por completo al módulo legado (tabla `vendors`, tramos de pago,
 * Stripe, portal /v/[token]), que sigue dormido y fuera de esta página.
 * Sin la migración del presupuesto, esa pestaña avisa y la agenda sigue.
 */
export default async function PanelProveedoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getCurrentWedding();
  if (!context) redirect("/login");
  const params = await searchParams;
  const view: View = params.ver === "presupuesto" ? "presupuesto" : "agenda";
  const openNew = isVendorCategory(params.nuevo) ? params.nuevo : null;
  const today = todayIn();
  const [contacts, budget] = await Promise.all([
    getVendorContacts(context.supabase, context.wedding.id),
    view === "presupuesto" ? getBudget(context.supabase, context.wedding.id) : Promise.resolve(null),
  ]);

  return (
    <main className="pn-wrap pn-page pn-page--tight">
      <PageHead eyebrow="Proveedores y presupuesto" back={{ href: "/panel/planificar", label: "Planificar" }} title={<>Con quién trabajáis <em>y cuánto</em></>}
        lead="Vuestra agenda de proveedores y vuestro presupuesto, en un sitio. Es un registro vuestro: Vinklo no contacta con nadie, no cobra ni mueve dinero." />
      <PlanningTabs label="Proveedores y presupuesto" current={view} href={(value) => (value === "agenda" ? "/panel/proveedores" : "/panel/proveedores?ver=presupuesto")}
        tabs={[{ value: "agenda", label: "Agenda", count: contacts.status === "ok" ? contacts.data.length : null }, { value: "presupuesto", label: "Presupuesto" }]} />

      {contacts.status !== "ok" ? (
        <p role="alert" className="pn-note pn-note--warn">
          {contacts.status === "missing"
            ? "La agenda de proveedores todavía no está disponible en vuestra cuenta. Volved en un rato."
            : "No hemos podido cargar vuestros proveedores. Actualizad la página para volver a intentarlo."}{" "}
          <Link href="/panel" className="underline underline-offset-4">Volver al resumen</Link>
        </p>
      ) : view === "agenda" ? (
        <VendorsBoardLive initial={contacts.data} openNew={openNew} />
      ) : budget?.status === "ok" ? (
        <BudgetBoardLive initial={budget.data} contacts={contacts.data} today={today} />
      ) : (
        <p role="alert" className="pn-note pn-note--warn">
          {budget?.status === "missing"
            ? "El presupuesto todavía no está disponible en vuestra cuenta. Volved en un rato; vuestra agenda de proveedores no cambia."
            : "No hemos podido cargar el presupuesto. Actualizad la página para volver a intentarlo."}{" "}
          <Link href="/panel/proveedores" className="underline underline-offset-4">Ir a la agenda</Link>
        </p>
      )}
    </main>
  );
}
