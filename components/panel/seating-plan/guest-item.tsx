"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVerticalIcon, UtensilsIcon } from "lucide-react";
import { TagBadges } from "@/components/panel/tag-field";
import { formatCount, initials } from "@/components/panel/guest-status";
import { NONE } from "@/components/panel/seating-plan/use-seat-drag";
import { companionLabel, companionsAtHome, seatsTaken, tableOccupancy, type SeatGuest, type SeatTable, type SeatVisitor } from "@/lib/crm/seating";

// ---------------------------------------------------------------- piezas

const STATUS: Record<SeatGuest["rsvp_status"], { label: string; className: string }> = {
  si: { label: "Viene", className: "pn-status pn-status--confirmed" },
  pendiente: { label: "Sin responder", className: "pn-status pn-status--pending" },
  no: { label: "No viene", className: "pn-status pn-status--declined" },
};

function companions(guest: SeatGuest): string | null {
  const here = seatsTaken(guest) - 1;
  if (guest.rsvp_status !== "si" || here <= 0) return null;
  return here === 1 ? "+1 acompañante" : `+${here} acompañantes`;
}

function MoveSelect({ guest, current, tables, onMove, disabled }: {
  guest: SeatGuest; current: string | null; tables: SeatTable[]; onMove: (tableId: string | null) => void; disabled?: boolean;
}) {
  return (
    <label className="pn-seat-move">
      <span className="sr-only">Mover a {guest.name} a</span>
      <select
        value={current ?? NONE}
        disabled={disabled}
        onChange={(event) => onMove(event.target.value === NONE ? null : event.target.value)}
      >
        <option value={NONE}>{current ? "Quitar de la mesa" : "Mover a mesa…"}</option>
        {tables.map((table) => {
          const occ = tableOccupancy(table);
          return <option key={table.id} value={table.id}>{table.name} · {formatCount(occ.attending)}/{formatCount(table.seats)}</option>;
        })}
      </select>
    </label>
  );
}

export function GuestItem({ guest, tableId, tables, onMove, dragProps, dragging, found = false }: {
  guest: SeatGuest; tableId: string | null; tables: SeatTable[];
  onMove: (guestId: string, tableId: string | null) => void;
  dragProps: { onPointerDown(event: ReactPointerEvent<HTMLElement>): void };
  dragging: boolean;
  /** Resaltado por «¿Dónde está…?». */
  found?: boolean;
}) {
  const extra = companions(guest);
  const status = STATUS[guest.rsvp_status];
  return (
    <li className="pn-seat-guest" data-status={guest.rsvp_status} data-dragging={dragging || undefined} data-seat-guest={guest.id} data-found={found || undefined} {...dragProps}>
      <span className="pn-seat-grip" aria-hidden="true"><GripVerticalIcon className="size-4" /></span>
      <span className={`pn-avatar pn-avatar--sm ${guest.rsvp_status === "si" ? "pn-avatar--confirmed" : ""}`} aria-hidden="true">{initials(guest.name)}</span>
      <span className="pn-seat-guest-text">
        <span className="pn-seat-guest-name">{guest.name}</span>
        <span className="pn-seat-guest-meta">
          <span className={status.className}>{status.label}</span>
          {extra && <span className="pn-seat-plus">{extra}</span>}
          {companionsAtHome(guest).length > 0 && <span className="pn-seat-names">Con {companionsAtHome(guest).map(companionLabel).join(", ")}</span>}
          {guest.group_name && <span className="pn-group-tag">{guest.group_name}</span>}
          <TagBadges tags={guest.tags} max={1} />
          {guest.notes && <span className="pn-seat-note" title={guest.notes}><UtensilsIcon aria-hidden="true" className="size-3.5" /><span>{guest.notes}</span></span>}
        </span>
      </span>
      <MoveSelect guest={guest} current={tableId} tables={tables} onMove={(target) => onMove(guest.id, target)} />
    </li>
  );
}

export function VisitorItem({ visitor, onHome, disabled, found = false }: { visitor: SeatVisitor; onHome?: () => void; disabled?: boolean; found?: boolean }) {
  return (
    <li className="pn-seat-guest pn-seat-visitor" data-status={visitor.rsvp_status} data-found={found || undefined}>
      <span className={`pn-avatar pn-avatar--sm ${visitor.rsvp_status === "si" ? "pn-avatar--confirmed" : ""}`} aria-hidden="true">{initials(visitor.name)}</span>
      <span className="pn-seat-guest-text">
        <span className="pn-seat-guest-name">{companionLabel(visitor)}</span>
        <span className="pn-seat-guest-meta"><span className="pn-seat-names">Con {visitor.guestName}</span></span>
      </span>
      {onHome && <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={disabled} onClick={onHome} aria-label={`Sentar a ${visitor.name} con ${visitor.guestName}`}>Con su familia</button>}
    </li>
  );
}
