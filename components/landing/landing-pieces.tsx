"use client";

/**
 * Piezas interactivas de la landing (7-oct-2026, mensajes nuevos):
 *  - «Sabréis…»: cada cosa con su icono.
 *  - Aviso de regalos («Una cosa más»): joinWaitlist con interés en regalos,
 *    misma tabla que las parejas fundadoras.
 */
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { ArmchairIcon, BusIcon, GiftIcon, UsersIcon, WheatOffIcon } from "lucide-react";

import { landingCopy, type Locale } from "@/components/landing/copy";
import { joinWaitlist } from "@/lib/actions/waitlist";

import "./home-instinct.css";

/**
 * «Sabréis…» (7-oct-2026, a petición del propietario): al pasar el ratón (o
 * enfocar) por cada cosa, su icono aparece encima, al estilo de instinct.com.
 * Vuelve el 13-oct-2026 (se había ido con el hero nuevo).
 */
const KNOW_ICONS = [UsersIcon, WheatOffIcon, BusIcon, ArmchairIcon, GiftIcon] as const;

export function KnowList({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale).know;
  return (
    <p className="lc-know">
      {t.intro}{" "}
      {t.items.map(({ text, sep }, i) => {
        const Icon = KNOW_ICONS[i]!;
        return (
          <span key={text}>
            <span className="lc-know-item" tabIndex={0}>
              <span className="lc-know-icon" aria-hidden="true"><Icon width={18} height={18} strokeWidth={1.75} /></span>
              {text}
            </span>
            {sep}{" "}
          </span>
        );
      })}
    </p>
  );
}

/** Aviso de regalos: misma acción que parejas fundadoras, con interés en regalos marcado. */
export function GiftsNotify({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale).notify;
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!consent) { setError(t.needConsent); return; }
    start(async () => {
      try {
        const result = await joinWaitlist({ email, kind: "pareja", consent: true, interestedInGifts: true });
        if (result.ok) setDone(true);
        else setError(t.serverError ?? result.error);
      } catch {
        setError(t.offline);
      }
    });
  }

  if (done) return <p role="status" className="hi-done">{t.done}</p>;

  return (
    <form className="hi-notify" onSubmit={submit} aria-busy={pending}>
      <label htmlFor="hi-email" className="sr-only">{t.email}</label>
      <span className="hi-field">
        <input id="hi-email" type="email" required maxLength={254} autoComplete="email" placeholder={t.email} value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} />
        <button type="submit" disabled={pending} className="hi-cta">{pending ? t.sending : <>{t.submit} <span aria-hidden="true">›</span></>}</button>
      </span>
      <label className="hi-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={pending} />
        <span>{t.consentPre}<Link href="/privacidad">{t.privacy}</Link>{t.consentPost}</span>
      </label>
      {error && <p role="alert" className="hi-error">{error}</p>}
    </form>
  );
}
