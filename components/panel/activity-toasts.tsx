"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ToastEvent = { key: string; kind: "opened" | "yes" | "no"; name: string; companions: number };

const text = (e: ToastEvent) =>
  e.kind === "opened" ? `${e.name} ha abierto su invitación`
    : e.kind === "no" ? `${e.name} no podrá venir`
      : e.companions > 0 ? `${e.name} viene, con ${e.companions} ${e.companions === 1 ? "acompañante" : "acompañantes"}` : `${e.name} viene`;

/**
 * Avisa de lo nuevo que trae el refresco de 30 s del resumen (sin avisar de
 * lo que ya estaba al abrir la página). Máximo tres avisos por refresco.
 */
export function ActivityToasts({ events }: { events: ToastEvent[] }) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(events.map((e) => e.key));
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(e.key));
    for (const e of events) seen.current.add(e.key);
    for (const e of fresh.slice(0, 3).reverse()) {
      if (e.kind === "yes") toast.success(text(e));
      else toast(text(e));
    }
  }, [events]);
  return null;
}
