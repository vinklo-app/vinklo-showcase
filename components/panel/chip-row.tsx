"use client";

import { useEffect, useRef } from "react";

/**
 * Fila de chips desplazable (móvil): al cargar, el chip activo queda a la
 * vista. Sin esto, «Con alergias o notas» activo quedaba fuera de la pantalla
 * y la lista parecía «Todos».
 */
export function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - 16);
    }
  });
  return <nav ref={ref} aria-label={label} className="pn-chips">{children}</nav>;
}
