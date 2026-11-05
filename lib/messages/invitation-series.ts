/**
 * Envío en serie de la primera invitación (plan maestro §4.1). Puro (cliente
 * y servidor): quién entra en la fila, en qué orden y quién va después. El
 * estado de la tanda (persona en curso, enviadas, saltadas) es el mismo de la
 * fila de recordatorios (components/panel/reminders.ts, `queueView`).
 */
import { whatsappNumber } from "@/lib/invitation-sharing";
import { GUEST_SIDES, parseSideFilter, parseTagFilter, type GuestSide, type SideFilter } from "@/lib/crm/tags";
import { parseGroupFilter } from "@/lib/crm/groups";

export interface InvitationQueueItem {
  id: string;
  name: string;
  phone: string;
  rsvp_status: "pendiente" | "si" | "no";
  /** Ya tenía un enlace creado desde la lista (sin confirmar el envío). */
  invitation_prepared_at: string | null;
  group_name: string | null;
  /** Etiquetas y lado (20261020100000): [] / null sin la migración. */
  tags: string[];
  side: GuestSide | null;
}

type Row = Omit<InvitationQueueItem, "phone" | "group_name" | "tags" | "side"> & { phone: string | null; group_name?: string | null; tags?: string[]; side?: GuestSide | null; invitation_opened_at?: string | null };

/**
 * ¿Le toca la primera invitación? No a quien ya respondió (sí o no) ni a
 * quien abrió su enlace personal: eso prueba que ya la tiene (entonces toca,
 * como mucho, un recordatorio). Revisión UX P0 #3 y P1 #14.
 */
export function needsInvitation(row: { rsvp_status: string; invitation_opened_at?: string | null }): boolean {
  return row.rsvp_status === "pendiente" && !row.invitation_opened_at;
}

/**
 * Quita a quien no necesita la invitación y separa quien tiene un teléfono
 * válido para WhatsApp de quien no (solo cuenta a quien sí la necesita).
 */
export function splitInvitationQueue(rows: readonly Row[]): { items: InvitationQueueItem[]; withoutPhone: number } {
  const items: InvitationQueueItem[] = [];
  let withoutPhone = 0;
  for (const { invitation_opened_at: openedAt, ...row } of rows) {
    if (!needsInvitation({ rsvp_status: row.rsvp_status, invitation_opened_at: openedAt })) continue;
    if (row.phone && whatsappNumber(row.phone)) items.push({ ...row, phone: row.phone, group_name: row.group_name ?? null, tags: row.tags ?? [], side: row.side ?? null });
    else withoutPhone += 1;
  }
  return { items, withoutPhone };
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Por grupo (alfabético, «sin grupo» al final) y, dentro del grupo, en el
 * orden en que llegan (el de la lista: alta más antigua primero). Estable.
 */
export function sortInvitationQueue<T extends { group_name: string | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ga = a.item.group_name, gb = b.item.group_name;
      if (ga !== gb) {
        if (ga === null) return 1;
        if (gb === null) return -1;
        const byGroup = collator.compare(ga, gb);
        if (byGroup !== 0) return byGroup;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Quién va después de `currentId` en la tanda (sin saltadas). null = no queda
 * nadie más. Sirve para «Sí, enviada · Siguiente: Marta», que confirma y abre
 * WhatsApp con la siguiente persona en el mismo toque.
 */
export function nextInSeries<T extends { id: string }>(queue: readonly T[], skipped: readonly string[], currentId: string): T | null {
  const skip = new Set(skipped);
  const index = queue.findIndex((item) => item.id === currentId);
  const pending = queue.filter((item) => !skip.has(item.id) && item.id !== currentId);
  if (index < 0) return pending[0] ?? null;
  // La siguiente en el orden de la fila; si la actual era la última, la primera pendiente.
  return queue.slice(index + 1).find((item) => !skip.has(item.id)) ?? pending[0] ?? null;
}

/** Grupos de la fila con cuántas personas hay en cada uno (chips de filtro). */
export function seriesGroups(items: readonly { group_name: string | null }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) if (item.group_name) counts.set(item.group_name, (counts.get(item.group_name) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => collator.compare(a[0], b[0]));
}

/**
 * Filtros de la fila (los mismos de /panel/invitados): `?grupo=`,
 * `?etiqueta=` y `?lado=p1|p2|ambos|sin`. Se combinan (y).
 */
export interface SeriesFilter { group: string | null; tag: string | null; side: SideFilter }

export const NO_SERIES_FILTER: SeriesFilter = { group: null, tag: null, side: null };

/** Lee los filtros de la URL con los mismos parsers que la lista. */
export function parseSeriesFilter(params: Record<string, string | string[] | undefined>): SeriesFilter {
  const group = parseGroupFilter({ grupo: params.grupo });
  return { group: group.kind === "named" ? group.name : null, tag: parseTagFilter(params.etiqueta), side: parseSideFilter(params.lado) };
}

export function hasSeriesFilter(filter: SeriesFilter): boolean {
  return Boolean(filter.group || filter.tag || filter.side);
}

/** Quien cumple todos los filtros activos. La etiqueta, exacta (como `p_tag` de guest_page). */
export function filterSeries<T extends { group_name: string | null; tags: readonly string[]; side: GuestSide | null }>(items: readonly T[], filter: SeriesFilter): T[] {
  return items.filter((item) => (!filter.group || item.group_name === filter.group)
    && (!filter.tag || item.tags.includes(filter.tag))
    && (!filter.side || (filter.side === "none" ? item.side === null : item.side === filter.side)));
}

/** Etiquetas de la fila con cuántas personas las tienen (chips de filtro). */
export function seriesTags(items: readonly { tags: readonly string[] }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => collator.compare(a[0], b[0]));
}

/** Cuántas personas hay de cada lado (y sin indicar). Vacío si nadie tiene lado. */
export function seriesSides(items: readonly { side: GuestSide | null }[]): [Exclude<SideFilter, null>, number][] {
  if (!items.some((item) => item.side !== null)) return [];
  const sides: Exclude<SideFilter, null>[] = [...GUEST_SIDES, "none"];
  return sides.map((side) => [side, items.filter((item) => (side === "none" ? item.side === null : item.side === side)).length] as [Exclude<SideFilter, null>, number])
    .filter(([, count]) => count > 0);
}

/**
 * URL de la fila con los filtros, con los mismos nombres que /panel/invitados
 * (`grupo`, `etiqueta`, `lado`). `base` puede traer ya su query (borrador).
 */
export function seriesHref(base: string, filter: SeriesFilter): string {
  const params = new URLSearchParams();
  if (filter.group) params.set("grupo", filter.group);
  if (filter.tag) params.set("etiqueta", filter.tag);
  if (filter.side) params.set("lado", filter.side === "none" ? "sin" : filter.side);
  const query = params.toString();
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

/**
 * El filtro que de verdad se aplica: un grupo o una etiqueta solo si alguien
 * de la fila lo tiene (hay chip), y el lado solo si alguien tiene lado. Así un
 * enlace viejo no deja la fila vacía sin ningún chip marcado.
 */
export function activeSeriesFilter(items: readonly InvitationQueueItem[], requested: SeriesFilter): SeriesFilter {
  return {
    group: requested.group && items.some((item) => item.group_name === requested.group) ? requested.group : null,
    tag: requested.tag && items.some((item) => item.tags.includes(requested.tag as string)) ? requested.tag : null,
    side: requested.side && items.some((item) => item.side !== null) ? requested.side : null,
  };
}
