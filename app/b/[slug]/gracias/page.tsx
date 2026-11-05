import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { coupleInitials } from "@/components/invitation/format";
import { BRAND_NAME } from "@/lib/brand";
import { getPublicSite } from "@/lib/data/site-public";
import { RSVP_MVP } from "@/lib/product-scope";
import { findScene } from "@/lib/site-document";

export const dynamic = "force-dynamic";

interface GraciasPageProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  title: "¡Mil gracias!",
  robots: { index: false },
};

const buttonClass =
  "inline-flex min-h-12 items-center justify-center px-6 text-[0.8125rem] font-bold tracking-[0.08em] uppercase transition-[opacity,transform] duration-[220ms] ease-[var(--ease-out)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cava active:scale-[0.97] active:duration-[80ms]";

/**
 * Página de vuelta de Stripe Checkout. El webhook es quien confirma la
 * aportación: aquí decimos "pago realizado", nunca "confirmado".
 *
 * R-02: lee la instantánea publicada (`getPublicSite`), no la fila viva de
 * `weddings`: si la pareja retiró la web, esta página también es 404, y los
 * nombres son los publicados, no el borrador.
 */
export default async function GraciasPage({ params }: GraciasPageProps) {
  // Sin pagos activos no hay checkout del que volver: la página no existe
  // (revisión de código 2026-10-06, R04; el webhook histórico sigue intacto).
  if (RSVP_MVP) notFound();
  const { slug } = await params;
  const site = await getPublicSite(slug);
  const cover = site ? findScene(site.document, "cover") : undefined;
  if (!site || !cover) notFound();

  const { partnerName1, partnerName2 } = cover.props;
  const initials = coupleInitials(partnerName1, partnerName2);

  return (
    <main className="flex min-h-svh items-center justify-center bg-papel px-4 py-12 text-center text-tinta">
      <div className="w-full max-w-md">
        {/* Monograma de un solo glifo, como en la portada de la invitación */}
        <p aria-hidden="true" className="font-script text-3xl text-tinta/70">
          {initials}
        </p>

        <p className="mt-8 font-sans text-[11px] font-medium tracking-[0.16em] text-cava-texto uppercase">Pago realizado</p>
        <h1 className="font-display mt-4 text-[clamp(2.5rem,1.6rem+4vw,4rem)] leading-[1.02] tracking-[-0.03em]">¡Mil gracias!</h1>
        <p className="mx-auto mt-6 max-w-[30rem] text-base leading-relaxed text-pretty text-tinta/75">
          Tu sobre ya está de camino a {partnerName1} y {partnerName2}. Les va a hacer muchísima ilusión — y a los preparativos
          también.
        </p>
        <p className="mt-3 text-sm text-tinta/60">Si nos dejaste tu email, recibirás tu recibo en unos minutos.</p>

        <Link href={`/b/${site.slug}`} className={`${buttonClass} mt-9 border border-current/25 text-tinta hover:border-current/50`}>
          Volver a la invitación
        </Link>

        {/* Bucle de crecimiento (estrategia M1): el invitado acaba de vivir
            el producto en su mejor momento — es el próximo cliente. */}
        <div className="mt-12 border-t border-current/10 pt-8">
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-tinta/70">
            ¿Os casáis vosotros — o conoces a alguien que sí? Esto es {BRAND_NAME}, el sobre de boda: los invitados aportan desde
            un enlace y los novios reciben el 100&nbsp;%. Gratis para los novios.
          </p>
          <Link
            href="/?utm_source=guest&utm_medium=gracias&utm_campaign=loop"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-tinta underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cava"
          >
            Descubrir {BRAND_NAME} →
          </Link>
        </div>
      </div>
    </main>
  );
}
