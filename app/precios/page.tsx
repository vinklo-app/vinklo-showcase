import "@/components/landing/landing.css";

import type { Metadata } from "next";
import Link from "next/link";

import {
  formatEurCents,
  serviceFeeCents,
  totalChargeCents,
} from "@/lib/fees";
import { PRICING_FAQS } from "@/lib/pricing-data";
import {
  faqPageJsonLd,
  JsonLd,
  softwareApplicationJsonLd,
} from "@/lib/jsonld";
import { PricingCards } from "@/components/landing/pricing-cards";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Gratis para los novios: recibís el 100 % de cada aportación. El invitado añade unos gastos de gestión siempre visibles antes de pagar.",
};

/**
 * /precios — la página dedicada de precios (2026-07-09). El home lleva un
 * teaser con las mismas cards; aquí vive el detalle: desglose de la
 * comisión del invitado CALCULADO EN VIVO con lib/fees.ts (nunca
 * hardcodeado, no puede desincronizarse del modelo real) y la FAQ de
 * precios con <details> nativo (mismo patrón accesible que el FAQ del
 * home).
 */

// Ejemplo con importe no redondo (DESIGN.md §8: 6.450 € gana a 5.000 €).
const EXAMPLE_CONTRIBUTION_CENTS = 15000;

function FeeExample() {
  const fee = serviceFeeCents(EXAMPLE_CONTRIBUTION_CENTS);
  const total = totalChargeCents(EXAMPLE_CONTRIBUTION_CENTS);
  return (
    <div className="mx-auto mt-10 max-w-md rounded-none border border-line bg-white p-6 sm:p-8">
      <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-cava-texto uppercase">
        Un ejemplo real
      </p>
      <dl className="mt-4 space-y-3 text-sm tabular-nums">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-tinta/70">Aportación del invitado</dt>
          <dd className="font-semibold text-tinta">
            {formatEurCents(EXAMPLE_CONTRIBUTION_CENTS)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-tinta/70">Gastos de gestión</dt>
          <dd className="font-semibold text-tinta">{formatEurCents(fee)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold text-tinta">El invitado paga</dt>
          <dd className="font-display text-lg font-semibold text-tinta">
            {formatEurCents(total)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-tinta">Vosotros recibís</dt>
          <dd className="font-display text-lg font-semibold text-salvia">
            {formatEurCents(EXAMPLE_CONTRIBUTION_CENTS)}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-tinta/65">
        Calculado con la tarifa real del producto: 1,9&nbsp;% +
        0,95&nbsp;€ por aportación con tarjeta (mínimo 1,50&nbsp;€).
      </p>
    </div>
  );
}

export default function PreciosPage() {
  return (
    <>
    <SiteHeader />
    <main className="bg-papel text-tinta">
      <JsonLd data={faqPageJsonLd("https://vinklo.es/precios#faq", PRICING_FAQS)} />
      <JsonLd
        data={softwareApplicationJsonLd({
          premiumPriceEur: "79.00",
          premiumFullPriceEur: "99",
        })}
      />
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <header className="text-center">
          <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-cava-texto uppercase">
            Precios
          </p>
          <h1 className="font-display mt-3 text-4xl font-semibold text-balance text-tinta sm:text-5xl">
            Qué cuesta — y quién lo paga
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-pretty text-tinta/70">
            Para los novios, nada: recibís el 100&nbsp;% de cada aportación.
            El invitado añade unos gastos de gestión pequeños, siempre
            visibles antes de pagar.
          </p>
        </header>

        <div className="mt-14">
          <PricingCards />
        </div>

        {/* ---- Desglose de costes (movido del home el 2026-07-09) ---- */}
        <section aria-labelledby="costes-title" className="mt-24">
          <h2
            id="costes-title"
            className="font-display text-center text-3xl font-semibold text-balance text-tinta sm:text-4xl"
          >
            ¿Qué costes tiene?
          </h2>
          <div className="mx-auto mt-8 grid max-w-5xl gap-5 sm:grid-cols-3">
            <div className="rounded-none bg-rubor p-6 text-center">
              <p className="font-display text-5xl font-semibold text-cava-texto tabular-nums">
                0&nbsp;€
              </p>
              <p className="mt-2 font-display text-lg font-semibold text-tinta">
                Para los novios
              </p>
              <p className="mt-1.5 text-sm text-pretty text-tinta/65">
                Nada. Nunca. Recibís el 100&nbsp;% de cada aportación en
                vuestra cuenta.
              </p>
            </div>
            <div className="rounded-none bg-menta p-6 text-center">
              <p className="font-display text-5xl font-semibold text-tinta tabular-nums">
                1,9&nbsp;%
              </p>
              <p className="mt-2 font-display text-lg font-semibold text-tinta">
                Para los invitados
              </p>
              <p className="mt-1.5 text-sm text-pretty text-tinta/65">
                + 0,95&nbsp;€ de gestión por aportación con tarjeta — siempre
                visibles antes de pagar.
              </p>
            </div>
            <div className="rounded-none bg-vainilla p-6 text-center">
              <p className="font-display text-5xl font-semibold text-tinta tabular-nums">
                3<span className="text-cava-texto">×</span>
              </p>
              <p className="mt-2 font-display text-lg font-semibold text-tinta">
                Pagos aplazados
              </p>
              <p className="mt-1.5 text-sm text-pretty text-tinta/65">
                Los invitados pueden financiar el regalo en 3 pagos sin
                intereses con Klarna. Sin coste para vosotros.
              </p>
            </div>
          </div>

          <FeeExample />
        </section>

        {/* ---- FAQ de precios: <details> nativo, mismo patrón que el home ---- */}
        <section aria-labelledby="faq-precios-title" className="mt-24">
          <h2
            id="faq-precios-title"
            className="font-display text-3xl font-semibold text-balance text-tinta sm:text-4xl"
          >
            Preguntas sobre precios
          </h2>
          <div className="mt-8 grid items-start gap-5 md:grid-cols-2">
            {PRICING_FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-none border border-line bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center gap-4 p-5 outline-none focus-visible:ring-3 focus-visible:ring-cava/60 focus-visible:ring-offset-2 sm:p-6 [&::-webkit-details-marker]:hidden">
                  <span className="font-display flex-1 text-lg font-semibold text-tinta">
                    {faq.q}
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-2xl leading-none font-semibold text-cava-texto transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="px-5 pb-6 text-sm leading-relaxed text-pretty text-tinta/70 sm:px-6">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <footer className="mt-20 text-center">
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-none bg-tinta px-8 text-sm font-semibold tracking-[0.08em] text-white uppercase transition-colors outline-none hover:bg-[#2B231C] focus-visible:ring-3 focus-visible:ring-cava/60 focus-visible:ring-offset-2"
          >
            Crear nuestra web
          </Link>
          <p className="mt-6">
            <Link
              href="/"
              className="text-sm font-medium text-tinta/70 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-cava/60"
            >
              ← Volver al inicio
            </Link>
          </p>
        </footer>
      </div>
    </main>
    </>
  );
}
