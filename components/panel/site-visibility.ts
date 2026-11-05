/**
 * Qué ven hoy los invitados al abrir el enlace (review fase 1, R-01/R-03).
 *
 * - "live": nunca se ha publicado una revisión (`publishedRevisionId` y
 *   `publishedAt` a null). El adaptador sirve la web EN VIVO: cada cambio
 *   guardado en ajustes o agenda se ve al momento, pero la foto, la paleta
 *   y los cambios de IA solo viven en el borrador hasta publicar. Las bodas
 *   nuevas se publican al crearse, así que esto afecta a las anteriores.
 * - "published": hay revisión publicada; los invitados ven esa versión fija
 *   hasta que la pareja publique de nuevo.
 * - "withdrawn": hubo publicación pero el puntero está a null; el enlace
 *   devuelve 404 hasta volver a publicar.
 *
 * Puro y server-safe; recibe el `SiteEditorState` (o null si la boda no
 * tiene fila del motor de webs, que equivale a "live").
 */
export type SiteVisibility = "live" | "published" | "withdrawn";

export function siteVisibility(state: { publishedRevisionId: string | null; publishedAt: string | null } | null | undefined): SiteVisibility {
  if (!state) return "live";
  if (state.publishedRevisionId !== null) return "published";
  return state.publishedAt !== null ? "withdrawn" : "live";
}

/** Aviso bajo el formulario de ajustes / agenda. Voz COPY-Y-VOZ (vosotros). */
export const SITE_VISIBILITY_NOTE: Record<SiteVisibility, string> = {
  live: "Los nombres, la fecha, el lugar y el programa ya se ven en vuestra web. La foto, los colores y los cambios de «Pedid cambios» se verán cuando publiquéis.",
  published: "Guardar actualiza el borrador. Publicar actualiza la web que ven vuestros invitados.",
  withdrawn: "Vuestro enlace no se abre para los invitados. Volved a publicar cuando queráis mostrar la web.",
};

/** Mensaje tras guardar ajustes. */
export const SITE_SAVED_MESSAGE: Record<SiteVisibility, string> = {
  live: "Cambios guardados. Publicad para que vuestros invitados vean también la foto y los colores.",
  published: "Cambios guardados en el borrador. Publicad para que los vean vuestros invitados.",
  withdrawn: "Cambios guardados. La web sigue retirada hasta que la volváis a publicar.",
};

/** Dónde aparece la agenda del día. */
export const AGENDA_VISIBILITY_NOTE: Record<SiteVisibility, string> = {
  live: "Vuestros invitados ya lo ven en vuestra página.",
  published: "Aparece en vuestra página cuando publiquéis los cambios desde «Vuestra web».",
  withdrawn: "Vuestra web está retirada: se verá cuando la volváis a publicar.",
};
