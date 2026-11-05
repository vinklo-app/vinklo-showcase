"use client";

/**
 * El sobre — elemento firma de vinklo (docs/design.md).
 *
 * v5 (2026-07-08): importe LIBRE — sin precio por persona ni mínimos de
 * producto; chips de importes frecuentes solo como atajo. Card blanca con
 * solapa y sello de lacre en oro pastel con las iniciales de los novios.
 * Al entrar en viewport la solapa "se abre" (rotateX, 500 ms, una vez,
 * respetando prefers-reduced-motion).
 *
 * Isla de cliente única de la página de invitado: todo lo demás es RSC.
 */

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  logBizumContribution,
  startCardContribution,
} from "@/lib/actions/contribute";
import { parseEsAmountToCents } from "@/lib/amounts";
import { formatEurCents, serviceFeeCents } from "@/lib/fees";
import { centsToDecimalComma } from "@/lib/format/money";

export interface ContributionEnvelopeProps {
  slug: string;
  /** Iniciales de los novios para el sello, p. ej. "M·J". */
  initials: string;
  bizumPhone: string | null;
  stripeOnboarded: boolean;
}

/** Atajos frecuentes — sugerencias, nunca mínimos. */
const QUICK_AMOUNTS_EUR = [50, 100, 150, 200] as const;

function parseEurosToCents(raw: string): number {
  if (raw.replace(/[\s€]/g, "") === "") return 0;
  const cents = parseEsAmountToCents(raw);
  return cents !== null && cents > 0 ? cents : 0;
}

function centsToEurosInput(cents: number): string {
  return centsToDecimalComma(cents);
}

const fieldClass =
  "h-11 rounded-lg border-line bg-papel/40 text-base text-tinta placeholder:text-tinta/40 focus-visible:border-cava focus-visible:ring-cava/40";

export function ContributionEnvelope({
  slug,
  initials,
  bizumPhone,
  stripeOnboarded,
}: ContributionEnvelopeProps) {
  // ---- apertura del sobre (una sola vez) ----
  const [open, setOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) return;
    const el = sectionRef.current;
    if (el === null || typeof IntersectionObserver === "undefined") {
      setOpen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setOpen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // ---- estado del formulario ----
  const [amountInput, setAmountInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Bizum: nombre e importe prefijados con lo elegido arriba, editables.
  const [bizumNameRaw, setBizumNameRaw] = useState<string | null>(null);
  const [bizumAmountRaw, setBizumAmountRaw] = useState<string | null>(null);
  const [bizumError, setBizumError] = useState<string | null>(null);
  const [bizumDone, setBizumDone] = useState(false);
  const [bizumPending, startBizumTransition] = useTransition();

  const amountCents = parseEurosToCents(amountInput);
  const feeCents = amountCents > 0 ? serviceFeeCents(amountCents) : 0;
  const totalCents = amountCents + feeCents;

  const bizumName = bizumNameRaw ?? guestName;
  const bizumAmount =
    bizumAmountRaw ?? (amountCents > 0 ? centsToEurosInput(amountCents) : "");

  const nothingAvailable = !stripeOnboarded && bizumPhone === null;

  function handleCardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCardError(null);
    startTransition(async () => {
      const result = await startCardContribution({
        slug,
        guestName,
        amountCents,
        message: message.trim() === "" ? undefined : message.trim(),
        email: email.trim() === "" ? undefined : email.trim(),
      });
      // En éxito la acción redirige a Stripe y nunca llega aquí.
      if (result && result.ok === false) setCardError(result.error);
    });
  }

  function handleBizumSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBizumError(null);
    startBizumTransition(async () => {
      const result = await logBizumContribution({
        slug,
        guestName: bizumName,
        amountCents: parseEurosToCents(bizumAmount),
        message: message.trim() === "" ? undefined : message.trim(),
        email: email.trim() === "" ? undefined : email.trim(),
      });
      if (result.ok) {
        setBizumDone(true);
      } else {
        setBizumError(result.error);
      }
    });
  }

  return (
    <section
      ref={sectionRef}
      aria-label="Vuestra aportación"
      className="relative mx-auto w-full max-w-md"
      style={{ perspective: "1000px" }}
    >
      <div className="relative overflow-visible rounded-xl border border-line bg-white shadow-[0_10px_30px_rgba(23,19,15,0.1)]">
        {/* Solapa triangular */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 origin-top rounded-t-xl transition-transform duration-500 ease-in-out motion-reduce:transition-none"
          style={{
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            backgroundColor:
              "color-mix(in oklab, var(--papel) 86%, var(--tinta))",
            boxShadow:
              "inset 0 -2px 6px color-mix(in oklab, var(--tinta) 20%, transparent)",
            transform: open ? "rotateX(180deg)" : "rotateX(0deg)",
          }}
        />
        {/* Sello de lacre (botón ≥44px: también abre el sobre) */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label={open ? `Sello de ${initials}` : "Abrir el sobre"}
          className="absolute top-16 left-1/2 z-20 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cava text-white shadow-[0_3px_8px_rgba(23,19,15,0.3)] outline-none focus-visible:ring-3 focus-visible:ring-cava/50 focus-visible:ring-offset-2"
        >
          <span
            aria-hidden="true"
            className="font-script flex size-11 items-center justify-center rounded-full border border-white/40 text-base leading-none"
          >
            {initials}
          </span>
        </button>

        <div className="px-5 pb-6 pt-24 sm:px-7">
          <h2 className="font-display text-center text-2xl font-semibold text-tinta">
            ¡Qué ganas de veros!
          </h2>
          <p className="mt-1 text-center text-sm text-tinta/70">
            Este sobre llega directo a los novios: vuestra aportación ayuda a
            hacer realidad su regalo.
          </p>

          {nothingAvailable ? (
            <p className="mt-6 rounded-lg border border-cava/40 bg-papel px-4 py-5 text-center text-sm text-tinta">
              Los pagos con tarjeta estarán disponibles muy pronto. Vuelve a
              pasarte por aquí en unos días, ¡gracias por la ilusión!
            </p>
          ) : (
            <>
              <form onSubmit={handleCardSubmit} className="mt-6 space-y-5">
                {/* Importe libre */}
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-tinta">
                    ¿Cuánto queréis aportar?
                  </Label>
                  <div className="relative">
                    <Input
                      id="amount"
                      name="amount"
                      type="text"
                      inputMode="decimal"
                      required
                      autoComplete="off"
                      placeholder="Lo que os salga del corazón"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className={`${fieldClass} pr-8 text-lg font-semibold tabular-nums`}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-tinta/50"
                    >
                      €
                    </span>
                  </div>
                  <div
                    className="flex flex-wrap gap-2 pt-1"
                    role="group"
                    aria-label="Importes frecuentes"
                  >
                    {QUICK_AMOUNTS_EUR.map((euros) => (
                      <button
                        key={euros}
                        type="button"
                        onClick={() => setAmountInput(String(euros))}
                        aria-pressed={amountCents === euros * 100}
                        className={`h-9 rounded-full px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-cava/50 ${
                          amountCents === euros * 100
                            ? "bg-cava text-white"
                            : "bg-rubor text-tinta/75 hover:bg-menta"
                        }`}
                      >
                        {euros} €
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nombre */}
                <div className="space-y-1.5">
                  <Label htmlFor="guest-name" className="text-tinta">
                    Pon tu nombre y apellidos
                  </Label>
                  <Input
                    id="guest-name"
                    name="guestName"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Ana García López"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className={fieldClass}
                  />
                </div>

                {/* Email opcional */}
                <div className="space-y-1.5">
                  <Label htmlFor="guest-email" className="text-tinta">
                    Tu email{" "}
                    <span className="font-normal text-tinta/50">
                      (opcional, para tu recibo)
                    </span>
                  </Label>
                  <Input
                    id="guest-email"
                    name="email"
                    type="email"
                    maxLength={120}
                    autoComplete="email"
                    placeholder="tucorreo@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={fieldClass}
                  />
                </div>

                {/* Mensaje opcional */}
                <div className="space-y-1.5">
                  <Label htmlFor="guest-message" className="text-tinta">
                    Un mensaje para los novios{" "}
                    <span className="font-normal text-tinta/50">
                      (opcional)
                    </span>
                  </Label>
                  <textarea
                    id="guest-message"
                    name="message"
                    rows={3}
                    maxLength={500}
                    placeholder="¡Nos vemos en la pista de baile!"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full rounded-lg border border-line bg-papel/40 px-2.5 py-2 text-base text-tinta transition-colors outline-none placeholder:text-tinta/40 focus-visible:border-cava focus-visible:ring-3 focus-visible:ring-cava/40"
                  />
                </div>

                {stripeOnboarded ? (
                  <>
                    {/* Desglose en vivo — los gastos de gestión SIEMPRE antes del botón */}
                    {amountCents > 0 && (
                      <dl
                        aria-live="polite"
                        className="space-y-1.5 rounded-lg bg-papel px-4 py-3 text-sm text-tinta tabular-nums"
                      >
                        <div className="flex justify-between gap-4">
                          <dt>Vuestra aportación</dt>
                          <dd>{formatEurCents(amountCents)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 text-tinta/70">
                          <dt>Gastos de gestión</dt>
                          <dd>{formatEurCents(feeCents)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-medium">
                          <dt>Total</dt>
                          <dd className="text-base font-semibold">
                            {formatEurCents(totalCents)}
                          </dd>
                        </div>
                      </dl>
                    )}

                    {cardError && (
                      <p role="alert" className="text-sm text-granate">
                        {cardError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isPending || amountCents <= 0}
                      className="h-12 w-full rounded-full bg-tinta text-base font-bold text-white shadow-[0_10px_22px_-10px_rgba(23,19,15,0.45)] transition-transform outline-none hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-cava/60 focus-visible:ring-offset-2 disabled:opacity-60"
                    >
                      {isPending ? "Preparando el pago…" : "Aportar a su regalo"}
                    </button>
                    <p className="text-center text-xs text-tinta/50">
                      Pago seguro con tarjeta, Apple Pay o Google Pay. También
                      podéis financiar en 3 pagos sin intereses con Klarna.
                    </p>
                  </>
                ) : (
                  <p className="rounded-lg border border-cava/40 bg-papel px-4 py-3 text-center text-sm text-tinta">
                    Los pagos con tarjeta estarán disponibles muy pronto.
                    Mientras tanto, podéis usar Bizum aquí abajo.
                  </p>
                )}
              </form>

              {/* ---- Bizum, más discreto ---- */}
              {bizumPhone !== null && (
                <div className="mt-7 border-t border-line pt-5">
                  <h3 className="font-display text-lg font-semibold text-tinta">
                    ¿Prefieres Bizum?
                  </h3>
                  {bizumDone ? (
                    <p
                      role="status"
                      className="mt-3 rounded-lg border border-salvia/50 bg-salvia/10 px-4 py-4 text-sm text-tinta"
                    >
                      <span className="font-medium text-salvia">
                        ¡Gracias{bizumName.trim() !== "" ? `, ${bizumName.trim()}` : ""}!
                      </span>{" "}
                      Hemos apuntado tu Bizum. Los novios lo confirmarán en
                      cuanto lo vean.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-sm text-tinta/70">
                        Envía tu aportación al{" "}
                        <span className="font-medium text-tinta tabular-nums">
                          {bizumPhone}
                        </span>
                        . Sin gastos de gestión.
                      </p>
                      <form
                        onSubmit={handleBizumSubmit}
                        className="mt-3 space-y-3"
                      >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="bizum-name" className="text-tinta">
                              Nombre y apellidos
                            </Label>
                            <Input
                              id="bizum-name"
                              name="bizumName"
                              type="text"
                              required
                              minLength={2}
                              maxLength={80}
                              autoComplete="name"
                              value={bizumName}
                              onChange={(e) => setBizumNameRaw(e.target.value)}
                              className={fieldClass}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="bizum-amount"
                              className="text-tinta"
                            >
                              Importe enviado
                            </Label>
                            <div className="relative">
                              <Input
                                id="bizum-amount"
                                name="bizumAmount"
                                type="text"
                                inputMode="decimal"
                                required
                                autoComplete="off"
                                value={bizumAmount}
                                onChange={(e) =>
                                  setBizumAmountRaw(e.target.value)
                                }
                                className={`${fieldClass} pr-8 tabular-nums`}
                              />
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-tinta/50"
                              >
                                €
                              </span>
                            </div>
                          </div>
                        </div>
                        {bizumError && (
                          <p role="alert" className="text-sm text-granate">
                            {bizumError}
                          </p>
                        )}
                        <button
                          type="submit"
                          disabled={bizumPending}
                          className="h-11 w-full rounded-full border border-line/30 bg-white text-sm font-semibold text-tinta transition-colors outline-none hover:bg-papel focus-visible:ring-3 focus-visible:ring-cava/50 disabled:opacity-60"
                        >
                          {bizumPending
                            ? "Apuntando tu Bizum…"
                            : "Ya he enviado mi Bizum"}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
