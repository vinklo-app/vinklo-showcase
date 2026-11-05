/**
 * Etiquetas y lado de los invitados (plan maestro 8-oct-2026, §3.1–3.2). Puro
 * (cliente y servidor). Columnas `wedding_guests.tags` y `side`
 * (20261020100000).
 *
 *  - Grupo     = «van juntos» (uno o ninguno). Las mesas automáticas nunca lo separan.
 *  - Etiquetas = «de qué os conocen» (varias). Las mesas automáticas juntan a quien comparte etiqueta.
 *  - Lado      = de quién es invitado: de {nombre1}, de {nombre2} o de los dos.
 */

export const TAG_MAX = 30;
export const TAGS_PER_GUEST = 8;
/** Tope de «Etiquetar…» / «Lado…» en una sola escritura (como «Mover a grupo…»). */
export const MAX_TAG_MOVE = 500;

export const GUEST_SIDES = ["p1", "p2", "ambos"] as const;
export type GuestSide = (typeof GUEST_SIDES)[number];

export function isGuestSide(value: unknown): value is GuestSide {
  return typeof value === "string" && (GUEST_SIDES as readonly string[]).includes(value);
}

/** «  Amigos   de la uni » → «Amigos de la uni»; vacío o no texto → null. */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean;
}

/** Clave de comparación: sin mayúsculas ni tildes. */
export function tagKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

/**
 * Si ya existe «Amigos de la Uni», escribir «amigos de la uni» reutiliza la
 * existente. null si queda vacía.
 */
export function canonicalTag(value: unknown, existing: readonly string[]): string | null {
  const clean = normalizeTag(value);
  if (!clean) return null;
  const key = tagKey(clean);
  return existing.find((tag) => tagKey(tag) === key) ?? clean;
}

/**
 * Normaliza una lista: forma canónica, sin repetidas (la primera gana), sin
 * vacías ni de más de 30 caracteres y como mucho 8.
 */
export function normalizeTags(list: readonly unknown[] | null | undefined, existing: readonly string[] = [], max = TAGS_PER_GUEST): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list ?? []) {
    const tag = canonicalTag(item, existing);
    if (!tag || tag.length > TAG_MAX) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Nombre corto de la persona para las etiquetas («Lucía» de «Lucía Pérez»); vacío → fallback. */
function firstName(value: string | null | undefined, fallback: string): string {
  const clean = normalizeTag(value ?? "");
  return clean ? clean.split(" ")[0].slice(0, 14) : fallback;
}

/** Propuestas para empezar (se ofrecen mientras la boda no tiene ninguna etiqueta). */
export function suggestedTags(partner1: string | null | undefined, partner2: string | null | undefined): string[] {
  const a = firstName(partner1, "la novia");
  const b = firstName(partner2, "el novio");
  return [
    `Familia de ${a}`, `Familia de ${b}`,
    `Amigos de ${a}`, `Amigos de ${b}`,
    "Amigos de los dos",
    `Trabajo de ${a}`, `Trabajo de ${b}`,
    "Pueblo",
  ];
}

export interface Partners { p1: string; p2: string }

/** { p1: "De Lucía", p2: "De Juan", ambos: "De los dos" }. */
export function SIDE_LABELS(partner1: string | null | undefined, partner2: string | null | undefined): Record<GuestSide, string> {
  return {
    p1: `De ${firstName(partner1, "la primera persona")}`,
    p2: `De ${firstName(partner2, "la segunda persona")}`,
    ambos: "De los dos",
  };
}

/** Filtro de lado de la lista: todos, sin indicar o uno concreto. */
export type SideFilter = GuestSide | "none" | null;

/** URL `?lado=p1|p2|ambos|sin`. */
export function parseSideFilter(value: unknown): SideFilter {
  if (value === "sin") return "none";
  return isGuestSide(value) ? value : null;
}

/** Valor de `p_side` de `guest_page`: undefined = no se envía (todos), '' = sin indicar. */
export function sideRpcParam(side: SideFilter | undefined): string | undefined {
  if (!side) return undefined;
  return side === "none" ? "" : side;
}

/** URL `?etiqueta=…` → etiqueta (o null). */
export function parseTagFilter(value: unknown): string | null {
  const tag = typeof value === "string" ? normalizeTag(value.slice(0, 200)) : null;
  return tag && tag.length <= TAG_MAX ? tag : null;
}

/** Una fila de `guest_tag_summary`. */
export interface GuestTagSummary {
  tag: string;
  guests: number;
  confirmed: number;
  /** Personas que asistirán (confirmados + acompañantes). */
  attendees: number;
}

export function tagNames(summary: readonly GuestTagSummary[] | null | undefined): string[] {
  return (summary ?? []).map((row) => row.tag);
}

/** Hasta `max` etiquetas visibles y cuántas quedan («+N»). */
export function visibleTags(tags: readonly string[] | null | undefined, max = 2): { shown: string[]; more: number } {
  const list = tags ?? [];
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
