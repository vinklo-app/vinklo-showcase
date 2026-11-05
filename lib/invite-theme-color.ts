import { resolveLayout, resolveOpening, resolvePalette, type SiteDocument } from "@/lib/site-document";

/**
 * Qué ve el invitado en lo alto de la pantalla, para teñir la franja de la
 * barra de estado de Safari (theme-color):
 * - "sealed": el sobre cerrado (papel).
 * - "cover": la primera escena de la Story, la portada.
 * - "scene": cualquier otra cosa (resto de escenas, o la maqueta web).
 */
export type InviteThemePhase = "sealed" | "cover" | "scene";

type ThemeDoc = Pick<SiteDocument, "themeId" | "palette" | "layout" | "opening" | "scenes">;

/** ¿Hay sobre delante de la portada? (misma regla que el renderer). */
export function hasSealedEnvelope(doc: Pick<SiteDocument, "opening" | "scenes">): boolean {
  return resolveOpening(doc) !== "ninguno" && doc.scenes.some((s) => s.type === "cover" && s.enabled);
}

/**
 * Color de la franja del iPhone: el papel de la paleta, salvo cuando se ve
 * una portada Story a sangre sobre foto; ahí, la tinta, que es el velo con el
 * que arranca la foto por arriba. La maqueta web no cuenta: su portada es un
 * marco redondeado con 10 px de papel alrededor, así que lo que toca la
 * franja es papel.
 */
export function inviteThemeColor(doc: ThemeDoc, phase: InviteThemePhase): string {
  const palette = resolvePalette(doc);
  if (phase !== "cover" || resolveLayout(doc) !== "historia") return palette.paper;
  const cover = doc.scenes.find((s) => s.type === "cover" && s.enabled);
  return cover?.type === "cover" && cover.props.image ? palette.ink : palette.paper;
}

/** Fase inicial que pinta el servidor: sobre si lo hay; si no, portada. */
export function initialInvitePhase(doc: Pick<SiteDocument, "opening" | "scenes">): InviteThemePhase {
  return hasSealedEnvelope(doc) ? "sealed" : "cover";
}
