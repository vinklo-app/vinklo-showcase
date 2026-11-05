"use client";

/**
 * Borrador del panel (solo desarrollo). Monta los componentes de presentación
 * reales con datos ficticios y acciones que mutan estado local: no hay
 * Supabase ni server actions detrás (la IA de «Pedid cambios» también es de
 * mentira, SOLO aquí). Sirve para capturar y revisar el diseño sin sesión.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PenLineIcon } from "lucide-react";
import type { GuestInput } from "@/lib/actions/guests";
import { GuestList, type GuestActions, type GuestRow } from "@/components/panel/guest-list";
import type { GuestExtrasActions } from "@/components/panel/guest-extras";
import type { GuestCompanion } from "@/lib/actions/companions";
import { SAMPLE_COMPANIONS } from "./seating-fixtures";
import { GuestFilters, GuestPagination, type GuestFilterParams } from "@/components/panel/guest-filters";
import { GuestSummaryLine } from "@/components/panel/guest-summary-line";
import { GuestCsvButton } from "@/components/panel/guest-csv-button";
import { MessageEditor, type SavedTemplate } from "@/components/panel/message-editor";
import { ReminderQueue, type ReminderPerson } from "@/components/panel/reminder-queue";
import { ReminderCallout } from "@/components/panel/reminder-callout";
import { SeriesCallout } from "@/components/panel/series-callout";
import { InvitationSeries } from "@/components/panel/invitation-series";
import { seriesHref, type InvitationQueueItem } from "@/lib/messages/invitation-series";
import type { QueueState } from "@/components/panel/reminders";
import { SiteEditor, type SiteEditorActions } from "@/components/panel/site-editor";
import type { SiteEditorState } from "@/lib/actions/site";
import type { SiteVersionRow } from "@/lib/site-chat/thread";
import { SITE_PALETTES, type SiteDocument } from "@/lib/site-document";
import { buildGuestCsv } from "@/lib/messages/guest-csv";
import { normalizeGuestListFilter } from "@/lib/messages/filters";
import { validateTemplate, type MessageContext, type TemplateKind } from "@/lib/messages/templates";
import type { CrmActions, Gift } from "@/lib/crm/contract";
import { CONTACTS_DEMO, countFilters, groupSummary, inFilter, inGroup, inTagAndSide, summarize, tagSummary, withCrm, type Dataset } from "./fixtures";
import { SIDE_LABELS, canonicalTag, normalizeTags, tagKey, type SideFilter } from "@/lib/crm/tags";
import type { GuestCsvExtra } from "@/components/panel/guest-csv-button";
import { canonicalGroupName, groupNames, normalizeGroupName, type GroupFilter } from "@/lib/crm/groups";
import { rowProblem } from "@/lib/actions/guest-import";
import { GuestViewToggle } from "@/components/panel/guest-table";
import { MAX_GUEST_BULK, giftDeletionImpact } from "@/lib/crm/guest-bulk";
import type { GuestView } from "@/lib/crm/guest-view";

const wait = (ms = 350) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const PAGE_SIZE = 100; // = GUEST_PAGE_SIZE de lib/data/attendance
const CONTEXT: MessageContext = { novios: "Lucía y Juan", fecha: "sábado, 12 de junio" };
const PARTNERS = { p1: "Lucía", p2: "Juan" };
const SIDES = SIDE_LABELS(PARTNERS.p1, PARTNERS.p2);

/**
 * `&contactos=1`: simula el selector de contactos de Chrome en Android antes
 * de que GuestList compruebe `'contacts' in navigator && 'ContactsManager' in window`
 * (efecto tras montar). Se instala al evaluar el módulo, solo en el borrador.
 */
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("contactos") === "1" && !("ContactsManager" in window)) {
  Object.assign(window, { ContactsManager: function ContactsManager() {} });
  Object.defineProperty(navigator, "contacts", { configurable: true, value: { select: async () => { await wait(250); return CONTACTS_DEMO; } } });
}

export function PreviewInvitados({ initial, current, basePath, openAdd = false, openBulk = false, openExcel = false, view = "lista", pasted, failBulk, failOptOut = false, dataset, initialGifts, initialNoGift, failGifts = false, noTags = false, noLimits = false }: {
  /** «Importar desde Excel» abierto al cargar (`&nuevo=excel`) y vista «Tabla» (`&tabla=1`). */
  openExcel?: boolean; view?: GuestView;
  initial: GuestRow[]; current: GuestFilterParams; basePath: string; openAdd?: boolean; failOptOut?: boolean;
  /** Importación masiva: abrir «Añadir varios», texto pegado de partida y fallos simulados. */
  openBulk?: boolean; pasted?: string; failBulk?: "rows" | "network";
  /** CRM: regalos «del servidor» (estado local), marcados sin regalo y `&fallo=regalos` (las escrituras fallan). */
  dataset: Dataset; initialGifts: Gift[] | null; initialNoGift: string[]; failGifts?: boolean;
  /** `&etiquetas=0`: simula la base sin la migración de etiquetas. */
  noTags?: boolean;
  /** `&topes=0`: simula la base sin la migración del tope de acompañantes. */
  noLimits?: boolean;
}) {
  const [rawGuests, setGuests] = useState(initial);
  const importedIds = useRef(new Set<string>());
  const [gifts, setGifts] = useState(initialGifts);
  const [noGift, setNoGift] = useState(() => new Set(initialNoGift));
  // Igual que el servidor tras revalidar: los campos CRM salen de los regalos actuales.
  const guests = useMemo(() => (gifts ? withCrm(dataset, rawGuests, gifts, noGift) : rawGuests), [dataset, rawGuests, gifts, noGift]);
  const summary = useMemo(() => summarize(guests), [guests]);
  const counts = useMemo(() => countFilters(guests), [guests]);
  const needle = current.query.trim().toLowerCase();
  const groups = useMemo(() => groupSummary(guests), [guests]);
  const tags = useMemo(() => tagSummary(guests), [guests]);
  const matching = guests.filter((guest) => inFilter(guest, current.filter) && inGroup(guest, current.group) && inTagAndSide(guest, current.tag, current.side) && guest.name.toLowerCase().includes(needle));
  // Como la página real: el tope llega aparte (null = sin límite); sin la migración, no llega.
  // La tabla, como la página real, lleva todo el filtro sin paginar.
  const rows = (view === "tabla" ? matching : matching.slice((current.page - 1) * PAGE_SIZE, current.page * PAGE_SIZE)).map((guest) => (noLimits ? { ...guest, max_companions: undefined } : { ...guest, max_companions: guest.max_companions ?? null }));
  const showCallout = current.filter === "todos" || current.filter === "esperando" || current.filter === "para_recordar";
  const vistaBase = basePath.replace(/vista=[^&]*/, "vista=recordatorios");

  // Acompañantes con nombre y «No sentar con…» en memoria (como lib/actions/companions.ts).
  const extrasStore = useRef<{ companions: Map<string, GuestCompanion[]>; apart: Array<[string, string]> } | null>(null);
  if (extrasStore.current === null) {
    const companions = new Map<string, GuestCompanion[]>();
    for (const guest of initial) {
      const sample = SAMPLE_COMPANIONS[guest.name];
      if (sample) companions.set(guest.id, sample.map((item) => ({ id: item.id, name: item.name, isKid: item.is_kid, byGuest: guest.name === "Lucas y Andrea", tableId: null })));
    }
    extrasStore.current = { companions, apart: [] };
  }
  const extras = useMemo<GuestExtrasActions>(() => {
    const store = extrasStore.current!;
    const nameOf = (id: string) => initial.find((guest) => guest.id === id)?.name ?? "Invitado";
    let next = 0;
    return {
      async load(id) {
        await wait(200);
        if (noTags) return { ok: false, error: "Sin migración", missing: true };
        const apart = store.apart.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a)).map((other) => ({ id: other, name: nameOf(other) }));
        return { ok: true, companions: store.companions.get(id) ?? [], apart };
      },
      async saveCompanions(id, list) {
        await wait(300);
        const saved = list.map((item) => ({ id: item.id ?? `nuevo-${++next}`, name: item.name.replace(/\s+/g, " ").trim(), isKid: item.kid, byGuest: false, tableId: null }));
        if (saved.some((item) => !item.name)) return { ok: false, error: "Escribid el nombre de cada acompañante o quitad la fila." };
        store.companions.set(id, saved);
        return { ok: true, companions: saved };
      },
      async addApart(id, other) {
        await wait(200);
        if (id === other) return { ok: false, error: "Elegid a otra persona." };
        store.apart.push(id < other ? [id, other] : [other, id]);
        return { ok: true };
      },
      async removeApart(id, other) {
        await wait(200);
        store.apart = store.apart.filter(([a, b]) => !((a === id && b === other) || (a === other && b === id)));
        return { ok: true };
      },
      async searchGuests(query) {
        await wait(120);
        const needle = query.trim().toLowerCase();
        return initial.filter((guest) => guest.name.toLowerCase().includes(needle)).slice(0, 20).map((guest) => ({ id: guest.id, name: guest.name }));
      },
    };
  }, [initial, noTags]);

  const actions: GuestActions = {
    extras,
    async add(input: GuestInput) {
      await wait();
      if (input.name.trim().length < 2) return { ok: false, error: "Escribid el nombre (mínimo 2 letras)." };
      setGuests((list) => [...list, { id: `tmp-${Date.now()}`, name: input.name, phone: input.phone || null, rsvp_status: input.status, rsvp_companions: input.status === "si" ? input.companions : 0, rsvp_notes: input.notes || null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null, last_reminder_at: null, reminder_count: 0, reminders_opt_out: false, group_name: normalizeGroupName(input.group), tags: normalizeTags(input.tags ?? []), side: input.side ?? null, max_companions: input.maxCompanions ?? null }]);
      return { ok: true };
    },
    async update(id, input) {
      await wait();
      setGuests((list) => list.map((guest) => guest.id === id ? { ...guest, name: input.name, phone: input.phone || null, rsvp_status: input.status, rsvp_companions: input.status === "si" ? input.companions : 0, rsvp_notes: input.notes || null, ...(input.group !== undefined ? { group_name: normalizeGroupName(input.group) } : {}), ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}), ...(input.side !== undefined ? { side: input.side } : {}), ...(input.maxCompanions !== undefined ? { max_companions: input.maxCompanions } : {}) } : guest));
      return { ok: true };
    },
    async remove(id) {
      await wait();
      setGuests((list) => list.filter((guest) => guest.id !== id));
      return { ok: true };
    },
    async createInvitation(id) {
      await wait();
      setGuests((list) => list.map((guest) => guest.id === id ? { ...guest, invitation_prepared_at: new Date().toISOString(), invitation_sent_at: null } : guest));
      return { ok: true, path: `/b/lucia-y-juan?invitacion=ejemplo-${id}` };
    },
    // «Reenviar»: añade un enlace sin revocar ni tocar «enviada» (como createReminderLink).
    async createReminderLink(id) {
      await wait();
      return { ok: true, path: `/b/lucia-y-juan?invitacion=reenvio-${id}` };
    },
    async confirmSent(id) {
      await wait();
      setGuests((list) => list.map((guest) => guest.id === id ? { ...guest, invitation_sent_at: new Date().toISOString() } : guest));
      return { ok: true };
    },
    // «Guardar como plantilla» desde la hoja del mensaje (en el borrador no se guarda en ningún sitio).
    async saveTemplate() {
      await wait(300);
      return { ok: true };
    },
    async listContacts() {
      await wait(200);
      return { ok: true as const, guests: guests.map((guest) => ({ name: guest.name, phone: guest.phone })) };
    },
    async setGroup(ids, group) {
      await wait(400);
      const name = canonicalGroupName(group, groupNames(groups));
      const wanted = new Set(ids);
      const moved = rawGuests.filter((guest) => wanted.has(guest.id)).length;
      if (moved === 0) return { ok: false as const, error: "No se ha movido a nadie: esos invitados ya no están en vuestra lista." };
      setGuests((list) => list.map((guest) => (wanted.has(guest.id) ? { ...guest, group_name: name } : guest)));
      return { ok: true as const, moved, missing: ids.length - moved };
    },
    // Etiquetas (como set_guest_tags): forma canónica de la boda, quitar sin mayúsculas, tope de 8.
    async setTags(ids, change) {
      await wait(400);
      const names = tags.map((row) => row.tag);
      const add = (change.add ?? []).map((tag) => canonicalTag(tag, names) ?? tag);
      const remove = new Set((change.remove ?? []).map(tagKey));
      const wanted = new Set(ids);
      let changed = 0;
      const nextList = rawGuests.map((guest) => {
        if (!wanted.has(guest.id)) return guest;
        const next = normalizeTags([...(guest.tags ?? []).filter((tag) => !remove.has(tagKey(tag))), ...add.filter((tag) => !remove.has(tagKey(tag)))]);
        if (next.join("|") === (guest.tags ?? []).join("|")) return guest;
        changed += 1;
        return { ...guest, tags: next };
      });
      setGuests(nextList);
      return { ok: true as const, changed };
    },
    async setSide(ids, side) {
      await wait(300);
      const wanted = new Set(ids);
      const moved = rawGuests.filter((guest) => wanted.has(guest.id)).length;
      if (moved === 0) return { ok: false as const, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
      setGuests((list) => list.map((guest) => (wanted.has(guest.id) ? { ...guest, side } : guest)));
      return { ok: true as const, moved, missing: ids.length - moved };
    },
    async setMaxCompanions(ids, max) {
      await wait(300);
      const wanted = new Set(ids);
      const moved = rawGuests.filter((guest) => wanted.has(guest.id)).length;
      if (moved === 0) return { ok: false as const, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
      setGuests((list) => list.map((guest) => (wanted.has(guest.id) ? { ...guest, max_companions: max } : guest)));
      return { ok: true as const, moved, missing: ids.length - moved };
    },
    async renameTag(from, to) {
      await wait(400);
      const key = tagKey(from);
      const changed = rawGuests.filter((guest) => (guest.tags ?? []).some((tag) => tagKey(tag) === key)).length;
      setGuests((list) => list.map((guest) => ((guest.tags ?? []).some((tag) => tagKey(tag) === key)
        ? { ...guest, tags: normalizeTags((guest.tags ?? []).flatMap((tag) => (tagKey(tag) === key ? (to ? [to] : []) : [tag]))) }
        : guest)));
      return { ok: true as const, changed };
    },
    async bulkCreate(rows, group, extra) {
      await wait(600);
      if (failBulk === "network") return { ok: false as const, error: "No se ha añadido ningún invitado. Comprobad la conexión y probad de nuevo.", created: 0 as const, skipped: rows.length, errors: [] };
      // Mismo criterio que el servidor (schema de guests.ts); `fallo=varios` rechaza además la 2.ª fila.
      const errors = rows.flatMap((row, index) => {
        const problem = rowProblem({ name: row.name, phone: row.phone ?? "" }) ?? (failBulk === "rows" && index === 1 ? "Revisad el teléfono: mínimo 6 caracteres." : null);
        return problem ? [{ line: index + 1, message: problem }] : [];
      });
      const bad = new Set(errors.map((item) => item.line - 1));
      const added = rows.filter((_, index) => !bad.has(index));
      const stamp = Date.now();
      setGuests((list) => [...list, ...added.map((row, index) => ({ id: `tmp-${stamp}-${index}`, name: row.name, phone: row.phone || null, rsvp_status: "pendiente" as const, rsvp_companions: 0, rsvp_notes: null, source: "couple" as const, invitation_prepared_at: null, invitation_sent_at: null, last_reminder_at: null, reminder_count: 0, reminders_opt_out: false, group_name: normalizeGroupName(group), tags: normalizeTags(extra?.tags ?? []), side: extra?.side ?? null }))]);
      return { ok: true as const, created: added.length, skipped: errors.length, errors };
    },
    // «Importar desde Excel» en memoria; un reintento con el mismo id no duplica (como la RPC).
    async importExcel(importId, list) {
      await wait(700);
      if (failBulk === "network") return { ok: false as const, error: "No se ha importado nadie. Comprobad la conexión y probad de nuevo." };
      const people = list.reduce((sum, guest) => sum + 1 + guest.companions, 0);
      if (importedIds.current.has(importId)) return { ok: true as const, guests: list.length, people, repeated: true };
      importedIds.current.add(importId);
      const stamp = Date.now();
      setGuests((rows) => [...rows, ...list.map((guest, index) => ({
        id: `xl-${stamp}-${index}`, name: guest.name, phone: guest.phone, rsvp_status: guest.status, rsvp_companions: guest.status === "si" ? guest.companions : 0,
        rsvp_notes: guest.notes, source: "couple" as const, invitation_prepared_at: null, invitation_sent_at: null, last_reminder_at: null, reminder_count: 0, reminders_opt_out: false,
        group_name: guest.group, tags: guest.tags, side: guest.side, max_companions: guest.max_companions, extra_fields: Object.keys(guest.extra).length ? guest.extra : null,
      }))]);
      return { ok: true as const, guests: list.length, people, repeated: false };
    },
    // Acciones en bloque (Bloque 4), en memoria como deleteGuests / setGuestsStatus / listGuestsInFilter.
    async removeMany(ids) {
      await wait(400);
      const wanted = new Set(ids);
      const deleted = rawGuests.filter((guest) => wanted.has(guest.id)).length;
      if (deleted === 0) return { ok: false as const, error: "No se ha borrado a nadie: esos invitados ya no están en vuestra lista." };
      setGuests((list) => list.filter((guest) => !wanted.has(guest.id)));
      setGifts((list) => list && list.flatMap((gift) => {
        const givers = gift.givers.filter((giver) => !wanted.has(giver.guestId));
        return givers.length === 0 && gift.givers.length > 0 ? [] : [{ ...gift, givers }];
      }));
      return { ok: true as const, deleted, missing: ids.length - deleted };
    },
    async previewRemove(ids) {
      await wait(250);
      return { ok: true as const, ...giftDeletionImpact(gifts ?? [], new Set(ids)) };
    },
    async setStatus(ids, status) {
      await wait(400);
      const wanted = new Set(ids);
      const changed = rawGuests.filter((guest) => wanted.has(guest.id)).length;
      if (changed === 0) return { ok: false as const, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
      setGuests((list) => list.map((guest) => (wanted.has(guest.id) ? { ...guest, rsvp_status: status, rsvp_companions: status === "si" ? guest.rsvp_companions : 0 } : guest)));
      return { ok: true as const, changed, missing: ids.length - changed };
    },
    async listFilter() {
      await wait(350);
      if (matching.length > MAX_GUEST_BULK) return { ok: false as const, error: `Podéis elegir hasta ${MAX_GUEST_BULK} invitados a la vez: afinad el filtro o la búsqueda.` };
      return { ok: true as const, guests: matching.map(({ id, name, rsvp_status, invitation_prepared_at, invitation_sent_at, group_name, tags }) => ({ id, name, rsvp_status, invitation_prepared_at, invitation_sent_at, group_name, tags })) };
    },
    async setRemindersOptOut(id, optOut) {
      await wait(500);
      if (failOptOut) return { ok: false, error: "No se ha guardado: el invitado ya no está disponible." };
      setGuests((list) => list.map((guest) => guest.id === id ? { ...guest, reminders_opt_out: optOut } : guest));
      return { ok: true };
    },
  };

  const failed = { ok: false as const, error: "No se ha guardado. Comprobad la conexión y probad de nuevo." };
  const giftActions: CrmActions = {
    async createGift(input) {
      await wait(450);
      if (failGifts) return failed;
      const id = `00000000-0000-4000-9999-${String(Date.now()).slice(-12)}`;
      setGifts((list) => [{ id, kind: input.kind, amountCents: input.amountCents ?? null, description: input.description ?? null, note: input.note ?? null, receivedOn: input.receivedOn ?? null, thankedAt: null, createdAt: new Date().toISOString(), givers: input.guestIds.map((guestId) => ({ guestId, name: rawGuests.find((guest) => guest.id === guestId)?.name ?? "Invitado" })) }, ...(list ?? [])]);
      return { ok: true, data: { id } };
    },
    async updateGift(id, input) {
      await wait(400);
      if (failGifts) return failed;
      setGifts((list) => (list ?? []).map((item) => item.id === id ? { ...item, kind: input.kind, amountCents: input.amountCents ?? null, description: input.description ?? null, note: input.note ?? null, receivedOn: input.receivedOn ?? null, givers: input.guestIds.map((guestId) => ({ guestId, name: rawGuests.find((guest) => guest.id === guestId)?.name ?? "Invitado" })) } : item));
      return { ok: true };
    },
    async deleteGift(id) {
      await wait(300);
      if (failGifts) return failed;
      setGifts((list) => (list ?? []).filter((item) => item.id !== id));
      return { ok: true };
    },
    async setGiftThanked(id, thanked) {
      await wait(350);
      if (failGifts) return failed;
      setGifts((list) => (list ?? []).map((item) => item.id === id ? { ...item, thankedAt: thanked ? new Date().toISOString() : null } : item));
      return { ok: true };
    },
    async setGuestNoGift(guestId, value) {
      await wait(350);
      if (failGifts) return failed;
      setNoGift((set) => { const next = new Set(set); if (value) next.add(guestId); else next.delete(guestId); return next; });
      return { ok: true };
    },
  };
  actions.gifts = giftActions;

  async function exportCsv(filter: string, search = "", group?: GroupFilter, extra?: GuestCsvExtra) {
    await wait(300);
    const key = normalizeGuestListFilter(filter);
    const list = guests.filter((guest) => inFilter(guest, key) && inGroup(guest, group) && inTagAndSide(guest, extra?.tag, extra?.side as SideFilter | undefined) && guest.name.toLowerCase().includes(search.trim().toLowerCase()));
    return { ok: true as const, csv: buildGuestCsv(list, SIDES), filename: `invitados-${key.replace(/_/g, "-")}-vinklo.csv`, rows: list.length };
  }

  return (
    <>
      <header className="pn-rule border-b pb-5">
        <h1 className="pn-display pn-h1">Invitados</h1>
        <p className="pn-muted pn-tnum mt-3 text-sm leading-relaxed"><GuestSummaryLine summary={summary} /></p>
        {(current.filter === "todos" || current.filter === "sin_enviar") && <SeriesCallout count={counts.sin_enviar} href={seriesHref(basePath.replace(/vista=[^&]*/, "vista=enviar"), { group: current.group?.kind === "named" ? current.group.name : null, tag: current.tag ?? null, side: current.side ?? null })} />}
        {showCallout && <ReminderCallout count={counts.para_recordar} href={vistaBase} />}
      </header>
      {summary.total > 0 && <GuestFilters basePath={basePath} current={current} counts={counts} gifts groups={groups} tags={noTags ? null : tags} sideLabels={SIDES} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === "tabla" ? <span /> : <GuestPagination basePath={basePath} current={current} matchingCount={matching.length} pageSize={PAGE_SIZE} />}
        {summary.total > 0 && <GuestViewToggle view={view} hrefs={{ lista: basePath.replace(/&tabla=1/, ""), tabla: basePath.includes("&tabla=1") ? basePath : `${basePath}&tabla=1` }} />}
      </div>
      <GuestList
        guests={rows}
        actions={actions}
        filter={current.filter}
        query={current.query}
        openAddInitially={openAdd}
        openBulkInitially={openBulk}
        bulkInitialText={pasted}
        openExcelInitially={openExcel}
        view={view}
        clearHref={basePath}
        invitationMessage={{ template: null, context: CONTEXT }}
        gifts={gifts}
        directory={rawGuests.map(({ id, name }) => ({ id, name }))}
        thanksMessage={{ template: null, context: CONTEXT }}
        groups={groupNames(groups)}
        group={current.group}
        tagSummary={noTags ? null : tags}
        partners={PARTNERS}
        tag={current.tag}
        sideFiltered={Boolean(current.side)}
        side={current.side ?? null}
        total={matching.length}
        tablesHref="/borrador/panel?vista=mesas&excel=1"
        limits={!noLimits}
        toolbar={(
          <>
            <Link href={basePath.replace(/vista=[^&]*/, "vista=mensajes")} className="pn-act pn-press"><PenLineIcon aria-hidden="true" className="size-4" />Mensajes</Link>
            {summary.total > 0 && <GuestCsvButton filter={current.filter} query={current.query} group={current.group} tag={current.tag} side={current.side} sideLabel={current.side && current.side !== "none" ? SIDES[current.side] : undefined} exportCsv={exportCsv} />}
          </>
        )}
      />
    </>
  );
}

/** Editor de mensajes con guardado de mentira (`&fallo=1`: el servidor rechaza). */
export function PreviewMensajes({ templates, sampleName, initialKind, noDate = false, fail = false }: { templates: Record<TemplateKind, SavedTemplate>; sampleName: string; initialKind: TemplateKind; noDate?: boolean; fail?: boolean }) {
  return (
    <MessageEditor
      templates={templates}
      context={noDate ? { ...CONTEXT, fecha: "" } : CONTEXT}
      sampleName={sampleName}
      sampleLink="https://vinklo.es/b/lucia-y-juan?invitacion=…"
      initialKind={initialKind}
      actions={{
        async save(kind, body) {
          await wait(500);
          if (fail) return { ok: false, error: "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo." };
          const valid = validateTemplate(body, kind);
          return valid.ok ? { ok: true } : valid;
        },
        async reset() { await wait(400); return { ok: true }; },
      }}
    />
  );
}

/** Fila de recordatorios: confirmar o retirar a alguien lo quita de la fila «del servidor» (estado local). */
export function PreviewRecordatorios({ initial, state, basePath, listHref, fail = false }: { initial: ReminderPerson[]; state: QueueState; basePath: string; listHref: string; fail?: boolean }) {
  const [gone, setGone] = useState<string[]>([]);
  const items = initial.filter((item) => !gone.includes(item.id));
  return (
    <ReminderQueue
      items={items}
      state={state}
      template={null}
      context={CONTEXT}
      linkPreview="https://vinklo.es/b/lucia-y-juan?invitacion=…"
      basePath={basePath}
      listHref={listHref}
      actions={{
        async createLink(id) { await wait(250); return { ok: true, path: `/b/lucia-y-juan?invitacion=ejemplo-${id.slice(-4)}` }; },
        async confirm(id) {
          await wait(400);
          if (fail) return { ok: false, error: "No se ha guardado: confirmad antes el envío de la invitación a esta persona." };
          setGone((list) => [...list, id]);
          return { ok: true, lastReminderAt: new Date().toISOString(), reminderCount: 1 };
        },
        async optOut(id) { await wait(400); setGone((list) => [...list, id]); return { ok: true }; },
      }}
      templateActions={{
        async save() { await wait(300); return fail ? { ok: false, error: "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo." } : { ok: true }; },
        async reset() { await wait(300); return { ok: true }; },
      }}
    />
  );
}

/**
 * Envío en serie: confirmar a alguien lo saca de la fila «del servidor»
 * (estado local). `fail` = confirmar falla; `failLink` = crear el enlace falla.
 */
export function PreviewEnviar({ initial, state, basePath, listHref, withoutPhone, fail = false, failLink = false }: { initial: InvitationQueueItem[]; state: QueueState; basePath: string; listHref: string; withoutPhone: number; fail?: boolean; failLink?: boolean }) {
  const [gone, setGone] = useState<string[]>([]);
  const items = initial.filter((item) => !gone.includes(item.id));
  return (
    <InvitationSeries
      items={items}
      state={state}
      template={null}
      context={CONTEXT}
      linkPreview="https://vinklo.es/b/lucia-y-juan?invitacion=…"
      basePath={basePath}
      listHref={listHref}
      withoutPhone={withoutPhone}
      actions={{
        async createLink(id) {
          await wait(250);
          if (failLink) return { ok: false, error: "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo." };
          return { ok: true, path: `/b/lucia-y-juan?invitacion=ejemplo-${id.slice(-4)}` };
        },
        async confirm(id) {
          await wait(400);
          if (fail) return { ok: false, error: "Cread primero un enlace personal para este invitado." };
          setGone((list) => [...list, id]);
          return { ok: true };
        },
      }}
      templateActions={{
        async save() { await wait(300); return fail ? { ok: false, error: "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo." } : { ok: true }; },
        async reset() { await wait(300); return { ok: true }; },
      }}
    />
  );
}

/**
 * IA de mentira para el borrador: reconoce una paleta, la cuenta atrás, la
 * bienvenida (también si está seleccionada) y una pregunta de aparcamiento.
 * «error» simula la IA caída.
 */
async function fakePropose({ instruction, document, focus }: { instruction: string; document: SiteDocument; focus?: string }) {
  await wait(2200);
  const text = instruction.toLocaleLowerCase("es-ES");
  if (text.includes("error")) return { ok: false as const, error: "La edición con IA no está disponible ahora mismo." };
  if (text.includes("fecha")) return { ok: false as const, error: "La fecha no se cambia con la IA: cambiadla en «Los datos», más abajo en esta página.", action: { label: "Ir a Los datos", target: "los-datos" } };
  const changes: string[] = [];
  let next: SiteDocument = document;
  const palette = SITE_PALETTES.find((p) => text.includes(p.label.toLocaleLowerCase("es-ES")) || text.includes(p.id) || (p.id === "mar" && text.includes("azul")) || (p.id === "natural" && text.includes("verde")) || (p.id === "lavanda" && text.includes("suave")));
  if (palette) { next = { ...next, palette: palette.id }; changes.push(`los colores (${palette.label})`); }
  if (text.includes("cuenta atrás")) {
    next = { ...next, scenes: next.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, showCountdown: false } } : s)) };
    changes.push("la cuenta atrás (oculta)");
  }
  if (text.includes("bienvenida") || focus?.includes("Bienvenida")) {
    const short = /cort|breve/.test(text);
    next = { ...next, scenes: next.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, welcomeMessage: short ? "Os esperamos. Será un día precioso." : "Queremos celebrarlo con vosotros, con calma y sin prisas. Os esperamos." } } : s)) };
    changes.push("el mensaje de bienvenida");
  }
  if (text.includes("aparcamiento") || text.includes("preguntas")) {
    const item = { id: "q-1", question: "¿Hay aparcamiento?", answer: "" };
    const faq = next.scenes.find((s) => s.type === "faq");
    next = faq
      ? { ...next, scenes: next.scenes.map((s) => (s.type === "faq" ? { ...s, props: { ...s.props, items: [...s.props.items.filter((i) => i.id !== "q-1"), { ...item, answer: "Sí, en la propia finca." }] } } : s)) }
      : { ...next, scenes: [...next.scenes.filter((s) => s.type !== "rsvp"), { id: "preguntas", type: "faq" as const, enabled: true, props: { title: "Preguntas y respuestas", contact: "", items: [{ ...item, answer: "Sí, en la propia finca." }] } }, ...next.scenes.filter((s) => s.type === "rsvp")] };
    changes.push("Preguntas: + ¿Hay aparcamiento?");
  }
  if (changes.length === 0) return { ok: false as const, error: "No hemos encontrado nada que cambiar con esa petición. Probad a contarlo de otra forma o hacedlo a mano desde Vuestro contenido.", action: { label: "Ir a Vuestro contenido", target: "vuestro-contenido" } };
  const dropped = text.includes("hora") ? ["la hora (no aparece en vuestra petición)"] : [];
  return { ok: true as const, document: next, summary: `Cambiamos ${changes.join(", ")}. (Simulación de desarrollo.)`, changes, dropped };
}

/**
 * Editor de la web con IA de mentira e historial en memoria. `&fallo=1`: la
 * subida de foto falla; `&fallo=conflicto`: el próximo cambio de la IA choca
 * con otro guardado (como si la otra persona de la pareja guardase antes).
 */
export function PreviewAjustes({ state, before, after, failUpload = false, conflict = false, plan = "free" }: { state: SiteEditorState; before?: ReactNode; after?: ReactNode; failUpload?: boolean; conflict?: boolean; plan?: "free" | "premium" }) {
  const version = useRef(state.draftVersion);
  const pendingConflict = useRef(conflict);
  const history = useRef<SiteVersionRow[]>([]);
  const actions: SiteEditorActions = {
    async upload(formData) {
      await wait(900);
      if (failUpload) return { ok: false, error: "La foto pesa demasiado: el máximo son 5 MB." };
      const file = formData.get("file");
      if (!(file instanceof File)) return { ok: false, error: "Elegid una foto para subir." };
      const bitmap = await createImageBitmap(file);
      const result = { ok: true as const, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    },
    propose: fakePropose,
    async save({ document, baseVersion, history: entry }) {
      await wait(400);
      if (pendingConflict.current && entry?.kind === "ai") {
        pendingConflict.current = false;
        return { ok: false, code: "conflict", draftVersion: version.current + 1, error: "Otra pestaña o dispositivo ha guardado la web antes que esta." };
      }
      if (baseVersion !== version.current) return { ok: false, code: "conflict", draftVersion: version.current, error: "Otra pestaña o dispositivo ha guardado la web antes que esta. Recargad para ver la última versión antes de seguir editando." };
      version.current += 1;
      if (!entry) return { ok: true, draftVersion: version.current };
      const row: SiteVersionRow = { id: `h-${version.current}`, createdAt: new Date().toISOString(), ...entry, document, draftVersion: version.current, authorId: null };
      history.current = [...history.current, row].slice(-50);
      return { ok: true, draftVersion: version.current, history: { id: row.id, createdAt: row.createdAt } };
    },
    async history() {
      await wait(200);
      return { ok: true, available: true, rows: history.current };
    },
  };
  return <SiteEditor state={state} plan={plan} visibility="live" actions={actions} before={before} after={after} />;
}
