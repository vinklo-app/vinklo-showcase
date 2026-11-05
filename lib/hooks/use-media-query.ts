import { useSyncExternalStore } from "react";

/** Consulta CSS de movimiento reducido (la única que se lee suelta, sin hook). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * ¿Cumple la ventana esta media query? Reactivo (useSyncExternalStore). En
 * servidor y en la hidratación devuelve false, como los hooks que sustituye.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Lectura puntual (handlers y efectos): sin ventana, false. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
