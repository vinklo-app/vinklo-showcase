"use client";

import { useId, useRef, useState, useTransition } from "react";
import {
  DEFAULT_TEMPLATES, TEMPLATE_MAX_LENGTH, validateTemplate, type TemplateVariable,
} from "@/lib/messages/templates";
import { formatCount } from "@/components/panel/guest-status";

export type TemplateActionResult = { ok: true } | { ok: false; error: string };
export interface ReminderTemplateActions {
  save(body: string): Promise<TemplateActionResult>;
  reset(): Promise<TemplateActionResult>;
}

const VARIABLES: Array<{ key: TemplateVariable; label: string }> = [
  { key: "nombre", label: "Nombre" },
  { key: "enlace", label: "Enlace" },
  { key: "novios", label: "Vuestros nombres" },
  { key: "fecha", label: "Fecha" },
];

/**
 * Editar el texto del recordatorio sin salir de la fila. Antes «Cambiar el
 * texto» era un enlace a /panel/invitados/mensajes: sacaba a la pareja de en
 * medio de los recordatorios. Ahora se abre aquí mismo, dentro de la tarjeta
 * de la persona actual, y el padre (ReminderQueue) recibe cada tecla para
 * que la burbuja de vista previa cambie en vivo, antes incluso de guardar.
 */
export function ReminderTemplateInline({ initial, isDefault, actions, onDraftChange, onSaved, kind = "reminder" }: {
  /** Qué texto se edita: el recordatorio (por defecto) o la invitación (envío en serie). */
  kind?: "reminder" | "invitation";
  /** Texto efectivo actual (guardado o el de Vinklo). */
  initial: string;
  isDefault: boolean;
  actions: ReminderTemplateActions;
  /** Cada tecla mientras está abierto; `null` al cerrar sin guardar. */
  onDraftChange: (draft: string | null) => void;
  /** Tras guardar o recuperar: el nuevo texto guardado, o `null` = texto de Vinklo. */
  onSaved: (savedBodyOrNull: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [savedIsDefault, setSavedIsDefault] = useState(isDefault);
  const [showError, setShowError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const ids = { area: useId(), count: useId(), error: useId() };

  const validation = validateTemplate(draft, kind);
  const errorText = serverError ?? (showError && !validation.ok ? validation.error : null);
  const dirty = draft.trim() !== initial.trim();

  function openEditor() {
    setDraft(initial);
    setOpen(true);
    onDraftChange(initial);
    requestAnimationFrame(() => areaRef.current?.focus());
  }
  function close() {
    setOpen(false);
    setServerError(null);
    setShowError(false);
    onDraftChange(null);
  }
  function change(value: string) {
    setDraft(value);
    onDraftChange(value);
    setServerError(null);
  }
  function insert(variable: TemplateVariable) {
    const token = `{${variable}}`;
    const area = areaRef.current;
    const start = area?.selectionStart ?? draft.length;
    const end = area?.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    const after = draft.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
    const next = `${before}${lead}${token}${trail}${after}`;
    if (next.length > TEMPLATE_MAX_LENGTH) return;
    change(next);
    const caret = before.length + lead.length + token.length;
    requestAnimationFrame(() => area?.setSelectionRange(caret, caret));
  }
  function save() {
    setShowError(true);
    if (!validation.ok) { areaRef.current?.focus(); return; }
    const body = validation.body;
    startTransition(async () => {
      try {
        const result = await actions.save(body);
        if (!result.ok) { setServerError(result.error); return; }
        setSavedIsDefault(false);
        onSaved(body);
        close();
      } catch { setServerError("No hemos podido guardarlo. Comprobad la conexión y probad de nuevo."); }
    });
  }
  function restoreOriginal() {
    if (savedIsDefault) { change(DEFAULT_TEMPLATES[kind]); return; }
    startTransition(async () => {
      try {
        const result = await actions.reset();
        if (!result.ok) { setServerError(result.error); return; }
        setSavedIsDefault(true);
        onSaved(null);
        close();
      } catch { setServerError("No hemos podido recuperarlo. Probad de nuevo."); }
    });
  }

  if (!open) {
    return (
      <button type="button" className="pn-link pn-press pn-queue-template-toggle" onClick={openEditor}>
        Cambiar el texto
      </button>
    );
  }

  return (
    <div className="pn-field pn-queue-template">
      <span className="flex items-baseline justify-between gap-3">
        <label htmlFor={ids.area}>{kind === "invitation" ? "Texto de la invitación" : "Texto del recordatorio"}</label>
        <span id={ids.count} className="pn-tnum pn-muted text-xs font-normal" aria-live="off">
          {formatCount(draft.length)} / {formatCount(TEMPLATE_MAX_LENGTH)}
        </span>
      </span>
      <textarea
        id={ids.area}
        ref={areaRef}
        rows={5}
        maxLength={TEMPLATE_MAX_LENGTH}
        value={draft}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={`${ids.count}${errorText ? ` ${ids.error}` : ""}`}
        onChange={(event) => change(event.target.value)}
        onBlur={() => setShowError(true)}
        className="pn-msg-area"
      />
      {errorText && <p id={ids.error} role="alert" className="pn-row-error">{errorText}</p>}
      <div className="pn-vars" role="group" aria-label="Variables">
        {VARIABLES.map(({ key, label }) => (
          <button key={key} type="button" className="pn-var pn-press" onPointerDown={(event) => event.preventDefault()} onClick={() => insert(key)}>
            <span>{label}</span>
            <code>{`{${key}}`}</code>
          </button>
        ))}
      </div>
      <div className="pn-form-actions">
        <button type="button" className="pn-btn pn-press" disabled={pending || !dirty} onClick={save}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="pn-link pn-press" disabled={pending} onClick={close}>Cancelar</button>
        {!savedIsDefault && (
          <button type="button" className="pn-link pn-press pn-muted" disabled={pending} onClick={restoreOriginal}>
            Volver al texto de Vinklo
          </button>
        )}
      </div>
    </div>
  );
}
