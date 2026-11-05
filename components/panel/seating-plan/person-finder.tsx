"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { findPeople, type FoundPerson, type SeatingPlan } from "@/lib/crm/seating";

/**
 * «¿Dónde está…?»: busca por nombre (sin tildes) entre invitados y
 * acompañantes con nombre y, al elegir a alguien, el plano lleva hasta su
 * mesa (o a «Sin mesa») y la resalta. El foco se queda en el campo.
 */
export function PersonFinder({ plan, onPick }: { plan: SeatingPlan; onPick: (person: FoundPerson) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => (open ? findPeople(plan, query) : []), [open, plan, query]);
  const tableName = (id: string | null) => (id ? plan.tables.find((table) => table.id === id)?.name ?? "Sin mesa" : "Sin mesa");
  const listId = "pn-seat-find-results";
  function pick(person: FoundPerson) { setOpen(false); onPick(person); }
  return (
    <div className="pn-seat-find">
      <label className="pn-field">
        <span>¿Dónde está…?</span>
        <span className="pn-seat-find-input">
          <SearchIcon aria-hidden="true" className="size-4" />
          <input type="search" value={query} placeholder="Nombre o apellido" autoComplete="off" enterKeyHint="search" aria-controls={listId}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const first = findPeople(plan, query)[0]; if (first) pick(first); } if (event.key === "Escape") setOpen(false); }} />
        </span>
      </label>
      {open && query.trim() !== "" && (
        <ul id={listId} className="pn-seat-find-results" aria-label="Personas encontradas">
          {results.length === 0 ? (
            <li className="pn-help" aria-live="polite">Nadie se llama así en vuestra lista.</li>
          ) : results.map((person) => (
            <li key={`${person.kind}-${person.id}`}>
              <button type="button" className="pn-seat-find-hit pn-press" onClick={() => pick(person)}>
                <span className="pn-seat-find-name">{person.name}{person.guestName && <span className="pn-muted"> · con {person.guestName}</span>}</span>
                <span className="pn-seat-find-where">{tableName(person.tableId)}{person.rsvp_status === "no" ? " · no viene" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
