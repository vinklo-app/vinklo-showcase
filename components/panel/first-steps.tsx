import Link from "next/link";
import { CheckIcon, GlobeIcon, InboxIcon, SendIcon, UserPlusIcon, type LucideIcon } from "lucide-react";
import { IconTile } from "@/components/panel/page-head";
import type { SiteVisibility } from "@/components/panel/site-visibility";

/**
 * «Primeros pasos» del panel (revisión UX, ítem 8): sustituye a «Revisad los
 * datos de vuestra web», que la pareja acaba de hacer en el creador. Sale de
 * datos que ya existen (sin migración): qué ven hoy los invitados
 * (`siteVisibility`, la misma lectura que Ajustes y el editor), el resumen de
 * asistencia (`total`, `sent`, confirmados + no vienen). Cada paso
 * lleva a la pantalla que lo resuelve; el primero sin hacer es la llamada a la
 * acción. Server-safe y puro (lo prueba next-actions/first-steps.test).
 */

export interface FirstStep {
  key: "web" | "guests" | "send" | "reply";
  icon: LucideIcon;
  done: boolean;
  title: string;
  detail: string;
  href: string;
  /** Abre en otra pestaña (la web pública: no se sale del panel). */
  external?: boolean;
}

/** Enlace del alta de invitados (abre el formulario): la única llamada a añadir de esta zona. */
export const ADD_GUESTS_HREF = "/panel/invitados?nuevo=1";

/** El paso de la web según lo que ven hoy los invitados (site-visibility.ts). */
function webStep(visibility: SiteVisibility, slug: string): FirstStep {
  if (visibility === "published") return { key: "web", icon: GlobeIcon, done: true, title: "Vuestra web está publicada", detail: "Quien tenga el enlace ya puede verla.", href: `/b/${slug}`, external: true };
  if (visibility === "withdrawn") return { key: "web", icon: GlobeIcon, done: false, title: "Volved a publicar vuestra web", detail: "Está retirada: el enlace no se abre. En Ajustes, «Volver a publicar».", href: "/panel/ajustes" };
  // «live»: el enlace ya abre la web con los datos guardados; la foto, los colores y los cambios esperan a publicar.
  return { key: "web", icon: GlobeIcon, done: false, title: "Publicad vuestra web", detail: "Ya se ve con vuestros datos; la foto y los colores saldrán al publicar en Ajustes.", href: "/panel/ajustes" };
}

export function buildFirstSteps({ visibility, guests, sent, replies, slug }: {
  /** null = no se pudo leer el estado de la web: el paso no se enseña (no se adivina). */
  visibility: SiteVisibility | null;
  guests: number;
  /** Invitaciones marcadas como enviadas (WhatsApp no acredita la entrega). */
  sent: number;
  /** Respuestas: confirmados más los que no vienen. */
  replies: number;
  slug: string;
}): FirstStep[] {
  const steps: FirstStep[] = [];
  if (visibility !== null) steps.push(webStep(visibility, slug));
  steps.push(guests > 0
    ? { key: "guests", icon: UserPlusIcon, done: true, title: "Primeros invitados añadidos", detail: "Podéis seguir añadiendo desde Invitados.", href: "/panel/invitados" }
    : { key: "guests", icon: UserPlusIcon, done: false, title: "Añadid a vuestros primeros invitados", detail: "De uno en uno o pegando una lista.", href: ADD_GUESTS_HREF });
  steps.push(sent > 0
    ? { key: "send", icon: SendIcon, done: true, title: "Primera invitación enviada", detail: "Las que faltan, en Mensajes.", href: "/panel/invitados/mensajes" }
    : { key: "send", icon: SendIcon, done: false, title: "Enviad la primera invitación", detail: "El mensaje de WhatsApp sale con su nombre y su enlace personal.", href: "/panel/invitados/mensajes" });
  steps.push(replies > 0
    ? { key: "reply", icon: InboxIcon, done: true, title: "Primera respuesta recibida", detail: "Las respuestas, en Invitados.", href: "/panel/invitados" }
    : { key: "reply", icon: InboxIcon, done: false, title: "Primera respuesta", detail: "Cuando alguien responda desde su enlace, lo veréis en Invitados.", href: "/panel/invitados" });
  return steps;
}

/** Todo hecho: la lista ya no hace falta. */
export function firstStepsComplete(steps: FirstStep[]): boolean {
  return steps.every((step) => step.done);
}

export function FirstSteps({ steps }: { steps: FirstStep[] }) {
  const next = steps.find((step) => !step.done)?.key;
  const done = steps.filter((step) => step.done).length;
  return (
    <div className="pn-first-steps">
      <p className="pn-sub pn-tnum">{done} de {steps.length} hechos</p>
      <ol className="pn-steps pn-steps--icons mt-3" aria-label="Primeros pasos">
        {steps.map(({ key, icon, done: isDone, title, detail, href, external }) => (
          <li key={key} data-done={isDone ? "true" : undefined}>
            <Link href={href} className="pn-step pn-press" aria-current={key === next ? "step" : undefined} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              <IconTile icon={isDone ? CheckIcon : icon} tone={isDone || key !== next ? "ink" : "clay"} />
              <span className="pn-step-text">
                <span className="pn-step-title">{isDone && <span className="sr-only">Hecho: </span>}{title}</span>
                <span className="pn-sub">{detail}</span>
                {external && <span className="sr-only"> (se abre en otra pestaña)</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
