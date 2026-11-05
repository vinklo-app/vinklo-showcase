import type { Metadata } from "next";
import Link from "next/link";

import { ReadShell } from "@/components/guias/read-mode";
import { landingCopy } from "@/components/landing/copy";
import { BRAND_CONTACT_EMAIL } from "@/lib/brand";
import { faqPageJsonLd, JsonLd } from "@/lib/jsonld";

const SITE_URL = "https://vinklo.es";
const URL = `${SITE_URL}/en/faq`;
const FAQS = landingCopy("en").faq.items;

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "What couples ask before creating their wedding website with vinklo: price, sign-up, WhatsApp invitations, gifts and language.",
  alternates: {
    canonical: URL,
    languages: { es: `${SITE_URL}/preguntas`, en: URL, "x-default": `${SITE_URL}/preguntas` },
  },
};

/**
 * /preguntas en inglés (1-nov-2026): mismo armazón y mismas preguntas que la
 * landing en /en (copy/en.ts), más la del idioma. Las páginas legales y las
 * guías solo existen en español: el pie lo dice.
 */
export default function FaqEnPage() {
  return (
    <div lang="en">
      <JsonLd data={faqPageJsonLd(URL, FAQS, "en")} />
      <ReadShell
        locale="en"
        language={{ href: "/preguntas", lang: "es", text: "ES", label: "Versión en español" }}
        eyebrow="FAQ"
        title="Frequently asked questions"
        lead="What couples ask us before creating their wedding website: what’s included, how much it costs and how it reaches your guests."
        wide
        footer={
          <>
            <aside className="rd-cta" aria-label="Create your website">
              <p>
                Any other questions? Write to us at{" "}
                <a href={`mailto:${BRAND_CONTACT_EMAIL}`}>{BRAND_CONTACT_EMAIL}</a>{" "}
                or try the builder (in Spanish for now): you don’t need to sign up to get started.
              </p>
              <div className="rd-cta-actions">
                <Link href="/crear" className="rd-btn">
                  Create our website
                </Link>
                <Link href="/demo" className="rd-link">
                  See an example wedding
                </Link>
              </div>
            </aside>
            <nav className="rd-foot" aria-label="More links">
              <Link href="/en">Back to home</Link>
              <Link href="/privacidad">Privacy</Link>
              <Link href="/terminos">Terms</Link>
              <Link href="/aviso-legal">Legal notice</Link>
            </nav>
            <p className="rd-foot-note">Legal pages are in Spanish.</p>
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
    </div>
  );
}
