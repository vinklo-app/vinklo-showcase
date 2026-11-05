import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClockIcon, ChevronLeftIcon, PlusIcon } from "lucide-react";

import { PanelNav } from "@/components/panel/panel-nav";
import { PanelHeader } from "@/components/panel/panel-header";
import { PanelStats } from "@/components/panel/panel-stats";
import { PanelToaster } from "@/components/panel/panel-toaster";
import { PublishCard } from "@/components/panel/publish-card";
import { ActivityFeed, buildActivity } from "@/components/panel/activity-feed";
import { NextActions, buildNextActions } from "@/components/panel/next-actions";
import { FirstSteps, buildFirstSteps, firstStepsComplete } from "@/components/panel/first-steps";
import { PanelHero } from "@/components/panel/panel-hero";
import { QuickSearch } from "@/components/panel/quick-search";
import { parseQueueState } from "@/components/panel/reminders";
import { normalizeGuestListFilter } from "@/lib/messages/filters";
import { DEFAULT_TEMPLATES } from "@/lib/messages/templates";
import { DEFAULT_THANKS_TEMPLATE } from "@/lib/crm/contract";
import { WeddingSettings } from "@/components/panel/wedding-settings";
import { SITE_VISIBILITY_NOTE } from "@/components/panel/site-visibility";
import type { SiteEditorState } from "@/lib/actions/site";
import { documentFromLegacy, findScene, type SiteDocument } from "@/lib/site-document";
import { DATASETS, DATASET_LABELS, countFilters, crmFunnel, giftSummary, giftsFor, groupSummary, guestsFor, invitationQueueFor, isDataset, noGiftFor, pasteFor, reminderQueueFor, summarize, withCrm, type Dataset } from "./fixtures";
import { GroupSummaryCard } from "@/components/panel/group-summary";
import { parseGroupFilter } from "@/lib/crm/groups";
import { SIDE_LABELS, parseSideFilter, parseTagFilter } from "@/lib/crm/tags";
import { GiftSummaryCard, showGiftSummary } from "@/components/panel/crm-summary";
import { PreviewAjustes, PreviewEnviar, PreviewInvitados, PreviewMensajes, PreviewRecordatorios } from "./preview";
import { DayPrintView, SeatingPrintView } from "@/components/panel/print-views";
import { activeSeriesFilter, filterSeries, hasSeriesFilter, parseSeriesFilter, seriesHref } from "@/lib/messages/invitation-series";
import { SeriesFilters } from "@/components/panel/series-filters";
import { PreviewMesas } from "./preview-mesas";
import { samplePlan } from "./seating-fixtures";
import { unseatedAttending } from "@/lib/crm/seating";
import { IconTile, PageHead } from "@/components/panel/page-head";
import { PlanningTabs } from "@/components/panel/planning-tabs";
import { readyModules } from "@/lib/panel/modules";
import { todayIn } from "@/lib/planning/dates";
import { countTasks } from "@/lib/planning/tasks";
import { isVendorCategory } from "@/lib/vendors/contacts";
import { PreviewAgenda, PreviewPresupuesto, PreviewTareas } from "./preview-planificar";
import { sampleBudget, sampleContacts, sampleTasks } from "./planning-fixtures";
import "@/components/panel/panel.css";
import "@/components/panel/planning.css";

/**
 * Ruta de preview del panel de los novios — SOLO en desarrollo (404 en
 * producción; nunca indexable). Vistas: `?vista=resumen` (por defecto),
 * `invitados` (`&filtro=…&q=…`, `&fallo=1` falla «No enviarle recordatorios»),
 * `&grupo=…` / `&singrupo=1` filtran por grupo; en el resumen `&grupos=0` simula una lista sin agrupar.
 * `&etiqueta=…` / `&lado=p1|p2|ambos|sin` filtran por etiqueta y lado; `&etiquetas=0` simula la base sin esa migración.
 * `vacio`, `ajustes` (editor de la web con IA de mentira), `mensajes`
 * (`&tipo=recordatorio`, `&guardado=1` texto propio, `&fecha=0` boda sin
 * fecha, `&fallo=1` guardar falla) y `recordatorios` (`&persona=…&paso=confirmar`,
 * `&fin=1` pantalla final, `&fallo=1` confirmar falla).
 * `enviar`: envío en serie de la primera invitación (`&persona=…&paso=confirmar`,
 * `&grupo=…`, `&fallo=1` confirmar falla, `&fallo=enlace` crear el enlace falla, `&fin=1` pantalla final).
 * `mesas-imprimir` y `dia-imprimir`: hojas para imprimir (`&tablas=0` sin mesas).
 * `mesas`: plan de mesas con datos de muestra (`&tablas=0` sin mesas, `&excel=1` columna Mesa de un Excel en quien no tiene mesa, `&fallo=1` sentar falla,
 *   `&plano=1` abre la revisión de un plano leído de muestra, `&propuesta=1` abre la propuesta,
 *   `&ia=0` sin IA: explicaciones de plantilla y lectura del plano no disponible).
 * `planificar`: índice de módulos. `tareas`: lista de tareas (`&vacio=1` sin tareas,
 * `&fecha=0` boda sin fecha, `&fallo=1` las escrituras fallan; `datos=peor` textos largos).
 * `proveedores`: agenda (`&ver=presupuesto` el presupuesto; `&vacio=1` vacío;
 * `&nuevo=<tipo>` abre el alta; `&fallo=1` fallan las escrituras; `datos=peor`).
 * En el resumen, `&tareas=0` simula la base sin la migración de tareas.
 * Importación masiva: `&nuevo=varios` abre «Añadir varios», `&pegar=demo|peor|tope`
 * con texto ya pegado, `&contactos=1` simula el selector de contactos de Android,
 * `&fallo=varios` el servidor rechaza parte de las filas, `&fallo=red` todo el lote.
 * Datos (break-ui): `?datos=demo|peor|mil|rechazo`. En ajustes:
 * `&foto=0` sin foto, `&fallo=1` la subida falla, `&fallo=conflicto` el
 * primer cambio de la IA choca con otro guardado (chat del editor).
 * Ver docs/handoffs/2026-10-03-v2/panel.md.
 */
export const metadata: Metadata = {
  title: "Borrador · panel",
  robots: { index: false, follow: false },
};


const WEDDING = { partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-12", slug: "lucia-y-juan" };

function sampleDocument(withPhoto: boolean): SiteDocument {
  const doc = documentFromLegacy({
    partner_name_1: WEDDING.partnerName1,
    partner_name_2: WEDDING.partnerName2,
    wedding_date: WEDDING.weddingDate,
    cover_image_url: null,
    page_config: {
      style: "editorial",
      welcomeMessage: "Después de once años juntos, por fin nos casamos. Nos encantaría celebrarlo contigo en la sierra.",
      venue: "Finca La Alquería",
      address: "Camino de la Dehesa, 14 · Cercedilla, Madrid",
      time: "13:00",
    },
    agenda: [
      { id: "a1", title: "Ceremonia", time_label: "13:00", place: "Ermita de San Lorenzo", address: null, notes: null },
      { id: "a2", title: "Cóctel", time_label: "14:15", place: "Jardín de la Alquería", address: null, notes: null },
      { id: "a3", title: "Banquete", time_label: "16:00", place: "Carpa principal", address: null, notes: null },
    ],
  });
  if (!withPhoto || !findScene(doc, "cover")) return doc;
  // Foto de muestra local (CSP img-src 'self'); el contrato pide https, válido solo aquí.
  return { ...doc, scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: { url: "/muestras/pareja.jpg", alt: "Foto de Lucía y Juan", width: 1600, height: 1067 } } } : s)) };
}

function DataToggle({ vista, datos }: { vista: string; datos: Dataset }) {
  return (
    <nav aria-label="Datos de prueba (solo desarrollo)" className="pn-wrap flex flex-wrap items-center gap-2 pt-3 text-xs">
      <span className="pn-muted">Datos:</span>
      {DATASETS.map((value) => (
        <Link key={value} href={`/borrador/panel?vista=${vista}&datos=${value}`} aria-current={value === datos ? "true" : undefined} className="pn-chip pn-chip--sm">
          {DATASET_LABELS[value]}
        </Link>
      ))}
    </nav>
  );
}

export default async function BorradorPanelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const vista = typeof params.vista === "string" ? params.vista : "resumen";
  const datos: Dataset = isDataset(params.datos) ? params.datos : "demo";
  const query = typeof params.q === "string" ? params.q : "";
  const filter = normalizeGuestListFilter(typeof params.filtro === "string" ? params.filtro : params.status);
  const group = parseGroupFilter(params);
  const tag = params.etiquetas === "0" ? null : parseTagFilter(params.etiqueta);
  const side = params.etiquetas === "0" ? null : parseSideFilter(params.lado);
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1;
  const openAdd = params.nuevo === "1";
  const openBulk = params.nuevo === "varios";
  const pasted = pasteFor(params.pegar);
  const base = "/borrador/panel";
  // `?invitados=0`: el resumen de un panel recién creado (sin invitados, «Primeros pasos»).
  const guests = vista === "vacio" || params.invitados === "0" ? [] : guestsFor(datos);
  const toggle = <DataToggle vista={vista} datos={datos} />;

  if (vista === "ajustes") {
    // `&maqueta=web`: borrador ya en web (la Story sale bloqueada sin `&premium=1`).
    const sample = sampleDocument(params.foto !== "0");
    const draft: SiteDocument = params.maqueta === "web" ? { ...sample, layout: "web" } : sample;
    // `&web=withdrawn`: web retirada (la píldora del móvil dice «Retirada»).
    const state: SiteEditorState = { weddingId: "borrador", slug: WEDDING.slug, draft, draftVersion: 3, publishedRevisionId: null, publishedAt: params.web === "withdrawn" ? "2026-10-01T10:00:00Z" : null, hasUnpublishedChanges: true };
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/ajustes" />
        <main className="pn-wrap py-8 sm:py-10">
          <header className="pn-rule border-b pb-5">
            <h1 className="pn-display pn-h1">Vuestra web de boda</h1>
            <p className="pn-muted mt-3 text-sm leading-relaxed">Preparad los detalles y compartid vuestra invitación.</p>
          </header>
          <div className="mt-6">
            <PreviewAjustes
              state={state}
              failUpload={params.fallo === "1"}
              conflict={params.fallo === "conflicto"}
              plan={params.premium === "1" ? "premium" : "free"}
              before={(
                <div className="grid gap-3">
                  <PublishCard state={state} />
                  <p className="pn-note">{SITE_VISIBILITY_NOTE.live}</p>
                </div>
              )}
              after={(
                <div className="pn-ed-section">
                  <WeddingSettings slug={WEDDING.slug} visibility="live" initial={{ partnerName1: WEDDING.partnerName1, partnerName2: WEDDING.partnerName2, weddingDate: WEDDING.weddingDate, guestCountEst: 110, pageConfig: { style: "editorial", welcomeMessage: "", venue: "Finca La Alquería", address: "", time: "13:00" } }} />
                  {/* Como en /panel/ajustes (de mentira: aquí no hay sesión). */}
                  <div className="mt-8"><button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Cerrar sesión</button></div>
                </div>
              )}
            />
          </div>
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "mensajes") {
    const saved = params.guardado === "1";
    const templates = {
      invitation: saved ? { body: "¡Hola, {nombre}! Lucía y Juan nos casamos el {fecha} 💍 Nos haría muchísima ilusión que vinieras. Aquí tienes tu invitación: {enlace}", isDefault: false } : { body: DEFAULT_TEMPLATES.invitation, isDefault: true },
      reminder: { body: DEFAULT_TEMPLATES.reminder, isDefault: true },
      thanks: { body: DEFAULT_THANKS_TEMPLATE, isDefault: true },
    };
    const sampleName = guests[0]?.name ?? "Marta";
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/invitados/mensajes" />
        {toggle}
        <main className="pn-wrap flex flex-col gap-6 py-8 sm:py-10">
          <header className="pn-rule border-b pb-5">
            <Link href={`${base}?vista=invitados&datos=${datos}`} className="pn-link pn-press pn-muted -ml-1"><ChevronLeftIcon aria-hidden="true" className="size-4" />Invitados</Link>
            <h1 className="pn-display pn-h1 mt-1">Mensajes de WhatsApp</h1>
            <p className="pn-muted mt-3 max-w-[60ch] text-sm leading-relaxed">Lo que se abre en vuestro WhatsApp para cada persona.</p>
          </header>
          <PreviewMensajes key={`${datos}-${params.tipo}-${params.guardado}`} templates={templates} sampleName={sampleName} initialKind={params.tipo === "recordatorio" ? "reminder" : params.tipo === "agradecimiento" ? "thanks" : "invitation"} noDate={params.fecha === "0"} fail={params.fallo === "1"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "recordatorios") {
    const state = parseQueueState(params);
    const queue = params.fin === "1" ? [] : reminderQueueFor(guests);
    const finalState = params.fin === "1" && state.enviados === 0 ? { ...state, enviados: 4, retirados: 1 } : state;
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/invitados/recordatorios" />
        {toggle}
        <main className="pn-wrap pn-narrow flex flex-col gap-6 py-8 sm:py-10">
          <header className="pn-rule border-b pb-5">
            <Link href={`${base}?vista=invitados&datos=${datos}`} className="pn-link pn-press pn-muted -ml-1"><ChevronLeftIcon aria-hidden="true" className="size-4" />Invitados</Link>
            <h1 className="pn-display pn-h1 mt-1">Recordar a quien no ha respondido</h1>
            <p className="pn-muted mt-3 text-sm leading-relaxed">Un recordatorio por persona; nadie recibe dos en menos de 3 días.</p>
          </header>
          <PreviewRecordatorios key={datos} initial={queue} state={finalState} basePath={`${base}?vista=recordatorios&datos=${datos}`} listHref={`${base}?vista=invitados&datos=${datos}`} fail={params.fallo === "1"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "enviar") {
    const state = parseQueueState(params);
    const full = invitationQueueFor(guests);
    const filter = activeSeriesFilter(full.items, parseSeriesFilter(params));
    const queue = params.fin === "1" ? [] : filterSeries(full.items, filter);
    const finalState = params.fin === "1" && state.enviados === 0 ? { ...state, enviados: 9 } : state;
    const seriesBase = `${base}?vista=enviar&datos=${datos}`;
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/invitados/enviar" />
        {toggle}
        <main className="pn-wrap pn-narrow pn-page pn-page--tight">
          <PageHead eyebrow="Invitados · Envío" back={{ href: `${base}?vista=invitados&datos=${datos}`, label: "Invitados" }} title={<>Enviad las <em>invitaciones</em></>}
            lead="Se abre WhatsApp con su invitación; al volver, marcadla como enviada." />
          <SeriesFilters items={full.items} filter={filter} base={seriesBase} sideLabels={SIDE_LABELS(WEDDING.partnerName1, WEDDING.partnerName2)} />
          <PreviewEnviar key={`${datos}-${seriesHref("", filter)}`} initial={queue} state={finalState} basePath={seriesHref(seriesBase, filter)} listHref={seriesHref(`${base}?vista=invitados&datos=${datos}`, filter)}
            withoutPhone={hasSeriesFilter(filter) ? 0 : full.withoutPhone} fail={params.fallo === "1"} failLink={params.fallo === "enlace"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "mesas-imprimir" || vista === "dia-imprimir") {
    const plan = samplePlan(guests, datos === "demo", params.tablas === "0");
    const wedding = { names: `${WEDDING.partnerName1} y ${WEDDING.partnerName2}`, date: "12 de junio de 2027" };
    const menuIds = ["carne", "pescado", "vegetariano"];
    const attending = guests.filter((guest) => guest.rsvp_status === "si").map((guest, index) => ({
      id: guest.id, name: guest.name, companions: guest.rsvp_companions, notes: guest.rsvp_notes,
      answers: index % 3 === 2 ? null : { menu: { [menuIds[index % 3]]: guest.rsvp_companions + 1 } },
    }));
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current={vista === "mesas-imprimir" ? "/panel/mesas" : "/panel/dia"} />
        {toggle}
        {vista === "mesas-imprimir" ? (
          <SeatingPrintView wedding={wedding} plan={plan} back={{ href: `${base}?vista=mesas&datos=${datos}`, label: "Mesas" }} />
        ) : (
          <DayPrintView
            wedding={wedding}
            agenda={[
              { id: "a1", title: "Ceremonia", time_label: "13:00", place: "Ermita de San Lorenzo", address: "Camino de la Ermita, s/n · Cercedilla", notes: null },
              { id: "a2", title: "Cóctel", time_label: "14:15", place: "Jardín de la Alquería", address: null, notes: "Autobús desde la ermita a las 14:00." },
              { id: "a3", title: "Banquete", time_label: "16:00", place: "Carpa principal", address: null, notes: null },
            ]}
            guests={attending}
            modules={{ bus: null, lodging: null, song: false, kids: false, menu: [{ id: "carne", label: "Carne" }, { id: "pescado", label: "Pescado" }, { id: "vegetariano", label: "Vegetariano" }] }}
            labels={{ stops: {}, hotels: {}, menu: { carne: "Carne", pescado: "Pescado", vegetariano: "Vegetariano" } }}
            plan={params.tablas === "0" ? null : plan}
            back={{ href: `${base}?vista=resumen&datos=${datos}`, label: "El día" }}
          />
        )}
      </div>
    );
  }

  if (vista === "planificar") {
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/planificar" />
        <main className="pn-wrap pn-narrow pn-page pn-page--tight">
          <PageHead eyebrow="Planificar" title={<>Todo vuestro día, <em>en un sitio</em></>} lead="Lo que necesitáis para organizar la boda sin hojas de cálculo ni otras aplicaciones." />
          <ul className="pn-steps">
            {readyModules().map((module) => (
              <li key={module.id}>
                <Link href={`${base}?vista=${module.id === "dia" ? "resumen" : module.id}`} className="pn-step pn-press">
                  <span className="pn-step-title">{module.label}</span>
                  <span className="pn-sub pn-muted text-sm">{module.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </div>
    );
  }

  if (vista === "tareas") {
    const today = todayIn();
    const weddingDate = params.fecha === "0" ? null : WEDDING.weddingDate;
    const tasks = params.vacio === "1" ? [] : sampleTasks(today, weddingDate, datos === "peor");
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/tareas" />
        {toggle}
        <main className="pn-wrap pn-narrow pn-page pn-page--tight">
          <PageHead eyebrow="Tareas" back={{ href: `${base}?vista=planificar`, label: "Planificar" }} title={<>Lo que queda <em>por hacer</em></>}
            lead="Vuestra lista hasta la boda: lo que vence esta semana arriba, lo vencido destacado y lo hecho, a un toque de deshacer." />
          <PreviewTareas key={`${datos}-${params.vacio}-${params.fecha}-${params.fallo}`} initial={tasks} today={today} weddingDate={weddingDate} fail={params.fallo === "1"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "proveedores") {
    const today = todayIn();
    const ver = params.ver === "presupuesto" ? "presupuesto" : "agenda";
    const contacts = params.vacio === "1" ? [] : sampleContacts(datos === "peor");
    const href = (value: string) => `${base}?vista=proveedores&datos=${datos}${value === "presupuesto" ? "&ver=presupuesto" : ""}${params.vacio === "1" ? "&vacio=1" : ""}`;
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/proveedores" />
        {toggle}
        <main className="pn-wrap pn-page pn-page--tight">
          <PageHead eyebrow="Proveedores y presupuesto" back={{ href: `${base}?vista=planificar`, label: "Planificar" }} title={<>Con quién trabajáis <em>y cuánto</em></>}
            lead="Vuestra agenda de proveedores y vuestro presupuesto, en un sitio. Es un registro vuestro: Vinklo no contacta con nadie, no cobra ni mueve dinero." />
          <PlanningTabs label="Proveedores y presupuesto" current={ver} href={href}
            tabs={[{ value: "agenda", label: "Agenda", count: contacts.length }, { value: "presupuesto", label: "Presupuesto" }]} />
          {ver === "agenda" ? (
            <PreviewAgenda key={`${datos}-${params.vacio}-${params.fallo}-${params.nuevo}`} initial={contacts} openNew={isVendorCategory(params.nuevo) ? params.nuevo : null} fail={params.fallo === "1"} />
          ) : (
            <PreviewPresupuesto key={`${datos}-${params.vacio}-${params.fallo}`} initial={sampleBudget(today, contacts, params.vacio === "1", datos === "peor")} contacts={contacts} today={today} fail={params.fallo === "1"} />
          )}
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "mesas") {
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/mesas" />
        {toggle}
        <main className="pn-wrap pn-page pn-page--tight">
          <PageHead eyebrow="Mesas" back={{ href: `${base}?vista=resumen&datos=${datos}`, label: "Planificar" }} title={<>Quién se sienta <em>con quién</em></>}
            lead="Cread las mesas y sentad a vuestros invitados: cada mesa cuenta a quien viene y sus acompañantes, y las alergias quedan a la vista para el catering." />
          <PreviewMesas key={`${datos}-${params.tablas}-${params.fallo}-${params.plano}-${params.propuesta}-${params.ia}-${params.excel}`} guests={guests} demo={datos === "demo"} empty={params.tablas === "0"} fail={params.fallo === "1"}
            floor={params.plano === "1"} proposal={params.propuesta === "1"} noAi={params.ia === "0"} excel={params.excel === "1"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  if (vista === "invitados" || vista === "vacio") {
    return (
      <div className="bb-scope pn-scope pn-shell min-h-svh">
        <PanelNav current="/panel/invitados" />
        {toggle}
        <main className="pn-wrap flex flex-col gap-6 py-8 sm:py-10">
          <PreviewInvitados key={`${vista}-${datos}`} dataset={datos} initialGifts={params.fallo === "lectura" ? null : giftsFor(datos, guests)} initialNoGift={[...noGiftFor(datos)]} failGifts={params.fallo === "regalos"} initial={guests} current={{ query, filter, page, group, tag, side }} noTags={params.etiquetas === "0"} noLimits={params.topes === "0"} basePath={`${base}?vista=${vista}&datos=${datos}${params.tabla === "1" ? "&tabla=1" : ""}`} openAdd={openAdd} openBulk={openBulk} openExcel={params.nuevo === "excel"} view={params.tabla === "1" ? "tabla" : "lista"} pasted={pasted} failBulk={params.fallo === "varios" ? "rows" : params.fallo === "red" ? "network" : undefined} failOptOut={params.fallo === "1"} />
        </main>
        <PanelToaster />
      </div>
    );
  }

  const gifts = giftsFor(datos, guests);
  const crmGuests = withCrm(datos, guests, gifts);
  const funnel = params.embudo === "0" ? null : crmFunnel(crmGuests);
  const stats = summarize(guests);
  // Menú (P1-6): como la hoja del catering del borrador, uno de cada tres que vienen sin elegir; ?menu=0 = la web no pregunta menú.
  const menuMissing = params.menu === "0" ? null : guests.filter((guest) => guest.rsvp_status === "si").reduce((sum, guest, index) => sum + (index % 3 === 2 ? guest.rsvp_companions + 1 : 0), 0);
  const actions = buildNextActions({ funnel, counts: countFilters(crmGuests), toThank: countFilters(crmGuests).sin_agradecer, agendaCount: 6, unseated: params.tablas === "0" ? null : unseatedAttending(samplePlan(guests, datos === "demo", false)), tasks: params.tareas === "0" ? null : countTasks(sampleTasks(todayIn(), WEDDING.weddingDate), todayIn()), menuMissing });
  // «Primeros pasos», como en /panel. La web de muestra está publicada;
  // `?web=live|withdrawn` enseña los otros dos estados (siteVisibility).
  const webVisibility = params.web === "live" || params.web === "withdrawn" ? params.web : "published";
  // Los pasos enlazan al panel real; aquí se quedan dentro del borrador.
  const previewHref: Record<string, string> = {
    "/panel/invitados?nuevo=1": `${base}?vista=invitados&datos=${datos}&nuevo=1`,
    "/panel/invitados": `${base}?vista=invitados&datos=${datos}`,
    "/panel/invitados/mensajes": `${base}?vista=mensajes&datos=${datos}`,
    "/panel/ajustes": `${base}?vista=ajustes&datos=${datos}`,
  };
  const firstSteps = buildFirstSteps({ visibility: webVisibility, guests: stats.total, sent: stats.sent, replies: stats.confirmed + stats.declined, slug: WEDDING.slug })
    .map((step) => (previewHref[step.href] ? { ...step, href: previewHref[step.href]! } : step));
  const progress = firstStepsComplete(firstSteps) ? undefined : <FirstSteps steps={firstSteps} />;
  return (
    <div className="bb-scope pn-scope pn-shell min-h-svh">
      <PanelNav current="/panel" />
      {toggle}
      <main className="pn-wrap flex flex-col gap-10 py-8 sm:py-10">
        <PanelHeader {...WEDDING} guestUrl={`http://localhost:3474/b/${WEDDING.slug}`} />
        {/* Centro de mando, lo primero (P1-7), como en /panel. */}
        {stats.total > 0 ? (
          <div className="pn-command">
            <NextActions actions={actions} progress={progress} />
            <ActivityFeed events={buildActivity(
              crmGuests.filter((g) => g.crm?.invitationOpenedAt).map((g) => ({ id: g.id, name: g.name, rsvp_status: g.rsvp_status, invitation_opened_at: g.crm?.invitationOpenedAt ?? null })),
              crmGuests.filter((g) => g.rsvp_status !== "pendiente").map((g, i) => ({ id: g.id, name: g.name, rsvp_status: g.rsvp_status, rsvp_companions: g.rsvp_companions, updated_at: new Date(Date.now() - (i + 1) * 5_400_000).toISOString() })),
            )} />
          </div>
        ) : (
          <NextActions actions={actions} hasGuests={false} progress={progress} />
        )}
        {stats.total > 0 && <QuickSearch />}
        {funnel && <PanelHero funnel={funnel} listHref={`${base}?vista=invitados&datos=${datos}`} />}
        <PanelStats stats={stats} guestCountEst={110} title="Así está vuestra lista" funnel={funnel} listHref={`${base}?vista=invitados&datos=${datos}`} aside={<p className="pn-refresh">Se actualiza cada 30 s mientras esta página está visible.</p>} />
        {stats.total > 0 && <GroupSummaryCard groups={groupSummary(params.grupos === "0" ? guests.map((guest) => ({ ...guest, group_name: null })) : guests)} listHref={`${base}?vista=invitados&datos=${datos}`} />}
        {(() => {
          const summary = params.regalos === "fallo" ? null : giftSummary(params.regalos === "0" ? [] : gifts, crmGuests);
          return showGiftSummary({ guests: stats.total, guestsError: false, summary }) && <GiftSummaryCard summary={summary} error={params.regalos === "fallo"} listHref={`${base}?vista=invitados&datos=${datos}`} />;
        })()}
        {stats.total === 0 && (
          <section aria-labelledby="prepare-title">
            <p className="pn-eyebrow">Paso a paso</p>
            <h2 id="prepare-title" className="pn-display pn-h2">Preparad vuestra <em>invitación</em></h2>
            <ol className="pn-steps pn-steps--icons mt-4">
              <li><Link href={base} className="pn-step pn-press"><IconTile icon={CalendarClockIcon} /><span className="pn-step-text"><span className="pn-step-title">Añadid lugares y horarios</span></span></Link></li>
            </ol>
          </section>
        )}
        <Link href={`${base}?vista=invitados&nuevo=1`} className="pn-fab pn-fab--clay pn-press" aria-label="Añadir invitado"><PlusIcon aria-hidden="true" className="size-5" />Añadir</Link>
      </main>
    </div>
  );
}
