import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getPublishedSiteDocument, getSiteEditorState } from "@/lib/data/site";
import {
  AgendaManager,
  type AgendaRow,
} from "@/components/panel/agenda-manager";
import { PageHead } from "@/components/panel/page-head";
import { ModuleSummary } from "@/components/panel/module-summary";
import { getModuleAnswers } from "@/lib/data/module-answers";
import { getAttendingGuests } from "@/lib/data/catering";
import { DietSummary } from "@/components/panel/diet-summary";
import { hasModules, rsvpModulesFromDocument } from "@/lib/rsvp-answers";
import { guestMenuModules, moduleLabelsForAnswers } from "@/lib/module-labels";
import { AGENDA_VISIBILITY_NOTE, siteVisibility } from "@/components/panel/site-visibility";

export const metadata: Metadata = {
  title: "El día de la boda",
  robots: { index: false, follow: false },
};

/**
 * Logística del día: la pareja publica la agenda (ceremonia, cóctel,
 * banquete, autobuses…) y los invitados la ven en su página. El aviso de
 * visibilidad es condicional (R-03): en vivo si nunca se publicó una
 * revisión; si hay revisión, solo tras publicar.
 */
export default async function PanelDiaPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");
  const { supabase, wedding } = context;

  const [{ data: items }, siteState, answerRows, attending] = await Promise.all([
    supabase
      .from("wedding_agenda_items")
      .select("id, title, time_label, place, address, notes, sort")
      .eq("wedding_id", wedding.id)
      .order("sort", { ascending: true }),
    getSiteEditorState(supabase, wedding.id),
    getModuleAnswers(supabase, wedding.id),
    getAttendingGuests(supabase, wedding.id),
  ]);
  // Módulos (autobuses, alojamiento, menú…): de la web en edición, que es la
  // que la pareja está configurando; las respuestas, de la base de datos.
  const modules = siteState ? rsvpModulesFromDocument(siteState.draft) : null;
  const visibility = siteVisibility(siteState);
  // Etiquetas (paradas, hoteles, menús): de la revisión PUBLICADA, que es
  // contra la que respondieron los invitados; el borrador rellena huecos (5.8).
  const showModules = Boolean(siteState && modules && hasModules(modules) && answerRows);
  const published = siteState && showModules ? await getPublishedSiteDocument(supabase, wedding.id, siteState.publishedRevisionId) : null;
  const labels = siteState && showModules ? moduleLabelsForAnswers(siteState.draft, published) : null;
  // «Sin menú» cuenta contra los menús que los invitados pueden elegir (la publicada).
  const menuModules = siteState && showModules ? guestMenuModules(siteState.draft, published, siteState.publishedRevisionId) : null;

  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight">
      <PageHead eyebrow="El día" title={<>El día <em>de la boda</em></>}
        lead="Todo lo que vuestros invitados necesitan tener a mano: dónde es la ceremonia, a qué hora se come, de dónde salen los autobuses.">
        <p className={`pn-note ${visibility === "withdrawn" ? "pn-note--warn" : ""}`}>
          {AGENDA_VISIBILITY_NOTE[visibility]}{" "}
          {visibility === "live" && <Link href={`/b/${wedding.slug}`} className="underline underline-offset-4">Ver vuestra página</Link>}
          {visibility === "published" && <Link href="/panel/ajustes" className="underline underline-offset-4">Ir a publicar</Link>}
        </p>
        <p className="pn-head-meta"><Link href="/panel/dia/imprimir" className="pn-link">Imprimir la agenda y la hoja del catering</Link></p>
      </PageHead>

      <div>
        <AgendaManager items={(items ?? []) as AgendaRow[]} />
      </div>
      {modules && answerRows && labels && (
        <ModuleSummary rows={answerRows} modules={modules} labels={labels} menuModules={menuModules} />
      )}
      {attending && <DietSummary guests={attending} />}
    </main>
  );
}
