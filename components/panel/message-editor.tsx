"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  TEMPLATE_KINDS, TEMPLATE_MAX_LENGTH, defaultTemplate, firstName, renderTemplate, validateTemplate,
  type MessageContext, type TemplateKind, type TemplateVariable,
} from "@/lib/messages/templates";
import { formatCount } from "@/components/panel/guest-status";
import { MessageBubble } from "@/components/panel/message-bubble";

export type TemplateResult = { ok: true } | { ok: false; error: string };
export interface MessageEditorActions {
  save(kind: TemplateKind, body: string): Promise<TemplateResult>;
  reset(kind: TemplateKind): Promise<TemplateResult>;
}
export interface SavedTemplate { body: string; isDefault: boolean }

const KIND_LABELS: Record<TemplateKind, string> = { invitation: "Invitación", reminder: "Recordatorio", thanks: "Agradecimiento" };
const KIND_HELP: Record<TemplateKind, string> = {
  invitation: "Se abre en WhatsApp cuando compartís la invitación personal de cada persona.",
  reminder: "Para quien ya recibió la invitación y aún no ha respondido. Se usa en «Recordar a quien no ha respondido».",
  thanks: "Para dar las gracias por un regalo. Se abre en WhatsApp desde la ficha de cada invitado, en «Regalo». No lleva enlace.",
};
/** Variables por mensaje: el agradecimiento no lleva enlace y solo usa nombre y novios (CHECK 20261008100000). */
const VARIABLES: Array<{ key: TemplateVariable; label: string }> = [
  { key: "nombre", label: "Nombre" },
  { key: "enlace", label: "Enlace personal" },
  { key: "novios", label: "Vuestros nombres" },
  { key: "fecha", label: "Fecha de la boda" },
];

/**
 * Editor de los dos mensajes de WhatsApp. Variables como chips que se
 * insertan donde está el cursor (sin cerrar el teclado en el móvil), vista
 * previa en burbuja con un invitado real, validación con los mismos textos
 * que el servidor y «Volver al texto original» con deshacer.
 */
export function MessageEditor({ templates, context, sampleName, sampleLink, actions, initialKind = "invitation" }: {
  templates: Record<TemplateKind, SavedTemplate>;
  context: MessageContext;
  /** Nombre de un invitado real de la lista (o «Marta» si no hay). */
  sampleName: string;
  /** Enlace de ejemplo con el formato real (no es un enlace válido). */
  sampleLink: string;
  actions: MessageEditorActions;
  initialKind?: TemplateKind;
}) {
  const [kind, setKind] = useState<TemplateKind>(initialKind);
  const [saved, setSaved] = useState(templates);
  const [drafts, setDrafts] = useState<Record<TemplateKind, string>>({ invitation: templates.invitation.body, reminder: templates.reminder.body, thanks: templates.thanks.body });
  const [showErrors, setShowErrors] = useState<Record<TemplateKind, boolean>>({ invitation: false, reminder: false, thanks: false });
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const ids = { area: useId(), help: useId(), error: useId(), count: useId() };

  const draft = drafts[kind];
  const needsLink = kind !== "thanks";
  const validation = validateTemplate(draft, kind);
  const dirty = (k: TemplateKind) => drafts[k].trim() !== saved[k].body.trim();
  const missingLink = needsLink && !draft.includes("{enlace}");
  const isOriginal = draft.trim() === defaultTemplate(kind) && saved[kind].isDefault;
  const preview = renderTemplate(draft, { nombre: firstName(sampleName), enlace: needsLink ? sampleLink : "", novios: context.novios, fecha: context.fecha });
  const variables = needsLink ? VARIABLES : VARIABLES.filter(({ key }) => key === "nombre" || key === "novios");
  const errorText = serverError ?? (showErrors[kind] && !validation.ok ? validation.error : null);

  // Cambios sin guardar: el navegador avisa antes de salir.
  const anyDirty = TEMPLATE_KINDS.some(dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; // returnValue: Safari
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [kind]: value }));
    setServerError(null);
    setStatus("");
  }

  function insert(variable: TemplateVariable) {
    const token = `{${variable}}`;
    const area = areaRef.current;
    const focused = area !== null && document.activeElement === area;
    const range = focused ? { start: area.selectionStart, end: area.selectionEnd } : selection.current ?? { start: draft.length, end: draft.length };
    const before = draft.slice(0, range.start);
    const after = draft.slice(range.end);
    // Un espacio a cada lado si el token cae pegado a una palabra.
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
    const next = `${before}${lead}${token}${trail}${after}`;
    if (next.length > TEMPLATE_MAX_LENGTH) { setServerError(`El mensaje puede tener como máximo ${formatCount(TEMPLATE_MAX_LENGTH)} caracteres.`); return; }
    setDraft(next);
    const caret = before.length + lead.length + token.length;
    selection.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      if (!areaRef.current) return;
      if (focused) areaRef.current.setSelectionRange(caret, caret);
    });
  }

  function save() {
    setShowErrors((current) => ({ ...current, [kind]: true }));
    if (!validation.ok) { areaRef.current?.focus(); return; }
    const body = validation.body;
    const current = kind;
    startTransition(async () => {
      try {
        const result = await actions.save(current, body);
        if (!result.ok) { setServerError(result.error); return; }
        setSaved((all) => ({ ...all, [current]: { body, isDefault: false } }));
        setDrafts((all) => ({ ...all, [current]: body }));
        setStatus(`Mensaje de ${KIND_LABELS[current].toLowerCase()} guardado.`);
      } catch { setServerError("No hemos podido guardarlo. Comprobad la conexión y probad de nuevo."); }
    });
  }

  function restoreOriginal() {
    const current = kind;
    const previousSaved = saved[current];
    const previousDraft = drafts[current];
    setServerError(null);
    setShowErrors((all) => ({ ...all, [current]: false }));
    if (previousSaved.isDefault) {
      // Nada guardado: solo se recupera el texto en el campo.
      setDrafts((all) => ({ ...all, [current]: defaultTemplate(current) }));
      toast("Texto original recuperado", { id: `original-${current}`, action: { label: "Deshacer", onClick: () => setDrafts((all) => ({ ...all, [current]: previousDraft })) } });
      return;
    }
    startTransition(async () => {
      try {
        const result = await actions.reset(current);
        if (!result.ok) { setServerError(result.error); return; }
        setSaved((all) => ({ ...all, [current]: { body: defaultTemplate(current), isDefault: true } }));
        setDrafts((all) => ({ ...all, [current]: defaultTemplate(current) }));
        toast("Texto original recuperado", {
          id: `original-${current}`,
          action: {
            label: "Deshacer",
            onClick: async () => {
              const back = await actions.save(current, previousSaved.body).catch(() => ({ ok: false as const, error: "" }));
              if (!back.ok) {
                // Se devuelve al campo para que no se pierda; queda pendiente de guardar.
                setDrafts((all) => ({ ...all, [current]: previousDraft }));
                toast("No se ha podido guardar vuestro texto anterior. Lo tenéis en el campo: pulsad «Guardar el mensaje».");
                return;
              }
              setSaved((all) => ({ ...all, [current]: previousSaved }));
              setDrafts((all) => ({ ...all, [current]: previousDraft }));
            },
          },
        });
      } catch { setServerError("No hemos podido recuperar el texto original. Probad de nuevo."); }
    });
  }

  function onTabKey(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = TEMPLATE_KINDS[(TEMPLATE_KINDS.indexOf(kind) + 1) % TEMPLATE_KINDS.length];
    setKind(next);
    setServerError(null);
    requestAnimationFrame(() => document.getElementById(`${ids.area}-tab-${next}`)?.focus());
  }

  return (
    <div className="pn-msg">
      <div className="pn-msg-edit">
        <div role="tablist" aria-label="Mensaje que editáis" className="pn-segment" onKeyDown={onTabKey}>
          {TEMPLATE_KINDS.map((value) => (
            <button key={value} id={`${ids.area}-tab-${value}`} type="button" role="tab" aria-selected={kind === value} aria-controls={`${ids.area}-panel`} tabIndex={kind === value ? 0 : -1}
              onClick={() => { setKind(value); setServerError(null); setStatus(""); }} className="pn-segment-btn">
              {KIND_LABELS[value]}
              {dirty(value) && <span className="pn-dot" aria-label="(sin guardar)" />}
            </button>
          ))}
        </div>

        <div id={`${ids.area}-panel`} role="tabpanel" aria-labelledby={`${ids.area}-tab-${kind}`} className="grid gap-4">
          <p className="pn-muted text-sm leading-relaxed">{KIND_HELP[kind]}</p>

          <div className="pn-field">
            <span className="flex items-baseline justify-between gap-3">
              <label htmlFor={ids.area}>Texto del mensaje</label>
              <span id={ids.count} className="pn-tnum pn-muted text-xs font-normal" aria-live="off">{formatCount(draft.length)} / {formatCount(TEMPLATE_MAX_LENGTH)}</span>
            </span>
            <textarea
              id={ids.area}
              ref={areaRef}
              rows={7}
              maxLength={TEMPLATE_MAX_LENGTH}
              value={draft}
              aria-invalid={errorText ? true : undefined}
              aria-describedby={`${ids.help} ${ids.count}${errorText ? ` ${ids.error}` : ""}`}
              onChange={(event) => setDraft(event.target.value)}
              onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
              onBlur={() => setShowErrors((all) => ({ ...all, [kind]: true }))}
              className="pn-msg-area"
            />
            {errorText && <p id={ids.error} role="alert" className="pn-row-error">{errorText}</p>}
          </div>

          <div className="grid gap-2">
            <p id={ids.help} className="pn-help">Tocad una variable para añadirla donde está el cursor. Vinklo la cambia por el dato de cada persona.</p>
            <div className="pn-vars" role="group" aria-label="Variables">
              {variables.map(({ key, label }) => {
                const missing = key === "enlace" && missingLink;
                return (
                  <button key={key} type="button" className="pn-var pn-press" data-missing={missing ? "true" : undefined}
                    onPointerDown={(event) => event.preventDefault()} onClick={() => insert(key)}
                    aria-label={`Añadir ${label.toLowerCase()}${key === "enlace" ? " (obligatorio)" : ""}`}>
                    <span>{label}</span>
                    <code>{`{${key}}`}</code>
                    {key === "enlace" && <small>{missing ? "Falta" : "Obligatorio"}</small>}
                  </button>
                );
              })}
            </div>
            {!context.fecha && draft.includes("{fecha}") && (
              <p className="pn-help">Vuestra boda aún no tiene fecha: la frase con {"{fecha}"} no se enviará hasta que la pongáis en «Vuestra web».</p>
            )}
          </div>

        </div>
      </div>

      <aside className="pn-msg-preview" aria-label="Vista previa">
        <p className="pn-help">Así quedará en WhatsApp para {firstName(sampleName) || sampleName}.{needsLink ? " El enlace es de ejemplo: cada persona recibe el suyo." : ""}</p>
        <MessageBubble text={preview} recipient={sampleName} />
        <p className="pn-help">Vinklo no envía nada: el mensaje se abre en vuestro WhatsApp y lo enviáis vosotros.</p>
      </aside>

      {/* Después de la vista previa en móvil: se guarda tras ver cómo queda. */}
      <div className="pn-msg-actions">
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-press" disabled={pending || !dirty(kind)} onClick={save}>
            {pending ? "Guardando…" : "Guardar el mensaje"}
          </button>
          <button type="button" className="pn-link pn-press" disabled={pending || isOriginal} onClick={restoreOriginal}>
            Volver al texto original
          </button>
        </div>
        <p className="pn-help" role="status" aria-live="polite">
          {status || (dirty(kind) ? "Cambios sin guardar." : saved[kind].isDefault ? "Estáis usando el texto original de Vinklo." : "")}
        </p>
      </div>
    </div>
  );
}
