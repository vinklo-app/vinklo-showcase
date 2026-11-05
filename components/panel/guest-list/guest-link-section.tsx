"use client";

import { useId, useState, useTransition } from "react";
import { CheckIcon, CopyIcon, MessageCircleIcon, RepeatIcon, Share2Icon } from "lucide-react";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { buildMessage, firstName } from "@/lib/messages/templates";
import { WhatsAppCompose, type ComposeRequest } from "@/components/panel/whatsapp-compose";
import type { GuestActions, GuestRow, InvitationMessage } from "./types";

/**
 * Mensaje de invitación de esta persona con su enlace, listo para revisar en
 * la hoja de WhatsApp. null = su teléfono no sirve para WhatsApp.
 */
export function invitationCompose(guest: Pick<GuestRow, "name" | "phone">, link: string, message?: InvitationMessage): ComposeRequest | null {
  if (!whatsappNumber(guest.phone)) return null;
  const context = message?.context ?? { novios: "", fecha: "" };
  return {
    kind: "invitation", name: guest.name, phone: guest.phone,
    text: buildMessage("invitation", message?.template, guest.name, link, context),
    vars: { nombre: firstName(guest.name), enlace: link, novios: context.novios, fecha: context.fecha },
  };
}

/**
 * Enlace personal recién emitido: campo para copiar, WhatsApp con el mensaje
 * relleno (antes se revisa y se puede retocar en la hoja) y, si toca,
 * «Marcar enviada». Lo comparten la fila y la ficha.
 * `mode`: «new» = enlace nuevo (los anteriores quedan revocados), «resend» =
 * enlace añadido para reenviar (el anterior sigue funcionando).
 */
export function ShareBox({ name, link, compose, saveTemplate, mode, confirm }: {
  name: string; link: string; mode: "new" | "resend";
  /** Mensaje para WhatsApp (null = sin teléfono válido). */
  compose: ComposeRequest | null;
  saveTemplate?: GuestActions["saveTemplate"];
  /** «Marcar enviada» (solo si el envío aún no está confirmado). */
  confirm?: { onClick: () => void; pending: boolean; done?: boolean };
}) {
  // Copia fija del mensaje al abrir la hoja: lo que se edita no se pierde si la fila se repinta.
  const [composing, setComposing] = useState<ComposeRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return (
    <div className="pn-row-share">
      <label className="pn-help">
        Enlace personal de {name}
        <input aria-label={`Enlace personal de ${name}`} className="mt-1" readOnly value={link} onFocus={(event) => event.target.select()} />
      </label>
      <div className="pn-row-share-actions">
        {compose && (
          <button type="button" onClick={() => setComposing(compose)} className="pn-btn pn-btn--sm pn-press">
            <MessageCircleIcon aria-hidden="true" className="size-4" />Abrir WhatsApp
          </button>
        )}
        <button type="button" onClick={copy} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">
          <CopyIcon aria-hidden="true" className="size-4" />{copied ? "Enlace copiado" : "Copiar enlace"}
        </button>
        {confirm && !confirm.done && (
          <button type="button" disabled={confirm.pending} onClick={confirm.onClick} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">
            <CheckIcon aria-hidden="true" className="size-4" />Marcar enviada
          </button>
        )}
      </div>
      {copyError && <p role="alert" className="pn-row-error">Seleccionad y copiad el enlace del campo de texto.</p>}
      {!compose && <p>Sin un teléfono válido no podemos abrir WhatsApp: copiad el enlace y enviádselo vosotros.</p>}
      {mode === "resend" ? (
        <p>Es un enlace más para {name}: el que ya tenía sigue funcionando y su invitación sigue contando como enviada. Quien tenga este enlace puede responder por esta persona.</p>
      ) : (
        <>
          {confirm && !confirm.done && <p>Abrir WhatsApp o copiar no confirma el envío. Tras mandarla, pulsad «Marcar enviada» para contar a esta persona.</p>}
          <p>Guardadlo antes de salir. Quien tenga este enlace puede responder por esta persona. Los enlaces anteriores quedan revocados.</p>
        </>
      )}
      <WhatsAppCompose request={composing} onClose={() => setComposing(null)} saveTemplate={saveTemplate} />
    </div>
  );
}

/**
 * «Enlace personal» en la ficha: el único sitio donde se revoca un enlace.
 * «Reenviar» añade un enlace sin revocar nada (con el envío confirmado);
 * «Enlace nuevo» pide confirmación en línea (no un diálogo nativo) porque deja
 * sin acceso a quien tenga el anterior y quita la marca de «enviada».
 */
/** Estado honesto (revisión Jobs #17): visible en la ficha, no solo en el title de la lista. */
export const WHATSAPP_NO_DELIVERY = "WhatsApp no confirma la entrega a Vinklo.";

export function GuestLinkSection({ guest, actions, message, first = false }: { guest: GuestRow; actions: GuestActions; message?: InvitationMessage; first?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [issued, setIssued] = useState<{ link: string; mode: "new" | "resend" } | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const hasLink = guest.invitation_prepared_at !== null;
  const wasSent = guest.invitation_sent_at !== null;
  const canResend = wasSent && Boolean(actions.createReminderLink);

  function issue(mode: "new" | "resend") {
    setError(null); setAsking(false);
    startTransition(async () => {
      try {
        const result = mode === "resend" && actions.createReminderLink ? await actions.createReminderLink(guest.id) : await actions.createInvitation(guest.id);
        if (!result.ok) { setError(result.error); return; }
        setSent(false);
        setIssued({ link: new URL(result.path, window.location.origin).href, mode });
      } catch { setError("No se ha podido crear el enlace. Probad de nuevo."); }
    });
  }
  function confirmSent() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await actions.confirmSent(guest.id);
        if (!result.ok) { setError(result.error); return; }
        setSent(true);
      } catch { setError("No se ha guardado el envío. Probad de nuevo."); }
    });
  }

  const status = issued
    ? issued.mode === "resend"
      ? "Enlace añadido para reenviar: el que ya tenía sigue funcionando."
      : "Enlace nuevo creado: los anteriores ya no funcionan. Mandádselo y confirmad el envío."
    : !hasLink
    ? "Aún no tiene enlace personal. Al crearlo podréis mandárselo por WhatsApp."
    : wasSent
      ? `Tiene su enlace y habéis confirmado el envío. ${WHATSAPP_NO_DELIVERY} Si lo ha perdido, reenviádselo: su enlace actual sigue funcionando.`
      : "Tiene su enlace preparado, pero no habéis confirmado el envío.";

  return (
    <section className="pn-sheet-section" data-first={first ? "true" : undefined} aria-labelledby={titleId}>
      <h3 id={titleId} className="pn-sheet-section-title">Enlace personal</h3>
      <p className="pn-help">{status}</p>
      {issued ? (
        <ShareBox name={guest.name} link={issued.link} compose={invitationCompose(guest, issued.link, message)} saveTemplate={actions.saveTemplate} mode={issued.mode}
          confirm={issued.mode === "new" ? { onClick: confirmSent, pending, done: sent } : undefined} />
      ) : asking ? (
        <div className="pn-gift-ask" role="group" aria-label="Confirmar enlace nuevo">
          <p className="text-sm font-semibold">¿Crear un enlace nuevo para {guest.name}?</p>
          <p className="pn-help">
            El enlace que tiene dejará de funcionar: no podrá abrir la invitación ni cambiar su respuesta con él.
            {wasSent ? " Además se quita la marca de «enviada» y tendréis que confirmar el envío otra vez." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => issue("new")} className="pn-btn pn-btn--danger pn-btn--sm pn-press">Sí, crear enlace nuevo</button>
            <button type="button" disabled={pending} onClick={() => setAsking(false)} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {!hasLink ? (
            <button type="button" disabled={pending} onClick={() => issue("new")} className="pn-btn pn-btn--sm pn-press">
              <Share2Icon aria-hidden="true" className="size-4" />{pending ? "Un momento…" : "Crear su enlace"}
            </button>
          ) : (
            <>
              {canResend && (
                <button type="button" disabled={pending} onClick={() => issue("resend")} className="pn-btn pn-btn--sm pn-press">
                  <RepeatIcon aria-hidden="true" className="size-4" />{pending ? "Un momento…" : "Reenviar"}
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => setAsking(true)} className="pn-link pn-press">Enlace nuevo…</button>
            </>
          )}
        </div>
      )}
      {sent && <p className="pn-note pn-note--ok">Envío confirmado por vosotros. {WHATSAPP_NO_DELIVERY} Al cerrar la ficha lo veréis en la lista.</p>}
      {error && <p role="alert" className="pn-row-error">{error}</p>}
    </section>
  );
}
