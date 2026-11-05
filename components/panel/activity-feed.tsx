import Link from "next/link";
import { BellRingIcon, CheckIcon, EyeIcon, MessageCircleHeartIcon, XIcon } from "lucide-react";
import { IconTile } from "@/components/panel/page-head";
import { initials } from "@/components/panel/guest-status";
import { ActivityToasts } from "@/components/panel/activity-toasts";

/**
 * Actividad en vivo del resumen (2026-10-06): quién ha abierto su invitación
 * y quién ha respondido, con la hora y la acción que toca. Se actualiza con
 * el refresco de 30 s del resumen y avisa con un toast de lo nuevo.
 * «Abierta» = primera apertura del enlace personal; «respondió» usa la hora
 * en que respondió el invitado (responded_at; si no, la última edición), como «Respuestas recientes».
 */

export type ActivityKind = "opened" | "yes" | "no";
export interface ActivityEvent {
  key: string;
  guestId: string;
  name: string;
  kind: ActivityKind;
  at: string;
  companions: number;
  /** Para «abierta»: sigue sin responder (se puede recordar). */
  pending: boolean;
}

export function buildActivity(
  opened: { id: string; name: string; rsvp_status: string; invitation_opened_at: string | null }[],
  responded: { id: string; name: string; rsvp_status: string; rsvp_companions: number; updated_at: string }[],
  limit = 8,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const g of opened) {
    if (!g.invitation_opened_at) continue;
    events.push({ key: `o:${g.id}:${g.invitation_opened_at}`, guestId: g.id, name: g.name, kind: "opened", at: g.invitation_opened_at, companions: 0, pending: g.rsvp_status === "pendiente" });
  }
  for (const g of responded) {
    if (g.rsvp_status !== "si" && g.rsvp_status !== "no") continue;
    events.push({ key: `r:${g.id}:${g.rsvp_status}:${g.updated_at}`, guestId: g.id, name: g.name, kind: g.rsvp_status === "si" ? "yes" : "no", at: g.updated_at, companions: g.rsvp_companions, pending: false });
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

const rtf = new Intl.RelativeTimeFormat("es-ES", { numeric: "auto" });
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "ahora mismo";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }).format(new Date(iso));
}

export function activityText(event: Pick<ActivityEvent, "kind" | "name" | "companions">): string {
  if (event.kind === "opened") return `${event.name} ha abierto su invitación`;
  if (event.kind === "no") return `${event.name} no podrá venir`;
  return event.companions > 0 ? `${event.name} viene, con ${event.companions} ${event.companions === 1 ? "acompañante" : "acompañantes"}` : `${event.name} viene`;
}

const ICON = { opened: EyeIcon, yes: CheckIcon, no: XIcon } as const;

export function ActivityFeed({ events, error = false }: { events: ActivityEvent[]; error?: boolean }) {
  const now = Date.now();
  return (
    <section className="pn-activity" aria-labelledby="activity-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="pn-eyebrow"><span className="pn-live-dot" aria-hidden="true" />En directo</p>
          <h2 id="activity-title" className="pn-display pn-h2">Lo <em>último</em></h2>
        </div>
        <Link href="/panel/invitados" className="pn-link pn-press">Ver todos los invitados</Link>
      </div>
      {error ? (
        <p className="pn-note pn-note--warn mt-4" role="alert">La actividad no está disponible ahora.</p>
      ) : events.length === 0 ? (
        <div className="pn-quiet-empty">
          <IconTile icon={MessageCircleHeartIcon} />
          <p className="pn-muted text-sm leading-relaxed">Aquí veréis, al momento, quién abre su invitación y quién responde. Enviad las primeras desde vuestra lista.</p>
        </div>
      ) : (
        <ol className="pn-activity-list">
          {events.map((event) => {
            const Icon = ICON[event.kind];
            return (
              <li key={event.key} className="pn-activity-item" data-kind={event.kind}>
                <span className="pn-avatar pn-activity-avatar" aria-hidden="true">
                  {initials(event.name)}
                  <span className="pn-activity-badge"><Icon className="size-3" /></span>
                </span>
                <span className="pn-activity-text">
                  <span>{activityText(event)}</span>
                  <time dateTime={event.at} className="pn-muted">{relativeTime(event.at, now)}</time>
                </span>
                {event.kind === "opened" && event.pending ? (
                  <Link href="/panel/invitados/recordatorios" className="pn-activity-action pn-press"><BellRingIcon aria-hidden="true" className="size-4" />Recordar</Link>
                ) : (
                  <Link href={`/panel/invitados?q=${encodeURIComponent(event.name)}`} className="pn-activity-action pn-activity-action--quiet pn-press">Ver ficha</Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <ActivityToasts events={events.map(({ key, kind, name, companions }) => ({ key, kind, name, companions }))} />
    </section>
  );
}
