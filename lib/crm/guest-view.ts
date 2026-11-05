/** Vista de /panel/invitados: «Lista» (por defecto) o «Tabla» (punto 14 del backlog 13-oct-2026). */
export type GuestView = "lista" | "tabla";
/** Cookie que recuerda la vista: la lee la página en el servidor (sin parpadeo al cargar). */
export const GUEST_VIEW_COOKIE = "vk_invitados_vista";

export function parseGuestView(value: unknown): GuestView {
  return value === "tabla" ? "tabla" : "lista";
}

/**
 * Claves de campos propios en orden de aparición (columnas del CSV y de la
 * tabla). Aquí y no en guest-csv: la tabla es de cliente y guest-csv arrastra zod.
 */
export function extraFieldKeys(rows: Iterable<Record<string, string> | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const row of rows) if (row) for (const key of Object.keys(row)) keys.add(key);
  return [...keys];
}
