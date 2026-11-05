/**
 * JSON-LD de vinklo (GEO-SCHEMA-REPORT 2026-07-10). Los FAQPage se
 * generan desde las MISMAS constantes que renderizan los <details>
 * visibles — el schema no puede desincronizarse del copy (divergencia
 * texto visible/schema es riesgo de política de spam de Google).
 */

export const SITE_URL = "https://vinklo.es";

/**
 * Descripción canónica de la entidad. Una sola frase factual que se repite
 * igual en Organization, WebApplication y llms.txt (consistencia de entidad
 * para los buscadores con IA). Solo funciones vivas hoy; nada de regalos,
 * pagos ni entrega de WhatsApp (CLAUDE.md).
 */
export const ENTITY_DESCRIPTION =
  "vinklo es una herramienta web española para crear invitaciones de boda digitales con su propia página, compartirlas por WhatsApp con un enlace personal para cada invitado y reunir las confirmaciones de asistencia y los acompañantes en una lista de invitados.";

/**
 * Organization (GEO 2026-10-05). `disambiguatingDescription` separa esta
 * entidad de otras marcas con nombre parecido: dice lo que es (servicio
 * español de invitaciones de boda, vinklo.es) sin nombrar a terceros.
 * Sin sameAs ni datos del titular hasta que existan de verdad.
 */
export const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "vinklo",
  alternateName: ["Vinklo", "vinklo.es"],
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/icon-512.png`,
    width: 512,
    height: 512,
  },
  image: `${SITE_URL}/og.png`,
  description: ENTITY_DESCRIPTION,
  disambiguatingDescription:
    "vinklo (vinklo.es) es un servicio español de invitaciones de boda digitales y gestión de invitados, en español de España, para parejas que se casan en España.",
  slogan: "Invitad con ilusión. Organizad con calma.",
  email: "hola@vinklo.es",
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "hola@vinklo.es",
    availableLanguage: ["es-ES"],
    areaServed: "ES",
  },
  foundingDate: "2026",
  areaServed: { "@type": "Country", name: "España" },
  knowsAbout: [
    "Invitaciones de boda digitales",
    "Confirmación de asistencia a bodas (RSVP)",
    "Gestión de la lista de invitados de una boda",
    "Organización de bodas en España",
  ],
  // sameAs: añadir LinkedIn/Instagram/etc. SOLO cuando existan los perfiles
  // (ver docs/handoffs/2026-10-05-geo/informe.md).
} as const;

/** WebSite enlazado a la Organization. */
export const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: "vinklo",
  alternateName: "Vinklo",
  url: SITE_URL,
  inLanguage: "es-ES",
  description: ENTITY_DESCRIPTION,
  publisher: { "@id": `${SITE_URL}/#organization` },
} as const;

/**
 * WebApplication del producto actual (MVP de invitación + asistencia).
 * Una única oferta: gratis. No se publica el plan de pago (sin precio
 * aprobado) ni funciones pendientes.
 */
export const WEB_APPLICATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${SITE_URL}/#app`,
  name: "vinklo",
  url: SITE_URL,
  applicationCategory: "LifestyleApplication",
  applicationSubCategory:
    "Invitaciones de boda digitales y gestión de invitados",
  operatingSystem: "Web (navegador del móvil o del ordenador)",
  browserRequirements:
    "Requiere un navegador web actual. Los invitados no necesitan cuenta ni app.",
  inLanguage: "es-ES",
  isAccessibleForFree: true,
  countriesSupported: "ES",
  description: ENTITY_DESCRIPTION,
  featureList: [
    "Creador guiado de la invitación con preguntas y vista previa",
    "Página web de la boda con fecha, lugares y agenda del día",
    "Enlace personal para cada invitado",
    "Confirmación de asistencia sin que el invitado cree una cuenta",
    "Lista de invitados con pendientes, confirmados, no asistentes y acompañantes",
    "Mensaje preparado para compartir la invitación por WhatsApp",
  ],
  publisher: { "@id": `${SITE_URL}/#organization` },
  offers: {
    "@type": "Offer",
    name: "Gratis para los novios",
    price: "0",
    priceCurrency: "EUR",
    availability: "https://schema.org/InStock",
    url: `${SITE_URL}/crear`,
  },
} as const;

/** FAQPage a partir de las constantes de las FAQs visibles (inglés en /en). */
export function faqPageJsonLd(
  id: string,
  faqs: ReadonlyArray<{ q: string; a: string }>,
  inLanguage: "es-ES" | "en" = "es-ES"
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": id,
    inLanguage,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/**
 * HISTÓRICO (backlog de pagos): solo lo usa /precios, que hoy redirige por
 * RSVP_MVP. Describe funciones fuera del alcance actual: no usarlo en
 * páginas públicas activas. El producto vivo se describe en
 * WEB_APPLICATION_JSONLD.
 */
export function softwareApplicationJsonLd(input: {
  premiumPriceEur: string;
  premiumFullPriceEur: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": "https://vinklo.es/#app",
    name: "vinklo",
    url: "https://vinklo.es",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    inLanguage: "es-ES",
    description:
      "Página de boda con enlace de aportaciones: los invitados aportan al regalo de boda desde el móvil y los novios reciben el 100 % en su cuenta, con panel de bote en tiempo real y calendario de pagos a proveedores.",
    publisher: { "@id": "https://vinklo.es/#organization" },
    offers: [
      {
        "@type": "Offer",
        name: "Gratis para los novios",
        price: "0",
        priceCurrency: "EUR",
        description:
          "Recibís el 100 % de cada aportación. Página de invitado, bote en tiempo real, calendario de pagos con hasta 3 proveedores, hasta 30 aportaciones.",
      },
      {
        "@type": "Offer",
        name: "Premium Boda",
        price: input.premiumPriceEur,
        priceCurrency: "EUR",
        description: `Pago único (precio de lanzamiento; después ${input.premiumFullPriceEur} €). Proveedores ilimitados, portal de proveedores, recordatorios por email, exportación CSV, enlace personalizado, sin marca, dos administradores.`,
        url: "https://vinklo.es/precios",
      },
    ],
  };
}

/** Article JSON-LD para las guías (/guias/*). */
export function articleJsonLd(input: {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${input.url}#article`,
    headline: input.headline,
    description: input.description,
    inLanguage: "es-ES",
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    mainEntityOfPage: input.url,
    image: `${SITE_URL}/og.png`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    author: { "@id": "https://vinklo.es/#organization" },
    publisher: { "@id": "https://vinklo.es/#organization" },
  };
}

/** BreadcrumbList para páginas profundas (guías): Inicio › Guías › Título. */
export function breadcrumbJsonLd(
  items: ReadonlyArray<{ name: string; url: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Render helper: <script type="application/ld+json"> server-rendered.
 * El contenido es SIEMPRE estático (constantes de este módulo/copy del
 * sitio, nunca input de usuario); el escape de "<" evita que cualquier
 * futura cadena pueda romper el </script> (patrón estándar JSON-LD).
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
