import type { MetadataRoute } from "next";

/**
 * robots.txt (GEO 2026-10-05).
 *
 * - Regla general: indexar el sitio público; fuera las zonas privadas.
 *   `/b/*` (invitaciones de cada boda) NO se bloquea aquí a propósito: lleva
 *   `noindex` (metadata + X-Robots-Tag) y Googlebot tiene que poder rastrear
 *   la página para ver ese noindex.
 * - Rastreadores de IA (búsqueda y entrenamiento): permitidos de forma
 *   explícita en el contenido público (landing, creador, guías, legales,
 *   llms.txt). A ellos sí se les cierra `/b/` y `/borrador`: no todos
 *   respetan el meta noindex y las invitaciones contienen nombres, fechas y
 *   lugares de bodas reales.
 */
const PRIVATE = [
  "/panel",
  "/admin",
  "/onboarding",
  "/api",
  "/auth",
  "/login",
  "/v/",
  "/borrador",
];

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "MistralAI-User",
  "DuckAssistBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: [...PRIVATE, "/b/"] },
    ],
    sitemap: "https://vinklo.es/sitemap.xml",
    host: "https://vinklo.es",
  };
}
