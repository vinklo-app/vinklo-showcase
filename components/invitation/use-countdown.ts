"use client";

import { useEffect, useState } from "react";
import { weddingCountdown, type Countdown } from "@/lib/countdown";

/**
 * Reloj del cliente. El primer render usa `initialNow` (el instante del
 * servidor) para que la hidratación coincida; tras montar, el reloj real cada
 * `tickMs`. `mounted` dice si ya es el reloj real.
 */
export function useNow(initialNow: number, tickMs: number): { now: number; mounted: boolean } {
  const [state, setState] = useState({ now: initialNow, mounted: false });
  useEffect(() => {
    setState({ now: Date.now(), mounted: true });
    const timer = window.setInterval(() => setState({ now: Date.now(), mounted: true }), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);
  return state;
}

/** Cuenta atrás viva (ver `weddingCountdown`): se recalcula cada 30 s; los minutos nunca van más de medio minuto tarde. */
export function useCountdown(weddingDate: string | null | undefined, time: string | null | undefined, initialNow: number, tickMs = 30_000): Countdown | null {
  const { now } = useNow(initialNow, tickMs);
  return weddingCountdown(weddingDate, time, now);
}
