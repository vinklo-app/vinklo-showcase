import Link from "next/link";
import { AlarmClockIcon, ArmchairIcon, BellRingIcon, ChefHatIcon, ListChecksIcon, CalendarClockIcon, ChevronRightIcon, EyeIcon, GiftIcon, PhoneOffIcon, SendIcon, SparklesIcon, UtensilsIcon, type LucideIcon } from "lucide-react";
import type { CrmFunnelSummary } from "@/lib/crm/contract";
import type { GuestFilterCounts } from "@/lib/data/attendance";
import { filterUrl } from "@/components/panel/guest-filters";
import { formatCount } from "@/components/panel/guest-status";
import type { GuestListFilter } from "@/lib/messages/filters";

/**
 * «Lo que toca hoy» (2026-10-06, el CRM como todo en uno): las tareas que
 * salen de vuestros propios datos, ordenadas por lo que más acerca a tener
 * todas las respuestas. Cada una lleva a la pantalla que la resuelve, ya
 * filtrada. Sin tareas, lo dice. Server-safe: no guarda nada.
 *
 * El orden ES el peso (P1-7).
 */

interface Action {
  key: string;
  icon: LucideIcon;
  count: number;
  title: string;
  detail: string;
  href: string;
  tone?: "clay" | "ink";
}

const list = (filter: GuestListFilter) => filterUrl("/panel/invitados", { filter, page: 1 }, { query: "", filter: "todos", page: 1 });
const one = (count: number, singular: string, many: string) => (count === 1 ? singular : many);

export function buildNextActions({ funnel, counts, toRemind: remindTotal = null, toThank, agendaCount, unseated = null, tasks = null, menuMissing = null }: {
  funnel: CrmFunnelSummary | null;
  counts: GuestFilterCounts | null;
  /** Personas en la fila de recordatorios (getReminderCandidates); null = usar el recuento SQL. */
  toRemind?: number | null;
  toThank: number;
  agendaCount: number;
  /** Personas que vienen sin mesa (solo si ya hay mesas; null = sin mesas o sin la migración). */
  unseated?: number | null;
  /** Tareas abiertas que vencen en los próximos 7 días y vencidas (null = sin la migración de tareas). */
  tasks?: { thisWeek: number; overdue: number } | null;
  /** Personas que vienen sin menú (null = la boda no pregunta menú o sin datos). */
  menuMissing?: number | null;
}): Action[] {
  const actions: Action[] = [];
  const notSent = funnel?.pending.not_sent ?? counts?.sin_enviar ?? 0;
  const toRemind = remindTotal ?? funnel?.toRemind ?? counts?.para_recordar ?? 0;
  const openedUnanswered = funnel?.pending.opened_unanswered ?? 0;
  if (notSent > 0) actions.push({ key: "send", icon: SendIcon, count: notSent, tone: "clay", title: `${one(notSent, "Invitación", "Invitaciones")} por enviar`, detail: "El mensaje de WhatsApp sale con su nombre y su enlace personal.", href: "/panel/invitados/mensajes" });
  if (toRemind > 0) actions.push({ key: "remind", icon: BellRingIcon, count: toRemind, tone: "clay", title: `${one(toRemind, "Persona", "Personas")} para recordar`, detail: "Recibieron la invitación y no han respondido. El recordatorio ya está escrito.", href: "/panel/invitados/recordatorios" });
  if (openedUnanswered > 0) actions.push({ key: "opened", icon: EyeIcon, count: openedUnanswered, title: `La ${one(openedUnanswered, "ha", "han")} abierto y no ${one(openedUnanswered, "contesta", "contestan")}`, detail: "Saben de vuestra boda: un mensaje corto suele bastar.", href: list("abierta_sin_responder") });
  // Vencidas antes que los agradecimientos: tienen fecha y ya se pasó.
  if (tasks && tasks.overdue > 0) actions.push({ key: "tasks-overdue", icon: AlarmClockIcon, count: tasks.overdue, tone: "clay", title: one(tasks.overdue, "tarea vencida", "tareas vencidas"), detail: "Se os pasó la fecha: hacedlas o movedlas a otro día.", href: "/panel/tareas" });
  if (menuMissing && menuMissing > 0) actions.push({ key: "menu", icon: ChefHatIcon, count: menuMissing, tone: "clay", title: one(menuMissing, "persona sin menú", "personas sin menú"), detail: "Vienen y aún no han elegido menú: el catering necesitará el número.", href: "/panel/dia" });
  if (toThank > 0) actions.push({ key: "thank", icon: GiftIcon, count: toThank, title: `${one(toThank, "Regalo", "Regalos")} por agradecer`, detail: "El mensaje de gracias está preparado; marcadlo al enviarlo.", href: list("sin_agradecer") });
  if (tasks && tasks.thisWeek > 0) actions.push({ key: "tasks-week", icon: ListChecksIcon, count: tasks.thisWeek, tone: "ink", title: one(tasks.thisWeek, "tarea para esta semana", "tareas para esta semana"), detail: "Lo que vence en los próximos 7 días, en vuestra lista.", href: "/panel/tareas" });
  if (unseated && unseated > 0) actions.push({ key: "seating", icon: ArmchairIcon, count: unseated, tone: "ink", title: `${one(unseated, "persona que viene", "personas que vienen")} sin mesa`, detail: "Os proponemos un reparto por etiquetas y grupos: lo revisáis antes de aplicar nada.", href: "/panel/mesas?propuesta=1" });
  const notes = counts?.con_notas ?? 0;
  if (notes > 0) actions.push({ key: "notes", icon: UtensilsIcon, count: notes, tone: "ink", title: `Con alergias o notas`, detail: "Lo que os han contado al confirmar, listo para el catering.", href: list("con_notas") });
  const noPhone = counts?.sin_telefono ?? 0;
  if (noPhone > 0) actions.push({ key: "phone", icon: PhoneOffIcon, count: noPhone, tone: "ink", title: `Sin teléfono`, detail: "Añadidlo para enviarles la invitación por WhatsApp en un toque.", href: list("sin_telefono") });
  if (agendaCount === 0) actions.push({ key: "agenda", icon: CalendarClockIcon, count: 0, tone: "ink", title: "Añadid el programa del día", detail: "Ceremonia, cóctel, autobuses: vuestros invitados lo verán en la web.", href: "/panel/dia" });
  return actions;
}

export const STARTER_LINE = "Empezad por añadir a vuestra gente";

/** Sin invitados, la primera tarea en una línea que enlaza a añadirlos. */
function StarterLine() {
  return <p className="pn-week"><Link href="/panel/invitados?nuevo=1" className="pn-link pn-week-start">{STARTER_LINE}</Link></p>;
}

/**
 * `progress`: los «Primeros pasos» (first-steps.tsx) mientras falte alguno. Sin
 * invitados sustituyen a la línea de arranque: su paso «Añadid a vuestros
 * primeros invitados» es la única llamada a añadir de esta zona.
 */
export function NextActions({ actions, hasGuests = true, progress }: { actions: Action[]; hasGuests?: boolean; progress?: React.ReactNode }) {
  return (
    <section className="pn-todo" aria-labelledby="todo-title">
      <p className="pn-eyebrow">Lo que toca hoy</p>
      <h2 id="todo-title" className="pn-display pn-h2">{actions.length > 0 || !hasGuests || progress ? <>Vuestros <em>siguientes pasos</em></> : <>Todo <em>al día.</em></>}</h2>
      {progress ?? (!hasGuests && <StarterLine />)}
      {actions.length === 0 ? (
        hasGuests && !progress && <p className="pn-quiet-empty pn-muted"><SparklesIcon aria-hidden="true" className="size-5" />No hay nada pendiente ahora mismo. Os avisaremos aquí en cuanto alguien responda.</p>
      ) : (
        <ul className="pn-todo-list">
          {actions.map(({ key, icon: Icon, count, title, detail, href, tone = "clay" }) => (
            <li key={key}>
              <Link href={href} className="pn-todo-item pn-press" data-tone={tone}>
                <span className="pn-todo-icon" aria-hidden="true"><Icon className="size-5" /></span>
                <span className="pn-todo-text">
                  <span className="pn-todo-title">{count > 0 && <strong className="pn-tnum">{formatCount(count)} </strong>}{title}</span>
                  <span className="pn-todo-detail">{detail}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="pn-todo-go size-5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
