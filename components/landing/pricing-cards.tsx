import Link from "next/link";

import { BRAND_NAME } from "@/lib/brand";
import { formatEurCents } from "@/lib/fees";
import {
  FREE_FEATURES,
  PREMIUM_FEATURES,
  PREMIUM_FULL_PRICE_CENTS,
  PREMIUM_PRICE_CENTS,
} from "@/lib/pricing-data";
import { ArrowUpRight, CheckIcon } from "@/components/brand/icons";

/**
 * Las dos cards de planes (PLAN.md §3), compartidas entre el teaser del
 * home y /precios. Rediseño 2026-07-09: esquina-solapa del sobre en vez
 * de rounded-none genérico; el plan recomendado se distingue por superficie
 * (rubor + borde cava), no por el par botón-relleno/botón-fantasma; sin
 * badge de escasez (DESIGN.md §7/§8 prohíbe "plazas limitadas").
 */

function eur(cents: number): string {
  // Sin decimales para precios redondos de plan (79 €, 99 €).
  return formatEurCents(cents).replace(",00", "");
}

function FeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 space-y-2.5 text-sm text-tinta/80">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <CheckIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-salvia"
          />
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingCards() {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
      {/* Gratis */}
      <div className="lv-reveal flex flex-col rounded-none border border-line bg-white p-6 sm:p-8">
        <h3 className="font-display text-2xl font-semibold text-balance text-tinta">
          Gratis para los novios
        </h3>
        <p className="mt-2 text-sm text-tinta/70">
          Recibís el 100&nbsp;% de cada aportación. Sin cuotas, sin sorpresas.
        </p>
        <p className="font-display mt-5 text-4xl font-semibold text-tinta tabular-nums">
          0&nbsp;€
        </p>
        <FeatureList items={FREE_FEATURES} />
        <p className="mt-2.5 flex gap-2.5 text-sm text-tinta/65">
          <span aria-hidden="true">·</span>
          Con la marca de {BRAND_NAME} en vuestra página
        </p>
        <div className="mt-auto pt-7">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-tinta underline-offset-4 transition-colors outline-none hover:underline focus-visible:ring-3 focus-visible:ring-cava/60 focus-visible:ring-offset-2"
          >
            Crear vuestra boda
            <ArrowUpRight aria-hidden="true" className="size-4 text-cava" />
          </Link>
        </div>
      </div>

      {/* Premium — recomendado: superficie gris suave + hairline de tinta, mismo CTA */}
      <div className="lv-reveal flex flex-col rounded-none border border-line bg-rubor p-6 sm:p-8">
        <h3 className="font-display text-2xl font-semibold text-balance text-tinta">
          Premium Boda
        </h3>
        <p className="mt-2 text-sm text-tinta/70">
          Un solo pago para toda la boda. Nada de suscripciones.
        </p>
        <p className="mt-5 flex items-baseline gap-2.5 tabular-nums">
          <span className="font-display text-4xl font-semibold text-tinta">
            {eur(PREMIUM_PRICE_CENTS)}
          </span>
          <span className="text-lg text-tinta/60 line-through">
            {eur(PREMIUM_FULL_PRICE_CENTS)}
          </span>
        </p>
        <p className="mt-1 text-xs text-tinta/65">
          Precio de lanzamiento — después, {eur(PREMIUM_FULL_PRICE_CENTS)}{" "}
          (pago único).
        </p>
        <FeatureList items={PREMIUM_FEATURES} />
        <div className="mt-auto pt-7">
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-none bg-tinta px-6 text-[13px] font-semibold tracking-[0.08em] text-white uppercase transition-colors outline-none hover:bg-[#2B231C] focus-visible:ring-3 focus-visible:ring-cava/60 focus-visible:ring-offset-2"
          >
            Empezar con Premium
          </Link>
        </div>
      </div>
    </div>
  );
}
