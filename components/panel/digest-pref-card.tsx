"use client";

/**
 * «Avisos por correo» (Ajustes, plan maestro §2.6): cada miembro decide si
 * recibe el resumen diario de respuestas en su correo. Guarda al marcar.
 */
import { useState, useTransition } from "react";

import { setDigestEnabled, type DigestPrefState } from "@/lib/actions/digest";

export function DigestPrefCard({ state }: { state: DigestPrefState }) {
  const [enabled, setEnabled] = useState(state.available ? state.enabled : true);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();
  if (!state.available) return null;

  function toggle(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setStatus("idle");
    startTransition(async () => {
      try {
        const result = await setDigestEnabled(next);
        if (result.ok) {
          setStatus("saved");
          return;
        }
      } catch {
        // Cae al error de abajo.
      }
      setEnabled(previous);
      setStatus("error");
    });
  }

  return (
    <section id="avisos" aria-labelledby="avisos-title" className="pn-ed-section">
      <h2 id="avisos-title" className="pn-display pn-h2">Avisos por correo</h2>
      <label className="pn-optrow">
        <input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
        <span>Recibir el resumen diario: un correo por la mañana si alguien ha respondido a la invitación el día anterior.</span>
      </label>
      <p className="pn-help">Solo afecta a tu correo; tu pareja decide el suyo.</p>
      {status === "saved" ? <p role="status" className="pn-note pn-note--ok">Guardado.</p> : null}
      {status === "error" ? <p role="alert" className="pn-row-error">No hemos podido guardarlo. Probad de nuevo en un momento.</p> : null}
    </section>
  );
}
