"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, MessageCircleIcon, SendIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { buildMessage, DEFAULT_TEMPLATES, firstName as greetingName, type MessageContext } from "@/lib/messages/templates";
import { nextInSeries, type InvitationQueueItem } from "@/lib/messages/invitation-series";
import { formatCount } from "@/components/panel/guest-status";
import { MessageBubble } from "@/components/panel/message-bubble";
import { ReminderTemplateInline, type ReminderTemplateActions } from "@/components/panel/reminder-template-inline";
import { queueUrl, queueView, type QueueState } from "@/components/panel/reminders";
import { WhatsAppCompose, type ComposeRequest } from "@/components/panel/whatsapp-compose";
import { useFocusQuestion, useIssuedLinks } from "@/components/panel/queue-hooks";
import "@/components/panel/invitation-series.css";

type Result = { ok: true } | { ok: false; error: string };
type LinkResult = { ok: true; path: string } | { ok: false; error: string };
export interface InvitationSeriesActions {
  /** Añade un enlace personal sin revocar ninguno (createSeriesInvitation). */
  createLink(guestId: string): Promise<LinkResult>;
  /** La pareja declara que la ha enviado (confirmInvitationSent). */
  confirm(guestId: string): Promise<Result>;
}

/**
 * Pestaña con nombre para WhatsApp. Con rel="noopener" el navegador no la
 * reutiliza (cada invitado abre una nueva, igual que `_blank`); se mantiene
 * por si algún navegador sí lo hace, nunca es peor.
 */
const WHATSAPP_TARGET = "vinklo-whatsapp";
const OFFLINE = "No se ha guardado. Comprobad la conexión y probad de nuevo.";
const LINK_ERROR = "No se ha podido preparar el mensaje. Comprobad la conexión y probad de nuevo.";
const BAD_PHONE = "Su teléfono no sirve para WhatsApp. Corregidlo en su ficha de invitados.";

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * «Enviar las invitaciones» (plan maestro §4.1): la primera invitación, una
 * persona detrás de otra sin volver a la lista. Un toque crea su enlace
 * personal y enseña el mensaje exacto (editable solo para ella, punto 15 del
 * backlog); «Abrir WhatsApp» lo abre ya escrito. Al volver, «Sí · Ahora a…»
 * confirma el envío y enseña ya el mensaje de la siguiente persona. La persona en curso va en la URL
 * (`?persona=…&paso=confirmar`): si iOS recarga la página al volver de
 * WhatsApp, se retoma en la misma pregunta. La URL nunca lleva enlaces ni
 * tokens. Vinklo no envía nada ni sabe si llega: el envío lo declaráis
 * vosotros.
 */
export function InvitationSeries({ items, state, template, context, linkPreview, basePath, listHref, actions, templateActions, withoutPhone = 0 }: {
  items: InvitationQueueItem[];
  state: QueueState;
  /** Plantilla guardada o null = texto de Vinklo. */
  template: string | null;
  context: MessageContext;
  /** Enlace de ejemplo para la vista previa (el real se crea al abrir WhatsApp). */
  linkPreview: string;
  basePath: string;
  listHref: string;
  actions: InvitationSeriesActions;
  templateActions: ReminderTemplateActions;
  /** Sin enviar y sin teléfono válido: se mandan desde la lista copiando el enlace. */
  withoutPhone?: number;
}) {
  const router = useRouter();
  const view = queueView(items, state);
  const person = view.current;
  const [opened, setOpened] = useState<{ id: string; url: string } | null>(null);
  // Mensaje en revisión antes de abrir WhatsApp (whatsapp-compose.tsx).
  const [compose, setCompose] = useState<{ id: string; request: ComposeRequest } | null>(null);
  const links = useIssuedLinks(actions.createLink);
  const askRef = useRef<HTMLHeadingElement>(null);
  useFocusQuestion(askRef, Boolean(person && ((state.confirmar && state.persona === person.id) || opened?.id === person.id)), person?.id);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [savedTemplate, setSavedTemplate] = useState(template);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const effectiveTemplate = templateDraft ?? savedTemplate;
  const busy = preparing || saving || navigating;

  const go = (next: Partial<QueueState>) => startNavigation(() => router.replace(queueUrl(basePath, { ...state, ...next }), { scroll: false }));
  const withoutPhoneNote = withoutPhone > 0 && (
    <p className="pn-help">
      {withoutPhone === 1 ? "1 persona sin enviar no tiene" : `${formatCount(withoutPhone)} personas sin enviar no tienen`} un móvil que sirva para WhatsApp: mandadles el enlace desde la lista.{" "}
      <Link href={`${listHref}${listHref.includes("?") ? "&" : "?"}filtro=sin_enviar`} className="pn-link">Ver quién</Link>
    </p>
  );

  if (!person) {
    if (state.enviados === 0 && view.skippedInQueue === 0) {
      return (
        <EmptyState icon={SendIcon} title="Nadie por enviar" body="Todas las personas con móvil tienen su invitación enviada. Cuando añadáis a alguien nuevo, aparecerá aquí.">
          <Link href={listHref} className="pn-btn pn-btn--ghost pn-press">Volver a invitados</Link>
          {withoutPhoneNote}
        </EmptyState>
      );
    }
    return (
      <section className="pn-queue-done" aria-labelledby="series-done-title">
        <h2 id="series-done-title" className="pn-display pn-h1">Listo<span className="pn-em">.</span></h2>
        <p className="mt-4 max-w-[46ch] text-base leading-relaxed">
          {state.enviados === 0 ? "No habéis confirmado ninguna invitación en esta tanda." : state.enviados === 1 ? "Habéis enviado 1 invitación." : `Habéis enviado ${formatCount(state.enviados)} invitaciones.`}{" "}
          Cuando abran su enlace o respondan, lo veréis en vuestra lista.
        </p>
        <p className="pn-muted mt-2 max-w-[52ch] text-sm leading-relaxed">Los envíos los confirmáis vosotros: WhatsApp no nos dice si llegan ni si se leen.</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={listHref} className="pn-btn pn-press">Volver a invitados</Link>
          {view.skippedInQueue > 0 && (
            <button type="button" className="pn-btn pn-btn--ghost pn-press" disabled={busy} onClick={() => go({ persona: null, confirmar: false, enviados: 0, retirados: 0, saltados: [] })}>
              Repasar a quien habéis saltado ({formatCount(view.skippedInQueue)})
            </button>
          )}
        </div>
        {withoutPhoneNote && <div className="mt-4">{withoutPhoneNote}</div>}
      </section>
    );
  }

  const current = person;
  const next = nextInSeries(items, state.saltados, current.id);
  const asking = state.confirmar && state.persona === current.id;
  const ready = opened?.id === current.id ? opened : null;
  const rowError = error?.id === current.id ? error.text : null;
  const message = (who: InvitationQueueItem, link: string) => buildMessage("invitation", effectiveTemplate, who.name, link, context);
  const previewText = message(current, linkPreview);
  const meta = [
    current.group_name,
    current.invitation_prepared_at ? "Ya tenía un enlace: seguirá funcionando" : null,
  ].filter(Boolean);

  /**
   * Crea el enlace de `who` y enseña su mensaje para revisarlo. WhatsApp se
   * abre desde la hoja con un enlace real (toque del usuario), así que ya no
   * depende de la ventana de ~1 s que Safari deja tras un `await`.
   * `after` = estado de la tanda que acompaña al cambio de persona.
   */
  async function prepareFor(who: InvitationQueueItem, link: Promise<LinkResult>, after: Partial<QueueState> = {}) {
    const result = await link;
    if (!result.ok) { go({ persona: who.id, confirmar: false, ...after }); setError({ id: who.id, text: result.error }); return; }
    if (!whatsappNumber(who.phone)) { go({ persona: who.id, confirmar: false, ...after }); setError({ id: who.id, text: BAD_PHONE }); return; }
    const href = new URL(result.path, window.location.origin).href;
    if (who.id !== current.id || Object.keys(after).length > 0) go({ persona: who.id, confirmar: false, ...after });
    setCompose({
      id: who.id,
      request: { kind: "invitation", name: who.name, phone: who.phone, text: message(who, href), vars: { nombre: greetingName(who.name), enlace: href, novios: context.novios, fecha: context.fecha } },
    });
  }
  /** «Abrir WhatsApp» en la hoja: a partir de aquí se pregunta si se ha enviado. */
  function markOpened(id: string, url: string) {
    setOpened({ id, url });
    go({ persona: id, confirmar: true });
  }

  async function send() {
    setError(null);
    setPreparing(true);
    try { await prepareFor(current, links.get(current.id)); }
    catch { setError({ id: current.id, text: LINK_ERROR }); }
    finally { setPreparing(false); }
  }

  /**
   * «Sí · Ahora a…»: confirma esta y, a la vez, crea el enlace de la
   * siguiente para enseñar ya su mensaje en el mismo toque. Si la
   * confirmación falla, se queda en esta persona con el error; si falla solo
   * el enlace de la siguiente, se avanza y el error sale en su tarjeta.
   */
  async function confirmAndContinue(openNext: boolean) {
    setError(null);
    setSaving(true);
    const target = openNext ? next : null;
    const link = target ? links.get(target.id) : null;
    // Si la confirmación falla, el enlace ya creado no hace daño: no revoca nada.
    link?.catch(() => undefined);
    try {
      const confirmed = await actions.confirm(current.id);
      if (!confirmed.ok) { setError({ id: current.id, text: confirmed.error }); return; }
      links.forget(current.id);
      setOpened(null);
      const after = { enviados: state.enviados + 1 };
      if (!target || !link) { go({ persona: null, confirmar: false, ...after }); return; }
      try { await prepareFor(target, link, after); }
      catch { go({ persona: target.id, confirmar: false, ...after }); setError({ id: target.id, text: LINK_ERROR }); }
    } catch { setError({ id: current.id, text: OFFLINE }); }
    finally { setSaving(false); }
  }

  const skip = () => { setOpened(null); setError(null); go({ persona: null, confirmar: false, saltados: [...state.saltados, current.id] }); };
  const notSent = () => { setOpened(null); setError(null); go({ persona: current.id, confirmar: false }); };

  return (
    <section className="pn-queue" aria-labelledby="series-person" aria-busy={busy}>
      <div className="pn-queue-progress">
        <p className="pn-tnum text-sm font-semibold" aria-live="polite">{formatCount(view.position)} de {formatCount(view.total)}</p>
        <span className="pn-stepbar" aria-hidden="true"><span style={{ transform: `scaleX(${view.total ? (view.position - 1) / view.total : 0})` }} /></span>
      </div>
      {view.personaGone && <p className="pn-note mt-4">La persona anterior ya no está en la fila: su invitación ya consta como enviada.</p>}

      <article key={current.id} className="pn-queue-card">
        <header>
          <h2 id="series-person" className="pn-display pn-h2 pn-queue-name">{current.name}</h2>
          <p className="pn-sub pn-tnum">{current.phone}</p>
          {meta.length > 0 && <p className="pn-sub">{meta.join(" · ")}</p>}
        </header>

        <MessageBubble text={previewText} recipient={current.name} />

        <ReminderTemplateInline
          kind="invitation"
          initial={savedTemplate ?? DEFAULT_TEMPLATES.invitation}
          isDefault={savedTemplate === null}
          actions={templateActions}
          onDraftChange={setTemplateDraft}
          onSaved={(body) => { setSavedTemplate(body); setTemplateDraft(null); }}
        />

        {asking || ready ? (
          <div className="pn-queue-ask" role="group" aria-labelledby="series-ask">
            <h3 id="series-ask" ref={askRef} tabIndex={-1} className="pn-display pn-h3">¿Se la habéis enviado a {firstName(current.name)}?</h3>
            <p className="pn-help">Solo vosotros lo sabéis: WhatsApp no avisa a Vinklo.</p>
            <div className="pn-queue-actions">
              {next ? (
                <button type="button" className="pn-btn pn-btn--clay pn-press pn-series-next" disabled={busy} onClick={() => confirmAndContinue(true)}>
                  <MessageCircleIcon aria-hidden="true" className="size-4" />
                  <span>{saving ? "Guardando…" : <>Sí · Ahora a <span className="pn-series-next-name">{next.name}</span></>}</span>
                </button>
              ) : (
                <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={busy} onClick={() => confirmAndContinue(false)}>
                  <CheckIcon aria-hidden="true" className="size-4" />{saving ? "Guardando…" : "Sí, enviada"}
                </button>
              )}
            </div>
            {rowError && <p role="alert" className="pn-row-error">{rowError}</p>}
            <div className="pn-queue-more">
              {next && <button type="button" className="pn-link pn-press" disabled={busy} onClick={() => confirmAndContinue(false)}>Sí, y paro aquí</button>}
              <button type="button" className="pn-link pn-press" disabled={busy} onClick={notSent}>No la he enviado</button>
              {ready
                ? <a href={ready.url} target={WHATSAPP_TARGET} rel="noopener noreferrer" className="pn-link pn-press"><MessageCircleIcon aria-hidden="true" className="size-4" />Abrir WhatsApp otra vez</a>
                : <button type="button" className="pn-link pn-press" disabled={busy} onClick={send}><MessageCircleIcon aria-hidden="true" className="size-4" />{preparing ? "Preparando…" : "Abrir WhatsApp otra vez"}</button>}
            </div>
          </div>
        ) : (
          <div className="pn-queue-ask">
            <div className="pn-queue-actions">
              <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={busy} onClick={send}>
                <MessageCircleIcon aria-hidden="true" className="size-4" />{preparing ? "Preparando el mensaje…" : `Enviar a ${firstName(current.name)}`}
              </button>
            </div>
            {rowError && <p role="alert" className="pn-row-error">{rowError}</p>}
            <div className="pn-queue-more">
              <button type="button" className="pn-link pn-press" disabled={busy} onClick={skip}>Saltar</button>
            </div>
          </div>
        )}
      </article>
      {withoutPhoneNote}
      <WhatsAppCompose
        request={compose?.id === current.id ? compose.request : null}
        onClose={() => setCompose(null)}
        onOpened={({ url }) => markOpened(current.id, url)}
        saveTemplate={(_, body) => templateActions.save(body)}
        onTemplateSaved={(_, body) => setSavedTemplate(body)}
        target={WHATSAPP_TARGET}
      />
    </section>
  );
}
