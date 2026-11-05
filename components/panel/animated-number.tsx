"use client";

import { useState } from "react";
import { formatCount } from "@/components/panel/guest-status";

/**
 * Cifra que se anima SOLO cuando cambia su valor (nunca al montar ni al
 * filtrar: quien la usa decide pasarle totales que no dependen de la
 * búsqueda). El valor nuevo entra desde abajo si sube y desde arriba si
 * baja (240 ms, --ease-out, transform+opacity); con reduced-motion solo
 * funde. Cifras tabulares: el ancho no baila. Formato «1.000» a mano.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  // «Información de renders anteriores» (patrón de la doc de React): sin
  // efectos ni refs mutadas en render.
  const [seen, setSeen] = useState<{ value: number; tick: number; dir: "up" | "down" | null }>({ value, tick: 0, dir: null });
  if (seen.value !== value) setSeen({ value, tick: seen.tick + 1, dir: value > seen.value ? "up" : "down" });
  return (
    <span className={`pn-count ${className ?? ""}`}>
      <span key={seen.tick} className="pn-count-value" data-dir={seen.dir ?? undefined}>
        {formatCount(value)}
      </span>
    </span>
  );
}
