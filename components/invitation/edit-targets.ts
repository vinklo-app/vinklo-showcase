/**
 * Marcas para «Seleccionar» del editor (como las ediciones visuales de
 * Lovable): `data-edit-scene` en cada sección y `data-edit-path` en los
 * textos que la pareja puede señalar (rutas en lib/site-chat/edit-focus.ts).
 *
 * Solo se emiten cuando el renderer recibe `editTargets` en mode="preview"
 * (el editor del panel y el creador). La web pública, /demo y la landing
 * no llevan ninguna: su HTML no cambia.
 */
export type EditAttrs = { "data-edit-path"?: string; "data-edit-scene"?: string };

const NONE: EditAttrs = {};

export function editPath(on: boolean | undefined, path: string): EditAttrs {
  return on ? { "data-edit-path": path } : NONE;
}

export function editScene(on: boolean | undefined, sceneId: string): EditAttrs {
  return on ? { "data-edit-scene": sceneId } : NONE;
}

/**
 * Fecha aún sin elegir (solo en el creador, con las marcas activas): la
 * portada pinta «Vuestra fecha» en su sitio para que la pareja la toque y la
 * rellene. La web pública nunca lo enseña.
 */
export const DATE_GAP_FIELD = "weddingDate";
