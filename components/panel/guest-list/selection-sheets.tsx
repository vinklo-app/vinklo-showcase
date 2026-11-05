"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { RSVP_LABELS, type RsvpStatus } from "@/lib/guests";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GroupField } from "@/components/panel/group-field";
import { canonicalGroupName } from "@/lib/crm/groups";
import { SideField, TagField, type SideChoice, type TagContext } from "@/components/panel/tag-field";
import { CompanionLimitBulkField, type CompanionLimitChoice } from "@/components/panel/companion-limit-field";
import { deleteConfirmText, statusChangeHelp, type GiftDeletionImpact } from "@/lib/crm/guest-bulk";
import type { GuestActions } from "./types";

/**
 * «Mover a grupo…»: los elegidos pasan al grupo escrito o tocado; «Quitar
 * del grupo» los deja sin grupo. Una sola escritura (setGuestsGroup).
 */
export function MoveToGroup({ count, groups, initial, onMove }: {
  count: number; groups: readonly string[]; initial: string;
  onMove: (group: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const target = canonicalGroupName(value, groups);
  function run(group: string) {
    setError(null);
    startTransition(async () => {
      try { const problem = await onMove(group); if (problem) setError(problem); }
      catch { setError("No se ha guardado. Comprobad la conexión y probad de nuevo."); }
    });
  }
  return (
    <form className="pn-form" onSubmit={(event) => { event.preventDefault(); if (target) run(target); }}>
      <p className="pn-help">{plural(count, "invitado elegido", "invitados elegidos")}. Su asistencia, enlaces y regalos no cambian.</p>
      <fieldset disabled={pending} className="contents">
        <legend className="sr-only">Grupo de destino</legend>
        <GroupField value={value} onChange={(next) => { setValue(next); setError(null); }} groups={groups} label="Grupo" help="Elegid uno de los vuestros o escribid uno nuevo." />
      </fieldset>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
      <div className="pn-form-actions">
        <button className="pn-btn pn-press" type="submit" disabled={pending || !target}>{pending ? "Moviendo…" : target ? `Mover a «${target}»` : "Mover"}</button>
        <button type="button" disabled={pending} onClick={() => run("")} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Quitar del grupo</button>
      </div>
    </form>
  );
}

/**
 * «Borrar (n)»: lo que se va con los elegidos (respuesta, acompañantes con
 * nombre, mesa, enlace y los regalos que son solo suyos) antes de confirmar.
 * Al confirmar no se borra aún: la lista los oculta y el aviso ofrece
 * «Deshacer» hasta que se cierra (DELETE_UNDO_MS).
 */
export function DeleteSelected({ ids, preview, onConfirm, onCancel }: {
  ids: readonly string[];
  preview?: GuestActions["previewRemove"];
  onConfirm: () => void; onCancel: () => void;
}) {
  // undefined = comprobando; null = no se ha podido comprobar (se dice).
  const [impact, setImpact] = useState<GiftDeletionImpact | null | undefined>(preview ? undefined : null);
  useEffect(() => {
    if (!preview) return;
    let live = true;
    preview([...ids]).then((result) => { if (live) setImpact(result.ok ? { giftsDeleted: result.giftsDeleted, giftsKept: result.giftsKept } : null); }, () => { if (live) setImpact(null); });
    return () => { live = false; };
  }, [ids, preview]);
  const count = ids.length;
  const checking = impact === undefined;
  return (
    <div className="pn-form" role="group" aria-label={`Borrar a ${plural(count, "invitado", "invitados")}`}>
      <p className="text-sm font-semibold">¿Borrar a {plural(count, "invitado elegido", "invitados elegidos")}?</p>
      {checking
        ? <p className="pn-help" aria-live="polite">Comprobando sus regalos…</p>
        : deleteConfirmText(count, impact).map((line) => <p key={line} className="pn-help">{line}</p>)}
      <p className="pn-help">Tendréis unos segundos para deshacerlo.</p>
      <div className="pn-form-actions">
        <button type="button" disabled={checking} onClick={onConfirm} className="pn-btn pn-btn--danger pn-press">
          <Trash2Icon aria-hidden="true" className="size-4" />Borrar ({formatCount(count)})
        </button>
        <button type="button" onClick={onCancel} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Cancelar</button>
      </div>
    </div>
  );
}

/**
 * «Asistencia…»: marca la misma respuesta a todos los elegidos, como si la
 * cambiaseis en la ficha de cada uno. Una sola escritura (setGuestsStatus).
 */
export function StatusSelected({ count, onSave }: { count: number; onSave: (status: RsvpStatus) => Promise<string | null> }) {
  const [status, setStatus] = useState<RsvpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form className="pn-form" onSubmit={(event) => {
      event.preventDefault();
      if (!status) return;
      setError(null);
      startTransition(async () => {
        try { const problem = await onSave(status); if (problem) setError(problem); }
        catch { setError("No se ha guardado. Comprobad la conexión y probad de nuevo."); }
      });
    }}>
      <p className="pn-help">{plural(count, "invitado elegido", "invitados elegidos")}. Es lo mismo que cambiar «Asistencia» en la ficha de cada uno.</p>
      <fieldset disabled={pending} className="pn-field pn-span">
        <legend>Asistencia</legend>
        <div className="pn-group-picks" role="radiogroup" aria-label="Asistencia de los elegidos">
          {(["si", "no", "pendiente"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={status === value} className="pn-chip pn-chip--pick pn-press"
              onClick={() => { setStatus(value); setError(null); }}>
              {status === value ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}{RSVP_LABELS[value]}
            </button>
          ))}
        </div>
        {status && <small>{statusChangeHelp(status)}</small>}
      </fieldset>
      <p className="pn-help">Si después alguien responde desde su enlace, manda su respuesta.</p>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
      <div className="pn-form-actions">
        <button className="pn-btn pn-press" type="submit" disabled={pending || !status}>{pending ? "Guardando…" : status ? `Marcar «${RSVP_LABELS[status]}»` : "Guardar"}</button>
      </div>
    </form>
  );
}

/** Etiquetas que tienen los elegidos (para ofrecer «quitar»), por número de personas. */
export function presentTags(list: ReadonlyArray<{ tags?: string[] }>): string[] {
  const counts = new Map<string, number>();
  for (const guest of list) for (const item of guest.tags ?? []) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([name]) => name);
}

/**
 * «Etiquetar…» con varios elegidos: etiquetas que añadir (campo de etiquetas),
 * las que ya tienen para quitarlas a todos y, opcionalmente, su lado. Una
 * escritura por cosa (setGuestsTags y setGuestsSide).
 */
export function TagSelected({ count, tags, present, canSide, canLimit, onSave }: {
  /** undefined = sin etiquetas (sin la migración): solo el tope de acompañantes. */
  count: number; tags?: TagContext; present: readonly string[]; canSide: boolean; canLimit: boolean;
  onSave: (change: { add: string[]; remove: string[]; side: SideChoice; limit: CompanionLimitChoice }) => Promise<string | null>;
}) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<ReadonlySet<string>>(() => new Set());
  const [side, setSide] = useState<SideChoice>("keep");
  const [limit, setLimit] = useState<CompanionLimitChoice>("keep");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const removeList = present.filter((name) => remove.has(name));
  const nothing = add.length === 0 && removeList.length === 0 && side === "keep" && limit === "keep";
  return (
    <form className="pn-form" onSubmit={(event) => {
      event.preventDefault();
      if (nothing) return;
      setError(null);
      startTransition(async () => {
        try { const problem = await onSave({ add, remove: removeList, side, limit }); if (problem) setError(problem); }
        catch { setError("No se ha guardado. Comprobad la conexión y probad de nuevo."); }
      });
    }}>
      <p className="pn-help">{plural(count, "invitado elegido", "invitados elegidos")}.{tags ? " Las etiquetas que ya tenían se conservan; quien llegue a 8 se queda con las suyas." : ""}</p>
      <fieldset disabled={pending} className="contents">
        <legend className="sr-only">{tags ? "Etiquetas, lado y acompañantes de los elegidos" : "Acompañantes de los elegidos"}</legend>
        {tags && <TagField value={add} onChange={(next) => { setAdd(next); setError(null); }} existing={tags.names} suggestions={tags.suggestions} label="Añadir a todos" help="Tocad una de las vuestras o escribid una nueva." />}
        {tags && present.length > 0 && (
          <div className="pn-field pn-span">
            <span>Quitar a todos</span>
            <div className="pn-group-picks" role="group" aria-label="Etiquetas que ya tienen">
              {present.map((name) => {
                const on = remove.has(name);
                return (
                  <button key={name} type="button" aria-pressed={on} className="pn-chip pn-chip--pick pn-press"
                    onClick={() => setRemove((current) => { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next; })}>
                    {on ? <XIcon aria-hidden="true" className="size-3.5" /> : null}{name}
                  </button>
                );
              })}
            </div>
            <small>Tocad las que queráis quitarles.</small>
          </div>
        )}
        {tags && canSide && <SideField value={side} onChange={setSide} labels={tags.sideLabels} label="De quién son invitados" keepLabel="No cambiar" />}
        {canLimit && <CompanionLimitBulkField value={limit} onChange={(next) => { setLimit(next); setError(null); }} />}
      </fieldset>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
      <div className="pn-form-actions">
        <button className="pn-btn pn-press" type="submit" disabled={pending || nothing}>{pending ? "Guardando…" : "Guardar"}</button>
      </div>
    </form>
  );
}
