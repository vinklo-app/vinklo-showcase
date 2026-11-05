import Link from "next/link";
import { ArrowRightIcon, ListPlusIcon } from "lucide-react";
import { FUNNEL_STAGE_LABELS, type CrmFunnelSummary, type FunnelStage } from "@/lib/crm/contract";
import { AnimatedNumber } from "@/components/panel/animated-number";
import { filterUrl } from "@/components/panel/guest-filters";
import { formatCount } from "@/components/panel/guest-status";
import { funnelSteps } from "@/components/panel/gifts";

/*
 * Capítulo en tinta del resumen: el embudo de la landing (`.ll-funnel`) con
 * los datos reales de `crm_funnel_summary`. Barras a su valor final desde el
 * primer pintado (sin el barrido de la landing: el resumen se abre a diario);
 * solo se deslizan cuando una cifra cambia al actualizar. Las cifras no se
 * infieren: `reached` es acumulado (enviada incluye abiertas y respondidas).
 */

/** Qué parte de la lista abre cada etapa del embudo (2026-10-06: embudo clicable). */
const STAGE_FILTER = {
  added: "todos",
  prepared: "sin_enviar",
  sent: "esperando",
  opened: "abierta_sin_responder",
  responded: "vienen",
} as const satisfies Record<FunnelStage, Parameters<typeof filterUrl>[1]["filter"]>;

const one = (count: number, singular: string, many: string) => (count === 1 ? singular : many);
const href = (filter: Parameters<typeof filterUrl>[1]["filter"], listHref: string) => filterUrl(listHref, { filter, page: 1 }, { query: "", filter: "todos", page: 1 });

export function PanelHero({ funnel, listHref = "/panel/invitados" }: { funnel: CrmFunnelSummary; listHref?: string }) {
  const added = funnel.reached.added;
  if (added === 0) {
    return (
      <section className="pn-hero" aria-labelledby="hero-title">
        <p className="pn-eyebrow">Vuestra lista</p>
        <h2 id="hero-title" className="pn-display pn-hero-title">Empezad por quién <em>queréis que venga.</em></h2>
        <p className="pn-hero-lead">Añadid a vuestros invitados uno a uno o pegad la lista entera. Desde aquí veréis a quién le ha llegado la invitación, quién la ha abierto y quién ha respondido.</p>
        <div className="pn-hero-actions">
          {/* «Añadir invitados» vive en «Primeros pasos» y en el botón flotante (decisión del dueño, 17-oct). */}
          <Link href={`${listHref}${listHref.includes("?") ? "&" : "?"}nuevo=varios`} className="pn-hero-link pn-press"><ListPlusIcon aria-hidden="true" className="size-4" />Pegar la lista entera</Link>
        </div>
      </section>
    );
  }
  const steps = funnelSteps(funnel);
  const pending = funnel.pending.not_sent + funnel.pending.sent_unopened + funnel.pending.opened_unanswered;
  const answered = funnel.responses.yes + funnel.responses.no;
  return (
    <section className="pn-hero" aria-labelledby="hero-title">
      <div className="pn-hero-head">
        <div>
          <p className="pn-eyebrow">El recorrido de vuestras invitaciones</p>
          <h2 id="hero-title" className="pn-display pn-hero-title">Vuestra boda, <em>hoy.</em></h2>
        </div>
        <Link href={listHref} className="pn-hero-link pn-press">Ver la lista<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
      </div>
      <ol className="pn-hero-funnel" aria-label="Recorrido de vuestras invitaciones">
        {steps.map((step) => (
          <li key={step.stage}>
            <Link href={href(STAGE_FILTER[step.stage], listHref)} className="pn-hero-step pn-press" aria-label={`${FUNNEL_STAGE_LABELS[step.stage]}: ${step.value}. Ver en la lista`}>
            <span className="pn-hero-label">
              {FUNNEL_STAGE_LABELS[step.stage]}
              {step.stage === "responded" && answered > 0 && (
                <span className="pn-hero-split pn-tnum"> · {formatCount(funnel.responses.yes)} {one(funnel.responses.yes, "viene", "vienen")}, {formatCount(funnel.responses.no)} no</span>
              )}
            </span>
            <AnimatedNumber className="pn-hero-value" value={step.value} />
            <span className="pn-hero-bar" aria-hidden="true"><span style={{ transform: `scaleX(${step.share.toFixed(4)})` }} /></span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="pn-hero-foot">
        {pending > 0 ? (
          <>
            <strong className="pn-tnum">{formatCount(pending)}</strong> por responder
            {funnel.pending.opened_unanswered > 0 && (
              <> · <Link href={href("abierta_sin_responder", listHref)} className="pn-hero-inline"><strong className="pn-tnum">{formatCount(funnel.pending.opened_unanswered)}</strong> la {one(funnel.pending.opened_unanswered, "abrió y no contestó", "abrieron y no contestaron")}</Link></>
            )}
          </>
        ) : (
          <>Todas las personas de vuestra lista han respondido.</>
        )}
      </p>
    </section>
  );
}
