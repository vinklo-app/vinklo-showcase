"use client";

import { useId } from "react";
import { CheckIcon } from "lucide-react";
import { GROUP_NAME_MAX, normalizeGroupName } from "@/lib/crm/groups";

/** Sugerencias como chips: las primeras de la lista (el resto, en el desplegable del campo). */
const MAX_CHIPS = 8;

/**
 * Campo «Grupo»: se escribe uno nuevo o se toca uno de los ya usados (chips
 * y desplegable nativo del campo). Vacío = sin grupo. Lo comparten la ficha
 * del invitado, «Añadir varios» y «Mover a grupo…».
 */
export function GroupField({ value, onChange, groups, label = "Grupo (opcional)", help, autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  /** Grupos ya usados en la boda (orden del resumen). */
  groups: readonly string[];
  label?: string;
  help?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-grupos`;
  const helpId = `${id}-ayuda`;
  const current = normalizeGroupName(value);
  const chips = groups.slice(0, MAX_CHIPS);
  return (
    <div className="pn-field pn-span">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list={groups.length > 0 ? listId : undefined}
        maxLength={GROUP_NAME_MAX}
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint="done"
        placeholder="Familia de Elena, Trabajo, Vecinos…"
        aria-describedby={helpId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {groups.length > 0 && (
        <datalist id={listId}>
          {groups.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}
      {chips.length > 0 && (
        <div className="pn-group-picks" role="group" aria-label="Grupos que ya usáis">
          {chips.map((name) => {
            const active = current === name;
            return (
              <button key={name} type="button" aria-pressed={active} className="pn-chip pn-chip--pick pn-press" onClick={() => onChange(active ? "" : name)}>
                {active && <CheckIcon aria-hidden="true" className="size-3.5" />}{name}
              </button>
            );
          })}
        </div>
      )}
      <small id={helpId}>{help ?? (groups.length > 0 ? "Elegid uno de los vuestros o escribid uno nuevo. Vacío = sin grupo." : "Escribid uno nuevo, p. ej. «Familia de Elena». Vacío = sin grupo.")}</small>
    </div>
  );
}
