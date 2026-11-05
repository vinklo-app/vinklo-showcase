import Link from "next/link";
import Image from "next/image";
import { ChevronRightIcon } from "lucide-react";

import { landingCopy, type Locale } from "@/components/landing/copy";
import { DEMO_TEMPLATES } from "@/components/landing/demo-wedding";

/**
 * Plantillas (6-oct-2026, referencia cordially.io «Explore Templates»):
 * tarjetas grandes con la foto de cada web, tonos claros y cálidos, título en
 * serif y una línea. Cada una abre la web de ejemplo con ese estilo
 * (/demo/<plantilla>). Sin etiquetas ni selectores: tres opciones, todas
 * disponibles.
 */
export function TemplateCards({ locale = "es" }: { locale?: Locale }) {
  const copy = landingCopy(locale).templates;
  return (
      <ul className="lc-tpl" aria-label={copy.label}>
        {DEMO_TEMPLATES.map((t, i) => {
          const text = copy.byId[t.id];
          return (
          <li key={t.id} className="lc-tpl-card" data-reveal="rise" data-reveal-group="tpl" style={{ "--reveal-delay": `${i * 70}ms` } as React.CSSProperties}>
            <Link href={`/demo/${t.id}`} className="lc-tpl-link">
              <span className="lc-tpl-photo">
                <Image src={t.cover.url} alt={text?.alt ?? t.cover.alt} fill sizes="(min-width: 1040px) 30vw, 85vw" style={t.position ? { objectPosition: t.position } : undefined} />
                <span className="lc-tpl-go" aria-hidden="true"><ChevronRightIcon width={20} height={20} strokeWidth={1.75} /></span>
              </span>
              <span className="lc-tpl-kicker">{copy.kicker} · {text?.styleLabel ?? t.styleLabel}</span>
              <span className="lc-tpl-title">{t.name}</span>
              <span className="lc-tpl-desc">{text?.description ?? t.description}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
