import { redirect } from "next/navigation";
import { PageHead } from "@/components/panel/page-head";
import { InvitationSeriesLive } from "@/components/panel/messages-wired";
import { parseQueueState } from "@/components/panel/reminders";
import { getMessageTemplates } from "@/lib/actions/messages";
import { SeriesFilters } from "@/components/panel/series-filters";
import { SIDE_LABELS } from "@/lib/crm/tags";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getInvitationQueue } from "@/lib/data/invitation-queue";
import { activeSeriesFilter, filterSeries, hasSeriesFilter, parseSeriesFilter, seriesHref } from "@/lib/messages/invitation-series";

export const metadata = { title: "Enviar las invitaciones" };

/**
 * Envío en serie de la primera invitación (plan maestro §4.1). La fila se
 * reconstruye SIEMPRE desde el servidor; la persona en curso y la tanda
 * viajan en la URL (`?persona=…&paso=confirmar`), así que una recarga de iOS
 * al volver de WhatsApp vuelve a la misma pregunta. `?grupo=`, `?etiqueta=`
 * y `?lado=` filtran (los mismos parámetros que /panel/invitados) y se combinan.
 */
export default async function EnviarInvitacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const state = parseQueueState(params);
  const requested = parseSeriesFilter(params);
  const current = await getCurrentWedding();
  if (!current) redirect("/onboarding");
  const { supabase, wedding } = current;

  const [queue, templates, names] = await Promise.all([
    getInvitationQueue(supabase, wedding.id),
    getMessageTemplates(),
    // Para «De Lucía» / «De Juan» en los chips de lado; si falla, el texto genérico.
    supabase.from("weddings").select("partner_name_1, partner_name_2").eq("id", wedding.id).maybeSingle(),
  ]);
  const partners = names.error ? null : (names.data as { partner_name_1?: string | null; partner_name_2?: string | null } | null);
  const sideLabels = SIDE_LABELS(partners?.partner_name_1, partners?.partner_name_2);
  // Solo cuenta un filtro que tenga chip (un grupo o etiqueta que ya no está en la fila no filtra).
  const filter = queue ? activeSeriesFilter(queue.items, requested) : requested;
  const items = queue ? filterSeries(queue.items, filter) : [];
  const base = "/panel/invitados/enviar";
  const filtered = hasSeriesFilter(filter);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const context = templates.ok ? templates.context : { novios: "", fecha: "" };
  const template = templates.ok && !templates.templates.invitation.isDefault ? templates.templates.invitation.body : null;

  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight">
      <PageHead eyebrow="Invitados · Envío" back={{ href: seriesHref("/panel/invitados", filter), label: "Invitados" }} title={<>Enviad las <em>invitaciones</em></>}
        lead="Se abre WhatsApp con su invitación; al volver, marcadla como enviada." />
      {queue ? (
        <>
          <SeriesFilters items={queue.items} filter={filter} base={base} sideLabels={sideLabels} />
          <InvitationSeriesLive key={seriesHref("", filter) || "todos"} basePath={seriesHref(base, filter)} items={items} state={state} template={template} context={context}
            linkPreview={`${baseUrl}/b/${wedding.slug}?invitacion=…`} withoutPhone={filtered ? 0 : queue.withoutPhone} />
        </>
      ) : (
        <p role="alert" className="pn-note pn-note--warn">No hemos podido cargar a quién falta enviar la invitación. Probad a cargar la página de nuevo.</p>
      )}
    </main>
  );
}
