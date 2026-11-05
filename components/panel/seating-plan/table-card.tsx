"use client";

import { useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, CheckIcon, MinusIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GuestItem, VisitorItem } from "@/components/panel/seating-plan/guest-item";
import { TABLE_NAME_MAX, TABLE_SEATS_MAX, TABLE_SEATS_MIN, normalizeTableName, tableOccupancy, type SeatGuest, type SeatTable, type SeatVisitor } from "@/lib/crm/seating";

function SeatsStepper({ table, onChange }: { table: SeatTable; onChange: (seats: number) => void }) {
  return (
    <div className="pn-seat-stepper" role="group" aria-label={`Plazas de ${table.name}`}>
      <button type="button" className="pn-seat-icon pn-press" onClick={() => onChange(table.seats - 1)} disabled={table.seats <= TABLE_SEATS_MIN} aria-label={`Una plaza menos en ${table.name}`}><MinusIcon aria-hidden="true" className="size-4" /></button>
      <span className="pn-seat-stepper-value"><strong className="pn-tnum">{table.seats}</strong> plazas</span>
      <button type="button" className="pn-seat-icon pn-press" onClick={() => onChange(table.seats + 1)} disabled={table.seats >= TABLE_SEATS_MAX} aria-label={`Una plaza más en ${table.name}`}><PlusIcon aria-hidden="true" className="size-4" /></button>
    </div>
  );
}

function PinnedGroupSelect({ table, groups, onChange }: { table: SeatTable; groups: string[]; onChange: (group: string | null) => void }) {
  const current = table.pinned_group ?? "";
  const options = current && !groups.includes(current) ? [current, ...groups] : groups;
  return (
    <label className="pn-seat-move pn-seat-pin">
      <span className="pn-seat-pin-label">Mesa fija para</span>
      <select value={current} onChange={(event) => onChange(event.target.value || null)} aria-label={`Grupo con mesa fija en ${table.name}`}>
        <option value="">Ningún grupo</option>
        {options.map((group) => <option key={group} value={group}>{group}</option>)}
      </select>
    </label>
  );
}

export function TableCard({ table, tables, over, dragFrom, onMove, onRename, onSeats, onDelete, bind, draggingId, onCompanionHome, groups, onPin, busy, onActions, foundId = null, foundGuestId = null }: {
  table: SeatTable; tables: SeatTable[]; over: boolean; dragFrom: string | null | undefined;
  /** Persona (invitado o acompañante) que «¿Dónde está…?» ha encontrado en esta mesa, y su invitado. */
  foundId?: string | null; foundGuestId?: string | null;
  onMove: (guestId: string, tableId: string | null) => void;
  onRename: (name: string) => Promise<boolean>;
  onSeats: (seats: number) => void;
  onDelete: () => void;
  /** «Con su familia» de un acompañante sentado aquí (sin ella, solo se muestra). */
  onCompanionHome?: (visitor: SeatVisitor) => void;
  /** Grupos para «Mesa fija para…»; sin onPin no se ofrece. */
  groups: string[];
  onPin?: (group: string | null) => void;
  busy?: boolean;
  /** «Más acciones» de la mesa entera (intercambiar, mover, fusionar, dividir…). */
  onActions?: () => void;
  bind: (guest: SeatGuest, from: string | null) => { onPointerDown(event: ReactPointerEvent<HTMLElement>): void };
  draggingId: string | null;
}) {
  const occ = tableOccupancy(table);
  // Un acompañante sentado aquí aparte se resalta él; si se sienta con su invitado, la fila del invitado.
  const visitorFound = Boolean(foundId) && (table.visitors ?? []).some((visitor) => visitor.id === foundId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(table.name);
  const headingId = `mesa-${table.id}`;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normalizeTableName(name);
    if (!clean) { toast("Poned un nombre a la mesa."); return; }
    if (clean === table.name) { setEditing(false); return; }
    if (await onRename(clean)) setEditing(false);
  }
  const state = occ.over
    ? `Se pasa en ${plural(-occ.free, "persona", "personas")}`
    : occ.free === 0 ? "Completa" : `${plural(occ.free, "plaza libre", "plazas libres")}`;
  return (
    <section className="pn-seat-table" aria-labelledby={headingId} data-drop-table={table.id} data-found={foundId ? "" : undefined} data-over={occ.over || undefined} data-target={over && dragFrom !== table.id ? "" : undefined}>
      <header className="pn-seat-table-head">
        {editing ? (
          <form className="pn-seat-rename" onSubmit={submit}>
            <label className="sr-only" htmlFor={`${headingId}-name`}>Nombre de la mesa</label>
            <input id={`${headingId}-name`} value={name} maxLength={TABLE_NAME_MAX} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setName(table.name); setEditing(false); } }} />
            <button type="submit" className="pn-seat-icon pn-seat-icon--ink pn-press" aria-label="Guardar el nombre"><CheckIcon aria-hidden="true" className="size-4" /></button>
            <button type="button" className="pn-seat-icon pn-press" aria-label="Cancelar" onClick={() => { setName(table.name); setEditing(false); }}><XIcon aria-hidden="true" className="size-4" /></button>
          </form>
        ) : (
          <div className="pn-seat-title-row">
            <h3 id={headingId} className="pn-seat-title">{table.name}</h3>
            {table.pinned_group && <span className="pn-group-tag" title="Mesa fija para este grupo">{table.pinned_group}</span>}
            <button type="button" className="pn-seat-icon pn-press" onClick={() => { setName(table.name); setEditing(true); }} aria-label={`Cambiar el nombre de ${table.name}`}><PencilIcon aria-hidden="true" className="size-4" /></button>
            {onActions && <button type="button" className="pn-seat-icon pn-press" onClick={onActions} aria-label={`Más acciones de ${table.name}: intercambiar, mover, fusionar o dividir`}><MoreHorizontalIcon aria-hidden="true" className="size-4" /></button>}
          </div>
        )}
        <p className="pn-seat-count" aria-label={`${formatCount(occ.attending)} de ${formatCount(table.seats)} plazas ocupadas`}>
          <span className="pn-num">{formatCount(occ.attending)}</span><span className="pn-seat-count-of">/{formatCount(table.seats)}</span>
        </p>
      </header>
      <div className="pn-seat-bar" aria-hidden="true"><span style={{ transform: `scaleX(${occ.ratio.toFixed(4)})` }} /></div>
      <p className="pn-seat-state" role={occ.over ? "status" : undefined}>
        <span data-warn={occ.over || undefined}>{occ.over && <AlertTriangleIcon aria-hidden="true" className="size-4" />}{state}{occ.over && ": añadid plazas o moved a alguien"}</span>
        {occ.pending > 0 && <span className="pn-muted"> · {plural(occ.pending, "sin responder", "sin responder")}</span>}
      </p>
      {table.guests.length === 0 && (table.visitors ?? []).length === 0 ? (
        <p className="pn-seat-drop-hint">Arrastrad aquí a alguien o usad «Mover a mesa…» en la lista «Sin mesa».</p>
      ) : (
        <ul className="pn-seat-guests" aria-label={`En ${table.name}`}>
          {table.guests.map((guest) => <GuestItem key={guest.id} guest={guest} tableId={table.id} tables={tables} onMove={onMove} dragProps={bind(guest, table.id)} dragging={draggingId === guest.id} found={!visitorFound && foundGuestId === guest.id} />)}
          {(table.visitors ?? []).map((visitor) => <VisitorItem key={visitor.id} visitor={visitor} disabled={busy} found={foundId === visitor.id} onHome={onCompanionHome ? () => onCompanionHome(visitor) : undefined} />)}
        </ul>
      )}
      {onPin && (groups.length > 0 || table.pinned_group) && <PinnedGroupSelect table={table} groups={groups} onChange={onPin} />}
      <footer className="pn-seat-table-foot">
        <SeatsStepper table={table} onChange={onSeats} />
        {confirming ? (
          <div className="pn-seat-confirm" role="group" aria-label={`Borrar ${table.name}`}>
            <span className="text-sm">{table.guests.length > 0 ? `${plural(table.guests.length, "invitado vuelve", "invitados vuelven")} a «Sin mesa».` : "¿Borrar la mesa?"}</span>
            <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => { setConfirming(false); onDelete(); }}>Borrar</button>
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        ) : (
          <button type="button" className="pn-seat-icon pn-press" onClick={() => setConfirming(true)} aria-label={`Borrar ${table.name}`}><Trash2Icon aria-hidden="true" className="size-4" /></button>
        )}
      </footer>
    </section>
  );
}
