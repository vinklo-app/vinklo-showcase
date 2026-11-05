import type { SiteEditorState } from "@/lib/actions/site";

/**
 * Etiqueta del móvil (auditoría 2026-10-05): «Borrador» junto a «Publicada…
 * sin cambios pendientes» se contradecía. Igual que la publicada solo si hay
 * publicación, el servidor no ve cambios y no hay guardados locales por delante.
 */
export function draftChipLabel(state: SiteEditorState, localVersion: number): string {
  if (state.publishedRevisionId === null) return state.publishedAt ? "Borrador · web retirada" : "Borrador · sin publicar";
  return !state.hasUnpublishedChanges && localVersion === state.draftVersion ? "Igual que la publicada" : "Borrador · sin publicar";
}

/**
 * Etiqueta corta de la píldora del móvil (390 px, junto a «Publicar»): la
 * frase entera sigue para lectores de pantalla y al mantener el puntero. La
 * web retirada nunca se abrevia a «Borrador»: es el único estado en que el
 * enlace no se abre.
 */
export function shortChipLabel(state: SiteEditorState): string {
  return state.publishedRevisionId === null && state.publishedAt ? "Retirada" : "Borrador";
}

/** ¿Hay algo que publicar? Lo mismo que dice la etiqueta: todo menos «Igual que la publicada». */
export function hasPendingPublish(state: SiteEditorState, localVersion: number): boolean {
  return draftChipLabel(state, localVersion) !== "Igual que la publicada";
}
