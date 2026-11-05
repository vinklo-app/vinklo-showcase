import Link from "next/link";
import { ArrowRightIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import type { AttendanceSummary } from "@/lib/data/attendance";
import { AnimatedNumber } from "@/components/panel/animated-number";
import { formatCount } from "@/components/panel/guest-status";
import type { CrmFunnelSummary } from "@/lib/crm/contract";
import { FunnelSteps, PendingBuckets } from "@/components/panel/crm-summary";

/*
 * Resumen de /panel (server-safe). Dos «libros» con la misma gramática:
 * cifra grande + barra de proporción + leyenda con recuento. Métricas tal y
 * como las devuelven `attendance_summary` y `wedding_vendor_summary`: nada se
 * infiere ni se inventa. Los colores repiten los estados de las listas:
 * oliva = sí (confirmado / contratado), tinta = en curso, rayado = por hacer.
 */

export type BarTone = "done" | "declined" | "talking" | "contacted" | "todo";
export interface BarSegment { key: string; value: number; tone: BarTone; label: string }

/**
 * Barra de proporción. Cada tramo es una capa a todo el ancho movida con
 * translateX y escalada con scaleX desde la izquierda: solo transform, así
 * que al cambiar un dato (o al entrar la página) se anima en el compositor.
 * Sin datos, la pista vacía (rayada) dice «aún no hay nada».
 */
export function ProportionBar({ segments, total, label }: { segments: BarSegment[]; total: number; label: string }) {
  let offset = 0;
  return (
    <div className="pn-bar" role="img" aria-label={label}>
      {total > 0 && segments.map((segment) => {
        const start = offset;
        const fraction = segment.value / total;
        offset += fraction;
        if (segment.value === 0) return null;
        return (
          <span
            key={segment.key}
            className="pn-bar-seg"
            data-tone={segment.tone}
            style={{ transform: `translateX(${(start * 100).toFixed(3)}%) scaleX(${fraction.toFixed(4)})` }}
          />
        );
      })}
    </div>
  );
}

/** Leyenda: muestra de color + recuento + etiqueta. Los ceros también se dicen. */
export function BarLegend({ segments }: { segments: BarSegment[] }) {
  return (
    <ul className="pn-legend">
      {segments.map((segment) => (
        <li key={segment.key}>
          <span className="pn-swatch-key" data-tone={segment.tone} aria-hidden="true" />
          <AnimatedNumber className="pn-legend-num" value={segment.value} />
          <span className="pn-legend-label">{segment.label}</span>
        </li>
      ))}
    </ul>
  );
}

const one = (count: number, singular: string, many: string) => (count === 1 ? singular : many);

/**
 * Libro de invitados: asistentes, proporción de respuestas y del envío. Con
 * `funnel` (getCrmFunnel), los tres pasos se convierten en el embudo completo
 * (añadidos → respondida, con «abierta») y debajo van los grupos sin
 * respuesta; sin él (lectura fallida o sin migración), los tres pasos de siempre.
 */
export function PanelStats({ stats, guestCountEst, listHref = "/panel/invitados", title = "Invitados", aside, funnel, showFunnel = true }: {
  stats: AttendanceSummary; guestCountEst: number | null; listHref?: string; title?: React.ReactNode; aside?: React.ReactNode;
  funnel?: CrmFunnelSummary | null;
  /** false: el embudo ya va en el capítulo en tinta (PanelHero); aquí solo los grupos sin respuesta. */
  showFunnel?: boolean;
}) {
  const answered = stats.confirmed + stats.declined;
  const segments: BarSegment[] = [
    { key: "confirmed", value: stats.confirmed, tone: "done", label: one(stats.confirmed, "ha confirmado", "han confirmado") },
    { key: "declined", value: stats.declined, tone: "declined", label: one(stats.declined, "no vendrá", "no vendrán") },
    { key: "pending", value: stats.pending, tone: "todo", label: one(stats.pending, "sin responder", "sin responder") },
  ];
  const steps: Array<[string, number]> = [
    [one(stats.prepared, "invitación preparada", "invitaciones preparadas"), stats.prepared],
    [one(stats.sent, "envío confirmado", "envíos confirmados"), stats.sent],
    [one(answered, "respuesta", "respuestas"), answered],
  ];
  return (
    <section className="pn-ledger" aria-labelledby="ledger-guests">
      <div className="pn-ledger-head">
        <h2 id="ledger-guests" className="pn-display pn-h2">{title}</h2>
        <Link href={listHref} className="pn-link pn-press">Ver la lista<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
      </div>
      {stats.total === 0 ? (
        <EmptyState icon={UsersIcon} titleAs="h3" title={<>Aquí veréis <em>quién viene.</em></>} body="Aún no hay nadie en vuestra lista. Añadid a vuestros invitados (también podéis pegar la lista entera) y las respuestas llegarán solas." />
      ) : (
        <>
          <div className="pn-ledger-hero">
            <p className="pn-num pn-num-xl" aria-describedby="attendees-desc"><AnimatedNumber value={stats.attendees} /></p>
            <p id="attendees-desc" className="pn-ledger-caption">
              {one(stats.attendees, "persona asistirá", "personas asistirán")}
              <span className="pn-muted"> · <AnimatedNumber className="pn-tnum" value={stats.confirmed} /> {one(stats.confirmed, "confirmado", "confirmados")} y <AnimatedNumber className="pn-tnum" value={stats.companions} /> {one(stats.companions, "acompañante", "acompañantes")}</span>
            </p>
          </div>
          <ProportionBar segments={segments} total={stats.total} label={`De ${formatCount(stats.total)} en la lista: ${formatCount(stats.confirmed)} han confirmado, ${formatCount(stats.declined)} no vendrán y ${formatCount(stats.pending)} sin responder.`} />
          <BarLegend segments={segments} />
          {funnel ? (
            <>
              {showFunnel && <FunnelSteps funnel={funnel} />}
              <PendingBuckets pending={funnel.pending} listHref={listHref} />
            </>
          ) : (
            <ol className="pn-flow" aria-label="Vuestras invitaciones">
              {steps.map(([label, value]) => (
                <li key={label}>
                  <span className="pn-flow-num"><AnimatedNumber value={value} /></span>
                  <span className="pn-flow-label">{label}</span>
                  <span className="pn-flow-track" aria-hidden="true"><span style={{ transform: `scaleX(${stats.total ? Math.min(1, value / stats.total).toFixed(4) : 0})` }} /></span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="pn-help">
        {stats.total > 0 && <>De {formatCount(stats.total)} {one(stats.total, "persona", "personas")} en la lista. </>}
        WhatsApp no nos confirma la entrega: los envíos los marcáis vosotros.{funnel && stats.total > 0 ? " «Abierta» es la primera vez que esa persona abre su enlace personal." : ""}{guestCountEst ? ` Previsión inicial: ${formatCount(guestCountEst)}.` : ""}
      </p>
      {aside}
    </section>
  );
}
