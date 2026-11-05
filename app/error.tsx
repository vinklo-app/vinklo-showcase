"use client";

import Link from "next/link";
import { captureClientException } from "@/lib/observability/sentry-client";
import { useEffect } from "react";

import { LazoIcon } from "@/components/brand/icons";
import "@/app/login/access.css";

/**
 * Error raíz con la marca (misma pantalla que el 404). Lo recibe cualquier
 * fallo de render fuera de las rutas con su propio error.tsx (/panel).
 * Solo el digest va al log: el mensaje puede llevar datos del invitado.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] error de render", error.digest ?? "sin digest");
    // Los límites de error de React se tragan el fallo antes de window.onerror:
    // sin esto Sentry no lo ve. El filtro (sentry-scrub) limpia datos personales.
    captureClientException(error);
  }, [error]);

  return (
    <main className="ac-page">
      <header className="ac-top">
        <Link href="/" aria-label="vinklo, inicio" className="ac-wordmark">
          <LazoIcon aria-hidden="true" />
          <span aria-hidden="true">
            v<span className="ac-wordmark-i">ı</span>nklo
          </span>
        </Link>
      </header>

      <section className="ac-center">
        <div className="ac-card">
          <h1 className="ac-h1">No hemos podido cargar esta página.</h1>
          <p className="mt-4 text-sm leading-relaxed">No se ha perdido nada. Prueba a cargarla de nuevo en unos segundos.</p>
          <button type="button" onClick={reset} className="ac-btn ac-btn--inline">
            Volver a intentar
          </button>
        </div>
      </section>

      <footer className="ac-foot">
        <nav aria-label="Legal">
          <Link href="/aviso-legal">Aviso legal</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </footer>
    </main>
  );
}
