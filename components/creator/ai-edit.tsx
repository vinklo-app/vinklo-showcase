"use client";

/**
 * Atajo de la IA a un apartado de la misma página. La conversación con la IA
 * (hilo, progreso, versiones y compositor) vive en `components/site-chat`.
 */
import { useEffect, useState } from "react";
import type { AiAction } from "@/lib/ai/messages";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";

/**
 * Atajo de la IA a un apartado de la misma página («Ir a Vuestro contenido»).
 * Solo se pinta si el destino existe (en el creador todavía no hay
 * «Vuestro contenido»): nunca un enlace roto.
 */
export function AiActionLink({ action, className = "wb-link" }: { action?: AiAction; className?: string }) {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    setPresent(Boolean(action && document.getElementById(action.target)));
  }, [action]);
  if (!action || !present) return null;
  return <a
    href={`#${action.target}`}
    className={className}
    onClick={(event) => {
      const target = document.getElementById(action.target);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }}
  >{action.label}</a>;
}
