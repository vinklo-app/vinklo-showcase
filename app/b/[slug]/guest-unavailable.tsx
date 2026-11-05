"use client";

import { LazoIcon } from "@/components/brand/icons";

/**
 * La invitación no se ha podido leer (fallo momentáneo de la base de datos):
 * no es «boda no encontrada» (revisión perf P1-3). Mismo aspecto que el 404
 * del invitado, de tú y con «Reintentar», que recarga la página entera (la
 * lectura vuelve a hacerse en el servidor; nada de esto se cachea).
 * Un Server Component no puede fijar el estado HTTP 503 ni Retry-After: la
 * respuesta es 200 con `private, no-store` (next.config.ts, /b/*).
 */
export function GuestUnavailable() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-papel px-6 text-center text-tinta" data-guest-unavailable="">
      <div className="max-w-sm">
        <LazoIcon aria-hidden="true" className="mx-auto size-12 text-tinta" />
        <h1 className="font-display mt-6 text-3xl font-semibold">No hemos podido cargar la invitación</h1>
        <p className="mt-3 text-sm leading-relaxed text-tinta/70">
          Ha sido un fallo momentáneo, no de tu enlace: la invitación sigue ahí. Vuelve a intentarlo en unos segundos.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-sm font-medium text-tinta transition-colors outline-none hover:bg-white/60 focus-visible:ring-3 focus-visible:ring-cava/50"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
