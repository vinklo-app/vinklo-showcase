import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { BRAND_CONTACT_EMAIL } from "@/lib/brand";
import { LazoIcon } from "@/components/brand/icons";
import { landingCopy, type Locale } from "@/components/landing/copy";

/**
 * Cierre y pie de la landing (7-oct-2026, idea del cierre de cordially.io con
 * identidad propia): arriba, la marca con su frase y los enlaces; en medio,
 * un solo botón y el copyright. 13-oct-2026 (#23): dos filas de enlaces,
 * producto y legales, en lugar de diez en columnas. 14-oct-2026 (punto 17):
 * «Del Excel a WhatsApp», la landing en vídeo de importar la lista.
 * 1-nov-2026: enlaces y textos por idioma (copy/); en inglés, sin las
 * páginas que solo existen en español salvo las legales, que lo avisan.
 */
export function LandingFinale({ locale = "es" }: { locale?: Locale }) {
  const t = landingCopy(locale);
  return (
    <footer className="lc-finale" aria-labelledby="lc-finale-title">
      <div className="lc-finale-top">
        <div className="lc-finale-brand">
          <p className="lc-finale-logo"><LazoIcon aria-hidden="true" /><span>v<span className="lc-finale-i">ı</span>nklo</span></p>
          <h2 id="lc-finale-title" className="lc-finale-line">
            {t.finale.line}
          </h2>
          <a className="lc-finale-mail" href={`mailto:${BRAND_CONTACT_EMAIL}`}>{BRAND_CONTACT_EMAIL}</a>
        </div>
        <nav className="lc-finale-links" aria-label={t.finale.linksLabel}>
          {t.finale.links.map((col, i) => (
            <ul key={i}>
              {col.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}
            </ul>
          ))}
        </nav>
      </div>

      <div className="lc-finale-stage">
        <div className="lc-finale-actions">
          <Link href="/crear" className="lc-pill lc-pill--ink">{t.nav.create} <ArrowRightIcon aria-hidden="true" width={18} height={18} strokeWidth={1.75} /></Link>
        </div>
        <p className="lc-finale-copy">© 2026 <span className="lc-finale-copy-word">vinklo</span> · {t.finale.made}</p>
        {t.finale.note && <p className="lc-finale-copy">{t.finale.note}</p>}
      </div>
    </footer>
  );
}
