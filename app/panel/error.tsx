"use client";

import { captureClientException } from "@/lib/observability/sentry-client";
import Link from "next/link";
import { useEffect } from "react";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);
  return (
    <main className="pn-wrap pn-narrow py-14">
      <p className="pn-label">Vuestro panel</p>
      <h1 className="pn-display pn-h1 mt-3">No hemos podido cargar vuestro panel</h1>
      <p className="pn-muted mt-4 max-w-[48ch] text-sm leading-relaxed">Vuestros datos no se han modificado. Probad a cargarlo de nuevo.</p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button type="button" onClick={reset} className="pn-btn pn-press">Volver a intentar</button>
        <Link href="/panel" className="pn-link pn-press">Ir al resumen</Link>
      </div>
    </main>
  );
}
