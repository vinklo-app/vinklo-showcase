"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";

const STAGGER_MS = 60;
const STAGGER_CAP_MS = 300;

/** Lo que ya está a la vista al hidratar se revela tras este respiro (no a la vez que la hidratación). */
const IN_VIEW_DELAY_MS = 140;

/**
 * Reveals de la landing (DESIGN.md §5): IntersectionObserver, una sola vez,
 * escalonado de 60 ms dentro de cada `data-reveal-group`, tope 300 ms.
 *
 * Reglas que respeta:
 * - Sin JavaScript no se oculta nada: el CSS solo aplica el estado inicial
 *   cuando la raíz lleva `data-motion`. Lo pone antes de pintar el script en
 *   línea de la raíz (`LANDING_MOTION_BOOT` en landing-lovable.tsx; si este
 *   componente no llega a montar, ese script lo quita) y lo confirma este
 *   componente con `data-motion-ready`.
 * - Lo que ya está a la vista al cargar (p. ej. al recargar a media página:
 *   Safari restaura el scroll) también se anima, con un respiro tras la
 *   hidratación; antes se daba por revelado y las tarjetas salían ya
 *   terminadas. El hero no lleva data-reveal: el h1 (LCP) nunca se oculta.
 * - `prefers-reduced-motion`: `data-motion="reduce"`; el CSS conserva el
 *   fundido y elimina el desplazamiento.
 */
export function LandingMotion({ rootSelector = ".ll-home" }: { rootSelector?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) return;
    // Sin el script en línea (navegación en el cliente: React no ejecuta
    // scripts insertados) el contenido ya se ha pintado visible: lo que está a
    // la vista se queda así, sin ocultarlo y volverlo a mostrar.
    const booted = root.hasAttribute("data-motion");
    root.setAttribute("data-motion-ready", "");
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])"));
    if (items.length === 0) return () => root.removeAttribute("data-motion-ready");

    const reduce = prefersReducedMotion();
    const viewportBottom = window.innerHeight;

    const groupIndex = new Map<string, number>();
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      const inView = rect.top < viewportBottom && rect.bottom > 0;
      if (inView && !booted) { el.setAttribute("data-revealed", ""); continue; }
      const group = el.dataset.revealGroup;
      let delay = inView && !reduce ? IN_VIEW_DELAY_MS : 0;
      if (group) {
        const index = groupIndex.get(group) ?? 0;
        delay += Math.min(index * STAGGER_MS, STAGGER_CAP_MS);
        groupIndex.set(group, index + 1);
      }
      if (delay > 0) el.style.setProperty("--reveal-delay", `${delay}ms`);
    }

    root.setAttribute("data-motion", reduce ? "reduce" : "full");

    if (typeof IntersectionObserver === "undefined") {
      for (const el of items) el.setAttribute("data-revealed", "");
      return () => { root.removeAttribute("data-motion"); root.removeAttribute("data-motion-ready"); };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of items) observer.observe(el);

    return () => {
      observer.disconnect();
      root.removeAttribute("data-motion");
      root.removeAttribute("data-motion-ready");
    };
  }, [rootSelector]);

  return null;
}
