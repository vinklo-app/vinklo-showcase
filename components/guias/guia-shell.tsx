import Link from "next/link";

import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqPageJsonLd,
  JsonLd,
} from "@/lib/jsonld";
import { getGuia, guiaUrl, type GuiaSlug } from "@/components/guias/guias";
import {
  ReadShell,
  readingMinutes,
  textOf,
  withHeadingIds,
} from "@/components/guias/read-mode";

/**
 * Armazón de las guías (/guias/*) en modo Read: miga, titular serif con
 * clamp, fecha y tiempo de lectura (calculado sobre el texto real), índice
 * a partir de los <h2>, columna de 68ch y CTA final al creador. Emite
 * Article + BreadcrumbList JSON-LD y, si la guía trae `faq`, la sección
 * «Preguntas frecuentes» visible y su FAQPage JSON-LD desde el mismo array
 * (una sola fuente: el texto y el schema no pueden desincronizarse).
 * Regla GEO: bajo cada H2-pregunta, la primera frase responde directa
 * y autocontenida (40-60 palabras) — es lo que citan las IAs.
 */
export type GuiaFaq = { q: string; a: string };

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(iso)
  );

export function GuiaShell({
  slug,
  faq,
  children,
}: {
  /** Título, descripción y fechas salen del catálogo (components/guias/guias.ts). */
  slug: GuiaSlug;
  /** Preguntas frecuentes: se pintan al final y salen como FAQPage JSON-LD. */
  faq?: ReadonlyArray<GuiaFaq>;
  children: React.ReactNode;
}) {
  const { title, description, datePublished, dateModified, ogImage } =
    getGuia(slug);
  const url = guiaUrl(slug);
  const faqNodes =
    faq && faq.length > 0
      ? [
          <h2 key="faq-h">Preguntas frecuentes</h2>,
          ...faq.map((f) => (
            <div key={f.q} className="rd-faq">
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          )),
        ]
      : [];
  const content = (
    <>
      {children}
      {faqNodes}
    </>
  );
  const { nodes, toc } = withHeadingIds([children, ...faqNodes]);
  const minutes = readingMinutes(textOf(content));
  const updated = dateModified ?? datePublished;

  return (
    <>
      <JsonLd
        data={{
          ...articleJsonLd({
            url,
            headline: title,
            description,
            datePublished,
            dateModified,
          }),
          // Misma imagen que la tarjeta social de la guía (si la tiene).
          ...(ogImage ? { image: `https://vinklo.es${ogImage}` } : {}),
        }}
      />
      {faq && faq.length > 0 ? (
        <JsonLd data={faqPageJsonLd(`${url}#preguntas-frecuentes`, faq)} />
      ) : null}
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: "https://vinklo.es" },
          { name: "Guías", url: "https://vinklo.es/guias" },
          { name: title, url },
        ])}
      />
      <ReadShell
        eyebrow={
          <>
            <Link href="/guias">Guías</Link>
            <span aria-hidden="true" className="rd-crumb-sep">
              /
            </span>
            <span>Artículo</span>
          </>
        }
        title={title}
        meta={[
          <>
            Última actualización:{" "}
            <time dateTime={updated}>{longDate(updated)}</time>
          </>,
          minutes ? `${minutes} min de lectura` : null,
        ]}
        toc={toc}
        tocLabel="En esta guía"
        footer={
          <aside className="rd-cta" aria-label="Crear vuestra invitación">
            <p>
              Cread la web de vuestra boda gratis. Compartidla por WhatsApp
              y reunid las respuestas en un mismo lugar.
            </p>
            <div className="rd-cta-actions">
              <Link href="/crear" className="rd-btn">
                Crear nuestra web
              </Link>
              <Link href="/demo" className="rd-link">
                Ver una boda de ejemplo
              </Link>
              <Link href="/preguntas" className="rd-link">
                Preguntas frecuentes
              </Link>
              <Link href="/guias" className="rd-link">
                Más guías
              </Link>
            </div>
          </aside>
        }
      >
        <article className="rd-prose">{nodes}</article>
      </ReadShell>
    </>
  );
}
