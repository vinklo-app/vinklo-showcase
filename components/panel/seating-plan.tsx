"use client";

/**
 * Plan de mesas (2026-10-06). Tarjetas de mesa con ocupación y barra, bandeja
 * «Sin mesa» filtrable por grupo, y dos formas de sentar a alguien:
 *  - Arrastrar y soltar con ratón o lápiz (Pointer Events, sin librerías).
 *    El tacto NO arrastra: en el móvil el gesto es desplazar la página.
 *  - «Mover a…» en cada persona: un <select> nativo (teclado, lector de
 *    pantalla y móvil). Arrastrar nunca es la única vía.
 * Optimista: el cambio se ve al instante y se deshace si el servidor falla.
 * Las acciones llegan por props (servidor real o borrador sin base de datos).
 *
 * Mesas con IA (9-oct-2026): aviso proactivo con «Ver propuesta»
 * (seating-notice), plano del salón leído de una foto (floor-plan) y
 * acciones de mesa entera (table-actions). Todo cambio de varias personas se
 * aplica de una vez (apply_seating) y se deshace con el mismo «Deshacer».
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, ArmchairIcon, DownloadIcon, MapIcon, PlusIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";
import { EmptyState } from "@/components/panel/page-head";
import { GuestSheet } from "@/components/panel/guest-sheet";
import { AutoSeatPanel, type ExplainAction } from "@/components/panel/auto-seat";
import { FloorPlanMap, FloorPlanPanel, mapTablesOf } from "@/components/panel/floor-plan";
import { SeatingNotice } from "@/components/panel/seating-notice";
import { TableActionsPanel } from "@/components/panel/table-actions";
import type { FloorPlanReading, FloorSaveRow, SavedFloorTable } from "@/lib/crm/floor-plan";
import { applyChangeLocal, previousAssignments, type SeatingChange } from "@/lib/crm/table-ops";
import type { AutoSeatResult } from "@/lib/crm/auto-seating";
import { excelTablesProposal } from "@/lib/crm/excel-tables";
import "@/components/panel/seating.css";
import "@/components/panel/companions.css";
import { formatCount, initials, plural } from "@/components/panel/guest-status";
import {
  TABLE_NAME_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, TABLE_SEATS_MIN,
  buildSeatingCsv, filterUnseated, findGuestTable, groupToSeat, hasLayout, hasSeatingRules, moveGuests,
  nextTableName, normalizeTableName, removeTable, seatCompanions, seatedAttending, seatedDeclined, tableOccupancy, unseatedAttending, unseatedGroups,
  type FoundPerson, type SeatAssignment, type SeatTable, type SeatVisitor, type SeatingPlan,
} from "@/lib/crm/seating";
import { useSeatDrag } from "@/components/panel/seating-plan/use-seat-drag";
import { TableCard } from "@/components/panel/seating-plan/table-card";
import { PersonFinder } from "@/components/panel/seating-plan/person-finder";
import { UnseatedTray } from "@/components/panel/seating-plan/unseated-tray";
import { ExcelTablesNotice } from "@/components/panel/seating-plan/excel-tables-notice";
import { DeclinedSeatedNotice } from "@/components/panel/seating-plan/declined-seated-notice";

export type { SeatAssignment } from "@/lib/crm/seating";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface SeatingActions {
  create(input: { name: string; seats: number }): Promise<Result<{ id: string }>>;
  rename(tableId: string, name: string): Promise<Result>;
  setSeats(tableId: string, seats: number): Promise<Result>;
  remove(tableId: string): Promise<Result>;
  seat(guestIds: string[], tableId: string | null): Promise<Result<{ moved: number; missing: number }>>;
  /**
   * «Sentar automáticamente» y su «Deshacer» (applySeating, todo o nada).
   * Sin ella no se ofrece el botón.
   */
  apply?(newTables: Array<{ key: string; name: string; seats: number }>, assignments: SeatAssignment[]): Promise<Result<{ created: Array<{ key: string; id: string }>; seated: number }>>;
  /** «Mesa fija para…» (setTablePinnedGroup); sin ella, o sin la migración, no se ofrece. */
  setPinnedGroup?(tableId: string, group: string | null): Promise<Result>;
  /** Frases de la IA para la vista previa (sin ella, solo la plantilla). */
  explain?: ExplainAction;
  /** Leer la foto del plano del salón (IA). Sin ella (y sin saveFloorPlan) no se ofrece el plano. */
  readFloorPlan?(form: FormData): Promise<Result<{ reading: FloorPlanReading }>>;
  /** Guardar las mesas revisadas del plano (save_floor_plan). */
  saveFloorPlan?(rows: FloorSaveRow[]): Promise<Result<{ tables: SavedFloorTable[] }>>;
}

/** Lo necesario para deshacer el último cambio aplicado (propuesta o acción de mesa). */
interface AppliedProposal { previous: SeatAssignment[]; created: string[]; /** Frase del aviso «Habéis aplicado…». */ text: string }
const UNDO_TOAST_MS = 30_000;

// ---------------------------------------------------------------- plan

export function SeatingPlanView({ initial, actions, listHref = "/panel/invitados", weddingKey, partners, openProposal = false, initialFloorReading, excelTables }: {
  initial: SeatingPlan; actions: SeatingActions; listHref?: string;
  /** Columna Mesa del Excel de quienes no tienen mesa (id → valor): ofrece «Crear N mesas y sentar según vuestro Excel». */
  excelTables?: Readonly<Record<string, string>>;
  /** Id de la boda: recuerda en este dispositivo qué avisos proactivos se han visto. Sin él, no hay aviso. */
  weddingKey?: string;
  /** Nombres de la pareja (lado «de Lucía» en las explicaciones; nunca van a la IA). */
  partners?: { p1: string; p2: string };
  /** `?propuesta=1` (desde el resumen): abrir ya la propuesta. */
  openProposal?: boolean;
  /** Solo el borrador: abrir el plano con una lectura de muestra. */
  initialFloorReading?: FloorPlanReading;
}) {
  const [plan, setPlan] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState("");
  const [group, setGroup] = useState<string | null | "all">("all");
  const [showDeclined, setShowDeclined] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSeats, setNewSeats] = useState(TABLE_SEATS_DEFAULT);
  // El servidor manda: cada revalidación trae el plan real. Solo se sustituye
  // si el contenido cambió (un re-render con el mismo plan no pisa lo optimista).
  const serverSignature = useMemo(() => JSON.stringify(initial), [initial]);
  const lastSignature = useRef(serverSignature);
  useEffect(() => {
    if (serverSignature === lastSignature.current) return;
    lastSignature.current = serverSignature;
    setPlan(initial);
  }, [serverSignature, initial]);
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);
  const [autoOpen, setAutoOpen] = useState(openProposal && Boolean(actions.apply));
  const [autoPropose, setAutoPropose] = useState(openProposal);
  // Con el aviso de propuesta a la vista, su «Ver propuesta» es el primario: «Sentar automáticamente» pasa a secundario (revisión Jobs #13).
  const [noticeShown, setNoticeShown] = useState(false);
  const [floorOpen, setFloorOpen] = useState(Boolean(initialFloorReading));
  const [opsTable, setOpsTable] = useState<string | null>(null);
  // `?propuesta=1` abre la propuesta una vez: fuera de la URL para que recargar no la reabra.
  useEffect(() => {
    if (!openProposal) return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("propuesta")) return;
      url.searchParams.delete("propuesta");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* sin History API: se queda el parámetro */ }
  }, [openProposal]);
  const [applied, setApplied] = useState<AppliedProposal | null>(null);
  const [autoPending, setAutoPending] = useState(false);
  const appliedRef = useRef<AppliedProposal | null>(null);
  useEffect(() => { appliedRef.current = applied; }, [applied]);

  // «¿Dónde está…?»: mesa (o «Sin mesa», null) y persona resaltadas durante unos segundos.
  const [found, setFound] = useState<{ tableId: string | null; id: string; guestId: string; seq: number } | null>(null);
  useEffect(() => {
    if (!found) return;
    const timer = window.setTimeout(() => setFound(null), 4000);
    return () => window.clearTimeout(timer);
  }, [found]);
  function locate(person: FoundPerson) {
    const where = person.tableId ? plan.tables.find((table) => table.id === person.tableId)?.name ?? "su mesa" : "Sin mesa";
    if (!person.tableId) {
      // Que la bandeja lo muestre: sin filtro de grupo y, si no viene, con «Ver también a quien no viene».
      setGroup("all");
      if (person.rsvp_status === "no") setShowDeclined(true);
    }
    setFound((current) => ({ tableId: person.tableId, id: person.id, guestId: person.guestId, seq: (current?.seq ?? 0) + 1 }));
    setAnnounce(`${person.name}: ${where}.`);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = person.tableId
        ? document.querySelector(`[data-drop-table="${CSS.escape(person.tableId)}"]`)
        : document.querySelector(`.pn-seat-tray [data-seat-guest="${CSS.escape(person.guestId)}"]`);
      target?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    }));
  }

  // Sentados que han respondido que no vienen: no ocupan plaza, pero siguen en la mesa.
  const declinedSeated = useMemo(() => seatedDeclined(plan), [plan]);
  const [askDeclined, setAskDeclined] = useState(false);
  async function removeDeclined() {
    const ids = declinedSeated.map((guest) => guest.id);
    setAskDeclined(false);
    if (ids.length === 0) return;
    const text = `${plural(ids.length, "invitado que no viene", "invitados que no vienen")}, fuera de sus mesas.`;
    if (!actions.apply) { move(ids, null, text); toast(text); return; }
    await applyChange({ newTables: [], assignments: ids.map((guestId) => ({ guestId, tableId: null })), people: 0, summary: text }, () => ({ toast: text, banner: `Último cambio: ${text}` }));
  }

  // «Crear N mesas y sentar según vuestro Excel»: solo quien sigue sin mesa; se deshace como el resto.
  const excelMap = useMemo(() => new Map(Object.entries(excelTables ?? {})), [excelTables]);
  const excelProposal = useMemo(() => (actions.apply && excelMap.size > 0 ? excelTablesProposal(plan, excelMap) : null), [actions.apply, excelMap, plan]);
  const [excelDismissed, setExcelDismissed] = useState(false);
  async function seatFromExcel() {
    if (!excelProposal) return;
    const { change, guests } = excelProposal;
    await applyChange(change, (tablesUsed) => {
      const text = `Según vuestro Excel: ${plural(guests, "invitado sentado", "invitados sentados")} en ${plural(tablesUsed, "mesa", "mesas")}.`;
      return { toast: text, banner: `Último cambio: ${text}` };
    });
  }

  const groups = useMemo(() => unseatedGroups(plan), [plan]);
  /** Con la migración 20261023110000: nombres, mesa infantil y mesa fija. */
  const rules = hasSeatingRules(plan);
  const allGroups = useMemo(() => {
    const names = new Set<string>();
    for (const guest of [...plan.tables.flatMap((table) => table.guests), ...plan.unseated]) if (guest.group_name) names.add(guest.group_name);
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [plan]);
  const hasUngrouped = plan.unseated.some((guest) => !guest.group_name && guest.rsvp_status !== "no");
  const tray = useMemo(() => filterUnseated(plan.unseated, { group, showDeclined }), [plan.unseated, group, showDeclined]);
  const declinedUnseated = plan.unseated.filter((guest) => guest.rsvp_status === "no").length;
  const waiting = unseatedAttending(plan);
  const seated = seatedAttending(plan);
  const overTables = plan.tables.filter((table) => tableOccupancy(table).over).length;
  const tableName = (id: string | null) => (id ? plan.tables.find((table) => table.id === id)?.name ?? "la mesa" : "Sin mesa");

  const move = useCallback((ids: string[], tableId: string | null, label: string) => {
    const before = planRef.current;
    if (ids.length === 0) return;
    const after = moveGuests(before, ids, tableId);
    setPlan(after);
    setAnnounce(label);
    startTransition(async () => {
      const result = await actions.seat(ids, tableId);
      if (!result.ok) { setPlan(before); toast(result.error); setAnnounce(result.error); return; }
      if (result.missing > 0) toast(`${plural(result.missing, "invitado ya no estaba", "invitados ya no estaban")} en la lista.`);
    });
  }, [actions]);

  const moveOne = useCallback((guestId: string, tableId: string | null) => {
    const guest = [...planRef.current.unseated, ...planRef.current.tables.flatMap((table) => table.guests)].find((item) => item.id === guestId);
    if (!guest || findGuestTable(planRef.current, guestId) === tableId) return;
    const target = tableId ? planRef.current.tables.find((table) => table.id === tableId)?.name ?? "la mesa" : "Sin mesa";
    move([guestId], tableId, `${guest.name}, a ${target}.`);
  }, [move]);

  const { drag, over, ghost, bind } = useSeatDrag(moveOne);

  function seatGroup(groupName: string, tableId: string) {
    const ids = groupToSeat(planRef.current, groupName);
    if (ids.length === 0) return;
    move(ids, tableId, `${plural(ids.length, "invitado", "invitados")} de «${groupName}», a ${tableName(tableId)}.`);
    toast(`«${groupName}» sentado en ${tableName(tableId)}.`);
  }

  async function addTable(event?: FormEvent, preset?: { name: string; seats: number }) {
    event?.preventDefault();
    const name = preset?.name ?? normalizeTableName(newName) ?? nextTableName(planRef.current.tables);
    const seats = preset?.seats ?? newSeats;
    const result = await actions.create({ name, seats });
    if (!result.ok) { toast(result.error); return false; }
    setPlan((current) => ({ ...current, tables: [...current.tables, { id: result.id, name, seats, position: (current.tables.at(-1)?.position ?? 0) + 1, guests: [] }] }));
    setNewName("");
    setAnnounce(`${name} creada.`);
    return true;
  }

  async function createSuggested(count: number) {
    for (let i = 0; i < count; i += 1) {
      if (!(await addTable(undefined, { name: nextTableName(planRef.current.tables), seats: TABLE_SEATS_DEFAULT }))) break;
    }
  }

  async function rename(table: SeatTable, name: string) {
    const result = await actions.rename(table.id, name);
    if (!result.ok) { toast(result.error); return false; }
    setPlan((current) => ({ ...current, tables: current.tables.map((item) => (item.id === table.id ? { ...item, name } : item)) }));
    return true;
  }

  function changeSeats(table: SeatTable, seats: number) {
    if (seats < TABLE_SEATS_MIN || seats > TABLE_SEATS_MAX) return;
    const before = planRef.current;
    setPlan((current) => ({ ...current, tables: current.tables.map((item) => (item.id === table.id ? { ...item, seats } : item)) }));
    startTransition(async () => {
      const result = await actions.setSeats(table.id, seats);
      if (!result.ok) { setPlan(before); toast(result.error); }
    });
  }

  function deleteTable(table: SeatTable) {
    const before = planRef.current;
    setPlan(removeTable(before, table.id));
    setAnnounce(`${table.name} borrada.`);
    startTransition(async () => {
      const result = await actions.remove(table.id);
      if (!result.ok) { setPlan(before); toast(result.error); }
    });
  }

  /** «Con su familia»: el acompañante deja la mesa infantil y vuelve a la de su invitado. */
  function companionHome(visitor: SeatVisitor) {
    if (!actions.apply) return;
    const apply = actions.apply;
    const before = planRef.current;
    setPlan(seatCompanions(before, [{ companionId: visitor.id, tableId: null }]));
    setAnnounce(`${visitor.name}, con ${visitor.guestName}.`);
    startTransition(async () => {
      const result = await apply([], [{ companionId: visitor.id, tableId: null }]);
      if (!result.ok) { setPlan(before); toast(result.error); setAnnounce(result.error); }
    });
  }

  function pinGroup(table: SeatTable, group: string | null) {
    if (!actions.setPinnedGroup) return;
    const setPinned = actions.setPinnedGroup;
    const before = planRef.current;
    setPlan((current) => ({ ...current, tables: current.tables.map((item) => (item.id === table.id ? { ...item, pinned_group: group } : item)) }));
    setAnnounce(group ? `${table.name}: mesa fija para «${group}».` : `${table.name} ya no es mesa fija.`);
    startTransition(async () => {
      const result = await setPinned(table.id, group);
      if (!result.ok) { setPlan(before); toast(result.error); }
    });
  }

  async function undoProposal(record: AppliedProposal) {
    // Solo la última propuesta, y una vez (el aviso y el botón llaman aquí).
    if (!actions.apply || appliedRef.current !== record) return;
    appliedRef.current = null;
    setAutoPending(true);
    try {
      // Primero cada uno vuelve a su mesa de antes; después se borran las mesas creadas.
      const result = record.previous.length > 0 ? await actions.apply([], record.previous) : { ok: true as const, created: [], seated: 0 };
      if (!result.ok) { appliedRef.current = record; toast(result.error); return; }
      let after = applyChangeLocal(planRef.current, { newTables: [], assignments: record.previous }, new Map());
      for (const id of record.created) {
        const removed = await actions.remove(id);
        if (removed.ok) after = removeTable(after, id);
      }
      setPlan(after);
      setApplied(null);
      setAnnounce("Cambio deshecho.");
      toast("Deshecho: cada uno vuelve a donde estaba.");
    } finally { setAutoPending(false); }
  }

  /**
   * Aplica de una vez (apply_seating, todo o nada) una propuesta o una acción
   * de mesa entera y guarda lo necesario para deshacerla.
   */
  async function applyChange(change: SeatingChange, message: (tablesUsed: number) => { toast: string; banner: string }) {
    if (!actions.apply) return false;
    const before = planRef.current;
    const previous = previousAssignments(before, change);
    setAutoPending(true);
    try {
      const response = await actions.apply(change.newTables, change.assignments);
      if (!response.ok) { toast(response.error); return false; }
      const ids = new Map(response.created.map((item) => [item.key, item.id]));
      setPlan(applyChangeLocal(before, change, ids));
      const tablesUsed = new Set(change.assignments.flatMap((item) => (item.tableId ? [ids.get(item.tableId) ?? item.tableId] : []))).size;
      const text = message(tablesUsed);
      const record: AppliedProposal = { previous, created: [...ids.values()], text: text.banner };
      setApplied(record);
      appliedRef.current = record;
      setAnnounce(text.toast);
      toast(text.toast, { duration: UNDO_TOAST_MS, action: { label: "Deshacer", onClick: () => void undoProposal(record) } });
      return true;
    } finally { setAutoPending(false); }
  }

  async function applyProposal(result: AutoSeatResult) {
    const change: SeatingChange = {
      newTables: result.newTables,
      assignments: [...result.assignments, ...result.companionAssignments],
      people: result.seatedPeople,
      summary: "",
    };
    const done = await applyChange(change, (tablesUsed) => ({
      toast: `Hemos sentado a ${plural(result.seatedPeople, "persona", "personas")} en ${plural(tablesUsed, "mesa", "mesas")}.`,
      banner: `Habéis aplicado una propuesta automática (${plural(result.seatedPeople, "persona", "personas")} en ${plural(tablesUsed, "mesa", "mesas")}).`,
    }));
    if (done) { setAutoOpen(false); setAutoPropose(false); }
  }

  async function applyTableChange(change: SeatingChange) {
    const done = await applyChange(change, () => ({ toast: change.summary, banner: `Último cambio: ${change.summary}` }));
    if (done) setOpsTable(null);
  }

  /** Mesas del plano guardadas: las nuevas se añaden y las existentes se actualizan (nadie cambia de mesa). */
  function floorSaved(saved: SavedFloorTable[]) {
    setPlan((current) => {
      const byId = new Map(saved.map((table) => [table.id, table]));
      const lastPosition = current.tables.at(-1)?.position ?? 0;
      const updated = current.tables.map((table) => {
        const item = byId.get(table.id);
        return item ? { ...table, name: item.name, seats: item.seats, shape: item.shape, pos_x: item.x, pos_y: item.y } : table;
      });
      const created = saved.filter((table) => table.created).map((table, index) => ({
        id: table.id, name: table.name, seats: table.seats, position: lastPosition + index + 1, guests: [], visitors: [],
        shape: table.shape, pos_x: table.x, pos_y: table.y,
      }));
      return { ...current, tables: [...updated, ...created] };
    });
    setFloorOpen(false);
    const created = saved.filter((table) => table.created).length;
    const message = `Plano guardado: ${plural(saved.length, "mesa", "mesas")}${created > 0 ? `, ${plural(created, "nueva", "nuevas")}` : ""}.`;
    setAnnounce(message);
    toast(message);
  }

  function exportCsv() {
    const rows = plan.tables.reduce((n, table) => n + table.guests.filter((guest) => guest.rsvp_status !== "no").length, 0)
      + plan.unseated.filter((guest) => guest.rsvp_status !== "no").length;
    if (rows === 0) { toast("Aún no hay nadie que exportar."); return; }
    const blob = new Blob(["﻿" + buildSeatingCsv(plan)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "plan-de-mesas-vinklo.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Descargado: ${plural(rows, "persona", "personas")} en ${plural(plan.tables.length, "mesa", "mesas")}.`);
  }

  const suggested = Math.max(1, Math.ceil((waiting + seated) / TABLE_SEATS_DEFAULT));
  const activeGroup = group !== "all" && group !== null ? group : null;
  const activeGroupIds = activeGroup ? groupToSeat(plan, activeGroup) : [];

  return (
    <div className="pn-seating" data-pending={pending || undefined}>
      <p className="sr-only" aria-live="polite">{announce}</p>

      {/* Cifras y herramientas */}
      <div className="pn-seat-toolbar">
        <dl className="pn-seat-stats">
          <div><dt>Mesas</dt><dd className="pn-num">{formatCount(plan.tables.length)}</dd></div>
          <div><dt>Personas sentadas</dt><dd className="pn-num">{formatCount(seated)}</dd></div>
          <div data-warn={waiting > 0 || undefined}><dt>Vienen sin mesa</dt><dd className="pn-num">{formatCount(waiting)}</dd></div>
        </dl>
        <div className="pn-seat-tools">
          {actions.apply && (
            <button type="button" className={`pn-btn ${noticeShown ? "pn-btn--ghost " : ""}pn-btn--sm pn-press`} onClick={() => setAutoOpen(true)} disabled={autoPending}><SparklesIcon aria-hidden="true" className="size-4" />Sentar automáticamente</button>
          )}
          {actions.readFloorPlan && actions.saveFloorPlan && (
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setFloorOpen(true)}><MapIcon aria-hidden="true" className="size-4" />Plano del salón</button>
          )}
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={exportCsv}><DownloadIcon aria-hidden="true" className="size-4" />Exportar CSV</button>
        </div>
      </div>
      {(plan.tables.length > 0 || plan.unseated.length > 0) && <PersonFinder plan={plan} onPick={locate} />}
      {actions.apply && weddingKey && (
        <SeatingNotice plan={plan} weddingKey={weddingKey} alreadyOpen={openProposal} onVisibilityChange={setNoticeShown} onPropose={() => { setAutoPropose(true); setAutoOpen(true); }} />
      )}
      {applied && (
        <div className="pn-note pn-auto-undo" role="status">
          <span>{applied.text}</span>
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={autoPending} onClick={() => void undoProposal(applied)}>
            <Undo2Icon aria-hidden="true" className="size-4" />{autoPending ? "Deshaciendo…" : "Deshacer"}
          </button>
        </div>
      )}
      {overTables > 0 && (
        <p className="pn-note pn-note--warn" role="status"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4 align-[-0.15em]" />{overTables === 1 ? "Una mesa supera sus plazas: está marcada abajo." : `${formatCount(overTables)} mesas superan sus plazas: están marcadas abajo.`}</p>
      )}
      {excelProposal && !excelDismissed && (
        <ExcelTablesNotice excelProposal={excelProposal} autoPending={autoPending} pending={pending} seatFromExcel={seatFromExcel} setExcelDismissed={setExcelDismissed} />
      )}
      {declinedSeated.length > 0 && (
        <DeclinedSeatedNotice declinedSeated={declinedSeated} askDeclined={askDeclined} setAskDeclined={setAskDeclined} autoPending={autoPending} pending={pending} removeDeclined={removeDeclined} />
      )}

      <div className="pn-seat-layout">
        {/* Bandeja «Sin mesa» */}
        <UnseatedTray plan={plan} tray={tray} waiting={waiting} groups={groups} hasUngrouped={hasUngrouped} group={group} setGroup={setGroup}
          activeGroup={activeGroup} activeGroupIds={activeGroupIds} seatGroup={seatGroup} moveOne={moveOne} bind={bind}
          drag={drag} over={over} found={found} declinedUnseated={declinedUnseated} showDeclined={showDeclined} setShowDeclined={setShowDeclined} />

        {/* Mesas */}
        <div className="pn-seat-main">
          {plan.tables.length === 0 ? (
            <EmptyState icon={ArmchairIcon} title={<>Vuestra primera <em>mesa</em></>} body={`Vienen ${plural(waiting, "persona", "personas")} por ahora. Cread las mesas y arrastrad a cada uno a la suya (en el móvil, con «Mover a mesa…»).`}>
              <button type="button" className="pn-btn pn-btn--clay pn-press" onClick={() => startTransition(() => createSuggested(suggested))} disabled={pending}>
                <PlusIcon aria-hidden="true" className="size-4" />{suggested === 1 ? "Crear una mesa de 10" : `Crear ${formatCount(suggested)} mesas de 10`}
              </button>
            </EmptyState>
          ) : (
            <>
            {hasLayout(plan) && <FloorPlanMap tables={mapTablesOf(plan.tables)} />}
            <div className="pn-seat-grid">
              {plan.tables.map((table) => (
                <TableCard key={table.id} table={table} tables={plan.tables} over={over === table.id} dragFrom={drag?.from}
                  onMove={moveOne} onRename={(name) => rename(table, name)} onSeats={(seats) => changeSeats(table, seats)} onDelete={() => deleteTable(table)}
                  bind={bind} draggingId={drag?.guestId ?? null}
                  onCompanionHome={actions.apply && rules ? companionHome : undefined}
                  groups={allGroups} onPin={actions.setPinnedGroup && rules ? (group) => pinGroup(table, group) : undefined} busy={pending}
                  onActions={actions.apply && plan.tables.length > 1 ? () => setOpsTable(table.id) : undefined}
                  foundId={found?.tableId === table.id ? found.id : null} foundGuestId={found?.tableId === table.id ? found.guestId : null} />
              ))}
            </div>
            </>
          )}
          <form className="pn-seat-add" onSubmit={(event) => { void addTable(event); }}>
            <label className="pn-field">
              <span>Nueva mesa</span>
              <input value={newName} maxLength={TABLE_NAME_MAX} placeholder={nextTableName(plan.tables)} onChange={(event) => setNewName(event.target.value)} />
            </label>
            <label className="pn-field pn-seat-add-seats">
              <span>Plazas</span>
              <input type="number" inputMode="numeric" min={TABLE_SEATS_MIN} max={TABLE_SEATS_MAX} value={newSeats} onChange={(event) => setNewSeats(Math.min(TABLE_SEATS_MAX, Math.max(TABLE_SEATS_MIN, Number(event.target.value) || TABLE_SEATS_DEFAULT)))} />
            </label>
            <button type="submit" className="pn-btn pn-press"><PlusIcon aria-hidden="true" className="size-4" />Añadir mesa</button>
          </form>
        </div>
      </div>

      {actions.apply && (
        <GuestSheet open={autoOpen} onClose={() => { if (!autoPending) { setAutoOpen(false); setAutoPropose(false); } }} title={autoPropose ? "Propuesta de mesas" : "Sentar automáticamente"}>
          {autoOpen && <AutoSeatPanel plan={plan} listHref={listHref} pending={autoPending} onApply={(result) => void applyProposal(result)}
            onCancel={() => { setAutoOpen(false); setAutoPropose(false); }} autoPropose={autoPropose} explain={actions.explain} partners={partners} />}
        </GuestSheet>
      )}
      {actions.apply && (
        <GuestSheet open={opsTable !== null} onClose={() => { if (!autoPending) setOpsTable(null); }} title={`Mesa entera: ${plan.tables.find((table) => table.id === opsTable)?.name ?? ""}`}>
          {opsTable && <TableActionsPanel plan={plan} tableId={opsTable} pending={autoPending} onApply={(change) => void applyTableChange(change)} onCancel={() => setOpsTable(null)} />}
        </GuestSheet>
      )}
      {actions.readFloorPlan && actions.saveFloorPlan && (
        <GuestSheet open={floorOpen} onClose={() => setFloorOpen(false)} title="Plano del salón" wide>
          {floorOpen && <FloorPlanPanel tables={plan.tables} actions={{ read: actions.readFloorPlan, save: actions.saveFloorPlan }} onSaved={floorSaved} onCancel={() => setFloorOpen(false)} initialReading={initialFloorReading} />}
        </GuestSheet>
      )}

      {/* Ficha que sigue al puntero mientras se arrastra */}
      <div ref={ghost} className="pn-seat-ghost" aria-hidden="true" hidden={!drag}>
        {drag && <><span className="pn-avatar pn-avatar--sm">{initials(drag.name)}</span>{drag.name}</>}
      </div>
    </div>
  );
}
