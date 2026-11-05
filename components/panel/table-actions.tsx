"use client";

/**
 * Acciones de mesa entera (lib/crm/table-ops.ts): intercambiar con otra,
 * mover a una vacía, fusionar, dividir y mover un grupo o un invitado suelto.
 * Se elige la acción y el destino, se ve qué va a pasar (o por qué no se
 * puede) y se aplica de una vez; el panel ofrece «Deshacer».
 */
import { useMemo, useState } from "react";
import "@/components/panel/seating-ai.css";
import { formatCount, plural } from "@/components/panel/guest-status";
import { tableOccupancy, type SeatTable, type SeatingPlan } from "@/lib/crm/seating";
import { mergeTables, moveGroup, moveGuest, moveTable, splitTable, swapTables, type SeatingChange, type TableOpResult } from "@/lib/crm/table-ops";

type Op = "swap" | "move" | "merge" | "split" | "unit";

const OPS: Array<{ id: Op; label: string; help: string }> = [
  { id: "swap", label: "Intercambiar con…", help: "Todos los de esta mesa pasan a otra y los de la otra, a esta." },
  { id: "move", label: "Mover a una mesa vacía…", help: "Todos los de esta mesa pasan a una mesa vacía." },
  { id: "merge", label: "Fusionar con…", help: "Todos los de esta mesa se suman a otra si caben. Esta queda vacía." },
  { id: "split", label: "Dividir", help: "Repartimos esta mesa en dos sin separar ningún grupo." },
  { id: "unit", label: "Mover un grupo o un invitado…", help: "Un grupo entero (o una persona sin grupo) a otra mesa." },
];

/** «Cambian de mesa 4 invitaciones (5 personas que vienen).» */
function movedText(change: SeatingChange): string {
  const invitations = change.assignments.length;
  const coming = change.people > 0 ? ` (${plural(change.people, "persona que viene", "personas que vienen")})` : "";
  return `Cambian de mesa ${plural(invitations, "invitación", "invitaciones")}${coming}. Podréis deshacerlo.`;
}

const isEmpty = (table: SeatTable) => table.guests.length === 0 && (table.visitors ?? []).length === 0;
const NEW_TABLE = "__nueva__";

export function TableActionsPanel({ plan, tableId, pending, onApply, onCancel }: {
  plan: SeatingPlan;
  tableId: string;
  pending: boolean;
  onApply: (change: SeatingChange) => void;
  onCancel: () => void;
}) {
  const table = plan.tables.find((item) => item.id === tableId);
  const [op, setOp] = useState<Op>("swap");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");

  /** Grupos y personas sin grupo de esta mesa (los que no vienen, no). */
  const units = useMemo(() => {
    if (!table) return [];
    const groups = new Map<string, number>();
    const list: Array<{ value: string; label: string }> = [];
    for (const guest of table.guests) {
      if (guest.rsvp_status === "no") continue;
      if (guest.group_name) groups.set(guest.group_name, (groups.get(guest.group_name) ?? 0) + 1);
      else list.push({ value: `g:${guest.id}`, label: guest.name });
    }
    return [...[...groups].map(([name, count]) => ({ value: `group:${name}`, label: `Grupo «${name}» (${plural(count, "invitado", "invitados")})` })), ...list];
  }, [table]);

  if (!table) return <p className="pn-note">Esa mesa ya no existe.</p>;
  const others = plan.tables.filter((item) => item.id !== table.id);
  const candidates = op === "move" ? others.filter(isEmpty) : op === "split" ? others.filter(isEmpty) : others;
  const chosenUnit = op === "unit" ? (unit || units[0]?.value || "") : "";

  let result: TableOpResult | null = null;
  if (op === "split") result = splitTable(plan, table.id, target && target !== NEW_TABLE ? target : null);
  else if (target) {
    if (op === "swap") result = swapTables(plan, table.id, target);
    else if (op === "move") result = moveTable(plan, table.id, target);
    else if (op === "merge") result = mergeTables(plan, table.id, target);
    else if (op === "unit" && chosenUnit) {
      result = chosenUnit.startsWith("group:") ? moveGroup(plan, chosenUnit.slice(6), target) : moveGuest(plan, chosenUnit.slice(2), target);
    }
  }
  const occ = (item: SeatTable) => tableOccupancy(item);
  const option = (item: SeatTable) => `${item.name} · ${formatCount(occ(item).attending)}/${formatCount(item.seats)}`;

  return (
    <form className="pn-table-ops" onSubmit={(event) => { event.preventDefault(); if (result?.ok) onApply(result.change); }}>
      <p className="pn-help m-0">{table.name}: {plural(occ(table).attending, "persona", "personas")} de {formatCount(table.seats)} plazas.</p>
      <fieldset className="pn-table-ops-list">
        <legend>Qué queréis hacer</legend>
        {OPS.map((item) => (
          <label key={item.id} className="pn-table-ops-option">
            <input type="radio" name="accion" value={item.id} checked={op === item.id} onChange={() => { setOp(item.id); setTarget(""); }} />
            <span>{item.label}<small>{item.help}</small></span>
          </label>
        ))}
      </fieldset>

      {op === "unit" && (
        units.length === 0 ? <p className="pn-note">No hay nadie en esta mesa que mover.</p> : (
          <label className="pn-field">
            <span>A quién</span>
            <select value={chosenUnit} onChange={(event) => setUnit(event.target.value)}>
              {units.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        )
      )}

      {op === "split" ? (
        <label className="pn-field">
          <span>La otra mitad, a</span>
          <select value={target || NEW_TABLE} onChange={(event) => setTarget(event.target.value)}>
            <option value={NEW_TABLE}>Una mesa nueva de {formatCount(table.seats)} plazas</option>
            {candidates.map((item) => <option key={item.id} value={item.id}>{option(item)}</option>)}
          </select>
        </label>
      ) : (
        <label className="pn-field">
          <span>{op === "unit" ? "A qué mesa" : op === "move" ? "Mesa vacía" : "Con qué mesa"}</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Elegid una mesa</option>
            {candidates.map((item) => <option key={item.id} value={item.id}>{option(item)}</option>)}
          </select>
          {op === "move" && candidates.length === 0 && <small>No tenéis ninguna mesa vacía: cread una abajo o usad «Fusionar con…».</small>}
        </label>
      )}

      {result && (result.ok
        ? <p className="pn-note" aria-live="polite">{result.change.summary} {movedText(result.change)}</p>
        : <p className="pn-note pn-note--warn" role="alert">{result.error}</p>)}

      <div className="pn-form-actions">
        <button type="submit" className="pn-btn pn-press" disabled={pending || !result?.ok}>{pending ? "Aplicando…" : "Aplicar"}</button>
        <button type="button" className="pn-link pn-press" disabled={pending} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
