"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MessageCircleIcon } from "lucide-react";
import { GuestSheet } from "@/components/panel/guest-sheet";
import { whatsappMessageUrl, whatsappNumber } from "@/lib/invitation-sharing";
import { COMPOSE_ERRORS, COMPOSE_MAX_LENGTH, composeIssue, needsLink, restoreLink, templateFromText } from "@/lib/messages/compose";
import { firstName, type TemplateKind, type TemplateVars } from "@/lib/messages/templates";

export type SaveTemplateResult = { ok: true } | { ok: false; error: string };

/** Un envío: a quién, qué tipo de mensaje y el texto ya relleno con su enlace. */
export interface ComposeRequest {
  kind: TemplateKind;
  name: string;
  phone: string | null;
  /** Texto ya relleno (plantilla + nombre + enlace…). */
  text: string;
  /** Valores con los que se rellenó: sirven para volver a la plantilla al guardarla. */
  vars: TemplateVars;
}

export interface ComposeOpened { url: string; text: string }

const TEMPLATE_NAMES: Record<TemplateKind, string> = {
  invitation: "la invitación",
  reminder: "el recordatorio",
  thanks: "el agradecimiento",
};
const SAVE_ERROR = "No se ha guardado. Comprobad la conexión y probad de nuevo.";

/**
 * Hoja común antes de abrir WhatsApp (invitación en serie, recordatorios,
 * enlace de la fila o de la ficha y agradecimiento de un regalo): la pareja
 * ve el mensaje exacto y lo puede cambiar solo para esta persona. «Guardar
 * como plantilla» es la única vía para que el cambio valga para todos.
 * «Abrir WhatsApp» es un enlace real (toque del usuario: ningún navegador lo
 * bloquea) y NO marca nada como enviado: eso lo confirma la pareja después.
 */
export function WhatsAppCompose({ request, onClose, onOpened, saveTemplate, onTemplateSaved, target = "_blank" }: {
  /** null = cerrada. */
  request: ComposeRequest | null;
  onClose: () => void;
  /** Se ha tocado «Abrir WhatsApp» con este texto (no acredita el envío). */
  onOpened?: (opened: ComposeOpened) => void;
  /** Sin ella no se ofrece «Guardar como plantilla». */
  saveTemplate?: (kind: TemplateKind, body: string) => Promise<SaveTemplateResult>;
  onTemplateSaved?: (kind: TemplateKind, body: string) => void;
  /** Pestaña donde se abre WhatsApp (el envío en serie reutiliza una con nombre). */
  target?: string;
}) {
  // La hoja conserva el último envío mientras se anima su salida.
  const [shown, setShown] = useState<{ request: ComposeRequest; seq: number } | null>(null);
  // Con cambios sin usar, cerrar (Esc, ✕, fondo, arrastre, Cancelar) pregunta antes.
  const [edited, setEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (request && request !== shown?.request) {
    setShown({ request, seq: (shown?.seq ?? 0) + 1 });
    setEdited(false);
    setConfirming(false);
  }
  const current = request ?? shown?.request ?? null;
  const requestClose = () => { if (edited) setConfirming(true); else onClose(); };
  return (
    <GuestSheet open={request !== null} title={current ? `Mensaje para ${firstName(current.name) || current.name}` : "Mensaje"} onClose={requestClose} confirmClose={edited}>
      {current && shown && (
        <ComposeBody key={shown.seq} request={current} onClose={onClose} onCancel={requestClose} onOpened={onOpened}
          onEditedChange={setEdited} confirming={confirming} onKeepEditing={() => setConfirming(false)}
          saveTemplate={saveTemplate} onTemplateSaved={onTemplateSaved} target={target} />
      )}
    </GuestSheet>
  );
}

function ComposeBody({ request, onClose, onCancel, onOpened, onEditedChange, confirming, onKeepEditing, saveTemplate, onTemplateSaved, target }: {
  request: ComposeRequest;
  /** Cierra sin preguntar (tras abrir WhatsApp o al descartar). */
  onClose: () => void;
  /** «Cancelar»: pregunta si hay cambios. */
  onCancel: () => void;
  onEditedChange: (edited: boolean) => void;
  confirming: boolean;
  onKeepEditing: () => void;
  onOpened?: (opened: ComposeOpened) => void;
  saveTemplate?: (kind: TemplateKind, body: string) => Promise<SaveTemplateResult>;
  onTemplateSaved?: (kind: TemplateKind, body: string) => void;
  target: string;
}) {
  const [text, setText] = useState(request.text);
  const [saving, setSaving] = useState<"ask" | "pending" | "done" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ids = { area: useId(), help: useId(), issue: useId(), discard: useId() };
  const discardRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (confirming) discardRef.current?.focus(); }, [confirming]);
  const link = needsLink(request.kind) ? (request.vars.enlace ?? null) : null;
  const issue = composeIssue(text, request.kind, link);
  const phoneOk = whatsappNumber(request.phone) !== null;
  const url = !issue ? whatsappMessageUrl(request.phone, text.trim()) : null;
  const edited = text.trim() !== request.text.trim();
  // Solo cuando se ha pedido guardar: son varias expresiones regulares por tecla.
  const template = saving ? templateFromText(text, request.vars, request.kind) : null;
  const name = TEMPLATE_NAMES[request.kind];

  function change(value: string) {
    setText(value);
    onEditedChange(value.trim() !== request.text.trim());
    setSaveError(null);
    if (saving !== "pending") setSaving(null);
  }
  async function save() {
    if (!saveTemplate || !template?.ok) return;
    setSaving("pending");
    setSaveError(null);
    try {
      const body = template.body;
      const result = await saveTemplate(request.kind, body);
      if (!result.ok) { setSaving("ask"); setSaveError(result.error); return; }
      setSaving("done");
      onTemplateSaved?.(request.kind, body);
    } catch { setSaving("ask"); setSaveError(SAVE_ERROR); }
  }

  return (
    <div className="pn-compose">
      <label className="pn-field" htmlFor={ids.area}>
        <span>Así le llegará a {request.name}</span>
        <textarea
          id={ids.area}
          rows={9}
          maxLength={COMPOSE_MAX_LENGTH}
          value={text}
          onChange={(event) => change(event.target.value)}
          aria-describedby={issue ? `${ids.help} ${ids.issue}` : ids.help}
          aria-invalid={issue ? true : undefined}
        />
      </label>
      <p id={ids.help} className="pn-help">
        Los cambios valen solo para este mensaje.{needsLink(request.kind) ? " No quitéis su enlace personal." : ""}
      </p>
      {issue && (
        <div id={ids.issue} role="alert" className="pn-compose-issue">
          <p className="pn-row-error">{issue}</p>
          {link && issue === COMPOSE_ERRORS.missingLink && (
            <button type="button" className="pn-link pn-press" onClick={() => change(restoreLink(text, link))}>Volver a poner el enlace</button>
          )}
        </div>
      )}
      {!phoneOk && <p className="pn-row-error" role="alert">Su teléfono no sirve para WhatsApp. Corregidlo en su ficha de invitados.</p>}

      {confirming ? (
        <div className="pn-gift-ask" role="group" aria-labelledby={ids.discard}>
          <p id={ids.discard} ref={discardRef} tabIndex={-1} className="text-sm font-semibold">¿Descartar los cambios?</p>
          <p className="pn-help">Lo que habéis cambiado en este mensaje se perderá.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pn-btn pn-btn--sm pn-press" onClick={onClose}>Descartar</button>
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onKeepEditing}>Seguir editando</button>
          </div>
        </div>
      ) : (
        <div className="pn-compose-actions">
          {url ? (
            <a href={url} target={target} rel="noopener noreferrer" className="pn-btn pn-btn--clay pn-press"
              onClick={() => { onOpened?.({ url, text: text.trim() }); onClose(); }}>
              <MessageCircleIcon aria-hidden="true" className="size-4" />Abrir WhatsApp
            </a>
          ) : (
            <button type="button" className="pn-btn pn-btn--clay pn-press" disabled>
              <MessageCircleIcon aria-hidden="true" className="size-4" />Abrir WhatsApp
            </button>
          )}
          <button type="button" className="pn-btn pn-btn--ghost pn-press" onClick={onCancel}>Cancelar</button>
        </div>
      )}
      <p className="pn-help">Abrir WhatsApp no lo envía ni lo marca como enviado: lo enviáis vosotros desde el chat.</p>

      {saveTemplate && edited && (
        <div className="pn-compose-save">
          {saving === "done" ? (
            <p className="pn-help" role="status">Guardado: a partir de ahora {name} saldrá con este texto.</p>
          ) : (saving === "ask" || saving === "pending") && template ? (
            template.ok ? (
              <div className="pn-gift-ask" role="group" aria-label="Guardar como plantilla">
                <p className="text-sm font-semibold">Así quedará {name} para todos:</p>
                <p className="pn-compose-template">{template.body}</p>
                <p className="pn-help">Lo que va entre llaves cambia para cada persona.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="pn-btn pn-btn--sm pn-press" disabled={saving === "pending"} onClick={save}>{saving === "pending" ? "Guardando…" : "Guardar plantilla"}</button>
                  <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={saving === "pending"} onClick={() => { setSaving(null); setSaveError(null); }}>Ahora no</button>
                </div>
                {saveError && <p role="alert" className="pn-row-error">{saveError}</p>}
              </div>
            ) : (
              <p role="alert" className="pn-row-error">No se puede guardar como plantilla: {template.error}</p>
            )
          ) : (
            <button type="button" className="pn-link pn-press" onClick={() => setSaving("ask")}>Guardar como plantilla</button>
          )}
        </div>
      )}
    </div>
  );
}
