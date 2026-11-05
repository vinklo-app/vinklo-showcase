import Link from "next/link";
import { ChipRow } from "@/components/panel/chip-row";
import { parseGroupFilter } from "@/lib/crm/groups";
import { parseTagFilter } from "@/lib/crm/tags";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/panel/page-head";
import { ReminderQueueLive } from "@/components/panel/messages-wired";
import { parseQueueState } from "@/components/panel/reminders";
import { getMessageTemplates } from "@/lib/actions/messages";
import { getReminderCandidates } from "@/lib/data/reminder-queue";
import { formatRsvpDate } from "@/lib/rsvp-window";
import { getCurrentWedding } from "@/lib/data/current-wedding";

export const metadata = { title: "Recordar a quien no ha respondido" };

/**
 * Fila de recordatorios. Se reconstruye SIEMPRE desde el servidor; la persona
 * en curso y la tanda viajan en la URL (`?persona=…&paso=confirmar`), así que
 * una recarga de iOS al volver de WhatsApp vuelve a la misma pregunta.
 */
export default async function RecordatoriosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const state = parseQueueState(params);
  // Recordatorios por grupo (20261012200000): `?grupo=Familia de Elena`.
  const parsedGroup = parseGroupFilter({ grupo: params.grupo });
  // Por etiqueta (20261020100000): `?etiqueta=Amigos de la uni`. Un filtro a la vez: el grupo manda.
  const group = parsedGroup.kind === "named" ? parsedGroup.name : null;
  const tag = group ? null : parseTagFilter(params.etiqueta);
  const current = await getCurrentWedding();
  if (!current) redirect("/onboarding");
  const { supabase, wedding } = current;

  const [all, filtered, templates] = await Promise.all([
    getReminderCandidates(supabase, wedding.id),
    group || tag ? getReminderCandidates(supabase, wedding.id, { group, tag }) : Promise.resolve(null),
    getMessageTemplates(),
  ]);
  const queue = group || tag ? filtered : all;
  const period = all?.period ?? null;
  // Chips de grupo con cuántas personas de la fila hay en cada uno.
  const groupCounts = new Map<string, number>();
  for (const item of all?.items ?? []) if (item.group_name) groupCounts.set(item.group_name, (groupCounts.get(item.group_name) ?? 0) + 1);
  const groups = [...groupCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  const base = "/panel/invitados/recordatorios";
  const groupHref = (name: string | null) => (name ? `${base}?grupo=${encodeURIComponent(name)}` : base);
  const tagHref = (name: string) => `${base}?etiqueta=${encodeURIComponent(name)}`;
  // Chips de etiqueta, igual que los de grupo.
  const tagCounts = new Map<string, number>();
  for (const item of all?.items ?? []) for (const name of item.tags) tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const context = templates.ok ? templates.context : { novios: "", fecha: "" };
  const template = templates.ok && !templates.templates.reminder.isDefault ? templates.templates.reminder.body : null;

  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight">
      <PageHead eyebrow="Invitados · Recordatorios" back={{ href: "/panel/invitados", label: "Invitados" }} title={<>Recordad a quien <em>no ha respondido</em></>}
        lead="Un recordatorio por persona, a partir de 3 días después de la invitación; nadie recibe dos en menos de 3 días." />
      {period?.status === "closed" ? (
        <p className="pn-note">
          El plazo para responder terminó el {formatRsvpDate(period.window.reason === "deadline" ? period.window.deadline : period.window.weddingDate)}: ya no proponemos recordatorios. Si queréis dar más tiempo, <Link href="/panel/ajustes" className="pn-link">ampliad el plazo en Ajustes</Link>.
        </p>
      ) : period?.status === "open" && period.soon && period.deadline ? (
        <p className="pn-note">
          {period.daysLeft === 0 ? "El plazo para responder termina hoy" : `El plazo para responder termina el ${formatRsvpDate(period.deadline)}`}: os proponemos recordar ya a quien no ha respondido, aunque la invitación sea reciente.
        </p>
      ) : null}
      {queue ? (
        <>
          {groups.length > 0 && (
            <ChipRow label="Recordar por grupo">
              <Link href={groupHref(null)} className="pn-chip pn-press" aria-current={group || tag ? undefined : "true"}>Todos <span className="pn-tnum">{all?.total ?? 0}</span></Link>
              {groups.map(([name, count]) => (
                <Link key={name} href={groupHref(name)} className="pn-chip pn-press" aria-current={group === name ? "true" : undefined}>{name} <span className="pn-tnum">{count}</span></Link>
              ))}
            </ChipRow>
          )}
          {tags.length > 0 && (
            <ChipRow label="Recordar por etiqueta">
              <span className="pn-chips-label" aria-hidden="true">Etiquetas</span>
              {groups.length === 0 && <Link href={base} className="pn-chip pn-press" aria-current={tag ? undefined : "true"}>Todos <span className="pn-tnum">{all?.total ?? 0}</span></Link>}
              {tags.map(([name, count]) => (
                <Link key={name} href={tag === name ? base : tagHref(name)} className="pn-chip pn-press" aria-current={tag === name ? "true" : undefined}>{name} <span className="pn-tnum">{count}</span></Link>
              ))}
            </ChipRow>
          )}
          <ReminderQueueLive key={group ?? (tag ? `t-${tag}` : "todos")} basePath={tag ? tagHref(tag) : groupHref(group)} items={queue.items} state={state} template={template} context={context} linkPreview={`${baseUrl}/b/${wedding.slug}?invitacion=…`} />
          {queue.total > queue.items.length && (
            <p className="pn-help">Hay {queue.total} personas en la fila; aquí se muestran las {queue.items.length} que hace más tiempo que contactasteis. Al terminar, volved a entrar para seguir.</p>
          )}
        </>
      ) : (
        <p role="alert" className="pn-note pn-note--warn">No hemos podido cargar la fila de recordatorios. Probad a cargar la página de nuevo.</p>
      )}
    </main>
  );
}
