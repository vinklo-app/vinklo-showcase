/**
 * Filtros por tarea de la lista de invitados (puro; cliente y servidor).
 * La condición de cada clave vive en SQL (`public.guest_in_filter`): recuento,
 * página, fila de recordatorios y CSV usan ese único predicado.
 */

export const GUEST_FILTERS = [
  "todos",
  "sin_enviar",
  "esperando",
  "para_recordar",
  "vienen",
  "no_vienen",
  "sin_telefono",
  "con_notas",
] as const;
export type GuestFilterKey = (typeof GUEST_FILTERS)[number];
/**
 * Filtros del CRM (2026-10-05): embudo «abierta» y estado del regalo. Van
 * aparte de GUEST_FILTERS para no añadir chips sin que el panel lo decida;
 * `guest_filter_counts` ya devuelve su recuento con la misma clave.
 */
export const CRM_GUEST_FILTERS = [
  "enviada_sin_abrir",
  "abierta_sin_responder",
  "con_regalo",
  "sin_regalo",
  "regalo_sin_indicar",
  "sin_agradecer",
] as const;
export type CrmGuestFilterKey = (typeof CRM_GUEST_FILTERS)[number];

export const CRM_GUEST_FILTER_LABELS: Record<CrmGuestFilterKey, string> = {
  enviada_sin_abrir: "Enviada, sin abrir",
  abierta_sin_responder: "Abierta, sin responder",
  con_regalo: "Con regalo",
  sin_regalo: "Sin regalo",
  regalo_sin_indicar: "Regalo sin indicar",
  sin_agradecer: "Por agradecer",
};

/** `sin_respuesta` = el antiguo `status=pendiente` (sin chip propio; se conserva para enlaces guardados). */
export type GuestFilter = GuestFilterKey | "sin_respuesta";
/**
 * Todo lo que acepta la lista/CSV en SQL (`guest_in_filter`): los filtros de
 * siempre + los del CRM. Tipo aparte para no ampliar los Record<GuestFilter, …>
 * del panel; el panel lo adopta cuando pinte los chips del CRM.
 */
export type GuestListFilter = GuestFilter | CrmGuestFilterKey;

export const GUEST_FILTER_LABELS: Record<GuestFilterKey, string> = {
  todos: "Todos",
  sin_enviar: "Sin enviar",
  esperando: "Esperando respuesta",
  para_recordar: "Para recordar",
  vienen: "Vienen",
  no_vienen: "No vienen",
  sin_telefono: "Sin teléfono",
  con_notas: "Con alergias o notas",
};

/** Días mínimos entre dos recordatorios a la misma persona (igual que en SQL). */
export const REMINDER_MIN_DAYS = 3;

const LEGACY: Record<string, GuestFilter> = { pendiente: "sin_respuesta", si: "vienen", no: "no_vienen" };

/**
 * Valor de `?filtro=` (o del antiguo `?status=`) → clave válida. Desconocido = «todos».
 * `isLegacy` permite al panel redirigir `status=si` a `filtro=vienen`.
 */
export function normalizeGuestFilter(value: unknown): GuestFilter {
  if (typeof value !== "string") return "todos";
  if ((GUEST_FILTERS as readonly string[]).includes(value) || value === "sin_respuesta") return value as GuestFilter;
  return Object.hasOwn(LEGACY, value) ? LEGACY[value] : "todos";
}

/** Como normalizeGuestFilter, aceptando además las claves del CRM. */
export function normalizeGuestListFilter(value: unknown): GuestListFilter {
  if (typeof value === "string" && (CRM_GUEST_FILTERS as readonly string[]).includes(value)) return value as CrmGuestFilterKey;
  return normalizeGuestFilter(value);
}
export function isLegacyGuestStatus(value: unknown): value is "pendiente" | "si" | "no" {
  return typeof value === "string" && Object.hasOwn(LEGACY, value);
}
