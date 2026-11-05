"use client";

import { countdownSentence, countdownText } from "@/lib/countdown";
import { useCountdown } from "../use-countdown";

/**
 * Cuenta atrás de la portada (Story): días; con hora de ceremonia, también
 * horas y minutos. Viva (se refresca sola) y en hora de Madrid. Pasada la
 * boda no se pinta. `suppressHydrationWarning`: donde el servidor y el
 * cliente calculan «ahora» por separado (sin `now`), pueden cruzar un
 * minuto. Conserva las clases `.sp-countdown`/`.sp-count`: el creador las
 * mide para anclar la portada.
 */
export function CoverCountdown({ weddingDate, time, initialNow, variant }: { weddingDate: string; time: string | null; initialNow: number; variant: "photo" | "paper" }) {
  const countdown = useCountdown(weddingDate, time, initialNow);
  if (!countdown) return null;
  const { value, rest } = countdownText(countdown);
  if (variant === "photo") {
    return (
      <div className="sp-countdown sp-countdown-inline mt-6">
        <p className="sr-only" suppressHydrationWarning>{countdownSentence(countdown)}</p>
        <p className="font-display text-lg text-papel" aria-hidden="true">
          <span className="sp-count-inline tabular" suppressHydrationWarning>{value}</span> <span suppressHydrationWarning>{rest}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="sp-countdown mt-9">
      <p className="sr-only" suppressHydrationWarning>{countdownSentence(countdown)}</p>
      <p className="sp-count font-display tabular text-cava-texto" aria-hidden="true" suppressHydrationWarning>{value}</p>
      <p className="font-display mt-2 text-lg text-tinta" aria-hidden="true" suppressHydrationWarning>{rest}</p>
      <p className="mx-auto mt-1.5 max-w-[22rem] text-xs text-pretty text-tinta/65">Nos encantará celebrar este día contigo</p>
    </div>
  );
}
