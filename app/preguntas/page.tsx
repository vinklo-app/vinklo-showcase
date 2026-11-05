import type { Metadata } from "next";
import Link from "next/link";

import { ReadShell } from "@/components/guias/read-mode";
import { FAQS } from "@/components/landing/faqs";
import { BRAND_CONTACT_EMAIL } from "@/lib/brand";
import { faqPageJsonLd, JsonLd } from "@/lib/jsonld";

const SITE_URL = "https://vinklo.es";

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description: "Lo que nos preguntan las parejas antes de crear su web de boda con vinklo: precio, registro, invitaciones por WhatsApp y regalos.",
  alternates: {
    canonical: `${SITE_URL}/preguntas`,
    languages: { es: `${SITE_URL}/preguntas`, en: `${SITE_URL}/en/faq`, "x-default": `${SITE_URL}/preguntas` },
  },
};

/**
 * Preguntas frecuentes (P2-6): mismo armazón que /guias (SiteHeader + modo
 * Read) en vez de la home antigua. Cada pregunta es un <details> nativo: se
 * abre sin JavaScript y el texto sigue en el HTML para buscadores y para el
 * FAQPage JSON-LD, que sale del mismo array.
 */
export default function PreguntasPage() {
  return (
    <>
      <JsonLd data={faqPageJsonLd(`${SITE_URL}/preguntas`, FAQS)} />
      <ReadShell
        eyebrow="Preguntas"
        title="Preguntas frecuentes"
        lead="Lo que nos preguntan las parejas antes de crear su web de boda: qué incluye, cuánto cuesta y cómo llega a vuestros invitados."
        wide
        language={{ href: "/en/faq", lang: "en", text: "EN", label: "English version" }}
        footer={
          <>
            <aside className="rd-cta" aria-label="Crear vuestra web">
              <p>
                ¿Os queda alguna duda? Escribidnos a{" "}
                <a href={`mailto:${BRAND_CONTACT_EMAIL}`}>{BRAND_CONTACT_EMAIL}</a>{" "}
                o probad el creador: no hace falta registrarse para empezar.
              </p>
              <div className="rd-cta-actions">
                <Link href="/crear" className="rd-btn">
                  Crear nuestra web
                </Link>
                <Link href="/demo" className="rd-link">
                  Ver una boda de ejemplo
                </Link>
                <Link href="/guias" className="rd-link">
                  Guías
                </Link>
              </div>
            </aside>
            <nav className="rd-foot" aria-label="Más enlaces">
              <Link href="/">Volver al inicio</Link>
              <Link href="/privacidad">Privacidad</Link>
              <Link href="/terminos">Términos</Link>
              <Link href="/aviso-legal">Aviso legal</Link>
            </nav>
          </>
        }
      >
        <div className="rd-faq-list">
          {FAQS.map((f) => (
            <details key={f.q} className="rd-faq-item">
              <summary>
                <h2>{f.q}</h2>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </ReadShell>
    </>
  );
}
