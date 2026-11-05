"use client";

import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { UsersRoundIcon } from "lucide-react";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GuestItem } from "@/components/panel/seating-plan/guest-item";
import { NONE, type DragState } from "@/components/panel/seating-plan/use-seat-drag";
import { tableOccupancy, type SeatGuest, type SeatingPlan } from "@/lib/crm/seating";

/** Bandeja «Sin mesa»: filtro por grupo, «Sentar a los de… en…» y lista; el estado es del plan. */
export function UnseatedTray({ plan, tray, waiting, groups, hasUngrouped, group, setGroup, activeGroup, activeGroupIds, seatGroup, moveOne, bind, drag, over, found, declinedUnseated, showDeclined, setShowDeclined }: {
  plan: SeatingPlan; tray: SeatGuest[]; waiting: number;
  groups: { name: string; guests: number; people: number }[]; hasUngrouped: boolean;
  group: string | null | "all"; setGroup: (group: string | null | "all") => void;
  activeGroup: string | null; activeGroupIds: string[];
  seatGroup: (groupName: string, tableId: string) => void;
  moveOne: (guestId: string, tableId: string | null) => void;
  bind: (guest: SeatGuest, from: string | null) => { onPointerDown(event: ReactPointerEvent<HTMLElement>): void };
  drag: DragState | null; over: string | null;
  /** Persona que «¿Dónde está…?» ha encontrado (tableId null: en esta bandeja). */
  found: { tableId: string | null; guestId: string } | null;
  declinedUnseated: number; showDeclined: boolean; setShowDeclined: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <aside className="pn-seat-tray" aria-labelledby="sin-mesa" data-drop-table={NONE} data-target={over === NONE && drag?.from ? "" : undefined}>
      <div className="pn-seat-tray-head">
        <h2 id="sin-mesa" className="pn-display pn-h3">Sin mesa</h2>
        <span className="pn-muted text-sm">{plural(waiting, "persona viene", "personas vienen")}</span>
      </div>
      {(groups.length > 0 || hasUngrouped) && (
        <div className="pn-seat-chips" role="group" aria-label="Filtrar por grupo">
          <button type="button" className="pn-chip pn-chip--pick pn-press" aria-pressed={group === "all"} onClick={() => setGroup("all")}>Todos</button>
          {groups.map((item) => (
            <button key={item.name} type="button" className="pn-chip pn-chip--pick pn-press" aria-pressed={group === item.name} onClick={() => setGroup(item.name)}>{item.name} <small>{formatCount(item.guests)}</small></button>
          ))}
          {hasUngrouped && groups.length > 0 && <button type="button" className="pn-chip pn-chip--pick pn-press" aria-pressed={group === null} onClick={() => setGroup(null)}>Sin grupo</button>}
        </div>
      )}
      {activeGroup && activeGroupIds.length > 0 && plan.tables.length > 0 && (
        <div className="pn-seat-group-action">
          <UsersRoundIcon aria-hidden="true" className="size-5 shrink-0" />
          <label className="pn-seat-move pn-seat-move--wide">
            <span className="pn-seat-group-label">Sentar a {activeGroupIds.length === 1 ? "la persona" : `los ${formatCount(activeGroupIds.length)}`} de «{activeGroup}» en…</span>
            <select value="" onChange={(event) => { if (event.target.value) seatGroup(activeGroup, event.target.value); }}>
              <option value="">Elegid una mesa</option>
              {plan.tables.map((table) => {
                const occ = tableOccupancy(table);
                return <option key={table.id} value={table.id}>{table.name} · {plural(Math.max(occ.free, 0), "libre", "libres")}</option>;
              })}
            </select>
          </label>
        </div>
      )}
      {groups.length > 0 && group === "all" && plan.tables.length > 0 && (
        <p className="pn-seat-tip pn-muted">Elegid un grupo para sentarlo entero de una vez.</p>
      )}
      {tray.length === 0 ? (
        <p className="pn-seat-drop-hint">{plan.unseated.length === 0 ? "Todos tienen mesa. ¡Bien hecho!" : "Nadie más con este filtro."}</p>
      ) : (
        <ul className="pn-seat-guests" aria-label="Invitados sin mesa">
          {tray.map((guest) => <GuestItem key={guest.id} guest={guest} tableId={null} tables={plan.tables} onMove={moveOne} dragProps={bind(guest, null)} dragging={drag?.guestId === guest.id} found={found?.tableId === null && found.guestId === guest.id} />)}
        </ul>
      )}
      {declinedUnseated > 0 && (
        <button type="button" className="pn-link pn-press pn-muted mt-2" onClick={() => setShowDeclined((value) => !value)} aria-pressed={showDeclined}>
          {showDeclined ? "Ocultar a quien no viene" : `Ver también a quien no viene (${formatCount(declinedUnseated)})`}
        </button>
      )}
    </aside>
  );
}
