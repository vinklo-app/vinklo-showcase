import type { MetadataRoute } from "next";

import { GUIAS, guiaUrl } from "@/components/guias/guias";

/**
 * Sitemap de las páginas públicas indexables de vinklo.es. Las guías salen
 * del catálogo (components/guias/guias.ts). Fuera: /b/* (invitaciones
 * privadas, noindex), /precios (backlog) y zonas con sesión.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://vinklo.es";
  const homeDate = "2026-10-05";
  const latestGuide = GUIAS.map((g) => g.dateModified ?? g.datePublished)
    .sort()
    .at(-1);
  return [
    { url: base, lastModified: homeDate, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/crear`, lastModified: homeDate, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/preguntas`, changeFrequency: "monthly", priority: 0.6 },
    // Versión en inglés (1-nov-2026): la landing y las preguntas.
    { url: `${base}/en`, lastModified: "2026-11-01", changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/en/faq`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/demo`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/invitados-desde-excel`, lastModified: "2026-10-14", changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/guias`, lastModified: latestGuide, changeFrequency: "weekly", priority: 0.7 },
    ...GUIAS.map((g) => ({
      url: guiaUrl(g.slug),
      lastModified: g.dateModified ?? g.datePublished,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: `${base}/aviso-legal`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terminos`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
