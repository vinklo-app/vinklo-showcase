import Link from "next/link";
import { ArrowRightIcon, ChevronRightIcon, UsersRoundIcon } from "lucide-react";
import { IconTile } from "@/components/panel/page-head";
import { ProportionBar, type BarSegment } from "@/components/panel/panel-stats";
import { filterUrl } from "@/components/panel/guest-filters";
import { formatCount, plural } from "@/components/panel/guest-status";
import type { GroupFilter, GuestGroupSummary } from "@/lib/crm/groups";

/*
 * «Por grupos» en /panel (server-safe): cada grupo con su barra de
 * confirmados / no vienen / sin responder (la misma barra que la lista) y un
 * enlace a la lista filtrada por ese grupo. Cifras de `guest_group_summary`.
 */

const groupHref = (listHref: string, group: GroupFilter) => filterUrl(listHref, { group, page: 1 }, { query: "", filter: "todos", page: 1 });

function segments(group: GuestGroupSummary): BarSegment[] {
  return [
    { key: "yes", value: group.confirmed, tone: "done", label: "vienen" },
    { key: "no", value: group.declined, tone: "declined", label: "no vienen" },
  ];
}

function line(group: GuestGroupSummary): string {
  return [
    `${formatCount(group.confirmed)} ${group.confirmed === 1 ? "viene" : "vienen"}`,
    group.declined > 0 ? `${formatCount(group.declined)} no` : null,
    group.pending > 0 ? `${formatCount(group.pending)} sin responder` : null,
  ].filter(Boolean).join(" · ");
}

export function GroupSummaryCard({ groups, listHref = "/panel/invitados" }: {
  /** null = sin la migración de grupos o fallo: no se pinta nada. */
  groups: GuestGroupSummary[] | null;
  listHref?: string;
}) {
  if (!groups) return null;
  const named = groups.filter((group) => group.name !== null);
  const ungrouped = groups.find((group) => group.name === null);
  const head = (
    <div className="pn-ledger-head">
      <h2 id="ledger-groups" className="pn-display pn-h2">Por <em>grupos</em></h2>
      {named.length > 0 && <Link href={listHref} className="pn-link pn-press">Ver la lista<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>}
    </div>
  );
  if (named.length === 0) {
    // Sin grupos: una invitación corta a usarlos (solo si ya hay invitados).
    if (!ungrouped) return null;
    return (
      <section className="pn-ledger" aria-labelledby="ledger-groups">
        {head}
        <div className="pn-ledger-empty pn-quiet-empty">
          <IconTile icon={UsersRoundIcon} />
          <div className="grid justify-items-start gap-3">
            <p className="pn-text text-sm leading-relaxed">Agrupad a vuestros invitados («Familia de Elena», «Amigos de Marcos», «Trabajo») y veréis aquí quién falta por responder en cada grupo. En la lista, tocad «Seleccionar» y «Mover a grupo…».</p>
            <Link href={listHref} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Ir a la lista</Link>
          </div>
        </div>
      </section>
    );
  }
  const rows = ungrouped ? [...named, ungrouped] : named;
  return (
    <section className="pn-ledger" aria-labelledby="ledger-groups">
      {head}
      <ul className="pn-groups">
        {rows.map((group) => {
          const label = group.name ?? "Sin grupo";
          return (
            <li key={group.name ?? "∅"}>
              <Link href={groupHref(listHref, group.name ? { kind: "named", name: group.name } : { kind: "none" })} className="pn-group-row pn-press" data-ungrouped={group.name ? undefined : "true"}>
                <span className="pn-group-row-top">
                  <span className="pn-name pn-group-row-name">{label}</span>
                  <span className="pn-group-row-count pn-tnum">{plural(group.guests, "invitado", "invitados")}</span>
                  <ChevronRightIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
                </span>
                <ProportionBar segments={segments(group)} total={group.guests} label={`${label}: ${line(group)}`} />
                <span className="pn-sub pn-tnum">
                  {line(group)}
                  {group.attendees > 0 && <span className="pn-group-row-people"> · {plural(group.attendees, "persona asistirá", "personas asistirán")}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="pn-help">El rayado es quien aún no ha respondido. Tocad un grupo para ver a sus invitados.</p>
    </section>
  );
}
