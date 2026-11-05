import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronLeftIcon } from "lucide-react";

import { InvitationRenderer } from "@/components/invitation/renderer";
import { DEMO_TEMPLATES, demoWeddingDocument } from "@/components/landing/demo-wedding";
import { resolvePalette } from "@/lib/site-document";

/** Papel de la paleta de la plantilla (sin plantilla: el de la demo base). */
export function demoPaper(plantilla?: string): string {
  return resolvePalette(demoWeddingDocument(plantilla)).paper;
}

/**
 * Cuerpo de /demo y /demo/[plantilla]: la web de ejemplo, pura, y debajo
 * (fuera del renderer) una franja de 44 px en el papel de la plantilla con
 * la vuelta a vinklo y el enlace al creador. Server component sin
 * searchParams, para que ambas rutas sean estáticas.
 */
export function DemoSite({ plantilla }: { plantilla?: string }) {
  // iOS 26 pinta la franja de la isla y la de la barra de Safari con el fondo
  // del body (no con theme-color): el papel de la plantilla, sin costura.
  const doc = demoWeddingDocument(plantilla);
  const { paper, ink } = resolvePalette(doc);
  const template = DEMO_TEMPLATES.find((t) => t.id === plantilla);
  const vars = { "--demo-paper": paper, "--demo-ink": ink } as CSSProperties;
  return (
    <>
      <style>{`html,body{background-color:${paper}}`}</style>
      <h1 className="sr-only">Web de boda de ejemplo: Lucía y Juan</h1>
      <div className="demo-stage w-full overflow-hidden" style={vars}>
        <InvitationRenderer document={doc} mode="preview" plan="free" fullPage demoRsvp />
      </div>
      <nav aria-label="vinklo" className="demo-bar" style={vars}>
        <Link href="/" className="demo-bar-link">
          <ChevronLeftIcon aria-hidden="true" width={18} height={18} />
          vinklo
        </Link>
        {/* La plantilla se lleva tal cual al creador: mismo estilo, colores y sobre. */}
        <Link href={template ? `/crear?plantilla=${template.id}` : "/crear"} className="demo-bar-link demo-bar-cta">
          {template ? "Usar esta plantilla" : "Crear nuestra web"}
        </Link>
      </nav>
    </>
  );
}
