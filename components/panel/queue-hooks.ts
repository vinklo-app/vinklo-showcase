"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";

type LinkResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Enlace ya creado para cada persona de la fila mientras no se confirme el
 * envío: mirar el mensaje y cancelar no crea otro enlace vivo cada vez
 * (createSeriesInvitation y createReminderLink añaden, no sustituyen).
 */
export function useIssuedLinks(createLink: (guestId: string) => Promise<LinkResult>) {
  const issued = useRef(new Map<string, string>());
  return useMemo(() => ({
    get(guestId: string): Promise<LinkResult> {
      const path = issued.current.get(guestId);
      if (path) return Promise.resolve({ ok: true, path });
      return createLink(guestId).then((result) => {
        if (result.ok) issued.current.set(guestId, result.path);
        return result;
      });
    },
    /** Tras confirmar el envío: la próxima vez (otra tanda) se crea uno nuevo. */
    forget(guestId: string) { issued.current.delete(guestId); },
  }), [createLink]);
}

/**
 * Al aparecer «¿Lo habéis enviado?» el botón que abrió la hoja ya no existe
 * y el foco caería en <body>. Se lleva a la pregunta cuando la hoja termina
 * de cerrarse (180 ms; mientras, el resto de la página es inert).
 */
export function useFocusQuestion(ref: RefObject<HTMLElement | null>, active: boolean, key: string | undefined) {
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) ref.current?.focus();
    }, 240);
    return () => window.clearTimeout(timer);
  }, [ref, active, key]);
}
