import type { SitePaletteId, SiteThemeId } from "@/lib/site-document";

/**
 * Plantillas de la landing: lo mínimo que necesita también el cliente
 * (/crear aplica estilo y colores al elegir una). Fuente única: la demo
 * (components/landing/demo-wedding.ts) deriva de aquí id, nombre, estilo y
 * paleta. Sin fotos ni documentos de ejemplo, para no engordar el bundle.
 */
export interface BuilderTemplateInfo { id: string; name: string; themeId: SiteThemeId; palette: SitePaletteId }

export const BUILDER_TEMPLATES: ReadonlyArray<BuilderTemplateInfo> = [
  { id: "origen", name: "Origen", themeId: "editorial", palette: "natural" },
  { id: "hora-dorada", name: "Hora dorada", themeId: "clasico", palette: "rosa" },
  { id: "vinedo", name: "Viñedo", themeId: "natural", palette: "natural" },
];

/** Plantilla por id, o undefined si no existe (id ausente, de otro tipo o inventado). */
export function findBuilderTemplate(id: unknown): BuilderTemplateInfo | undefined {
  return typeof id === "string" ? BUILDER_TEMPLATES.find((t) => t.id === id) : undefined;
}
