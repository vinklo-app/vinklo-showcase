"use client";

import { useId, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import "@/components/panel/tags.css";
import { GUEST_SIDES, TAGS_PER_GUEST, TAG_MAX, canonicalTag, normalizeTags, tagKey, visibleTags, type GuestSide } from "@/lib/crm/tags";

/** Etiquetas de la boda para la lista: undefined = sin la migración (no se ofrecen). */
export interface TagContext {
  /** Etiquetas en uso (orden del resumen). */
  names: readonly string[];
  /** Sugeridas para empezar (solo si aún no hay ninguna). */
  suggestions: readonly string[];
  sideLabels: Record<GuestSide, string>;
}

/** Propuestas como fichas pulsables (el resto, en el desplegable del campo). */
const MAX_PICKS = 10;

/**
 * Campo «Etiquetas» (de qué os conocen; varias por invitado). Fichas con la
 * etiqueta y una «x» para quitarla; campo de texto con el desplegable nativo
 * de las etiquetas que ya usáis y las sugeridas. Enter o coma añade. Debajo,
 * fichas pulsables con las que ya usáis (o, si aún no hay ninguna, las
 * sugeridas para empezar). Lo comparten la ficha del invitado, «Añadir varios»
 * y «Etiquetar…».
 */
export function TagField({ value, onChange, existing, suggestions = [], label = "Etiquetas (opcional)", help, max = TAGS_PER_GUEST, picksLabel }: {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Etiquetas que ya usa la boda (orden del resumen). */
  existing: readonly string[];
  /** Propuestas para empezar (se ofrecen si la boda aún no tiene etiquetas). */
  suggestions?: readonly string[];
  label?: string;
  help?: string;
  max?: number;
  picksLabel?: string;
}) {
  const id = useId();
  const listId = `${id}-etiquetas`;
  const helpId = `${id}-ayuda`;
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const pool = existing.length > 0 ? existing : suggestions;
  const chosen = new Set(value.map(tagKey));
  const picks = pool.filter((tag) => !chosen.has(tagKey(tag))).slice(0, MAX_PICKS);
  const full = value.length >= max;

  function add(raw: string) {
    const parts = raw.split(",");
    const next = normalizeTags([...value, ...parts.map((part) => canonicalTag(part, existing))], existing, max);
    const tooLong = parts.some((part) => (canonicalTag(part, existing) ?? "").length > TAG_MAX);
    setNote(tooLong ? `Cada etiqueta puede tener hasta ${TAG_MAX} caracteres.` : next.length >= max && parts.some((part) => part.trim()) && next.length === value.length ? `Como mucho ${max} etiquetas por invitado.` : null);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }
  function remove(tag: string) {
    setNote(null);
    onChange(value.filter((item) => item !== tag));
  }

  return (
    <div className="pn-field pn-span">
      <label htmlFor={id}>{label}</label>
      {value.length > 0 && (
        <ul className="pn-tag-chips" aria-label="Etiquetas elegidas">
          {value.map((tag) => (
            <li key={tag}>
              <span className="pn-tag-chip">
                <span className="pn-tag-chip-text">{tag}</span>
                <button type="button" className="pn-tag-chip-x pn-press" aria-label={`Quitar la etiqueta ${tag}`} onClick={() => remove(tag)}>
                  <XIcon aria-hidden="true" className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pn-tag-input">
        <input
          id={id}
          list={pool.length > 0 ? listId : undefined}
          maxLength={TAG_MAX + 1}
          autoComplete="off"
          enterKeyHint="done"
          disabled={full}
          placeholder={full ? `Ya tiene ${max} etiquetas` : "Amigos de la uni, Trabajo, Pueblo…"}
          aria-describedby={helpId}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            if (text.includes(",")) add(text);
            else { setDraft(text); setNote(null); }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); if (draft.trim()) add(draft); }
            if (event.key === "Backspace" && draft === "" && value.length > 0) remove(value[value.length - 1]);
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
        <button type="button" className="pn-tag-add pn-press" disabled={!draft.trim() || full} onClick={() => add(draft)} aria-label="Añadir la etiqueta escrita">
          <PlusIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
      {pool.length > 0 && (
        <datalist id={listId}>
          {pool.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
      )}
      {picks.length > 0 && !full && (
        <div className="pn-group-picks" role="group" aria-label={picksLabel ?? (existing.length > 0 ? "Etiquetas que ya usáis" : "Etiquetas sugeridas")}>
          {picks.map((tag) => (
            <button key={tag} type="button" className="pn-chip pn-chip--pick pn-press" onClick={() => add(tag)}>
              <PlusIcon aria-hidden="true" className="size-3.5" />{tag}
            </button>
          ))}
        </div>
      )}
      {note && <p role="status" className="pn-row-error">{note}</p>}
      <small id={helpId}>{help ?? "De qué os conocen: puede tener varias. Las mesas automáticas juntan a quien comparte etiqueta."}</small>
    </div>
  );
}

/**
 * «Lado»: de quién es invitado. Cuatro botones (los tres lados y «Sin
 * indicar»), como un selector de una opción.
 */
export type SideChoice = GuestSide | null | "keep";
export function SideField({ value, onChange, labels, label = "De quién es invitado (opcional)", keepLabel, help }: {
  value: SideChoice;
  onChange: (side: SideChoice) => void;
  labels: Record<GuestSide, string>;
  label?: string;
  /** Opción extra «No cambiar» (selección múltiple). */
  keepLabel?: string;
  help?: string;
}) {
  const id = useId();
  const option = (side: SideChoice, text: string) => {
    const active = value === side;
    return (
      <button key={side ?? "none"} type="button" role="radio" aria-checked={active} className="pn-chip pn-chip--pick pn-press"
        onClick={() => onChange(side)}>
        {active && <CheckIcon aria-hidden="true" className="size-3.5" />}{text}
      </button>
    );
  };
  return (
    <div className="pn-field pn-span">
      <span id={id}>{label}</span>
      <div className="pn-group-picks" role="radiogroup" aria-labelledby={id}>
        {keepLabel && option("keep", keepLabel)}
        {GUEST_SIDES.map((side) => option(side, labels[side]))}
        {option(null, "Sin indicar")}
      </div>
      {help && <small>{help}</small>}
    </div>
  );
}

/** Fichas suaves de la fila: hasta `max` etiquetas y «+N». */
export function TagBadges({ tags, max = 2 }: { tags: readonly string[] | null | undefined; max?: number }) {
  const { shown, more } = visibleTags(tags, max);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((tag) => <span key={tag} className="pn-group-tag pn-tag-soft">{tag}</span>)}
      {more > 0 && <span className="pn-group-tag pn-tag-soft" title={(tags ?? []).slice(max).join(", ")}>+{more}</span>}
    </>
  );
}
