"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { ContactIcon, FileSpreadsheetIcon, FolderInputIcon, ListChecksIcon, ListPlusIcon, PlusIcon, SendIcon, TagIcon, TagsIcon, Trash2Icon, UserCheckIcon, XIcon } from "lucide-react";
import type { RsvpStatus } from "@/lib/guests";
import type { GuestListFilter } from "@/lib/messages/filters";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GuestSheet } from "@/components/panel/guest-sheet";
import { GuestExtras } from "@/components/panel/guest-extras";
import { GuestBulkImport, pickContacts, useContactsPicker, type BulkImportActions } from "@/components/panel/guest-bulk-import";
import type { ImportRow } from "@/lib/actions/guest-import";
import { flushPendingCommits, pendingCommits } from "@/components/panel/deferred-commit";
import type { Gift } from "@/lib/crm/contract";
import { GuestGifts, type GiftStore, type GuestOption, type ThanksMessage } from "@/components/panel/guest-gifts";
import { giftsForGuest, rowGiftState } from "@/components/panel/gifts";
import { ALL_GROUPS, type GroupFilter } from "@/lib/crm/groups";
import type { SideChoice, TagContext } from "@/components/panel/tag-field";
import type { CompanionLimitChoice } from "@/components/panel/companion-limit-field";
import { SIDE_LABELS, suggestedTags, type GuestTagSummary, type Partners, type SideFilter } from "@/lib/crm/tags";
import { GuestImportedFields, GuestTable, type GuestView } from "@/components/panel/guest-table";
import type { ExcelImportActions } from "@/components/panel/guest-excel-import";
import type { RawSheet } from "@/lib/crm/guest-excel-import";
import { DELETE_UNDO_MS, MAX_GUEST_BULK, deleteDoneText, deletePendingText, selectedGuests, sendableGuests, statusDoneText, type BulkGuest } from "@/lib/crm/guest-bulk";
import type { GuestActions, GuestRow, InvitationMessage } from "@/components/panel/guest-list/types";
import { GuestEditor, empty } from "@/components/panel/guest-list/guest-editor";
import { GuestLinkSection } from "@/components/panel/guest-list/guest-link-section";
import { GuestItem } from "@/components/panel/guest-list/guest-item";
import { DeleteSelected, MoveToGroup, StatusSelected, TagSelected, presentTags } from "@/components/panel/guest-list/selection-sheets";
import { TagManager } from "@/components/panel/guest-list/tag-manager";
import { ReminderSettings } from "@/components/panel/guest-list/reminder-settings";
import { EmptyList } from "@/components/panel/guest-list/empty-list";

// Piezas de la lista en components/panel/guest-list/; aquí se reexporta lo público de siempre.
export type { GuestActions, GuestRow, InvitationMessage } from "@/components/panel/guest-list/types";
export { GuestLinkSection, WHATSAPP_NO_DELIVERY } from "@/components/panel/guest-list/guest-link-section";

// «Importar desde Excel» se descarga al abrirlo (el lector de Excel, más aún: al elegir el archivo).
const GuestExcelImport = dynamic(() => import("@/components/panel/guest-excel-import").then((m) => m.GuestExcelImport), {
  ssr: false,
  loading: () => <p className="pn-help" aria-live="polite">Preparando la importación…</p>,
});

type SheetState = { kind: "closed" } | { kind: "add" } | { kind: "edit"; guest: GuestRow; giftsFirst?: boolean; linkFirst?: boolean } | { kind: "bulk"; rows: ImportRow[] | null } | { kind: "group"; ids: string[] } | { kind: "tag"; ids: string[] } | { kind: "tags-admin" } | { kind: "excel" } | { kind: "delete"; ids: string[] } | { kind: "status"; ids: string[] };

/**
 * Lista de personas tipo WhatsApp. Sin animación al filtrar o paginar (es
 * repetitivo); la edición va en una hoja. Vacíos con dirección según el filtro.
 */
export function GuestList({ guests: serverGuests, actions, filter = "todos", query = "", openAddInitially = false, openBulkInitially = false, bulkInitialText, openExcelInitially = false, excelInitialSheets, view = "lista", clearHref = "/panel/invitados", invitationMessage, toolbar, gifts, directory, thanksMessage, groups, group = ALL_GROUPS, tagSummary, partners, tag = null, sideFiltered = false, side = null, limits = false, total, tablesHref = "/panel/mesas" }: {
  guests: GuestRow[]; actions: GuestActions; filter?: GuestListFilter; query?: string; openAddInitially?: boolean; clearHref?: string;
  /** Personas que cumplen el filtro activo en todas las páginas («Elegir los N del filtro»); sin él, solo la página. */
  total?: number;
  /** Lado elegido en la lista (para saber cuándo cambia el filtro de la selección). */
  side?: SideFilter;
  /** «Mesas» (tras importar un Excel con columna Mesa). */
  tablesHref?: string;
  /** Abre «Importar desde Excel» al cargar (borrador; `excelInitialSheets` = hojas ya leídas). */
  openExcelInitially?: boolean; excelInitialSheets?: { file: string; sheets: RawSheet[] };
  /** «Lista» (por defecto) o «Tabla» (hoja de cálculo con todo el filtro y los campos propios). */
  view?: GuestView;
  /** Abre «Añadir varios» al cargar (borrador; `bulkInitialText` = texto pegado de partida). */
  openBulkInitially?: boolean; bulkInitialText?: string;
  invitationMessage?: InvitationMessage;
  /** Acciones de la lista junto a «Añadir invitado» (exportar, mensajes). */
  toolbar?: React.ReactNode;
  /** Regalos de la boda (listGifts). undefined = sin CRM de regalos; null = la lectura falló. */
  gifts?: Gift[] | null;
  /** Toda la lista (id + nombre) para los regalos de grupo; sin ella, las filas de esta página. */
  directory?: GuestOption[];
  /** Plantilla de agradecimiento (null = la de Vinklo). */
  thanksMessage?: ThanksMessage;
  /** Grupos ya usados (sugerencias). undefined = sin grupos (migración sin aplicar): no se ofrecen. */
  groups?: readonly string[];
  /** Grupo elegido en la lista: el invitado nuevo nace en él. */
  group?: GroupFilter;
  /** Etiquetas en uso con su recuento (guest_tag_summary). undefined/null = sin la migración: no se ofrecen etiquetas ni lado. */
  tagSummary?: GuestTagSummary[] | null;
  /** Nombres de la pareja (para «De Lucía», «De Juan» y las sugerencias). */
  partners?: Partners;
  /** Etiqueta elegida en la lista: el invitado nuevo nace con ella. */
  tag?: string | null;
  /** Hay un lado elegido en la lista (solo para el vacío). */
  sideFiltered?: boolean;
  /** Se ha podido leer el tope de acompañantes (20261021110000): se ofrece en la ficha y en la selección. */
  limits?: boolean;
}) {
  // Borrado en bloque pendiente de «Deshacer»: la lista ya no los muestra, el servidor aún los tiene.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  // Cuántos borrados esperan aún al servidor (aviso abierto o llamada en curso).
  const [deleting, setDeleting] = useState(0);
  const guests = useMemo(() => (hidden.size > 0 ? serverGuests.filter((guest) => !hidden.has(guest.id)) : serverGuests), [serverGuests, hidden]);
  const [sheet, setSheet] = useState<SheetState>(openExcelInitially ? { kind: "excel" } : openBulkInitially ? { kind: "bulk", rows: null } : openAddInitially ? { kind: "add" } : { kind: "closed" });
  // Durante la salida (180 ms) la hoja sigue mostrando lo último abierto, sin saltar a «Nuevo invitado».
  const [shown, setShown] = useState<Exclude<SheetState, { kind: "closed" }>>(sheet.kind === "closed" ? { kind: "add" } : sheet);
  if (sheet.kind !== "closed" && sheet !== shown) setShown(sheet);
  const picker = useContactsPicker();
  // Regalos: copia local para que anotar, borrar o agradecer se vea al momento;
  // cuando el servidor manda una lista nueva (revalidación), manda la suya.
  const [giftSource, setGiftSource] = useState(gifts);
  const [giftList, setGiftList] = useState<Gift[] | null>(gifts ?? null);
  const [noGift, setNoGift] = useState<Record<string, boolean>>({});
  if (gifts !== giftSource) { setGiftSource(gifts); setGiftList(gifts ?? null); setNoGift({}); }
  const giftsEnabled = gifts !== undefined && Boolean(actions.gifts);
  const store: GiftStore = {
    upsert: (gift) => setGiftList((list) => list && (list.some((item) => item.id === gift.id) ? list.map((item) => (item.id === gift.id ? gift : item)) : [gift, ...list])),
    remove: (id) => setGiftList((list) => list && list.filter((item) => item.id !== id)),
    setNoGift: (guestId, value) => setNoGift((all) => ({ ...all, [guestId]: value })),
  };
  const giftFor = (guest: GuestRow) => {
    const own = giftList ? giftsForGuest(giftList, guest.id) : null;
    return { gifts: own, state: rowGiftState(guest.crm?.giftState, own, noGift[guest.id]) };
  };
  const people: GuestOption[] = directory ?? guests.map(({ id, name }) => ({ id, name }));
  const bulkActions: BulkImportActions | null = actions.bulkCreate && actions.listContacts ? { bulkCreate: actions.bulkCreate, listContacts: actions.listContacts } : null;
  const excelActions: ExcelImportActions | null = actions.importExcel && actions.listContacts ? { importGuests: actions.importExcel, listContacts: actions.listContacts } : null;
  const table = view === "tabla";
  async function importContacts() {
    if (!picker) return;
    try {
      const rows = await pickContacts(picker);
      if (rows) setSheet({ kind: "bulk", rows });
    } catch {
      toast("No se han podido leer los contactos. Podéis pegar la lista con «Añadir varios».");
    }
  }
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushPendingCommits(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushPendingCommits);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushPendingCommits);
    };
  }, []);
  const extrasFlush = useRef<(() => Promise<boolean>) | null>(null);
  const closingExtras = useRef(false);
  const registerExtrasFlush = useMemo(() => (flush: (() => Promise<boolean>) | null) => { extrasFlush.current = flush; }, []);
  const flushExtras = () => extrasFlush.current?.() ?? Promise.resolve(true);
  const close = async () => {
    if (closingExtras.current) return;
    closingExtras.current = true;
    try { if (await flushExtras()) setSheet({ kind: "closed" }); }
    finally { closingExtras.current = false; }
  };

  // --- Selección múltiple ----------------------------------------------------
  // Sobre las filas de esta página; al cambiar de filtro, lo que ya no se ve deja de contar.
  // «Elegir los N del filtro» trae al resto del filtro (`wide`) mientras el filtro no cambie.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  const [wide, setWide] = useState<ReadonlyMap<string, BulkGuest> | null>(null);
  const [wideLoading, setWideLoading] = useState(false);
  const selectionKey = `${filter}|${query}|${JSON.stringify(group)}|${tag ?? ""}|${side ?? ""}`;
  const [wideKey, setWideKey] = useState(selectionKey);
  if (wideKey !== selectionKey) { setWideKey(selectionKey); setWide(null); }
  const visibleWide = useMemo(() => (wide && hidden.size > 0 ? new Map([...wide].filter(([id]) => !hidden.has(id))) : wide), [wide, hidden]);
  const selected = useMemo(() => selectedGuests(picked, guests, visibleWide), [picked, guests, visibleWide]);
  const filterTotal = Math.max(guests.length, (total ?? guests.length) - hidden.size);
  const canPickWide = Boolean(actions.listFilter) && filterTotal > guests.length && !table;
  const allWide = Boolean(visibleWide) && selected.length > 0 && selected.length === visibleWide!.size;
  const allPage = guests.length > 0 && guests.every((guest) => picked.has(guest.id));
  async function pickWide() {
    if (!actions.listFilter || wideLoading) return;
    setWideLoading(true);
    try {
      const result = await actions.listFilter();
      if (!result.ok) { toast(result.error); return; }
      const rows = new Map(result.guests.filter((guest) => !hidden.has(guest.id)).map((guest) => [guest.id, guest]));
      setWide(rows);
      setPicked(new Set(rows.keys()));
    } catch { toast("No hemos podido leer la lista. Probad de nuevo."); }
    finally { setWideLoading(false); }
  }
  const canMove = Boolean(actions.setGroup && groups);
  const tagContext: TagContext | undefined = useMemo(() => {
    if (!tagSummary) return undefined;
    const names = tagSummary.map((row) => row.tag);
    return { names, suggestions: names.length === 0 ? suggestedTags(partners?.p1, partners?.p2) : [], sideLabels: SIDE_LABELS(partners?.p1, partners?.p2) };
  }, [tagSummary, partners?.p1, partners?.p2]);
  const canTag = Boolean(tagContext && actions.setTags);
  const canLimit = Boolean(limits && actions.setMaxCompanions);
  const sendable = sendableGuests(selected);
  function toggle(id: string) {
    setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function stopSelecting() { setSelecting(false); setPicked(new Set()); setWide(null); }
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) stopSelecting(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting]);
  async function moveSelected(ids: string[], name: string): Promise<string | null> {
    if (!actions.setGroup) return "No se puede mover ahora.";
    const result = await actions.setGroup(ids, name);
    if (!result.ok) return result.error;
    toast(`${plural(result.moved, "invitado", "invitados")} ${name ? `en «${name}»` : "sin grupo"}${result.missing ? ` · ${plural(result.missing, "ya no estaba", "ya no estaban")} en la lista` : ""}`);
    close();
    stopSelecting();
    return null;
  }
  /** «Etiquetar…»: etiquetas que añadir/quitar y, si se elige, el lado de todos. */
  async function tagSelected(ids: string[], change: { add: string[]; remove: string[]; side: SideChoice; limit: CompanionLimitChoice }): Promise<string | null> {
    const parts: string[] = [];
    if ((change.add.length > 0 || change.remove.length > 0) && actions.setTags) {
      const result = await actions.setTags(ids, { add: change.add, remove: change.remove });
      if (!result.ok) return result.error;
      parts.push(result.changed === 0 ? "Ya tenían esas etiquetas" : `${plural(result.changed, "invitado etiquetado", "invitados etiquetados")}`);
    }
    if (change.side !== "keep" && actions.setSide) {
      const result = await actions.setSide(ids, change.side);
      if (!result.ok) return parts.length ? `${parts.join(" · ")}, pero el lado no se ha guardado: ${result.error}` : result.error;
      parts.push(change.side && tagContext ? `${tagContext.sideLabels[change.side]}: ${formatCount(result.moved)}` : `Sin lado: ${formatCount(result.moved)}`);
    }
    if (change.limit !== "keep" && actions.setMaxCompanions) {
      const result = await actions.setMaxCompanions(ids, change.limit);
      if (!result.ok) return parts.length ? `${parts.join(" · ")}, pero el tope de acompañantes no se ha guardado: ${result.error}` : result.error;
      parts.push(`${change.limit === null ? "Sin límite de acompañantes" : change.limit === 0 ? "Sin acompañantes" : `Hasta ${change.limit} acompañante${change.limit === 1 ? "" : "s"}`}: ${formatCount(result.moved)}`);
    }
    toast(parts.join(" · ") || "Nada que cambiar");
    close();
    stopSelecting();
    return null;
  }
  /**
   * «Marcar enviadas»: solo quien tiene su enlace creado y sin envío
   * confirmado. Es una declaración de la pareja (WhatsApp no acredita
   * entrega): se pregunta antes y se guarda una a una con confirmSent.
   */
  function markSelectedSent() {
    const list = sendable;
    if (list.length === 0) return;
    if (!window.confirm(`¿Marcar como enviada la invitación de ${plural(list.length, "persona", "personas")}? Hacedlo solo si ya se la habéis mandado vosotros.`)) return;
    startBulk(async () => {
      let done = 0;
      for (const guest of list) {
        try { const result = await actions.confirmSent(guest.id); if (result.ok) done += 1; } catch { /* se cuenta abajo */ }
      }
      const failed = list.length - done;
      toast(failed === 0 ? `${plural(done, "invitación marcada", "invitaciones marcadas")} como enviada${done === 1 ? "" : "s"}` : `${formatCount(done)} de ${formatCount(list.length)} marcadas. ${plural(failed, "no se ha podido guardar", "no se han podido guardar")}: probad de nuevo.`);
      if (failed === 0) stopSelecting();
    });
  }
  /**
   * «Marcar asistencia…»: la misma respuesta para todos los elegidos.
   */
  async function statusSelected(ids: string[], status: RsvpStatus): Promise<string | null> {
    if (!actions.setStatus) return "No se puede cambiar ahora.";
    const result = await actions.setStatus(ids, status);
    if (!result.ok) return result.error;
    toast(statusDoneText(status, result.changed, result.missing));
    setSheet({ kind: "closed" });
    stopSelecting();
    return null;
  }
  /**
   * «Borrar (n)» confirmado: la lista los oculta al momento y el borrado
   * (deleteGuests, sin inversa) espera a que se cierre el aviso; «Deshacer»
   * los devuelve sin haber tocado el servidor. Si sigue pendiente, se guarda
   * al ocultar la pestaña, al salir de la página o al desmontar la lista.
   */
  const deleteCommits = useRef(new Set<() => void>());
  useEffect(() => {
    const commits = deleteCommits.current;
    return () => { for (const commit of Array.from(commits)) commit(); };
  }, []);
  const deleteSeq = useRef(0);
  function deleteSelected(ids: string[]) {
    if (!actions.removeMany || ids.length === 0) return;
    const removeMany = actions.removeMany;
    const toastId = `borrar-${(deleteSeq.current += 1)}`;
    const unhide = () => setHidden((current) => { const next = new Set(current); for (const id of ids) next.delete(id); return next; });
    let settled = false;
    const release = () => { settled = true; pendingCommits.delete(commit); deleteCommits.current.delete(commit); };
    const finish = () => setDeleting((count) => Math.max(0, count - ids.length));
    function commit() {
      if (settled) return;
      release();
      toast.dismiss(toastId);
      void removeMany(ids).then((result) => {
        finish();
        if (!result.ok) { unhide(); toast(result.error); return; }
        toast(deleteDoneText(result.deleted, result.missing));
      }, () => { finish(); unhide(); toast("No se ha borrado a nadie. Comprobad la conexión y probad de nuevo."); });
    }
    const undo = () => { if (settled) return; release(); finish(); unhide(); toast("No se ha borrado a nadie."); };
    setHidden((current) => new Set([...current, ...ids]));
    setDeleting((count) => count + ids.length);
    setSheet({ kind: "closed" });
    stopSelecting();
    pendingCommits.add(commit);
    deleteCommits.current.add(commit);
    toast(deletePendingText(ids.length), {
      id: toastId,
      duration: DELETE_UNDO_MS,
      action: { label: "Deshacer", onClick: undo },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }
  /**
   * Borrar a quien es el único que regala borra ese regalo (cascada en SQL);
   * si lo regaló con otros, el regalo se queda con ellos. Se dice antes.
   */
  function giftDeleteWarning(guest: GuestRow): string | undefined {
    const own = giftList ? giftsForGuest(giftList, guest.id) : null;
    const count = own ? own.length : guest.crm?.giftCount ?? 0;
    if (count === 0) return undefined;
    const solo = own ? own.filter((gift) => gift.givers.length <= 1).length : count;
    const shared = count - solo;
    const parts = [
      solo > 0 ? (solo === 1 ? "También se borrará el regalo que le habéis anotado." : `También se borrarán los ${solo} regalos que le habéis anotado.`) : "",
      shared > 0 ? (shared === 1 ? "El regalo que hizo con otras personas se queda con ellas." : `Los ${shared} regalos que hizo con otras personas se quedan con ellas.`) : "",
    ];
    return parts.filter(Boolean).join(" ");
  }
  /** Sección «Regalo» de la hoja, arriba (`top`) solo si tiene algo por agradecer. */
  function giftSection(guest: GuestRow, top: boolean) {
    if (!giftsEnabled || !actions.gifts) return null;
    if (giftList === null) {
      return top ? null : <p className="pn-note pn-note--warn mt-6">No hemos podido cargar los regalos. Actualizad la página para anotarlos.</p>;
    }
    const { gifts: own, state } = giftFor(guest);
    // Arriba o abajo se decide al abrir la hoja: si cambiara al agradecer, la sección se volvería a montar.
    const first = shown.kind === "edit" && Boolean(shown.giftsFirst);
    if (first !== top) return null;
    return (
      <GuestGifts
        key={`g-${guest.id}`}
        guest={{ id: guest.id, name: guest.name, phone: guest.phone }}
        gifts={own ?? []}
        giftState={state}
        directory={people}
        searchDirectory={actions.searchGuests}
        actions={actions.gifts}
        thanks={thanksMessage ?? { template: null, context: invitationMessage?.context ?? { novios: "", fecha: "" } }}
        store={store}
        first={top}
        saveTemplate={actions.saveTemplate}
      />
    );
  }
  const editing = shown.kind === "edit" ? shown.guest : null;
  const linkFirst = shown.kind === "edit" && Boolean(shown.linkFirst);
  const title = shown.kind === "edit" ? shown.guest.name : shown.kind === "bulk" ? (shown.rows ? "Revisad los contactos" : "Añadir varios invitados") : shown.kind === "group" ? "Mover a grupo" : shown.kind === "tag" ? (tagContext ? (canLimit ? "Etiquetas, lado y acompañantes" : "Etiquetar y lado") : "Acompañantes máximos") : shown.kind === "tags-admin" ? "Vuestras etiquetas" : shown.kind === "excel" ? "Importar desde Excel" : shown.kind === "delete" ? "Borrar invitados" : shown.kind === "status" ? "Marcar asistencia" : "Nuevo invitado";
  const groupList = groups ? [...groups] : undefined;
  // El grupo común de los elegidos (si lo comparten) sale ya escrito en «Mover a grupo…».
  const sharedGroup = selected.length > 0 && selected.every((guest) => (guest.group_name ?? null) === (selected[0].group_name ?? null)) ? selected[0].group_name ?? "" : "";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="pn-list-tools">
        {toolbar}
        {bulkActions && picker && (
          <button type="button" onClick={importContacts} className="pn-act pn-tools-first pn-press">
            <ContactIcon aria-hidden="true" className="size-4" />Importar contactos
          </button>
        )}
        {bulkActions && (
          <button type="button" onClick={() => setSheet({ kind: "bulk", rows: null })} className="pn-act pn-tools-first pn-press">
            <ListPlusIcon aria-hidden="true" className="size-4" />Añadir varios
          </button>
        )}
        {excelActions && (
          <button type="button" onClick={() => setSheet({ kind: "excel" })} className="pn-act pn-tools-first pn-press">
            <FileSpreadsheetIcon aria-hidden="true" className="size-4" />Importar Excel
          </button>
        )}
        {guests.length > 0 && !table && (
          <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting} className="pn-act pn-tools-first pn-press">
            <ListChecksIcon aria-hidden="true" className="size-4" />{selecting ? "Terminar" : "Seleccionar"}
          </button>
        )}
        {actions.renameTag && tagSummary && tagSummary.length > 0 && (
          <button type="button" onClick={() => setSheet({ kind: "tags-admin" })} className="pn-act pn-tools-first pn-press">
            <TagsIcon aria-hidden="true" className="size-4" />Gestionar etiquetas
          </button>
        )}
        <button type="button" onClick={() => setSheet({ kind: "add" })} className="pn-btn pn-btn--clay pn-press pn-desktop-only">
          <PlusIcon aria-hidden="true" className="size-4" />Añadir invitado
        </button>
      </div>
      {guests.length === 0 && deleting > 0 ? (
        <p className="pn-help" aria-live="polite">{deletePendingText(deleting)}</p>
      ) : guests.length === 0 ? (
        <EmptyList filter={filter} query={query} group={group} tagged={tag ?? (sideFiltered ? "este lado" : null)} clearHref={clearHref} onAdd={() => setSheet({ kind: "add" })} onBulk={bulkActions ? () => setSheet({ kind: "bulk", rows: null }) : undefined} onExcel={excelActions ? () => setSheet({ kind: "excel" }) : undefined} />
      ) : table ? (
        <GuestTable guests={guests} sideLabels={tagContext?.sideLabels} onEdit={(guest) => setSheet({ kind: "edit", guest })} />
      ) : (
        <div>
          {selecting && (
            <div className="pn-select-head">
              <p className="pn-help" aria-live="polite">{selected.length > 0 ? `${plural(selected.length, "elegido", "elegidos")} de ${formatCount(visibleWide ? visibleWide.size : guests.length)}` : "Tocad a las personas que queráis mover o marcar."}</p>
              <div className="pn-select-head-actions">
                {allWide ? (
                  <button type="button" className="pn-link pn-press" onClick={() => { setPicked(new Set()); setWide(null); }}>Quitar todos</button>
                ) : (
                  <button type="button" className="pn-link pn-press" onClick={() => setPicked(allPage && selected.length === guests.length ? new Set() : new Set(guests.map((guest) => guest.id)))}>
                    {allPage && selected.length === guests.length ? "Quitar todos" : `Elegir los ${formatCount(guests.length)}`}
                  </button>
                )}
                {canPickWide && !allWide && (filterTotal <= MAX_GUEST_BULK ? (
                  <button type="button" className="pn-link pn-press" disabled={wideLoading} onClick={() => void pickWide()}>
                    {wideLoading ? "Cargando…" : `Elegir los ${formatCount(filterTotal)} ${filter === "todos" && !query && group.kind === "all" && !tag && !side ? "de la lista" : "del filtro"}`}
                  </button>
                ) : (
                  <span className="pn-help">Para elegir a más de {formatCount(MAX_GUEST_BULK)} a la vez, afinad el filtro.</span>
                ))}
              </div>
            </div>
          )}
          <ul className="pn-list pn-guests" data-selecting={selecting ? "true" : undefined} data-selbar-rows={selecting && (actions.setStatus || actions.removeMany) ? "2" : undefined}>
            {guests.map((guest) => <GuestItem key={guest.id} guest={guest} actions={actions} message={invitationMessage} gift={giftsEnabled || guest.crm ? giftFor(guest) : undefined} select={selecting ? { checked: picked.has(guest.id), toggle: () => toggle(guest.id) } : undefined} onLink={() => setSheet({ kind: "edit", guest, linkFirst: true })} onEdit={() => setSheet({ kind: "edit", guest, giftsFirst: (giftFor(guest).gifts ?? []).some((gift) => !gift.thankedAt) || (!giftList && Boolean(guest.crm?.giftUnthanked)) })} />)}
          </ul>
          {!selecting && <p className="pn-swipe-hint">Deslizad una fila hacia la izquierda para ver todas sus acciones.</p>}
        </div>
      )}

      {selecting ? (
        <div className="pn-selbar" role="region" aria-label="Acciones con los elegidos">
          <div className="pn-selbar-main">
          <span className="pn-selbar-count pn-tnum">{formatCount(selected.length)}<span className="pn-wide-only"> {selected.length === 1 ? "elegido" : "elegidos"}</span></span>
          {canMove && (
            <button type="button" disabled={selected.length === 0 || bulkPending} onClick={() => setSheet({ kind: "group", ids: selected.map((guest) => guest.id) })} className="pn-btn pn-btn--sm pn-press">
              <FolderInputIcon aria-hidden="true" className="size-4" /><span className="pn-wide-only">Mover a grupo…</span><span aria-hidden="true" className="sm:hidden">Grupo…</span>
            </button>
          )}
          {(canTag || canLimit) && (
            <button type="button" disabled={selected.length === 0 || bulkPending} onClick={() => setSheet({ kind: "tag", ids: selected.map((guest) => guest.id) })} className="pn-btn pn-btn--sm pn-press">
              <TagIcon aria-hidden="true" className="size-4" />{canTag ? "Etiquetar…" : <><span className="pn-wide-only">Acompañantes máximos…</span><span aria-hidden="true" className="sm:hidden">Acompañantes…</span></>}
            </button>
          )}
          <button type="button" disabled={sendable.length === 0 || bulkPending} onClick={markSelectedSent} className="pn-btn pn-btn--ghost pn-btn--sm pn-press"
            title={selected.length > 0 && sendable.length === 0 ? "Solo se marcan quienes tienen su enlace creado y sin envío confirmado" : undefined}>
            <SendIcon aria-hidden="true" className="size-4" />{bulkPending ? "Guardando…" : <><span className={canTag ? "pn-wide-only" : undefined}>Marcar enviada{sendable.length === 1 ? "" : "s"}</span>{canTag && <span aria-hidden="true" className="sm:hidden">Enviada{sendable.length === 1 ? "" : "s"}</span>}{sendable.length > 0 ? ` (${formatCount(sendable.length)})` : ""}</>}
          </button>
          <button type="button" onClick={stopSelecting} className="pn-selbar-close pn-press" aria-label="Terminar la selección">
            <XIcon aria-hidden="true" className="size-5" />
          </button>
          </div>
          {(actions.setStatus || actions.removeMany) && (
            <div className="pn-selbar-more">
              {actions.setStatus && (
                <button type="button" disabled={selected.length === 0 || bulkPending} onClick={() => setSheet({ kind: "status", ids: selected.map((guest) => guest.id) })} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">
                  <UserCheckIcon aria-hidden="true" className="size-4" />Asistencia…
                </button>
              )}
              {actions.removeMany && (
                <button type="button" disabled={selected.length === 0 || bulkPending} onClick={() => setSheet({ kind: "delete", ids: selected.map((guest) => guest.id) })} className="pn-btn pn-btn--danger pn-btn--sm pn-press">
                  <Trash2Icon aria-hidden="true" className="size-4" />Borrar{selected.length > 0 ? ` (${formatCount(selected.length)})` : ""}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setSheet({ kind: "add" })} className="pn-fab pn-fab--clay pn-press" aria-label="Añadir invitado">
          <PlusIcon aria-hidden="true" className="size-5" />Añadir
        </button>
      )}

      <GuestSheet open={sheet.kind !== "closed"} onClose={close} confirmClose={shown.kind === "edit"} title={title} wide={shown.kind === "bulk" || shown.kind === "excel"}>
        {shown.kind === "excel" && excelActions ? (
          <GuestExcelImport actions={excelActions} partners={partners} initialSheets={excelInitialSheets} tablesHref={tablesHref}
            onDone={(count) => { if (count > 0) toast(plural(count, "invitación importada", "invitaciones importadas")); close(); }} />
        ) : shown.kind === "bulk" && bulkActions ? (
          <GuestBulkImport
            key={shown.rows ? "contactos" : "pegar"}
            actions={bulkActions}
            groups={groupList}
            initialGroup={group.kind === "named" ? group.name : ""}
            tags={tagContext}
            initialTags={tag && tagContext ? [tag] : []}
            initialRows={shown.rows}
            initialText={bulkInitialText}
            onDone={(created, finished) => {
              if (created > 0) toast(plural(created, "invitado añadido a la lista", "invitados añadidos a la lista"));
              if (finished) close();
            }}
          />
        ) : shown.kind === "delete" ? (
          <DeleteSelected key={shown.ids.join(",")} ids={shown.ids} preview={actions.previewRemove} onConfirm={() => deleteSelected(shown.ids)} onCancel={() => setSheet({ kind: "closed" })} />
        ) : shown.kind === "status" && actions.setStatus ? (
          <StatusSelected key={shown.ids.join(",")} count={shown.ids.length} onSave={(status) => statusSelected(shown.ids, status)} />
        ) : shown.kind === "group" ? (
          <MoveToGroup key={shown.ids.join(",")} count={shown.ids.length} groups={groupList ?? []} initial={sharedGroup} onMove={(name) => moveSelected(shown.ids, name)} />
        ) : shown.kind === "tag" && (tagContext || canLimit) ? (
          <TagSelected key={shown.ids.join(",")} count={shown.ids.length} tags={canTag ? tagContext : undefined} canSide={Boolean(actions.setSide)} canLimit={canLimit}
            present={presentTags(selectedGuests(new Set(shown.ids), guests, visibleWide))}
            onSave={(change) => tagSelected(shown.ids, change)} />
        ) : shown.kind === "tags-admin" && actions.renameTag ? (
          <TagManager summary={tagSummary ?? []} onRename={async (from, to) => {
            const result = await actions.renameTag!(from, to);
            if (!result.ok) return result.error;
            toast(to ? `«${from}» ahora es «${to}» (${plural(result.changed, "invitado", "invitados")})` : `«${from}» quitada a ${plural(result.changed, "invitado", "invitados")}`);
            return null;
          }} />
        ) : editing ? (
          <>
            {/* Llegó por «Enlace nuevo» desde la fila: el enlace va primero. */}
            {linkFirst && <GuestLinkSection key={`l-${editing.id}`} guest={editing} actions={actions} message={invitationMessage} first />}
            {/* Regalo por agradecer: es lo que ha venido a hacer. Si no, va tras los datos. */}
            {!linkFirst && giftSection(editing, true)}
            {/* Esperando respuesta: los recordatorios son lo primero que importa; si no, al final. */}
            {editing.rsvp_status === "pendiente" && editing.invitation_sent_at !== null && <ReminderSettings key={`r-${editing.id}`} guest={editing} actions={actions} first />}
            <GuestEditor
              key={editing.id}
              label="Guardar cambios"
              initial={{ name: editing.name, phone: editing.phone ?? "", status: editing.rsvp_status, companions: editing.rsvp_companions, notes: editing.rsvp_notes ?? "", group: editing.group_name ?? "", tags: editing.tags ?? [], side: editing.side ?? null, maxCompanions: editing.max_companions ?? null }}
              groups={groupList}
              tags={tagContext}
              limits={Boolean(limits) && editing.max_companions !== undefined}
              onSave={async (value) => { if (!await flushExtras()) return { ok: false, error: "Revisad los acompañantes antes de guardar." }; const result = await actions.update(editing.id, value); if (result.ok) await close(); return result; }}
              onDelete={async () => { const result = await actions.remove(editing.id); if (result.ok) setSheet({ kind: "closed" }); return result; }}
              deleteWarning={giftDeleteWarning(editing)}
            />
            <GuestImportedFields fields={editing.extra_fields} />
            {actions.extras && <GuestExtras key={`x-${editing.id}`} guest={{ id: editing.id, name: editing.name, companions: editing.rsvp_companions, status: editing.rsvp_status }} actions={actions.extras} registerFlush={registerExtrasFlush} />}
            {giftSection(editing, false)}
            {!linkFirst && <GuestLinkSection key={`l-${editing.id}`} guest={editing} actions={actions} message={invitationMessage} />}
            {!(editing.rsvp_status === "pendiente" && editing.invitation_sent_at !== null) && <ReminderSettings key={`r-${editing.id}`} guest={editing} actions={actions} />}
          </>
        ) : (
          <GuestEditor key="new" label="Añadir a la lista" groups={groupList} tags={tagContext} limits={Boolean(limits)} initial={{ ...empty, ...(group.kind === "named" ? { group: group.name } : {}), ...(tag && tagContext ? { tags: [tag] } : {}) }}
            onSave={async (value) => { const result = await actions.add(value); if (result.ok) close(); return result; }} />
        )}
      </GuestSheet>
    </div>
  );
}
