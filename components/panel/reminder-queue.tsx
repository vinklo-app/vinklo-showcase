"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRingIcon, MessageCircleIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { buildMessage, DEFAULT_TEMPLATES, firstName, type MessageContext } from "@/lib/messages/templates";
import { formatCount } from "@/components/panel/guest-status";
import { MessageBubble } from "@/components/panel/message-bubble";
import { ReminderTemplateInline, type ReminderTemplateActions } from "@/components/panel/reminder-template-inline";
import { queueUrl, queueView, reminderSummary, shortDate, FILTER_EMPTY, type QueueState } from "@/components/panel/reminders";
import { WhatsAppCompose, type ComposeRequest } from "@/components/panel/whatsapp-compose";
import { useFocusQuestion, useIssuedLinks } from "@/components/panel/queue-hooks";

export interface ReminderPerson {
  id: string; name: string; phone: string | null;
  /** Envío confirmado o, con `delivered_by: "opened"`, primera apertura de su enlace. */
  invitation_sent_at: string; last_reminder_at: string | null; reminder_count: number;
  delivered_by?: "sent" | "opened";
}
type Result = { ok: true } | { ok: false; error: string };
export interface ReminderQueueActions {
  createLink(guestId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  confirm(guestId: string): Promise<Result | { ok: true; lastReminderAt: string; reminderCount: number }>;
  optOut(guestId: string): Promise<Result>;
}

const OFFLINE = "No se ha guardado. Comprobad la conexión y probad de nuevo.";

/**
 * «Recordar a quien no ha respondido»: una persona cada vez. Se crea un
 * enlace, se enseña el recordatorio exacto (editable solo para esta persona,
 * punto 15 del backlog) y desde ahí se abre WhatsApp; al volver,
 * «¿Lo has enviado?». La fila sale siempre del servidor y la persona en
 * curso va en la URL: si iOS recarga la página al volver de WhatsApp, se
 * retoma en la misma pregunta. Vinklo no envía nada ni sabe si llega.
 */
export function ReminderQueue({ items, state, template, context, linkPreview, basePath, listHref, actions, templateActions }: {
  items: ReminderPerson[];
  state: QueueState;
  /** Plantilla guardada o null = texto de Vinklo. */
  template: string | null;
  context: MessageContext;
  /** Enlace de ejemplo para la vista previa (el real se crea al abrir WhatsApp). */
  linkPreview: string;
  basePath: string;
  listHref: string;
  actions: ReminderQueueActions;
  /** Editar el texto del recordatorio sin salir de la fila (ver reminder-template-inline.tsx). */
  templateActions: ReminderTemplateActions;
}) {
  const router = useRouter();
  const view = queueView(items, state);
  const person = view.current;
  const [opened, setOpened] = useState<{ id: string; url: string } | null>(null);
  // Recordatorio en revisión antes de abrir WhatsApp (whatsapp-compose.tsx).
  const [compose, setCompose] = useState<{ id: string; request: ComposeRequest } | null>(null);
  const links = useIssuedLinks(actions.createLink);
  const askRef = useRef<HTMLHeadingElement>(null);
  useFocusQuestion(askRef, Boolean(person && ((state.confirmar && state.persona === person.id) || opened?.id === person.id)), person?.id);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [saving, setSaving] = useState(false);
  // El texto efectivo vive en estado local para que guardarlo (o un borrador
  // sin guardar aún) cambie la vista previa al momento, sin recargar la
  // página ni salir de la fila de recordatorios.
  const [savedTemplate, setSavedTemplate] = useState(template);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const effectiveTemplate = templateDraft ?? savedTemplate;
  const busy = preparing || saving || navigating;

  const go = (next: Partial<QueueState>) => startNavigation(() => router.replace(queueUrl(basePath, { ...state, ...next }), { scroll: false }));

  if (!person) {
    const handled = state.enviados + state.retirados;
    if (handled === 0 && view.skippedInQueue === 0) {
      return (
        <EmptyState icon={BellRingIcon} title={FILTER_EMPTY.para_recordar.title} body={FILTER_EMPTY.para_recordar.body}>
          <Link href={`${listHref}${listHref.includes("?") ? "&" : "?"}filtro=esperando`} className="pn-btn pn-btn--ghost pn-press">Ver quién espera respuesta</Link>
        </EmptyState>
      );
    }
    return (
      <section className="pn-queue-done" aria-labelledby="queue-done-title">
        <h2 id="queue-done-title" className="pn-display pn-h1">Listo<span className="pn-em">.</span></h2>
        <p className="mt-4 max-w-[46ch] text-base leading-relaxed">
          {state.enviados === 0 ? "No habéis confirmado ningún recordatorio en esta tanda." : state.enviados === 1 ? "Habéis enviado 1 recordatorio." : `Habéis enviado ${formatCount(state.enviados)} recordatorios.`}{" "}
          Cuando respondan, lo veréis en vuestra lista.
        </p>
        <p className="pn-muted mt-2 max-w-[52ch] text-sm leading-relaxed">
          {state.retirados > 0 && `${state.retirados === 1 ? "A 1 persona" : `A ${formatCount(state.retirados)} personas`} no le${state.retirados === 1 ? "" : "s"} volveremos a proponer recordatorios. `}
          Los envíos los confirmáis vosotros: WhatsApp no nos dice si llegan ni si se leen.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={listHref} className="pn-btn pn-press">Volver a invitados</Link>
          {view.skippedInQueue > 0 && (
            <button type="button" className="pn-btn pn-btn--ghost pn-press" disabled={busy} onClick={() => go({ persona: null, confirmar: false, enviados: 0, retirados: 0, saltados: [] })}>
              Repasar a quien habéis saltado ({formatCount(view.skippedInQueue)})
            </button>
          )}
        </div>
      </section>
    );
  }

  const current = person;
  const asking = state.confirmar && state.persona === current.id;
  const ready = opened?.id === current.id ? opened : null;
  const rowError = error?.id === current.id ? error.text : null;
  const message = (link: string) => buildMessage("reminder", effectiveTemplate, current.name, link, context);
  const previewText = message(linkPreview);
  const meta = [
    current.delivered_by === "opened" ? `Abrió su invitación el ${shortDate(current.invitation_sent_at)}` : `Invitación enviada el ${shortDate(current.invitation_sent_at)}`,
    reminderSummary(current.reminder_count, current.last_reminder_at) || "Sin recordatorios todavía",
  ];

  async function openWhatsApp() {
    setError(null);
    setPreparing(true);
    try {
      const result = await links.get(current.id);
      if (!result.ok) { setError({ id: current.id, text: result.error }); return; }
      if (!whatsappNumber(current.phone)) { setError({ id: current.id, text: "Su teléfono no sirve para WhatsApp. Corregidlo en su ficha de invitados." }); return; }
      const href = new URL(result.path, window.location.origin).href;
      // WhatsApp se abre desde la hoja con un enlace real (toque del usuario).
      setCompose({
        id: current.id,
        request: { kind: "reminder", name: current.name, phone: current.phone, text: message(href), vars: { nombre: firstName(current.name), enlace: href, novios: context.novios, fecha: context.fecha } },
      });
    } catch {
      setError({ id: current.id, text: "No se ha podido preparar el mensaje. Comprobad la conexión y probad de nuevo." });
    } finally { setPreparing(false); }
  }

  async function run(action: () => Promise<Result | { ok: true }>, next: Partial<QueueState>) {
    setError(null);
    setSaving(true);
    try {
      const result = await action();
      if (!result.ok) { setError({ id: current.id, text: result.error }); return; }
      setOpened(null);
      go({ persona: null, confirmar: false, ...next });
    } catch { setError({ id: current.id, text: OFFLINE }); }
    finally { setSaving(false); }
  }

  const skip = () => { setOpened(null); setError(null); go({ persona: null, confirmar: false, saltados: [...state.saltados, current.id] }); };
  const optOut = () => run(() => actions.optOut(current.id), { retirados: state.retirados + 1 });
  const confirm = () => run(async () => {
    const result = await actions.confirm(current.id);
    if (result.ok) links.forget(current.id);
    return result;
  }, { enviados: state.enviados + 1 });

  return (
    <section className="pn-queue" aria-labelledby="queue-person" aria-busy={busy}>
      <div className="pn-queue-progress">
        <p className="pn-tnum text-sm font-semibold" aria-live="polite">{formatCount(view.position)} de {formatCount(view.total)}</p>
        <span className="pn-stepbar" aria-hidden="true"><span style={{ transform: `scaleX(${view.total ? (view.position - 1) / view.total : 0})` }} /></span>
      </div>
      {view.personaGone && <p className="pn-note mt-4">La persona anterior ya no está en la fila: ha respondido o ya se le ha recordado.</p>}

      <article key={current.id} className="pn-queue-card">
        <header>
          <h2 id="queue-person" className="pn-display pn-h2 pn-queue-name">{current.name}</h2>
          <p className="pn-sub pn-tnum">{current.phone}</p>
          <p className="pn-sub">{meta.join(" · ")}</p>
        </header>

        <MessageBubble text={previewText} recipient={current.name} />

        <ReminderTemplateInline
          // Base estable para «¿ha cambiado?» y para restaurar al abrir/cancelar:
          // el texto GUARDADO, nunca el borrador en curso (que ya alimenta la
          // burbuja de arriba vía effectiveTemplate). Si usara effectiveTemplate
          // aquí, el borrador se perseguiría a sí mismo y «Guardar» nunca se
          // activaría.
          initial={savedTemplate ?? DEFAULT_TEMPLATES.reminder}
          isDefault={savedTemplate === null}
          actions={templateActions}
          onDraftChange={setTemplateDraft}
          onSaved={(body) => { setSavedTemplate(body); setTemplateDraft(null); }}
        />

        {asking || ready ? (
          <div className="pn-queue-ask" role="group" aria-labelledby="queue-ask">
            <h3 id="queue-ask" ref={askRef} tabIndex={-1} className="pn-display pn-h3">¿Lo has enviado?</h3>
            <p className="pn-help">Solo vosotros lo sabéis: WhatsApp no avisa a Vinklo.</p>
            <div className="pn-queue-actions">
              <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={busy} onClick={confirm}>
                {saving ? "Guardando…" : "Sí, enviado"}
              </button>
              <button type="button" className="pn-btn pn-btn--ghost pn-press" disabled={busy} onClick={skip}>No, saltar</button>
            </div>
            {rowError && <p role="alert" className="pn-row-error">{rowError}</p>}
            <div className="pn-queue-more">
              {ready
                ? <a href={ready.url} target="_blank" rel="noopener noreferrer" className="pn-link pn-press"><MessageCircleIcon aria-hidden="true" className="size-4" />Abrir WhatsApp otra vez</a>
                : <button type="button" className="pn-link pn-press" disabled={busy} onClick={openWhatsApp}><MessageCircleIcon aria-hidden="true" className="size-4" />{preparing ? "Preparando…" : "Abrir WhatsApp otra vez"}</button>}
              <button type="button" className="pn-link pn-press pn-muted" disabled={busy} onClick={optOut}>No volver a recordarle</button>
            </div>
          </div>
        ) : (
          <div className="pn-queue-ask">
            <div className="pn-queue-actions">
              <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={busy} onClick={openWhatsApp}>
                <MessageCircleIcon aria-hidden="true" className="size-4" />{preparing ? "Preparando el mensaje…" : `Recordárselo a ${firstName(current.name)}`}
              </button>
            </div>
            {rowError && <p role="alert" className="pn-row-error">{rowError}</p>}
            <div className="pn-queue-more">
              <button type="button" className="pn-link pn-press" disabled={busy} onClick={skip}>Saltar</button>
              <button type="button" className="pn-link pn-press pn-muted" disabled={busy} onClick={optOut}>No volver a recordarle</button>
            </div>
          </div>
        )}
      </article>
      <WhatsAppCompose
        request={compose?.id === current.id ? compose.request : null}
        onClose={() => setCompose(null)}
        onOpened={({ url }) => { setOpened({ id: current.id, url }); go({ persona: current.id, confirmar: true }); }}
        saveTemplate={(_, body) => templateActions.save(body)}
        onTemplateSaved={(_, body) => setSavedTemplate(body)}
      />
    </section>
  );
}
