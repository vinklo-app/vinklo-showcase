import { AiAssistantCard } from "@/components/panel/ai-assistant-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getAttendanceSummary, getGuestFilterCounts, getGuestGroups } from "@/lib/data/attendance";
import { GroupSummaryCard } from "@/components/panel/group-summary";
import { getCrmFunnelFor, getGiftSummaryFor } from "@/lib/data/crm";
import { getReminderCandidates } from "@/lib/data/reminder-queue";
import { GiftSummaryCard, showGiftSummary } from "@/components/panel/crm-summary";
import { GiftCsvLive } from "@/components/panel/messages-wired";
import { AttendanceRefresh } from "@/components/panel/attendance-refresh";
import { PanelHeader } from "@/components/panel/panel-header";
import { PanelStats } from "@/components/panel/panel-stats";
import { PanelHero } from "@/components/panel/panel-hero";
import { IconTile } from "@/components/panel/page-head";
import { siteVisibility } from "@/components/panel/site-visibility";
import type { RecentGuest } from "@/components/panel/recent-responses";
import { ActivityFeed, buildActivity } from "@/components/panel/activity-feed";
import { NextActions, buildNextActions } from "@/components/panel/next-actions";
import { FirstSteps, buildFirstSteps, firstStepsComplete } from "@/components/panel/first-steps";
import { QuickSearch } from "@/components/panel/quick-search";
import { getUnseatedAttending } from "@/lib/data/seating";
import { getTaskCounts } from "@/lib/data/planning";
import { getMenuMissing } from "@/lib/data/module-answers";
import { todayIn } from "@/lib/planning/dates";

export const metadata = { title: "Vuestra boda, al día" };

type GuestSummaryRow = RecentGuest & { updated_at: string };

/**
 * «Respuestas recientes» por la hora en que respondió el invitado
 * (responded_at, 20261021100000), no por la última edición de la ficha
 * (riesgo D4). `updated_at` pasa a ser esa hora para la tarjeta y la
 * actividad; sin responded_at (respuesta puesta a mano) se usa la edición.
 * Sin la migración (42703) se vuelve al orden de antes.
 */
async function getRecentResponses(supabase: SupabaseClient, weddingId: string): Promise<{ data: GuestSummaryRow[] | null; error: { code?: string } | null }> {
  const byResponse = await supabase.from("wedding_guests").select("id, name, rsvp_status, rsvp_companions, updated_at, responded_at")
    .eq("wedding_id", weddingId).neq("rsvp_status", "pendiente")
    .order("responded_at", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(8);
  if (!byResponse.error) {
    const rows = (byResponse.data ?? []) as Array<GuestSummaryRow & { responded_at: string | null }>;
    return { data: rows.map(({ responded_at, ...row }) => ({ ...row, updated_at: responded_at ?? row.updated_at })), error: null };
  }
  if (byResponse.error.code !== "42703") return { data: null, error: byResponse.error };
  const legacy = await supabase.from("wedding_guests").select("id, name, rsvp_status, rsvp_companions, updated_at")
    .eq("wedding_id", weddingId).neq("rsvp_status", "pendiente").order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(8);
  return { data: (legacy.data ?? null) as GuestSummaryRow[] | null, error: legacy.error };
}

export default async function PanelPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");
  const { supabase } = context;
  const weddingId = context.wedding.id;
  // Membership already identifies the wedding: fetch independent summary reads together.
  const [weddingResult, guestResult, openedResult, agendaResult, stats, counts, funnel, giftSummary, groups, unseated, taskCounts, menuMissing, reminders, siteResult] = await Promise.all([
    supabase.from("weddings").select("id, slug, partner_name_1, partner_name_2, wedding_date, guest_count_est").eq("id", weddingId).maybeSingle(),
    getRecentResponses(supabase, weddingId),
    // Actividad: últimas primeras aperturas del enlace personal.
    supabase.from("wedding_guests").select("id, name, rsvp_status, invitation_opened_at")
      .eq("wedding_id", weddingId).not("invitation_opened_at", "is", null).order("invitation_opened_at", { ascending: false }).limit(8),
    supabase.from("wedding_agenda_items").select("id", { count: "exact", head: true })
      .eq("wedding_id", weddingId),
    getAttendanceSummary(supabase, weddingId),
    getGuestFilterCounts(supabase, weddingId),
    // CRM: si falla, el resumen vuelve a los tres pasos de siempre y la tarjeta de regalos lo dice.
    getCrmFunnelFor(supabase, weddingId),
    getGiftSummaryFor(supabase, weddingId),
    // Grupos (20261012100000): null sin la migración → la tarjeta no aparece.
    getGuestGroups(supabase, weddingId),
    // Mesas (20261013100000): null sin mesas o sin la migración → no hay línea.
    getUnseatedAttending(supabase, weddingId),
    // Tareas (20261014200000): null sin la migración → no hay línea.
    getTaskCounts(supabase, weddingId, todayIn()),
    // Menú (P1-6): null si la web no pregunta menú → no hay línea.
    getMenuMissing(supabase, weddingId),
    // «Para recordar» con las reglas de la fila (plazo, margen de 3 días y aperturas).
    getReminderCandidates(supabase, weddingId, { limit: 1 }),
    // «Primeros pasos»: qué ven hoy los invitados (siteVisibility, como Ajustes y el editor).
    supabase.from("wedding_sites").select("published_revision_id, published_at").eq("wedding_id", weddingId).maybeSingle(),
  ]);
  const { data: wedding, error: weddingError } = weddingResult;
  if (weddingError) throw new Error("No hemos podido cargar vuestra boda. Volved a intentarlo.");
  if (!wedding) redirect("/onboarding");
  const guests = (guestResult.data ?? []) as GuestSummaryRow[];
  if (!stats) throw new Error("No hemos podido cargar el resumen. Comprobad la migración de asistencia y reintentadlo.");
  const activity = buildActivity((openedResult.data ?? []) as { id: string; name: string; rsvp_status: string; invitation_opened_at: string | null }[], guests);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const guestUrl = `${baseUrl}/b/${wedding.slug}`;
  const agendaCount = agendaResult.count ?? 0;
  const actions = buildNextActions({ funnel, counts, toRemind: reminders?.total ?? null, toThank: counts?.sin_agradecer ?? 0, agendaCount, unseated, tasks: taskCounts, menuMissing });

  // La web: publicada, en vivo (sin publicar, la sirve el adaptador) o
  // retirada, con la misma regla que Ajustes y el editor. Sin poder leerlo,
  // el paso de la web no se enseña.
  const siteRow = siteResult.data as { published_revision_id: string | null; published_at: string | null } | null;
  const visibility = siteResult.error ? null : siteVisibility(siteRow ? { publishedRevisionId: siteRow.published_revision_id, publishedAt: siteRow.published_at } : null);
  const firstSteps = buildFirstSteps({ visibility, guests: stats.total, sent: stats.sent, replies: stats.confirmed + stats.declined, slug: wedding.slug });
  // Dentro de «Lo que toca hoy», antes de sus avisos, hasta que estén los cuatro (web, invitados,
  // primer envío, primera respuesta), haya o no invitados.
  const progress = firstStepsComplete(firstSteps) ? undefined : <FirstSteps steps={firstSteps} />;

  const showLedger = Boolean(guestResult.error) || !funnel || stats.total > 0;

  return (
    <main className="pn-wrap pn-page pn-page--summary">
      {/* «Cerrar sesión» vive en Ajustes (revisión Jobs #12): la portada solo tiene lo que toca hacer. */}
      <PanelHeader partnerName1={wedding.partner_name_1} partnerName2={wedding.partner_name_2} weddingDate={wedding.wedding_date} slug={wedding.slug} guestUrl={guestUrl} />

      <AiAssistantCard />

      {/* Centro de mando, lo primero (P1-7): lo que toca hoy
          + lo último, en vivo (refresco de 30 s con avisos). Sin invitados, solo
          los pasos, que empiezan por añadir a vuestra gente. */}
      {stats.total > 0 ? (
        <div className="pn-command">
          <NextActions actions={actions} progress={progress} />
          <ActivityFeed events={activity} error={Boolean(guestResult.error || openedResult.error)} />
        </div>
      ) : (
        <NextActions actions={actions} hasGuests={false} progress={progress} />
      )}

      {stats.total > 0 && <QuickSearch />}

      {/* Capítulo en tinta con el embudo real: cada etapa abre la lista filtrada. */}
      {funnel && !guestResult.error && <PanelHero funnel={funnel} />}

      {guestResult.error ? (
        <section aria-labelledby="status-title" className="grid gap-4">
          <h2 id="status-title" className="pn-display pn-h2">Así está vuestra lista</h2>
          <p role="alert" className="pn-note pn-note--warn">No hemos podido cargar las respuestas. Actualizad para volver a intentarlo; los contadores no están disponibles.</p>
          <AttendanceRefresh />
        </section>
      ) : showLedger && (
        <PanelStats stats={stats} guestCountEst={wedding.guest_count_est} title={<>Así está <em>vuestra lista</em></>} funnel={funnel} showFunnel={false} aside={<AttendanceRefresh />} />
      )}

      {stats.total > 0 && <GroupSummaryCard groups={groups} />}

      {showGiftSummary({ guests: stats.total, guestsError: Boolean(guestResult.error), summary: giftSummary }) && (
        <GiftSummaryCard summary={giftSummary} error={giftSummary === null} exportSlot={<GiftCsvLive />} />
      )}

      {/* «Revisad los datos de vuestra web» ya no está: lo acaban de hacer en
          el creador, y los «Primeros pasos» de arriba lo sustituyen. */}
      {stats.total === 0 && (
        <section aria-labelledby="prepare-title">
          <p className="pn-eyebrow">Paso a paso</p>
          <h2 id="prepare-title" className="pn-display pn-h2">Preparad vuestra <em>invitación</em></h2>
          <ol className="pn-steps pn-steps--icons mt-4">
            <li><Link href="/panel/dia" className="pn-step pn-press"><IconTile icon={CalendarClockIcon} /><span className="pn-step-text"><span className="pn-step-title">Añadid lugares y horarios</span></span></Link></li>
          </ol>
        </section>
      )}

      <Link href="/panel/invitados?nuevo=1" className="pn-fab pn-fab--clay pn-press" aria-label="Añadir invitado"><PlusIcon aria-hidden="true" className="size-5" />Añadir</Link>
    </main>
  );
}
