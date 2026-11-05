"use client";

import { captureClientException } from "@/lib/observability/sentry-client";
import { useEffect } from "react";

/**
 * Último recurso: falla el propio layout raíz, así que no hay fuentes ni
 * globals.css. Colores de la marca v9 en línea (perla, texto, ciruela).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] error global", error.digest ?? "sin digest");
    // Los límites de error de React se tragan el fallo antes de window.onerror:
    // sin esto Sentry no lo ve. El filtro (sentry-scrub) limpia datos personales.
    captureClientException(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#F8F7FA", color: "#24212A", fontFamily: "Georgia, 'Times New Roman', serif", padding: "0 16px" }}>
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p style={{ fontFamily: "Helvetica Neue, Arial, sans-serif", fontWeight: 700, fontSize: "1.25rem", margin: 0 }}>vinklo</p>
          <h1 style={{ fontWeight: 400, fontSize: "1.75rem", lineHeight: 1.2, margin: "2rem 0 1rem" }}>Algo ha fallado por nuestra parte.</h1>
          <p style={{ fontFamily: "Helvetica Neue, Arial, sans-serif", fontSize: "0.9375rem", lineHeight: 1.6, margin: 0, color: "#655E6B" }}>No se ha perdido nada. Prueba a cargar la página de nuevo en unos segundos.</p>
          <button type="button" onClick={reset} style={{ marginTop: "2rem", minHeight: 48, padding: "0 24px", border: 0, borderRadius: 12, background: "#573B62", color: "#FFFFFF", fontFamily: "Helvetica Neue, Arial, sans-serif", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
            Volver a intentar
          </button>
        </main>
      </body>
    </html>
  );
}
