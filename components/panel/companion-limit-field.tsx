"use client";

import { useId } from "react";
import { CheckIcon } from "lucide-react";
import { MAX_COMPANIONS, parseCompanionLimit } from "@/lib/crm/companion-limit";

/**
 * «Acompañantes máximos» de un invitado (plan maestro §4.2, columna
 * `wedding_guests.max_companions`). Vacío = sin límite (hasta 10); 0 = solo
 * esa persona. Su formulario de respuesta no deja poner más.
 */
export function CompanionLimitField({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const helpId = useId();
  return (
    <label className="pn-field">
      <span>Acompañantes máximos (opcional)</span>
      <input type="number" inputMode="numeric" min={0} max={MAX_COMPANIONS} step={1} placeholder="Sin límite" aria-describedby={helpId}
        value={value ?? ""} onChange={(event) => onChange(parseCompanionLimit(event.target.value))} />
      <small id={helpId}>Vacío = sin límite (hasta {MAX_COMPANIONS}). 0 = solo esta persona. Al responder no podrá apuntar a más.</small>
    </label>
  );
}

/** Selección múltiple: no cambiar, sin límite o un tope para todos. */
export type CompanionLimitChoice = "keep" | null | number;

export function CompanionLimitBulkField({ value, onChange }: { value: CompanionLimitChoice; onChange: (value: CompanionLimitChoice) => void }) {
  const id = useId();
  const numeric = typeof value === "number";
  const option = (choice: "keep" | "none" | "max", text: string) => {
    const active = choice === "keep" ? value === "keep" : choice === "none" ? value === null : numeric;
    return (
      <button key={choice} type="button" role="radio" aria-checked={active} className="pn-chip pn-chip--pick pn-press"
        onClick={() => onChange(choice === "keep" ? "keep" : choice === "none" ? null : numeric ? value : 0)}>
        {active && <CheckIcon aria-hidden="true" className="size-3.5" />}{text}
      </button>
    );
  };
  return (
    <div className="pn-field pn-span">
      <span id={id}>Acompañantes máximos</span>
      <div className="pn-group-picks" role="radiogroup" aria-labelledby={id}>
        {option("keep", "No cambiar")}
        {option("none", "Sin límite")}
        {option("max", "Con tope")}
      </div>
      {numeric && (
        <input type="number" inputMode="numeric" min={0} max={MAX_COMPANIONS} step={1} value={value} aria-label="Tope de acompañantes para todos"
          onChange={(event) => onChange(parseCompanionLimit(event.target.value) ?? 0)} />
      )}
      <small>{numeric ? (value === 0 ? "Solo la persona invitada, sin acompañantes." : `Cada uno podrá venir con hasta ${value === 1 ? "1 acompañante" : `${value} acompañantes`}.`) : `Sin límite = hasta ${MAX_COMPANIONS}. Las respuestas que ya hayan dado no cambian.`}</small>
    </div>
  );
}
