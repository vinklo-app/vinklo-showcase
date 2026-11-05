"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, Link2Icon, MessageCircleIcon, RepeatIcon, Share2Icon } from "lucide-react";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { reminderSummary, shortDate } from "@/components/panel/reminders";
import { GUEST_STATUS_HINTS, GUEST_STATUS_LABELS, companionsLabel, displayStatus, guestStatus, initials } from "@/components/panel/guest-status";
import { pendingCommits } from "@/components/panel/deferred-commit";
import { GIFT_KIND_LABELS, type Gift, type GuestGiftState } from "@/lib/crm/contract";
import { GiftKindIcon } from "@/components/panel/gift-kind-icon";
import { TagBadges } from "@/components/panel/tag-field";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";
import type { GuestActions, GuestRow, InvitationMessage } from "./types";
import { ShareBox, invitationCompose } from "./guest-link-section";

/**
 * Marca de regalo de la fila: iconos de los tipos anotados y si queda por
 * agradecer (arcilla) o está agradecido (oliva). «Sin indicar» no pinta nada.
 */
function GiftMark({ state, gifts, unthanked }: { state: GuestGiftState; gifts: Gift[]; unthanked: boolean }) {
  if (state === "unknown") return null;
  if (state === "no") return <span className="pn-gift-mark pn-muted">Sin regalo</span>;
  const kinds = Array.from(new Set(gifts.map((gift) => gift.kind)));
  const label = `Regalo${kinds.length ? `: ${kinds.map((kind) => GIFT_KIND_LABELS[kind]).join(", ")}` : ""}, ${unthanked ? "por agradecer" : "agradecido"}`;
  return (
    <span className="pn-gift-mark" data-unthanked={unthanked ? "true" : undefined} title={label}>
      <span className="sr-only">{label}</span>
      <span className="pn-gift-mark-icons" aria-hidden="true">
        {kinds.length ? kinds.slice(0, 3).map((kind) => <GiftKindIcon key={kind} kind={kind} className="size-3.5" />) : <GiftKindIcon kind="objeto" className="size-3.5" />}
      </span>
      <span aria-hidden="true">{unthanked ? "Por agradecer" : "Agradecido"}</span>
    </span>
  );
}

/**
 * «Marcar enviada» es optimista con deshacer: la fila cambia al momento y la
 * server action (que no tiene inversa) se llama al cerrarse el aviso, nunca
 * si la pareja pulsa «Deshacer». Los envíos aún sin confirmar se vuelcan al
 * ocultar la pestaña, al salir de la página o al desmontar la fila, para no
 * perder ninguno (los temporizadores de sonner se pausan con la pestaña oculta).
 */
const UNDO_MS = 4000;

/**
 * Deslizar una fila (solo táctil): la cara sigue al dedo 1:1 y deja ver la
 * bandeja de acciones detrás; al soltar decide la velocidad (> 0,11 px/ms) o
 * la distancia (mitad de la bandeja). Más allá de los bordes, resistencia
 * (rubber-band de Apple). Con ratón/trackpad la bandeja se pinta en línea y
 * no hay gesto. Solo una fila abierta a la vez.
 */
const SWIPE_VELOCITY = 0.11;
const SNAP = "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)";
const INLINE_QUERY = "(hover: hover) and (pointer: fine)";
let openRow: { current: () => void } | null = null;
function rubberband(overshoot: number, dimension: number) {
  return (overshoot * dimension * 0.55) / (dimension + 0.55 * Math.abs(overshoot));
}

export function GuestItem({ guest: row, actions, onEdit, onLink, message, gift, select }: {
  guest: GuestRow; actions: GuestActions; onEdit: () => void; message?: InvitationMessage;
  /** Abre la ficha por «Enlace personal» (el único sitio donde se revoca un enlace). */
  onLink: () => void;
  /** Regalos de esta persona ya cruzados con la lista local (null = no cargados) y su estado. */
  gift?: { gifts: Gift[] | null; state: GuestGiftState };
  /** Modo selección: tocar la fila la marca (sin bandeja ni acciones de fila). */
  select?: { checked: boolean; toggle: () => void };
}) {
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<"new" | "resend">("new");
  const [sentLocally, setSentLocally] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const commitRef = useRef<(() => void) | null>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const drag = useRef<{ id: number; x0: number; y0: number; base: number; axis: "x" | "y" | null; hist: Array<[number, number]> } | null>(null);
  const swallowClick = useRef(false);
  const closeSelf = useRef<() => void>(() => {});
  const [pending, startTransition] = useTransition();
  // Vista optimista: mientras dura el deshacer, la fila ya cuenta como enviada.
  const guest = sentLocally && !row.invitation_sent_at ? { ...row, invitation_sent_at: "pendiente-de-confirmar" } : row;
  const key = guestStatus(guest);
  const openedAt = guest.crm?.invitationOpenedAt ?? null;
  const statusKey = displayStatus(key, openedAt);
  const giftUnthanked = gift?.gifts ? gift.gifts.some((item) => !item.thankedAt) : Boolean(guest.crm?.giftUnthanked);
  useEffect(() => () => { commitRef.current?.(); }, []);
  const hasPhone = whatsappNumber(guest.phone) !== null;
  const canConfirmSent = (invitation !== null || guest.invitation_prepared_at !== null) && !guest.invitation_sent_at;
  const companions = companionsLabel(guest);

  /*
   * Compartir desde la fila NUNCA revoca un enlace que ya tiene (auditoría
   * 2026-10-05): sin enlace, se crea el primero; con el envío confirmado (en
   * el servidor, no el optimista), «Reenviar» añade otro sin revocar; con el
   * enlace preparado sin confirmar, la fila lleva a la ficha («Enlace nuevo»).
   */
  const hasLink = row.invitation_prepared_at !== null;
  const canResend = row.invitation_sent_at !== null && Boolean(actions.createReminderLink);
  const shareKind: "create" | "resend" | "sheet" = !hasLink ? "create" : canResend ? "resend" : "sheet";
  function share() {
    if (shareKind === "sheet") { onLink(); return; }
    const resend = shareKind === "resend";
    setError(null);
    commitRef.current?.();
    startTransition(async () => {
      try {
        const result = resend && actions.createReminderLink ? await actions.createReminderLink(guest.id) : await actions.createInvitation(guest.id);
        if (!result.ok) { setError(result.error); return; }
        if (!resend) setSentLocally(false);
        setLinkMode(resend ? "resend" : "new");
        setInvitation(new URL(result.path, window.location.origin).href);
      } catch { setError("No se ha podido crear el enlace. Probad de nuevo."); }
    });
  }
  function confirmSent() {
    if (commitRef.current) return;
    setError(null);
    setSentLocally(true);
    const toastId = `enviada-${row.id}`;
    let settled = false;
    const release = () => { settled = true; pendingCommits.delete(commit); commitRef.current = null; };
    function commit() {
      if (settled) return;
      release();
      toast.dismiss(toastId);
      startTransition(async () => {
        try {
          const result = await actions.confirmSent(row.id);
          if (!result.ok) { setSentLocally(false); setError(result.error); }
        } catch {
          setSentLocally(false);
          setError("No se ha guardado el envío. Probad de nuevo.");
        }
      });
    }
    const undo = () => { if (settled) return; release(); setSentLocally(false); };
    pendingCommits.add(commit);
    commitRef.current = commit;
    toast(`Invitación de ${row.name} marcada como enviada`, {
      id: toastId,
      duration: UNDO_MS,
      action: { label: "Deshacer", onClick: undo },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  // --- Bandeja deslizable --------------------------------------------------
  const hasTray = !invitation && !select;
  function place(x: number, animate: boolean) {
    const face = faceRef.current;
    if (!face) return;
    face.style.transition = animate && !prefersReducedMotion() ? `${SNAP}, background-color var(--d-micro) var(--ease-out)` : "";
    face.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
    offset.current = x;
  }
  function setTray(open: boolean) {
    place(open ? -(trayRef.current?.offsetWidth ?? 0) : 0, true);
    setTrayOpen(open);
    if (open) {
      if (openRow && openRow !== closeSelf) openRow.current();
      openRow = closeSelf;
    } else if (openRow === closeSelf) openRow = null;
  }
  closeSelf.current = () => setTray(false);
  const isInline = () => window.matchMedia(INLINE_QUERY).matches;

  useEffect(() => {
    if (!trayOpen) return;
    const onOutside = (event: PointerEvent) => { if (!itemRef.current?.contains(event.target as Node)) closeSelf.current(); };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [trayOpen]);
  useEffect(() => { if (invitation || select) closeSelf.current(); }, [invitation, select]);
  useEffect(() => () => { if (openRow === closeSelf) openRow = null; }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || !hasTray || drag.current || isInline()) return;
    drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, base: offset.current, axis: null, hist: [[event.clientX, event.timeStamp]] };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x0;
    const dy = event.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") { drag.current = null; return; }
      event.currentTarget.setPointerCapture(event.pointerId);
      itemRef.current?.setAttribute("data-dragging", "true");
      if (openRow && openRow !== closeSelf) openRow.current();
    }
    const width = trayRef.current?.offsetWidth ?? 0;
    const dimension = event.currentTarget.offsetWidth;
    let x = d.base + dx;
    if (x > 0) x = rubberband(x, dimension);
    else if (x < -width) x = -width - rubberband(-width - x, dimension);
    place(x, false);
    d.hist.push([event.clientX, event.timeStamp]);
    if (d.hist.length > 8) d.hist.shift();
  }
  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    itemRef.current?.removeAttribute("data-dragging");
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 350);
    // Velocidad solo con los últimos 100 ms: un dedo que se ha parado no «lanza».
    const now = event.timeStamp;
    const recent = d.hist.filter(([, t]) => now - t <= 100);
    const [x1, t1] = recent[0] ?? [event.clientX, now];
    const [x2, t2] = [event.clientX, now];
    const velocity = event.type === "pointercancel" ? 0 : (x2 - x1) / Math.max(1, t2 - t1);
    const width = trayRef.current?.offsetWidth ?? 0;
    setTray(velocity < -SWIPE_VELOCITY ? true : velocity > SWIPE_VELOCITY ? false : offset.current < -width / 2);
  }
  function onFaceClickCapture(event: React.MouseEvent) {
    // Tras deslizar no se dispara la acción tocada; con la bandeja abierta, tocar la fila la cierra (como en iOS).
    if (swallowClick.current || trayOpen) { event.preventDefault(); event.stopPropagation(); if (trayOpen && !swallowClick.current) setTray(false); }
  }
  /** Acción de la bandeja: se ejecuta y la fila vuelve a su sitio. */
  const fromTray = (run: () => void) => () => { run(); if (!isInline()) setTray(false); };

  // Siguiente paso visible en la fila (táctil): uno solo, el que toca ahora.
  const shareLabel = pending ? "Un momento…" : shareKind === "resend" ? "Reenviar" : shareKind === "sheet" ? "Su enlace" : hasPhone ? "WhatsApp" : "Compartir enlace";
  const shareName = shareKind === "resend" ? `Reenviar su enlace a ${guest.name}` : shareKind === "sheet" ? `Enlace personal de ${guest.name}` : hasPhone ? `Compartir por WhatsApp con ${guest.name}` : `Compartir enlace con ${guest.name}`;
  const ShareIcon = shareKind === "resend" ? RepeatIcon : shareKind === "sheet" ? Link2Icon : hasPhone ? MessageCircleIcon : Share2Icon;
  const nextStep = invitation || select ? null : canConfirmSent ? "confirm" : key === "pending" ? "share" : null;

  return (
    <li ref={itemRef} className="pn-guest" data-open={trayOpen ? "true" : undefined} data-selected={select?.checked ? "true" : undefined}
      onBlur={(event) => { if (trayOpen && !isInline() && !event.currentTarget.contains(event.relatedTarget as Node | null)) setTray(false); }}>
      <div ref={faceRef} className="pn-guest-face" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onFaceClickCapture}>
        {select ? (
          <span className="pn-select-box" data-checked={select.checked ? "true" : undefined} aria-hidden="true">{select.checked && <CheckIcon className="size-4" />}</span>
        ) : (
          <span className={`pn-avatar ${key === "confirmed" ? "pn-avatar--confirmed" : ""}`} aria-hidden="true">{initials(guest.name)}</span>
        )}
        <button type="button" className="pn-row-main" onClick={select ? select.toggle : onEdit}
          aria-label={select ? `Seleccionar a ${guest.name}` : `Editar a ${guest.name}`} aria-pressed={select ? select.checked : undefined}>
          <span className="pn-name">{guest.name}</span>
          <span className="pn-sub">
            {guest.group_name && <span className="pn-group-tag">{guest.group_name}</span>}
            <TagBadges tags={guest.tags} />
            {(() => {
              const rest = [companions, guest.source === "rsvp" ? "Respondió desde el enlace general" : null, statusKey === "opened" && shortDate(openedAt) ? `Abierta el ${shortDate(openedAt)}` : null, key === "sent" ? (guest.reminders_opt_out ? "Sin recordatorios" : reminderSummary(guest.reminder_count, guest.last_reminder_at)) : null].filter(Boolean).join(" · ");
              return <>{guest.phone ? <span className="pn-nowrap">{guest.phone}</span> : "Sin teléfono"}{rest ? `\u00a0· ${rest}` : ""}</>;
            })()}
          </span>
        </button>
        <div className="pn-guest-end">
          <span key={statusKey} className={`pn-status pn-status--${statusKey}`} data-changed={sentLocally ? "true" : undefined} title={GUEST_STATUS_HINTS[statusKey]}>{GUEST_STATUS_LABELS[statusKey]}</span>
          {gift && <GiftMark state={gift.state} gifts={gift.gifts ?? []} unthanked={giftUnthanked} />}
        </div>

        {guest.rsvp_notes && <p className="pn-sub pn-guest-wide whitespace-pre-wrap">{guest.rsvp_notes}</p>}
        {guest.rsvp_logistic_notes && <p className="pn-sub pn-guest-wide whitespace-pre-wrap">Otras notas: {guest.rsvp_logistic_notes}</p>}
        {guest.answers_text && <p className="pn-sub pn-guest-wide">{guest.answers_text}</p>}
        {nextStep === "share" && (
          <button type="button" disabled={pending} onClick={share} className="pn-act pn-act--next pn-press" aria-hidden="true" tabIndex={-1}>
            <ShareIcon aria-hidden="true" className="size-4" />{shareLabel}
          </button>
        )}
        {nextStep === "confirm" && (
          <button type="button" disabled={pending} onClick={confirmSent} className="pn-act pn-act--next pn-press" aria-hidden="true" tabIndex={-1}>
            <CheckIcon aria-hidden="true" className="size-4" />Marcar enviada
          </button>
        )}

      {invitation && (
        <ShareBox name={guest.name} link={invitation} compose={invitationCompose(guest, invitation, message)} saveTemplate={actions.saveTemplate} mode={linkMode}
          confirm={canConfirmSent ? { onClick: confirmSent, pending } : undefined} />
      )}

        {error && <p role="alert" className="pn-row-error">{error}</p>}
      </div>
      {hasTray && (
        <div ref={trayRef} className="pn-guest-tray" onFocus={() => { if (!trayOpen && !isInline()) setTray(true); }}>
          <button type="button" disabled={pending} onClick={fromTray(share)} className="pn-act pn-press" aria-label={shareName}>
            <ShareIcon aria-hidden="true" className="size-4" />
            {shareKind === "create" && hasPhone && !pending ? <span><span className="pn-wide-only">Compartir por </span>WhatsApp</span> : shareLabel}
          </button>
          {canConfirmSent && (
            <button type="button" disabled={pending} onClick={fromTray(confirmSent)} className="pn-act pn-act--ink pn-press">
              <CheckIcon aria-hidden="true" className="size-4" />Marcar enviada
            </button>
          )}
        </div>
      )}
    </li>
  );
}
