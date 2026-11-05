import Link from "next/link";
import { ChipRow } from "@/components/panel/chip-row";
import type { GuestSide } from "@/lib/crm/tags";
import { seriesGroups, seriesHref, seriesSides, seriesTags, type InvitationQueueItem, type SeriesFilter } from "@/lib/messages/invitation-series";

/**
 * Chips del envío en serie: por grupo, por etiqueta y por lado, con los mismos
 * parámetros que /panel/invitados (`grupo`, `etiqueta`, `lado`). Se combinan:
 * cada chip conserva los demás filtros y, si ya está activo, lo quita. Los
 * recuentos son de la fila entera. Server-safe.
 */
export function SeriesFilters({ items, filter, base, sideLabels }: {
  items: readonly InvitationQueueItem[]; filter: SeriesFilter; base: string; sideLabels: Record<GuestSide, string>;
}) {
  const groups = seriesGroups(items);
  const tags = seriesTags(items);
  const sides = seriesSides(items);
  const href = (next: Partial<SeriesFilter>) => seriesHref(base, { ...filter, ...next });
  const all = !filter.group && !filter.tag && !filter.side;
  const allChip = <Link href={base} className="pn-chip pn-press" aria-current={all ? "true" : undefined}>Todos <span className="pn-tnum">{items.length}</span></Link>;
  return (
    <>
      {groups.length > 0 && (
        <ChipRow label="Enviar por grupo">
          {allChip}
          {groups.map(([name, count]) => (
            <Link key={name} href={href({ group: filter.group === name ? null : name })} className="pn-chip pn-press" aria-current={filter.group === name ? "true" : undefined}>{name} <span className="pn-tnum">{count}</span></Link>
          ))}
        </ChipRow>
      )}
      {tags.length > 0 && (
        <ChipRow label="Enviar por etiqueta">
          <span className="pn-chips-label" aria-hidden="true">Etiquetas</span>
          {groups.length === 0 && allChip}
          {tags.map(([name, count]) => (
            <Link key={name} href={href({ tag: filter.tag === name ? null : name })} className="pn-chip pn-press" aria-current={filter.tag === name ? "true" : undefined}>{name} <span className="pn-tnum">{count}</span></Link>
          ))}
        </ChipRow>
      )}
      {sides.length > 0 && (
        <ChipRow label="Enviar por lado">
          <span className="pn-chips-label" aria-hidden="true">Lado</span>
          {groups.length === 0 && tags.length === 0 && allChip}
          {sides.map(([side, count]) => (
            <Link key={side} href={href({ side: filter.side === side ? null : side })} className="pn-chip pn-press" aria-current={filter.side === side ? "true" : undefined}>{side === "none" ? "Sin indicar" : sideLabels[side]} <span className="pn-tnum">{count}</span></Link>
          ))}
        </ChipRow>
      )}
    </>
  );
}
