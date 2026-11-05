import type { Metadata, Viewport } from "next";

import { DemoSite, demoPaper } from "@/components/landing/demo-site";

/**
 * Web de boda de demostración (6-oct-2026, como cordially.io/demo): la
 * maqueta «Como una web» con todas las secciones y fotos de ejemplo.
 * mode="preview": la propia maqueta es el contenedor de scroll a pantalla
 * completa, los enlaces no navegan y la asistencia no envía nada (no hay
 * boda real detrás). Datos ficticios. Estática: cada plantilla es su ruta
 * (/demo/[plantilla]); el antiguo /demo?plantilla=… redirige en next.config.ts.
 */
export const metadata: Metadata = {
  title: "Web de boda de ejemplo",
  description: "Así se ve una web de boda hecha con vinklo: portada, vuestra historia, fotos, programa, detalles, preguntas y confirmación de asistencia.",
  alternates: { canonical: "/demo" },
};

// theme-color = papel de la paleta (sin costura en iOS).
export function generateViewport(): Viewport {
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: demoPaper() };
}

export default function DemoPage() {
  return <DemoSite />;
}
