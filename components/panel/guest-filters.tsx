import Link from "next/link";
import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  CRM_GUEST_FILTER_LABELS, GUEST_FILTERS, GUEST_FILTER_LABELS,
  type CrmGuestFilterKey, type GuestFilterKey, type GuestListFilter,
} from "@/lib/messages/filters";
import { AnimatedNumber } from "@/components/panel/animated-number";
import { formatCount, plural } from "@/components/panel/guest-status";
import { ChipRow } from "@/components/panel/chip-row";
import { ALL_GROUPS, sameGroupFilter, type GroupFilter, type GuestGroupSummary } from "@/lib/crm/groups";
import { GUEST_SIDES, type GuestSide, type GuestTagSummary, type SideFilter } from "@/lib/crm/tags";

/**
 * Buscador + chips de tarea + paginación (server-safe). Filtro, búsqueda y
 * página se resuelven en el servidor (`guest_page` → `guest_in_filter`): aquí
 * solo se conservan `?filtro=`, `?q=`, `?page=`, el grupo (`?grupo=` o
 * `?singrupo=1`), la etiqueta (`?etiqueta=`) y el lado (`?lado=p1|p2|ambos|sin`).
 * Un chip de cada fila a la vez, combinables con la búsqueda. Los recuentos
 * salen del mismo predicado SQL. Por defecto solo se ve la fila de estados;
 * Grupos, Etiquetas, Lado y Regalos esperan tras «Filtrar» (revisión Jobs
 * #11), que llega abierto si alguno de ellos está activo.
 */
export interface GuestFilterParams { query: string; filter: GuestListFilter; page: number; group?: GroupFilter; tag?: string | null; side?: SideFilter }
export type GuestFilterCountsView = Partial<Record<GuestFilterKey | CrmGuestFilterKey, number>>;

type ChipKey = GuestFilterKey | CrmGuestFilterKey;
/** Primera fila: tareas de siempre, con «sin abrir» y «abierta sin responder» tras «Sin enviar» (orden del embudo). */
const TASK_CHIPS: ChipKey[] = GUEST_FILTERS.flatMap((key): ChipKey[] => (key === "sin_enviar" ? [key, "enviada_sin_abrir", "abierta_sin_responder"] : [key]));
/** Segunda fila «Regalos» (claves de guest_in_filter, 20261008100000). */
export const GIFT_CHIPS = ["con_regalo", "sin_agradecer", "regalo_sin_indicar", "sin_regalo"] as const satisfies readonly CrmGuestFilterKey[];
const isGiftChip = (value: GuestListFilter) => (GIFT_CHIPS as readonly string[]).includes(value);
const chipLabel = (key: ChipKey) => (key in GUEST_FILTER_LABELS ? GUEST_FILTER_LABELS[key as GuestFilterKey] : CRM_GUEST_FILTER_LABELS[key as CrmGuestFilterKey]);

export function filterUrl(basePath: string, params: Partial<GuestFilterParams>, current: GuestFilterParams): string {
  const next = { ...current, ...params };
  const [path, existing] = basePath.split("?");
  const search = new URLSearchParams(existing);
  for (const key of ["q", "filtro", "status", "page", "grupo", "singrupo", "etiqueta", "lado"]) search.delete(key);
  if (next.query) search.set("q", next.query);
  if (next.filter && next.filter !== "todos") search.set("filtro", next.filter);
  if (next.group?.kind === "named") search.set("grupo", next.group.name);
  if (next.group?.kind === "none") search.set("singrupo", "1");
  if (next.tag) search.set("etiqueta", next.tag);
  if (next.side) search.set("lado", next.side === "none" ? "sin" : next.side);
  if (next.page > 1) search.set("page", String(next.page));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function GuestFilters({ basePath = "/panel/invitados", current, counts, gifts = false, groups, tags, sideLabels }: {
  basePath?: string;
  current: GuestFilterParams;
  /** Recuentos de `guest_filter_counts` (sin ellos los chips van sin cifra). */
  counts?: GuestFilterCountsView | null;
  /** Segunda fila «Regalos» (con regalo · sin indicar · por agradecer). */
  gifts?: boolean;
  /** Fila «Grupos» (`guest_group_summary`); null/undefined = sin grupos (o sin la migración). */
  groups?: GuestGroupSummary[] | null;
  /** Filas «Etiquetas» y «Lado» (`guest_tag_summary`); null/undefined = sin la migración. */
  tags?: GuestTagSummary[] | null;
  /** «De Lucía», «De Juan», «De los dos». */
  sideLabels?: Record<GuestSide, string>;
}) {
  const [path, existing] = basePath.split("?");
  const hidden = Array.from(new URLSearchParams(existing).entries());
  const chip = (value: ChipKey) => {
    const active = current.filter === value;
    const count = counts?.[value];
    return (
      <Link key={value} href={filterUrl(basePath, { filter: value, page: 1 }, current)} aria-current={active ? "true" : undefined} className="pn-chip pn-press" scroll={false}>
        {chipLabel(value)}
        {typeof count === "number" && <small><AnimatedNumber value={count} /></small>}
      </Link>
    );
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <form method="get" action={path} role="search" className="pn-search" aria-label="Buscar invitados por nombre">
        <SearchIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
        <input name="q" type="search" defaultValue={current.query} maxLength={120} placeholder="Buscar por nombre" aria-label="Buscar por nombre" autoComplete="off" enterKeyHint="search" />
        {hidden.map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        {current.filter !== "todos" && <input type="hidden" name="filtro" value={current.filter} />}
        {current.group?.kind === "named" && <input type="hidden" name="grupo" value={current.group.name} />}
        {current.group?.kind === "none" && <input type="hidden" name="singrupo" value="1" />}
        {current.tag && <input type="hidden" name="etiqueta" value={current.tag} />}
        {current.side && <input type="hidden" name="lado" value={current.side === "none" ? "sin" : current.side} />}
        <button type="submit" className="pn-press">Buscar</button>
      </form>
      <ChipRow label="Filtrar por lo que queda por hacer">
        {TASK_CHIPS.map(chip)}
      </ChipRow>
      {(groups || tags || gifts || isGiftChip(current.filter)) && (
        <details className="pn-more-filters" open={moreFiltersActive(current) > 0 || undefined}>
          <summary className="pn-chip pn-press">
            <SlidersHorizontalIcon aria-hidden="true" className="size-4" />Filtrar
            {moreFiltersActive(current) > 0 && <small>{moreFiltersActive(current)}<span className="sr-only"> activos</span></small>}
          </summary>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
            {groups && <GroupChips basePath={basePath} current={current} groups={groups} />}
            {tags && <TagChips basePath={basePath} current={current} tags={tags} />}
            {tags && sideLabels && <SideChips basePath={basePath} current={current} labels={sideLabels} />}
            {(gifts || isGiftChip(current.filter)) && (
              <ChipRow label="Filtrar por regalos">
                <span className="pn-chips-label" aria-hidden="true">Regalos</span>
                {GIFT_CHIPS.map(chip)}
              </ChipRow>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** Filtros de detrás de «Filtrar» activos ahora (grupo, etiqueta, lado, regalos). */
export function moreFiltersActive(current: GuestFilterParams): number {
  return [(current.group ?? ALL_GROUPS).kind !== "all", Boolean(current.tag), Boolean(current.side), isGiftChip(current.filter)].filter(Boolean).length;
}

/**
 * Fila «Grupos»: un chip por grupo con su número de invitados y «Sin grupo».
 * Tocar el grupo activo lo quita. Solo aparece cuando hay algún grupo (o uno
 * elegido en la URL), para no ocupar sitio en una lista sin agrupar.
 */
function GroupChips({ basePath, current, groups }: { basePath: string; current: GuestFilterParams; groups: GuestGroupSummary[] }) {
  const named = groups.filter((group) => group.name !== null);
  const active = current.group ?? ALL_GROUPS;
  if (named.length === 0 && active.kind === "all") return null;
  const ungrouped = groups.find((group) => group.name === null)?.guests ?? 0;
  const chip = (key: string, label: string, target: GroupFilter, count?: number) => {
    const on = sameGroupFilter(active, target);
    return (
      <Link key={key} href={filterUrl(basePath, { group: on ? ALL_GROUPS : target, page: 1 }, current)} aria-current={on ? "true" : undefined} className="pn-chip pn-press" scroll={false}>
        {label}
        {typeof count === "number" && <small><AnimatedNumber value={count} /></small>}
      </Link>
    );
  };
  return (
    <ChipRow label="Filtrar por grupo">
      <span className="pn-chips-label" aria-hidden="true">Grupos</span>
      {named.map((group) => chip(`g-${group.name}`, group.name as string, { kind: "named", name: group.name as string }, group.guests))}
      {/* Un grupo elegido que ya no tiene a nadie (p. ej. tras moverlos a todos): sigue visible para poder quitarlo. */}
      {active.kind === "named" && !named.some((group) => group.name === active.name) && chip("g-actual", active.name, active, 0)}
      {(ungrouped > 0 || active.kind === "none") && chip("g-sin", "Sin grupo", { kind: "none" }, ungrouped)}
    </ChipRow>
  );
}

/**
 * Fila «Etiquetas»: un chip por etiqueta con su número de invitados. Tocar la
 * activa la quita. Solo aparece si hay alguna etiqueta (o una elegida).
 */
function TagChips({ basePath, current, tags }: { basePath: string; current: GuestFilterParams; tags: GuestTagSummary[] }) {
  const active = current.tag ?? null;
  if (tags.length === 0 && !active) return null;
  const chip = (name: string, count: number) => {
    const on = active === name;
    return (
      <Link key={`t-${name}`} href={filterUrl(basePath, { tag: on ? null : name, page: 1 }, current)} aria-current={on ? "true" : undefined} className="pn-chip pn-press" scroll={false}>
        {name}
        <small><AnimatedNumber value={count} /></small>
      </Link>
    );
  };
  return (
    <ChipRow label="Filtrar por etiqueta">
      <span className="pn-chips-label" aria-hidden="true">Etiquetas</span>
      {tags.map((row) => chip(row.tag, row.guests))}
      {active && !tags.some((row) => row.tag === active) && chip(active, 0)}
    </ChipRow>
  );
}

/** Fila «Lado»: de Lucía, de Juan, de los dos y sin indicar. Tocar el activo lo quita. */
function SideChips({ basePath, current, labels }: { basePath: string; current: GuestFilterParams; labels: Record<GuestSide, string> }) {
  const active = current.side ?? null;
  const options: Array<[Exclude<SideFilter, null>, string]> = [...GUEST_SIDES.map((side): [GuestSide, string] => [side, labels[side]]), ["none", "Sin indicar"]];
  return (
    <ChipRow label="Filtrar por lado">
      <span className="pn-chips-label" aria-hidden="true">Lado</span>
      {options.map(([value, label]) => {
        const on = active === value;
        return (
          <Link key={value} href={filterUrl(basePath, { side: on ? null : value, page: 1 }, current)} aria-current={on ? "true" : undefined} className="pn-chip pn-press" scroll={false}>
            {label}
          </Link>
        );
      })}
    </ChipRow>
  );
}

export function GuestPagination({ basePath = "/panel/invitados", current, matchingCount, pageSize }: {
  basePath?: string; current: GuestFilterParams; matchingCount: number; pageSize: number;
}) {
  const hasPrev = current.page > 1;
  const hasNext = current.page * pageSize < matchingCount;
  // Sin filtros y en una sola página, el recuento ya está en el chip «Todos»: no se repite.
  const grouped = (current.group ?? ALL_GROUPS).kind !== "all" || Boolean(current.tag) || Boolean(current.side);
  if (!current.query && current.filter === "todos" && !grouped && !hasPrev && !hasNext) return null;
  // Sin resultados lo explica el vacío de la lista (con su propio «Ver toda la lista»).
  if (matchingCount === 0 && !hasPrev) return null;
  return (
    <nav aria-label="Páginas de invitados" className="pn-muted flex flex-wrap items-center justify-between gap-x-3 text-xs">
      <span className="pn-tnum">
        {plural(matchingCount, "persona", "personas")} con estos filtros{matchingCount > pageSize ? ` · página ${formatCount(current.page)} de ${formatCount(Math.ceil(matchingCount / pageSize))}` : ""}
      </span>
      <span className="flex gap-4">
        {hasPrev && <Link className="pn-link pn-press" href={filterUrl(basePath, { page: current.page - 1 }, current)}>Anterior</Link>}
        {hasNext && <Link className="pn-link pn-press" href={filterUrl(basePath, { page: current.page + 1 }, current)}>Siguiente</Link>}
        {(current.query || current.filter !== "todos" || grouped) && <Link className="pn-link pn-press" href={filterUrl(basePath, { filter: "todos", query: "", page: 1, group: ALL_GROUPS, tag: null, side: null }, current)}>Quitar filtros</Link>}
      </span>
    </nav>
  );
}
