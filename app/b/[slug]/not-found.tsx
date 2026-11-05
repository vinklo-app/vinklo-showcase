import Link from "next/link";

import { LazoIcon } from "@/components/brand/icons";
import { BRAND_NAME } from "@/lib/brand";

export default function GuestNotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-papel px-6 text-center text-tinta">
      <div className="max-w-sm">
        {/* Símbolo de vinklo (antes, monograma «B» de Bodabote). */}
        <LazoIcon aria-hidden="true" className="mx-auto size-12 text-tinta" />
        <h1 className="font-display mt-6 text-3xl font-semibold">
          No encontramos esta boda
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-tinta/70">
          Puede que al enlace se le haya colado alguna letra por el camino.
          Revisa el mensaje que te enviaron los novios y vuelve a intentarlo:
          la fiesta sigue en pie.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-sm font-medium text-tinta transition-colors outline-none hover:bg-white/60 focus-visible:ring-3 focus-visible:ring-cava/50"
        >
          Conocer {BRAND_NAME}
        </Link>
      </div>
    </main>
  );
}
