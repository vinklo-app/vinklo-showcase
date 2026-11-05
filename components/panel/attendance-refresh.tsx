"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";

/** Cada cuánto se refresca solo y cuántas veces como máximo (plan maestro §4.4). */
export const AUTO_REFRESH_MS = 30_000;
export const AUTO_REFRESH_MAX = 20;

/**
 * Refresco de respuestas cada 30 s (solo con la pestaña visible y sin una
 * hoja de edición abierta), como mucho 20 veces seguidas: una pestaña
 * olvidada abierta no consulta al servidor toda la tarde. Tocar «Actualizar
 * respuestas» lo reanuda. Sin parpadeo: el texto del botón no cambia de
 * ancho, solo gira el icono; el estado va a un aria-live oculto.
 */
export function AttendanceRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const runs = useRef(0);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || document.querySelector('[data-guest-editor="true"]')) return;
      runs.current += 1;
      startTransition(() => router.refresh());
      if (runs.current >= AUTO_REFRESH_MAX) { window.clearInterval(timer); setStopped(true); }
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router, stopped]);
  function refreshNow() {
    runs.current = 0;
    setStopped(false);
    startTransition(() => router.refresh());
  }
  return (
    <div className="pn-refresh">
      <button type="button" aria-busy={pending} disabled={pending} onClick={refreshNow} className="pn-refresh-btn pn-press">
        <RefreshCwIcon aria-hidden="true" />
        <span>Actualizar respuestas</span>
      </button>
      <span>{stopped ? "Hemos dejado de actualizar solos: tocad para ver lo último." : "Se actualiza cada 30 s mientras esta página está visible."}</span>
      <span className="sr-only" role="status" aria-live="polite">{pending ? "Actualizando respuestas" : ""}</span>
    </div>
  );
}
