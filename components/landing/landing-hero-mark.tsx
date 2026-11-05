"use client";

/**
 * Hero de la landing (7-oct-2026, referencia vercel.com): en el centro, la
 * «V» de vinklo (sin halo desde la marca v9); a la derecha, tres líneas cortas.
 * Al pasar el ratón (o enfocar/tocar) una línea, se completa con su frase y
 * las otras se apagan. Sin JS se ven las tres líneas cortas.
 */
import { useState } from "react";

import { landingCopy, type Locale } from "@/components/landing/copy";

export function HeroMark({ locale = "es" }: { locale?: Locale }) {
  const lines = landingCopy(locale).mark;
  const [active, setActive] = useState<number | null>(null);
  return (
    <div className="lc-mark">
      {/* La «V» de vinklo: cada línea de la derecha enciende una parte
          (trazo izquierdo, trazo derecho, el punto). */}
      <div className="lc-mark-stage" aria-hidden="true" data-part={active ?? undefined}>
        <svg className="lc-mark-v" viewBox="0 0 24 24" fill="none">
          <path className="lc-mark-part" data-i="0" d="M3 5.5 12 20" />
          <path className="lc-mark-part" data-i="1" d="M12 20 21 5.5" />
          <circle className="lc-mark-dot" data-i="2" cx="12" cy="3.2" r="1.5" />
        </svg>
      </div>
      <ul className="lc-mark-lines" data-active={active === null ? undefined : ""} onPointerLeave={() => setActive(null)}>
        {lines.map((line, i) => (
          <li key={line.lead}>
            <button
              type="button"
              className="lc-mark-line"
              aria-expanded={active === i}
              data-on={active === i ? "" : undefined}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive((v) => (v === i ? null : i))}
            >
              <span className="lc-mark-lead">{line.lead}</span>
              <span className="lc-mark-rest">{line.rest}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
