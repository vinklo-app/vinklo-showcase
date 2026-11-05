import type { Metadata } from "next";

/**
 * Catálogo de guías. Fuente única para el índice /guias, el sitemap, los
 * metadatos/OG de cada guía y el GuiaShell. Las guías hablan del producto
 * vivo (web de la boda, envío por WhatsApp, confirmaciones, lista de
 * invitados y mesas); nada de cobros, pagos ni precios (CLAUDE.md). Los
 * regalos solo como anotación manual de la pareja.
 * Las guías antiguas sobre dinero se retiraron el 5-oct-2026 (8819261) y
 * redirigen a /guias desde next.config.ts.
 * Revisión de contenido v3: 9-oct-2026; v4 (reescritura + capturas del
 * producto en public/guias/): 10-oct-2026 (`dateModified`).
 */

export const GUIAS_BASE = "https://vinklo.es/guias";

export type Guia = {
  slug: string;
  title: string;
  description: string;
  teaser: string;
  datePublished: string;
  dateModified?: string;
  /** Tarjeta social propia (1200×630, en public/guias/). Sin ella, la general. */
  ogImage?: string;
};

const REVISION = "2026-10-10";

const GUIAS_DATA = [
  {
    slug: "invitacion-de-boda-digital",
    ogImage: "/guias/og-invitacion-movil-sobre.jpg",
    title: "Cómo hacer la web de vuestra boda, paso a paso",
    description:
      "Cómo hacer la web o invitación digital de vuestra boda: qué contar, qué apartados poner (programa, autobuses, alojamiento, menú), cómo compartirla por WhatsApp y cómo recoger las respuestas.",
    teaser:
      "Qué contar, qué apartados poner y cómo compartirla con un enlace para cada invitado.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
  {
    slug: "confirmar-asistencia-boda-whatsapp",
    ogImage: "/guias/og-panel-recordatorio-quien-no-responde.jpg",
    title: "Cómo confirmar asistencia a la boda por WhatsApp sin perder la cuenta",
    description:
      "Cómo pedir la confirmación de asistencia (RSVP) de una boda por WhatsApp: enlace personal, fecha límite, mensaje, recordatorios solo a quien falta y un único recuento.",
    teaser:
      "Enlace personal, fecha límite, recordatorios a quien falta y un único recuento.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
  {
    slug: "lista-de-invitados-boda",
    ogImage: "/guias/og-panel-lista-invitados.jpg",
    title: "Lista de invitados de boda: cómo hacerla y gestionarla",
    description:
      "Cómo hacer y gestionar la lista de invitados de una boda: por dónde empezar, qué apuntar, grupos y etiquetas, acompañantes, quién falta por responder y regalos por agradecer.",
    teaser:
      "Por dónde empezar, qué apuntar, grupos, acompañantes y quién falta por responder.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
  {
    slug: "como-organizar-las-mesas-de-la-boda",
    ogImage: "/guias/og-panel-mesas-sentar-automaticamente.jpg",
    title: "Cómo organizar las mesas de la boda",
    description:
      "Cómo organizar las mesas de una boda paso a paso: cuándo empezar, cuántas personas por mesa, a quién sentar junto, la mesa presidencial, alergias y el plano para el catering.",
    teaser:
      "Cuándo empezar, a quién sentar junto, la mesa presidencial y el plano para el catering.",
    datePublished: REVISION,
  },
  {
    slug: "que-poner-en-una-invitacion-de-boda",
    ogImage: "/guias/og-invitacion-movil-sobre.jpg",
    title: "Qué poner en la invitación de boda: programa, autobuses y alojamiento",
    description:
      "Qué información debe llevar una invitación de boda: lo imprescindible, el programa del día, autobuses, alojamiento, menú, niños y confirmación de asistencia, con ejemplos de texto.",
    teaser:
      "Lo imprescindible, el programa, autobuses y alojamiento, con ejemplos de texto.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
  {
    slug: "cuando-enviar-invitaciones-boda",
    ogImage: "/guias/og-panel-resumen-respuestas.jpg",
    title: "¿Cuándo se envían las invitaciones de boda?",
    description:
      "Con cuánta antelación enviar las invitaciones de boda, cuándo avisar antes con un «reserva la fecha», qué fecha límite poner para confirmar y cuándo recordarlo.",
    teaser:
      "Antelación orientativa, el «reserva la fecha», la fecha límite y el recordatorio.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
  {
    slug: "invitacion-de-boda-digital-o-papel",
    ogImage: "/guias/og-invitacion-movil-sobre.jpg",
    title: "Invitación de boda digital o de papel: cuál elegir",
    description:
      "Diferencias entre la invitación de boda digital y la de papel: envío, cambios de última hora, confirmación de asistencia, invitados mayores y cómo combinarlas.",
    teaser:
      "Comparativa honesta, con lo que hace mejor cada una y cómo combinarlas.",
    datePublished: "2026-10-05",
    dateModified: REVISION,
  },
] as const satisfies readonly Guia[];

export type GuiaSlug = (typeof GUIAS_DATA)[number]["slug"];

export const GUIAS: ReadonlyArray<Guia & { slug: GuiaSlug }> = GUIAS_DATA;

export function getGuia(slug: GuiaSlug): Guia {
  const guia = GUIAS.find((g) => g.slug === slug);
  if (!guia) throw new Error(`Guía desconocida: ${slug}`);
  return guia;
}

export function guiaUrl(slug: string): string {
  return `${GUIAS_BASE}/${slug}`;
}

/**
 * Metadatos completos de una guía: canonical propio y Open Graph/Twitter
 * de tipo artículo. Sin esto, Next hereda el openGraph del layout y la
 * tarjeta social de cada guía apuntaría a la portada.
 */
export function guiaMetadata(slug: GuiaSlug): Metadata {
  const g = getGuia(slug);
  const url = guiaUrl(slug);
  const image = g.ogImage ?? "/opengraph-image";
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: g.title,
      description: g.description,
      siteName: "vinklo",
      locale: "es_ES",
      publishedTime: g.datePublished,
      modifiedTime: g.dateModified ?? g.datePublished,
      images: [
        { url: image, width: 1200, height: 630, alt: g.title },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: g.title,
      description: g.description,
      images: [image],
    },
  };
}
