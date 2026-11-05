import type { MetadataRoute } from "next";

/**
 * Web App Manifest (Next 15 metadata route → /manifest.webmanifest).
 * Colores de la marca v9 «Ciruela y perla»: lienzo perla #F8F7FA, texto
 * #24212A (DESIGN.md).
 * `display: standalone` = al añadir a la pantalla de inicio se abre sin la
 * barra del navegador, como una app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "vinklo — Vuestra web de boda",
    short_name: "vinklo",
    description:
      "Cread vuestra web de boda y seguid las confirmaciones de asistencia en vuestro panel de invitados.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8F7FA",
    theme_color: "#F8F7FA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
