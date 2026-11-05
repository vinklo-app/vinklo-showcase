"use client";

/**
 * «Vuestra pareja» (Ajustes): invitar por email a la segunda cuenta, ver si
 * está pendiente o aceptada, reenviar, cancelar y (solo quien creó la boda)
 * quitar el acceso. Las acciones resuelven la boda en servidor.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  cancelPartnerInvite,
  invitePartner,
  removePartner,
  resendPartnerInvite,
  type PartnerActionResult,
  type PartnerState,
} from "@/lib/actions/partner";
import "./partner.css";

const DATE = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" });

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

export function PartnerCard({ state }: { state: PartnerState }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!state.ok) {
    return (
      <section aria-labelledby="pareja-title" className="pn-ed-section">
        <h2 id="pareja-title" className="pn-display pn-h2">Vuestra pareja</h2>
        <p role="alert" className="pn-note pn-note--warn">{state.error}</p>
      </section>
    );
  }
  if (!state.available) return null;

  const partner = state.members.find(member => !member.isMe) ?? null;
  const invite = state.invite;

  function run(task: () => Promise<PartnerActionResult | { ok: true } | { ok: false; error: string }>, success: (result: PartnerActionResult | { ok: true }) => string) {
    setError(null);
    setMessage(null);
    setDevLink(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(success(result));
      if ("devLink" in result && result.devLink) setDevLink(result.devLink);
      setConfirmRemove(false);
      router.refresh();
    });
  }

  const sentText = (result: PartnerActionResult | { ok: true }) =>
    "emailed" in result && !result.emailed
      ? "Invitación preparada, pero el correo no está configurado en este entorno."
      : "Invitación enviada. El enlace vale 7 días.";

  return (
    <section aria-labelledby="pareja-title" className="pn-ed-section partner-card">
      <h2 id="pareja-title" className="pn-display pn-h2">Vuestra pareja</h2>
      <p className="pn-muted text-sm">
        Gestionad la boda los dos, cada uno con su correo: veis y cambiáis lo mismo en invitados,
        mensajes, regalos, mesas y la web.
      </p>

      <ul className="partner-list" aria-label="Quién gestiona la boda">
        {state.members.map(member => (
          <li key={`${member.role}-${member.email}`} className="partner-row">
            <span className="partner-email">{member.email}</span>
            <span className="partner-tag">
              {member.isMe ? "Tú" : member.role === "owner" ? "Creó la boda" : "Aceptada"}
            </span>
          </li>
        ))}
        {!partner && invite ? (
          <li className="partner-row">
            <span className="partner-email">{invite.email}</span>
            <span className={`partner-tag ${invite.expired ? "partner-tag--warn" : ""}`}>
              {invite.expired ? "Caducada" : `Pendiente · enviada el ${day(invite.sentAt)}`}
            </span>
          </li>
        ) : null}
      </ul>

      {!partner && !invite ? (
        <form
          className="partner-invite"
          onSubmit={event => {
            event.preventDefault();
            const value = email;
            run(() => invitePartner(value), result => { setEmail(""); return sentText(result); });
          }}
        >
          <label className="pn-field">
            <span>Correo de tu pareja</span>
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              inputMode="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="nombre@correo.es"
              disabled={pending}
            />
            <small className="pn-help">Le llega un enlace para entrar con ese correo. Solo sirve para esa dirección.</small>
          </label>
          <div className="pn-form-actions">
            <button type="submit" className="pn-btn pn-press" disabled={pending || email.trim() === ""}>
              {pending ? "Enviando…" : "Enviar invitación"}
            </button>
          </div>
        </form>
      ) : null}

      {!partner && invite ? (
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending}
            onClick={() => run(() => resendPartnerInvite(), sentText)}>
            {pending ? "Un momento…" : invite.expired ? "Enviar un enlace nuevo" : "Reenviar"}
          </button>
          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending}
            onClick={() => run(() => cancelPartnerInvite(), () => "Invitación cancelada: su enlace ya no vale.")}>
            Cancelar invitación
          </button>
        </div>
      ) : null}

      {partner && state.role === "owner" ? (
        confirmRemove ? (
          <div className="pn-form-actions" role="group" aria-label="Confirmar">
            <p className="pn-note pn-note--warn">{partner.email} dejará de ver y gestionar la boda.</p>
            <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending}
              onClick={() => run(() => removePartner(), () => "Acceso retirado.")}>
              Sí, quitar acceso
            </button>
            <button type="button" className="pn-link pn-press" onClick={() => setConfirmRemove(false)}>No</button>
          </div>
        ) : (
          <button type="button" className="pn-link pn-press" onClick={() => setConfirmRemove(true)}>
            Quitar acceso a {partner.email}
          </button>
        )
      ) : null}

      {error ? <p role="alert" className="pn-row-error">{error}</p> : null}
      {message ? <p role="status" className="pn-note pn-note--ok">{message}</p> : null}
      {devLink ? (
        <p className="pn-help">Solo en local (sin RESEND_API_KEY): <a className="pn-link" href={devLink}>{devLink}</a></p>
      ) : null}
    </section>
  );
}
