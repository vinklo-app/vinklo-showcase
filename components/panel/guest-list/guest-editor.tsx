"use client";

import { useEffect, useState, useTransition } from "react";
import type { GuestActionResult, GuestInput } from "@/lib/actions/guests";
import { RSVP_LABELS, RSVP_STATUSES, type RsvpStatus } from "@/lib/guests";
import { contactPicker } from "@/lib/invitation-sharing";
import { GroupField } from "@/components/panel/group-field";
import { canonicalGroupName } from "@/lib/crm/groups";
import { SideField, TagField, type TagContext } from "@/components/panel/tag-field";
import { CompanionLimitField } from "@/components/panel/companion-limit-field";
import { normalizeTags } from "@/lib/crm/tags";

export const empty: GuestInput = { name: "", phone: "", status: "pendiente", companions: 0, notes: "" };

export function GuestEditor({ initial = empty, onSave, onDelete, label, deleteWarning, groups, tags, limits = false }: {
  initial?: GuestInput; onSave: (input: GuestInput) => Promise<GuestActionResult>; onDelete?: () => Promise<GuestActionResult>; label: string;
  /** Frase extra en la confirmación de borrar (p. ej. sus regalos anotados). */
  deleteWarning?: string;
  /** Grupos ya usados; undefined = sin grupos (sin la migración): el campo no aparece y no se envía. */
  groups?: readonly string[];
  /** Etiquetas y lado; undefined = sin la migración: los campos no aparecen y no se envían. */
  tags?: TagContext;
  /** Se puede leer y guardar el tope de acompañantes (sin la migración, el campo no aparece y no se envía). */
  limits?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [canPick, setCanPick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => { setCanPick(Boolean(contactPicker())); }, []);

  async function pickContact() {
    setError(null);
    try {
      const picker = contactPicker();
      if (!picker) return;
      const [contact] = await picker.select(["name", "tel"], { multiple: false });
      if (contact) setValue((current) => ({ ...current, name: (contact.name?.[0] ?? "").slice(0, 120), phone: (contact.tel?.[0] ?? "").slice(0, 20) }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError("No se ha podido elegir el contacto. Podéis escribirlo aquí.");
    }
  }

  return (
    <form data-guest-editor="true" className="pn-form" onSubmit={(event) => {
      event.preventDefault(); setError(null);
      startTransition(async () => {
        // «familia de elena» entra en «Familia de Elena» si ya existe; sin grupos no se envía el campo.
        const withGroup: GuestInput = groups ? { ...value, group: canonicalGroupName(value.group ?? "", groups) ?? "" } : { ...value, group: undefined };
        const withTags: GuestInput = tags ? { ...withGroup, tags: normalizeTags(value.tags ?? [], tags.names), side: value.side ?? null } : { ...withGroup, tags: undefined, side: undefined };
        const input: GuestInput = { ...withTags, maxCompanions: limits ? value.maxCompanions ?? null : undefined };
        try { const result = await onSave(input); if (!result.ok) setError(result.error); }
        catch { setError("No se ha guardado. Comprobad la conexión y reintentadlo."); }
      });
    }}>
      {canPick
        ? <button type="button" disabled={pending} onClick={pickContact} className="pn-link pn-press justify-self-start">Elegir de mis contactos</button>
        : <p className="pn-help">Podéis escribir o pegar el nombre y teléfono del invitado.</p>}
      <fieldset disabled={pending}>
        <legend className="sr-only">Datos del invitado</legend>
        <label className="pn-field"><span>Nombre y apellidos</span><input required minLength={2} maxLength={120} autoComplete="off" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} /></label>
        <label className="pn-field"><span>Teléfono (opcional)</span><input type="tel" inputMode="tel" maxLength={20} autoComplete="off" value={value.phone} onChange={(event) => setValue({ ...value, phone: event.target.value })} /><small>Para abrir WhatsApp con su enlace. Solo guardamos nombre y teléfono.</small></label>
        <label className="pn-field"><span>Asistencia</span><select value={value.status} onChange={(event) => setValue({ ...value, status: event.target.value as RsvpStatus, companions: event.target.value === "si" ? value.companions : 0 })}>{RSVP_STATUSES.map((status) => <option value={status} key={status}>{RSVP_LABELS[status]}</option>)}</select></label>
        <label className="pn-field"><span>Acompañantes adicionales</span><input type="number" inputMode="numeric" min={0} max={10} disabled={value.status !== "si"} value={value.companions} onChange={(event) => setValue({ ...value, companions: Number(event.target.value) })} /><small>Sin contar a la persona invitada; se cuentan al confirmar.</small></label>
        {limits && <CompanionLimitField value={value.maxCompanions ?? null} onChange={(maxCompanions) => setValue({ ...value, maxCompanions })} />}
        <label className="pn-field pn-span"><span>Notas de asistencia (opcional)</span><textarea maxLength={500} rows={2} value={value.notes} onChange={(event) => setValue({ ...value, notes: event.target.value })} /><small>El invitado puede actualizar estas notas al responder.</small></label>
        {groups && <GroupField value={value.group ?? ""} onChange={(group) => setValue({ ...value, group })} groups={groups} help={groups.length > 0 ? "Van juntos (una familia, una pareja): las mesas automáticas nunca los separan. Vacío = sin grupo." : "Van juntos, p. ej. «Familia de Elena»: las mesas automáticas nunca los separan. Vacío = sin grupo."} />}
        {tags && <SideField value={value.side ?? null} labels={tags.sideLabels} onChange={(side) => { if (side !== "keep") setValue({ ...value, side }); }} help="Sirve para equilibrar las mesas y para filtrar la lista." />}
        {tags && <TagField value={value.tags ?? []} onChange={(next) => setValue({ ...value, tags: next })} existing={tags.names} suggestions={tags.suggestions} />}
      </fieldset>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
      <div className="pn-form-actions">
        <button className="pn-btn pn-press" type="submit" disabled={pending}>{pending ? "Guardando…" : label}</button>
        {onDelete && (
          <button type="button" disabled={pending} className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => {
            if (!window.confirm(`¿Eliminar a ${value.name} y su respuesta? Su enlace personal dejará de funcionar.${deleteWarning ? ` ${deleteWarning}` : ""}`)) return;
            setError(null);
            startTransition(async () => {
              try { const result = await onDelete(); if (!result.ok) setError(result.error); }
              catch { setError("No se ha podido eliminar. Probad de nuevo."); }
            });
          }}>Eliminar</button>
        )}
      </div>
    </form>
  );
}
