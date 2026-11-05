import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PenLineIcon } from "lucide-react";

import { GuestListLive, GuestViewSwitch, type GuestRow } from "@/components/panel/guest-list-live";
import { GuestFilters, GuestPagination, filterUrl } from "@/components/panel/guest-filters";
import { AttendanceRefresh } from "@/components/panel/attendance-refresh";
import { GuestSummaryLine } from "@/components/panel/guest-summary-line";
import { GiftCsvLive, GuestCsvLive } from "@/components/panel/messages-wired";
import { ReminderCallout } from "@/components/panel/reminder-callout";
import { SeriesCallout } from "@/components/panel/series-callout";
import { PageHead } from "@/components/panel/page-head";
import { getMessageTemplates } from "@/lib/actions/messages";
import { getAllGuestsForFilter, getAttendanceSummary, getGuestCompanionLimits, getGuestExtraFields, getGuestFilterCounts, getGuestLogisticNotes, getGuestGroups, getGuestPage, getGuestTags, GUEST_PAGE_SIZE, type GuestPageResult } from "@/lib/data/attendance";
import { GUEST_VIEW_COOKIE, parseGuestView } from "@/lib/crm/guest-view";
import { groupNames, parseGroupFilter } from "@/lib/crm/groups";
import { SIDE_LABELS, parseSideFilter, parseTagFilter } from "@/lib/crm/tags";
import { listGiftsForGuests } from "@/lib/data/crm";
import { isLegacyGuestStatus, normalizeGuestFilter, normalizeGuestListFilter } from "@/lib/messages/filters";
import { toGuestCrmFields } from "@/lib/crm/guest-fields";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getReminderCandidates } from "@/lib/data/reminder-queue";
import { getModuleAnswers } from "@/lib/data/module-answers";
import { getSiteEditorState } from "@/lib/data/site";
import { describeAnswers, moduleLabelsFromDocument } from "@/lib/rsvp-answers";
import { formatRsvpDate, rsvpWindow } from "@/lib/rsvp-window";
import { seriesHref } from "@/lib/messages/invitation-series";

export const metadata = {
  title: "Invitados",
};

/**
 * Lista de invitados (tipo WhatsApp): cada persona con su estado honesto,
 * filtros por tarea (`?filtro=`), por grupo (`?grupo=` / `?singrupo=1`),
 * por etiqueta (`?etiqueta=`) y por lado (`?lado=p1|p2|ambos|sin`),
 * búsqueda y paginación en el servidor, CSV
 * del filtro activo y entrada a la fila de recordatorios.
 */
export default async function InvitadosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10000 ? requestedPage : 1;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  // Enlaces guardados con el antiguo `?status=pendiente|si|no` → `?filtro=`.
  if (typeof params.filtro !== "string" && isLegacyGuestStatus(params.status)) {
    redirect(filterUrl("/panel/invitados", { filter: normalizeGuestFilter(params.status) }, { query, filter: "todos", page }));
  }
  // Acepta también los filtros del CRM (enviada_sin_abrir, con_regalo, sin_agradecer…).
  const filter = normalizeGuestListFilter(params.filtro);
  const requestedGroup = parseGroupFilter(params);
  const requestedTag = parseTagFilter(params.etiqueta);
  const requestedSide = parseSideFilter(params.lado);
  const openAdd = params.nuevo === "1";
  const openBulk = params.nuevo === "varios";
  const context = await getCurrentWedding();
  if (!context) {
    redirect("/onboarding");
  }
  const { supabase, wedding: weddingData } = context;
  // «Tabla» (punto 14): todo el filtro activo de una vez, sin paginar; la elección vive en una cookie.
  const view = parseGuestView((await cookies()).get(GUEST_VIEW_COOKIE)?.value);
  const table = view === "tabla";
  const loadAll = async (): Promise<GuestPageResult> => {
    const rows = await getAllGuestsForFilter(supabase, weddingData.id, filter, query, requestedGroup, { tag: requestedTag, side: requestedSide });
    return rows ? { data: rows, error: null, count: rows.length } : { data: null, error: { message: "guest table read failed" }, count: null };
  };

  const [guestResult, summary, counts, templates, rsvpDates, groupSummary, tagSummary, reminders] = await Promise.all([
    table ? loadAll() : getGuestPage(supabase, weddingData.id, page, query, filter, requestedGroup, { tag: requestedTag, side: requestedSide }),
    getAttendanceSummary(supabase, weddingData.id),
    getGuestFilterCounts(supabase, weddingData.id),
    getMessageTemplates(),
    // Lectura aparte y opcional: si falla, simplemente no se muestra el plazo.
    supabase.from("weddings").select("wedding_date, rsvp_deadline, partner_name_1, partner_name_2").eq("id", weddingData.id).maybeSingle(),
    // Grupos (20261012100000). null = sin la migración o fallo: la lista va sin grupos.
    getGuestGroups(supabase, weddingData.id),
    // Etiquetas y lado (20261020100000). null = sin la migración o fallo: la lista va sin etiquetas.
    getGuestTags(supabase, weddingData.id),
    // El aviso «N para recordar» cuenta lo mismo que la fila (plazo, margen de 3 días y aperturas).
    getReminderCandidates(supabase, weddingData.id, { limit: 1 }),
  ]);
  // Sin grupos disponibles, `?grupo=` no filtra (getGuestPage ya lo ignora): no se pinta como activo.
  const group = groupSummary ? requestedGroup : parseGroupFilter({});
  // Sin etiquetas disponibles, `?etiqueta=` / `?lado=` no filtran (getGuestPage ya los ignora).
  const tag = tagSummary ? requestedTag : null;
  const side = tagSummary ? requestedSide : null;
  const dates = rsvpDates.error ? null : (rsvpDates.data as { wedding_date: string | null; rsvp_deadline: string | null; partner_name_1?: string | null; partner_name_2?: string | null } | null);
  const partners = { p1: dates?.partner_name_1 ?? "", p2: dates?.partner_name_2 ?? "" };
  const sideLabels = SIDE_LABELS(partners.p1, partners.p2);
  const rsvpState = dates?.rsvp_deadline ? rsvpWindow({ weddingDate: dates.wedding_date, rsvpDeadline: dates.rsvp_deadline }) : null;
  // Apertura del enlace y estado de regalo vienen en la propia fila de guest_page.
  const baseGuests: GuestRow[] = (guestResult.data ?? []).map((row) => ({ ...(row as GuestRow), crm: toGuestCrmFields(row) }));
  // Respuestas de módulos solo de esta página (una consulta pequeña aparte).
  const confirmedIds = baseGuests.filter((g) => g.rsvp_status === "si").map((g) => g.id);
  // Regalos solo de las personas de esta página (R05, consulta con sus ids):
  // el resto no se pinta ni viaja al navegador. Quién regala junto se busca
  // bajo demanda. null = la lectura falló.
  // Tope de acompañantes (20261021110000) solo de esta página; null = sin la migración o fallo (el campo no aparece).
  // Nota logística del invitado (20261030100000), igual: solo esta página; null = sin la migración.
  // Campos propios del Excel (20261031100000), igual. En la tabla (cientos de
  // personas) se leen sin lista de ids: una URL con miles de ids no cabe.
  const pageIds = table ? undefined : baseGuests.map((guest) => guest.id);
  const [answerRows, siteState, gifts, limits, logistic, extras] = await Promise.all([
    confirmedIds.length > 0 ? getModuleAnswers(supabase, weddingData.id, table ? undefined : confirmedIds) : null,
    confirmedIds.length > 0 ? getSiteEditorState(supabase, weddingData.id) : null,
    listGiftsForGuests(supabase, weddingData.id, baseGuests.map((guest) => guest.id)),
    getGuestCompanionLimits(supabase, weddingData.id, pageIds),
    getGuestLogisticNotes(supabase, weddingData.id, pageIds),
    getGuestExtraFields(supabase, weddingData.id, pageIds),
  ]);
  const labels = siteState ? moduleLabelsFromDocument(siteState.draft) : null;
  const answersById = new Map((answerRows ?? []).map((r) => [r.id, labels ? describeAnswers(r.answers, labels) : ""]));
  const guests: GuestRow[] = baseGuests.map((g) => ({
    ...g,
    ...(answersById.get(g.id) ? { answers_text: answersById.get(g.id) } : {}),
    ...(limits ? { max_companions: limits.get(g.id) ?? null } : {}),
    ...(logistic?.get(g.id) ? { rsvp_logistic_notes: logistic.get(g.id) } : {}),
    ...(extras?.get(g.id) ? { extra_fields: extras.get(g.id) } : {}),
  }));
  const error = guestResult.error || !summary;
  const emptyList = summary?.total === 0;
  const matchingCount = guestResult.count ?? 0;
  const current = { query, filter, page, group, tag, side };
  // Sin plantillas (fallo o sin migración): el texto de Vinklo de siempre.
  const invitationMessage = templates.ok
    ? { template: templates.templates.invitation.isDefault ? null : templates.templates.invitation.body, context: templates.context }
    : undefined;
  const showCallout = filter === "todos" || filter === "esperando" || filter === "para_recordar";
  const thanksMessage = templates.ok ? { template: templates.thanks.isDefault ? null : templates.thanks.body, context: templates.context } : undefined;

  return (
    <main className="pn-wrap pn-page pn-page--tight">
      <PageHead eyebrow="Vuestra lista" title={<>Vuestros <em>invitados</em></>} lead={<span className="pn-tnum"><GuestSummaryLine summary={summary} /></span>}>
        {rsvpState && rsvpState.status !== "open" ? (
          <p className="pn-head-meta">
            El plazo para confirmar terminó el {formatRsvpDate(rsvpState.reason === "deadline" ? rsvpState.deadline : rsvpState.weddingDate)}. <Link href="/panel/ajustes" className="pn-link">Cambiar</Link>
          </p>
        ) : rsvpState?.deadline ? (
          <p className="pn-head-meta">
            Aceptáis respuestas hasta el {formatRsvpDate(rsvpState.deadline)}. <Link href="/panel/ajustes" className="pn-link">Cambiar</Link>
          </p>
        ) : null}
        {/* Avisos de una línea bajo el título (revisión Jobs #11): la lista sube. */}
        {!error && (filter === "todos" || filter === "sin_enviar") && counts && <SeriesCallout count={counts.sin_enviar} href={seriesHref("/panel/invitados/enviar", { group: group.kind === "named" ? group.name : null, tag, side })} />}
        {!error && showCallout && counts && <ReminderCallout count={reminders?.total ?? counts.para_recordar} href={group.kind === "named" ? `/panel/invitados/recordatorios?grupo=${encodeURIComponent(group.name)}` : tag ? `/panel/invitados/recordatorios?etiqueta=${encodeURIComponent(tag)}` : "/panel/invitados/recordatorios"} />}
      </PageHead>

      {error ? (
        <p role="alert" className="pn-note pn-note--warn">
          No hemos podido cargar los invitados. Probad a cargar la página de nuevo. Vuestra lista no se ha modificado.
        </p>
      ) : (
        <>
          {/* Lista vacía: ni filtros a cero ni CSV vacíos (revisión Jobs #11). */}
          {!emptyList && <GuestFilters current={current} counts={counts} gifts groups={groupSummary} tags={tagSummary} sideLabels={sideLabels} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {table ? <span /> : <GuestPagination current={current} matchingCount={matchingCount} pageSize={GUEST_PAGE_SIZE} />}
            <div className="flex flex-wrap items-center gap-3">
              {!emptyList && <GuestViewSwitch view={view} />}
              <AttendanceRefresh />
            </div>
          </div>
          <GuestListLive
            guests={guests}
            filter={filter}
            query={query}
            openAddInitially={openAdd}
            openBulkInitially={openBulk}
            invitationMessage={invitationMessage}
            gifts={gifts}
            thanksMessage={thanksMessage}
            groups={groupSummary ? groupNames(groupSummary) : undefined}
            group={group}
            tagSummary={tagSummary}
            partners={partners}
            tag={tag}
            sideFiltered={Boolean(side)}
            side={side}
            total={matchingCount}
            limits={limits !== null}
            view={table ? "tabla" : "lista"}
            toolbar={(
              <>
                <Link href="/panel/invitados/mensajes" className="pn-act pn-press"><PenLineIcon aria-hidden="true" className="size-4" />Mensajes</Link>
                {!emptyList && <GuestCsvLive filter={filter} query={query} group={group} tag={tag} side={side} sideLabel={side && side !== "none" ? sideLabels[side] : undefined} />}
                {!emptyList && <GiftCsvLive compact />}
              </>
            )}
          />
        </>
      )}
    </main>
  );
}
