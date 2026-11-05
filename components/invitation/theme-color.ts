"use client";

import { createContext, useEffect } from "react";

/**
 * true mientras el sobre tapa la invitación, cerrado o abriéndose (lo provee
 * SealedEnvelope): la franja del iPhone no cambia a la portada antes de verse.
 */
export const SealedContext = createContext(false);

/**
 * true cuando el sobre ya terminó de abrirse (o no hay sobre). Sigue en false
 * durante toda la animación de apertura: el autoavance de la Story no
 * arranca hasta que la portada está a la vista.
 */
export const EnvelopeOpenContext = createContext(true);

/** Colores de la franja del iPhone por fase (solo en la web pública). */
export interface InviteThemeColors {
  sealed: string;
  cover: string;
  scene: string;
}

/** Cambia <meta name="theme-color"> (franja del iPhone) y lo restaura al salir. */
export function useThemeColor(color: string | null | undefined): void {
  useEffect(() => {
    if (!color) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const previous = meta.getAttribute("content");
    meta.setAttribute("content", color);
    // iOS 26 ya no pinta la franja con theme-color sino con el fondo de la
    // página (html/body): se tiñen también para que el color llegue.
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.backgroundColor;
    const prevBody = body.style.backgroundColor;
    root.style.backgroundColor = color;
    body.style.backgroundColor = color;
    return () => {
      if (previous !== null) meta.setAttribute("content", previous);
      root.style.backgroundColor = prevRoot;
      body.style.backgroundColor = prevBody;
    };
  }, [color]);
}
