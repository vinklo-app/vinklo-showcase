import type { Metadata } from "next";
import Link from "next/link";

import { ReadShell } from "@/components/guias/read-mode";
import { GUIAS, GUIAS_BASE, guiaUrl } from "@/components/guias/guias";
import { JsonLd } from "@/lib/jsonld";

const INDEX_TITLE = "Guías para organizar vuestra boda: web, invitados y mesas";
const INDEX_DESCRIPTION =
  "Guías prácticas para hacer la web de vuestra boda, confirmar asistencia por WhatsApp, llevar la lista de invitados, organizar las mesas y saber qué poner y cuándo enviar la invitación.";

export const metadata: Metadata = {
  title: INDEX_TITLE,
  description: INDEX_DESCRIPTION,
  alternates: { canonical: GUIAS_BASE },
  openGraph: {
    type: "website",
    url: GUIAS_BASE,
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    siteName: "vinklo",
    locale: "es_ES",
    images: [
      { url: "/opengraph-image", width: 1200, height: 630, alt: INDEX_TITLE },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

/** ItemList de las guías: ayuda a los buscadores a entender el índice. */
const ITEM_LIST_JSONLD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": `${GUIAS_BASE}#lista`,
  name: INDEX_TITLE,
  itemListElement: GUIAS.map((g, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: guiaUrl(g.slug),
    name: g.title,
  })),
};

/**
 * Índice de guías en modo Read: filas con filete y numeral editorial, sin
 * tarjetas. Titulares y teasers salen del catálogo (components/guias/guias.ts).
 */
export default function GuiasPage() {
  return (
    <>
      <JsonLd data={ITEM_LIST_JSONLD} />
      <ReadShell
        eyebrow="Guías"
        title="La web, los invitados y las mesas, paso a paso"
        lead="Guías prácticas para invitar a vuestra gente, saber quién viene, sentar a cada uno en su sitio y no perder ninguna respuesta por el camino."
        wide
        footer={
          <nav className="rd-foot" aria-label="Volver">
            <Link href="/">Volver al inicio</Link>
          </nav>
        }
      >
        <ol className="rd-list">
          {GUIAS.map((g, i) => (
            <li key={g.slug}>
              <Link href={`/guias/${g.slug}`} className="rd-row">
                <span className="rd-row-num tabular" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="rd-row-title">{g.title}</span>
                <span className="rd-row-teaser">{g.teaser}</span>
              </Link>
            </li>
          ))}
        </ol>
      </ReadShell>
    </>
  );
}
