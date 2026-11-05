import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronRightIcon, GiftIcon, HeartHandshakeIcon } from "lucide-react";
import { IconTile } from "@/components/panel/page-head";
import { FUNNEL_STAGE_LABELS, GIFT_KINDS, GIFT_KIND_LABELS, type CrmFunnelSummary, type CrmGiftSummary, type FunnelStage, type PendingBucket } from "@/lib/crm/contract";
import { AnimatedNumber } from "@/components/panel/animated-number";
import { filterUrl } from "@/components/panel/guest-filters";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GiftKindIcon } from "@/components/panel/gift-kind-icon";
import { PENDING_BUCKET_FILTER, funnelSteps, isMonetaryKind } from "@/components/panel/gifts";
import { formatEuros } from "@/lib/format/money";

/*
 * Resumen del CRM en /panel (server-safe): el embudo de las invitaciones
 * (sustituye a los tres pasos de PanelStats cuando hay datos), los grupos sin
 * respuesta con su filtro de la lista y el libro de regalos. Las cifras son
 * las de `getCrmFunnel` / `getGiftSummary`: aquí no se infiere nada.
 */

const one = (count: number, singular: string, many: string) => (count === 1 ? singular : many);

/** Base de cada conversión: «80 % de las preparadas». */
const CONVERSION_BASE: Record<Exclude<FunnelStage, "added">, string> = {
  prepared: "de los añadidos",
  sent: "de las preparadas",
  opened: "de las enviadas",
  responded: "de las abiertas",
};

const href = (listHref: string, filter: Parameters<typeof filterUrl>[1]["filter"]) => filterUrl(listHref, { filter, page: 1 }, { query: "", filter: "todos", page: 1 });

/**
 * Embudo vertical: cada paso con su cifra, la barra respecto a «Añadidos» y
 * la conversión sobre el paso anterior. «Respondida» parte su barra en sí
 * (oliva) y no (línea fuerte), los mismos tonos que la barra de asistencia.
 */
export function FunnelSteps({ funnel }: { funnel: CrmFunnelSummary }) {
  const steps = funnelSteps(funnel);
  const answered = funnel.responses.yes + funnel.responses.no;
  const yesShare = answered > 0 ? funnel.responses.yes / answered : 0;
  return (
    <ol className="pn-funnel" aria-label="Recorrido de vuestras invitaciones">
      {steps.map((step) => (
        <li key={step.stage} data-stage={step.stage}>
          <div className="pn-funnel-line">
            <span className="pn-funnel-label">{FUNNEL_STAGE_LABELS[step.stage]}</span>
            {step.conversion !== null && step.stage !== "added" && (
              <span className="pn-funnel-conv pn-tnum">{step.conversion} %<span className="pn-wide-only"> {CONVERSION_BASE[step.stage]}</span></span>
            )}
            <AnimatedNumber className="pn-funnel-num" value={step.value} />
          </div>
          <span className="pn-funnel-track" aria-hidden="true">
            {step.stage === "responded" ? (
              <>
                <span data-tone="done" style={{ transform: `scaleX(${(step.share * yesShare).toFixed(4)})` }} />
                <span data-tone="declined" style={{ transform: `translateX(${(step.share * yesShare * 100).toFixed(3)}%) scaleX(${(step.share * (1 - yesShare)).toFixed(4)})` }} />
              </>
            ) : (
              <span style={{ transform: `scaleX(${step.share.toFixed(4)})` }} />
            )}
          </span>
          {step.stage === "responded" && answered > 0 && (
            <span className="pn-funnel-split pn-tnum">
              <span><span className="pn-swatch-key" data-tone="done" aria-hidden="true" />{formatCount(funnel.responses.yes)} {one(funnel.responses.yes, "viene", "vienen")}</span>
              <span><span className="pn-swatch-key" data-tone="declined" aria-hidden="true" />{formatCount(funnel.responses.no)} no {one(funnel.responses.no, "viene", "vienen")}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const BUCKETS: Array<{ key: PendingBucket; label: (n: number) => string; hint: string }> = [
  { key: "not_sent", label: (n) => `${one(n, "invitación", "invitaciones")} sin enviar`, hint: "Preparad su enlace y mandadlo por WhatsApp." },
  { key: "sent_unopened", label: (n) => `${one(n, "enviada", "enviadas")} sin abrir`, hint: "Aún no han abierto su enlace personal." },
  { key: "opened_unanswered", label: (n) => `${one(n, "abierta", "abiertas")} sin responder`, hint: "Han visto la invitación y no han dicho si vienen." },
];

/** Quien no ha respondido, separado por la señal que tenemos. Cada grupo abre la lista filtrada. */
export function PendingBuckets({ pending, listHref = "/panel/invitados" }: { pending: CrmFunnelSummary["pending"]; listHref?: string }) {
  const total = pending.not_sent + pending.sent_unopened + pending.opened_unanswered;
  if (total === 0) return null;
  return (
    <div className="pn-pending">
      <p className="pn-pending-title"><span className="pn-tnum">{plural(total, "persona", "personas")}</span> sin responder</p>
      <ul className="pn-list">
        {BUCKETS.map(({ key, label, hint }) => (
          <li key={key}>
            <Link href={href(listHref, PENDING_BUCKET_FILTER[key])} className="pn-pending-row pn-press" aria-disabled={pending[key] === 0 ? "true" : undefined}>
              <span className="pn-pending-num pn-tnum">{formatCount(pending[key])}</span>
              <span className="min-w-0">
                <span className="pn-name">{label(pending[key])}</span>
                <span className="pn-sub">{hint}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Libro de regalos: total anotado (no cobrado), cuántos, por tipo y por
 * agradecer. Mismo contenedor que el de invitados; la cifra en tinta, no en
 * oro, para no competir con «personas asistirán».
 */
/**
 * Con la lista vacía la tarjeta de regalos no se enseña (decisión del dueño,
 * 18-oct-2026): aparece con el primer invitado. Sí se enseña si algo falló al
 * leer (para decirlo) o si ya hay regalos anotados.
 */
export function showGiftSummary({ guests, guestsError, summary }: { guests: number; guestsError: boolean; summary: CrmGiftSummary | null }): boolean {
  return guests > 0 || guestsError || !summary || summary.count > 0;
}

/**
 * `exportSlot`: el botón «Descargar regalos y agradecimientos (CSV)» (solo el
 * panel real lo pasa; el borrador no). Se muestra cuando hay regalos.
 */
export function GiftSummaryCard({ summary, listHref = "/panel/invitados", error = false, exportSlot }: { summary: CrmGiftSummary | null; listHref?: string; error?: boolean; exportSlot?: ReactNode }) {
  const head = (
    <div className="pn-ledger-head">
      <h2 id="ledger-gifts" className="pn-display pn-h2">Regalos <em>anotados</em></h2>
      {summary && summary.count > 0 && <Link href={href(listHref, "con_regalo")} className="pn-link pn-press">Ver quién<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>}
    </div>
  );
  if (!summary) {
    return (
      <section id="regalos" className="pn-ledger" aria-labelledby="ledger-gifts">
        {head}
        <p className={error ? "pn-note pn-note--warn" : "pn-help"} role={error ? "alert" : undefined}>No hemos podido cargar los regalos. Actualizad la página para volver a intentarlo.</p>
      </section>
    );
  }
  if (summary.count === 0) {
    return (
      <section id="regalos" className="pn-ledger" aria-labelledby="ledger-gifts">
        {head}
        <div className="pn-ledger-empty pn-quiet-empty">
          <IconTile icon={GiftIcon} />
          <div className="grid justify-items-start gap-3">
            <p className="pn-text text-sm leading-relaxed">Cuando alguien os haga un regalo, anotadlo desde su ficha en la lista: qué es, cuánto si queréis, y si ya le habéis dado las gracias. Así nadie se queda sin su «gracias». Solo lo veis vosotros.</p>
            <Link href={listHref} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">Ir a la lista</Link>
          </div>
        </div>
      </section>
    );
  }
  const kinds = GIFT_KINDS.filter((kind) => summary.byKind[kind]?.count > 0);
  return (
    <section id="regalos" className="pn-ledger" aria-labelledby="ledger-gifts">
      {head}
      <div className="pn-ledger-hero">
        <p className="pn-num pn-num-lg pn-gift-total">{formatEuros(summary.totalCents)}</p>
        <p className="pn-ledger-caption">
          anotado por vosotros
          <span className="pn-muted"> · {plural(summary.count, "regalo", "regalos")}{summary.withAmount < summary.count ? `, ${formatCount(summary.withAmount)} con importe` : ""}</span>
        </p>
      </div>
      <ul className="pn-gift-kinds">
        {kinds.map((kind) => (
          <li key={kind}>
            <GiftKindIcon kind={kind} />
            <span className="pn-gift-kinds-label">{GIFT_KIND_LABELS[kind]}</span>
            <span className="pn-tnum pn-muted">{formatCount(summary.byKind[kind].count)}</span>
            <span className="pn-gift-kinds-sum pn-tnum">{isMonetaryKind(kind) && summary.byKind[kind].totalCents > 0 ? formatEuros(summary.byKind[kind].totalCents) : ""}</span>
          </li>
        ))}
      </ul>
      {summary.unthanked > 0 ? (
        <Link href={href(listHref, "sin_agradecer")} className="pn-thanks-cta pn-press">
          <HeartHandshakeIcon aria-hidden="true" className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="pn-name"><span className="pn-tnum">{formatCount(summary.unthanked)}</span> por agradecer</span>
            <span className="pn-sub">{one(summary.unthanked, "Un regalo que aún no habéis agradecido.", "Regalos que aún no habéis agradecido.")} Podéis hacerlo por WhatsApp desde su ficha.</span>
          </span>
          <ChevronRightIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
        </Link>
      ) : (
        <p className="pn-note pn-note--ok">Todos los regalos anotados están agradecidos.</p>
      )}
      <p className="pn-help">
        {plural(summary.guests.yes, "persona con regalo", "personas con regalo")} · {formatCount(summary.guests.no)} sin regalo · {formatCount(summary.guests.unknown)} sin indicar.
        {" "}Son vuestras anotaciones: Vinklo no gestiona ni cobra estos regalos, y nadie más los ve.
      </p>
      {exportSlot && <div className="flex flex-wrap gap-2">{exportSlot}</div>}
    </section>
  );
}
