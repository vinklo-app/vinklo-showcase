/**
 * Grupos de invitados (2026-10-06): «Familia de Elena», «Amigos de Marcos»,
 * «Trabajo»… Puro (cliente y servidor). Columna `wedding_guests.group_name`
 * (20261012100000): texto libre, recortado, 1–40 caracteres; null = sin grupo.
 */

export const GROUP_NAME_MAX = 40;
/** Tope de «Mover a grupo…» en una sola escritura (una página de la lista son 100). */
export const MAX_GROUP_MOVE = 500;

/** «  Familia   de Elena » → «Familia de Elena»; vacío → null. Igual en cliente y servidor. */
export function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean;
}

/**
 * Si ya existe un grupo con el mismo nombre sin distinguir mayúsculas ni
 * tildes, se usa su forma: «familia de elena» entra en «Familia de Elena».
 */
export function canonicalGroupName(value: string | null, existing: readonly string[]): string | null {
  const clean = normalizeGroupName(value);
  if (!clean) return null;
  const key = groupKey(clean);
  return existing.find((name) => groupKey(name) === key) ?? clean;
}

function groupKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

/** Filtro de grupo de la lista: todos, sin grupo o un grupo concreto. */
export type GroupFilter = { kind: "all" } | { kind: "none" } | { kind: "named"; name: string };
export const ALL_GROUPS: GroupFilter = { kind: "all" };

/** URL: `?grupo=Familia%20de%20Elena` o `?singrupo=1` (un nombre real nunca choca con «sin grupo»). */
export function parseGroupFilter(params: { grupo?: unknown; singrupo?: unknown }): GroupFilter {
  if (params.singrupo === "1") return { kind: "none" };
  const name = typeof params.grupo === "string" ? normalizeGroupName(params.grupo.slice(0, 200)) : null;
  return name && name.length <= GROUP_NAME_MAX ? { kind: "named", name } : ALL_GROUPS;
}

/** Valor de `p_group` de `guest_page`: undefined = no se envía (todos), '' = sin grupo. */
export function groupRpcParam(group: GroupFilter | undefined): string | undefined {
  if (!group || group.kind === "all") return undefined;
  return group.kind === "none" ? "" : group.name;
}

export function sameGroupFilter(a: GroupFilter | undefined, b: GroupFilter | undefined): boolean {
  const x = a ?? ALL_GROUPS;
  const y = b ?? ALL_GROUPS;
  return x.kind === y.kind && (x.kind !== "named" || (y.kind === "named" && x.name === y.name));
}

/** Una fila de `guest_group_summary`: name null = sin grupo. */
export interface GuestGroupSummary {
  name: string | null;
  guests: number;
  confirmed: number;
  declined: number;
  pending: number;
  /** Personas que asistirán (confirmados + acompañantes). */
  attendees: number;
}

/** Nombres de los grupos en uso (para sugerirlos en la ficha), en el orden del resumen. */
export function groupNames(summary: readonly GuestGroupSummary[] | null | undefined): string[] {
  return (summary ?? []).flatMap((group) => (group.name ? [group.name] : []));
}
