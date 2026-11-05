import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getAttendingGuests } from "@/lib/data/catering";
import { getPrintWedding } from "@/lib/data/print-wedding";
import { getSeatingPlan } from "@/lib/data/seating";
import { getPublishedSiteDocument, getSiteEditorState } from "@/lib/data/site";
import { rsvpModulesFromDocument } from "@/lib/rsvp-answers";
import { guestMenuModules, moduleLabelsForAnswers } from "@/lib/module-labels";
import { DayPrintView, type PrintAgendaItem } from "@/components/panel/print-views";

export const metadata: Metadata = {
  title: "El día para imprimir",
  robots: { index: false, follow: false },
};

/**
 * Agenda del día y hoja del catering: menús elegidos y alergias/notas de
 * quien viene, con su mesa si ya hay plan (plan maestro §4.7).
 */
export default async function PanelDiaImprimirPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");
  const { supabase, wedding: current } = context;
  const [{ data: items, error: agendaError }, guests, siteState, seating, wedding] = await Promise.all([
    supabase.from("wedding_agenda_items").select("id, title, time_label, place, address, notes, sort")
      .eq("wedding_id", current.id).order("sort", { ascending: true }),
    getAttendingGuests(supabase, current.id),
    getSiteEditorState(supabase, current.id),
    getSeatingPlan(supabase, current.id),
    getPrintWedding(supabase, current.id),
  ]);
  if (agendaError || !guests) {
    return (
      <main className="pn-wrap pn-page pn-page--tight">
        <p role="alert" className="pn-note pn-note--warn">
          No hemos podido preparar la hoja. Actualizad la página para volver a intentarlo.{" "}
          <Link href="/panel/dia" className="underline underline-offset-4">Volver al día</Link>
        </p>
      </main>
    );
  }
  // Etiquetas de la revisión publicada (contra la que respondieron), 5.8.
  const published = siteState ? await getPublishedSiteDocument(supabase, current.id, siteState.publishedRevisionId) : null;
  return (
    <DayPrintView
      wedding={wedding}
      agenda={(items ?? []) as PrintAgendaItem[]}
      guests={guests}
      modules={siteState ? rsvpModulesFromDocument(siteState.draft) : null}
      labels={siteState ? moduleLabelsForAnswers(siteState.draft, published) : null}
      menuModules={siteState ? guestMenuModules(siteState.draft, published, siteState.publishedRevisionId) : null}
      plan={seating.status === "ok" ? seating.plan : null}
      back={{ href: "/panel/dia", label: "El día" }}
    />
  );
}
