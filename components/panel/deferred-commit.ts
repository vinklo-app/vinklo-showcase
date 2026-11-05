/**
 * Escrituras con «Deshacer» (marcar enviada, borrar un regalo): la acción del
 * servidor se aplaza hasta que se cierra el aviso y nunca se llama si la
 * pareja deshace. Las que siguen pendientes se vuelcan al ocultar la pestaña
 * o salir de la página (los temporizadores de sonner se pausan con la
 * pestaña oculta), para no perder ninguna. Un único registro para todo el panel.
 */
export const pendingCommits = new Set<() => void>();

export function flushPendingCommits() {
  for (const commit of Array.from(pendingCommits)) commit();
}
