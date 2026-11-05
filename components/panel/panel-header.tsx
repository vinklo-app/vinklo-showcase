import Link from "next/link";
import { CopyLinkButton } from "@/components/panel/copy-link-button";
import { formatCount } from "@/components/panel/guest-status";

/**
 * Cabecera del panel (server-safe): rótulo con la fecha y la cuenta atrás,
 * nombres en display grande con la «y» en cursiva arcilla (el énfasis de la
 * landing) y el enlace general de la web.
 */
export function formatWeddingDateLong(date: string | null): string {
  if (!date) return "Fecha por definir";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(new Date(`${date}T12:00:00`));
}

export function PanelHeader({ partnerName1, partnerName2, weddingDate, slug, guestUrl, children }: {
  partnerName1: string; partnerName2: string; weddingDate: string | null; slug: string; guestUrl: string; children?: React.ReactNode;
}) {
  const days = daysUntil(weddingDate);
  return (
    <header className="pn-head pn-head--hero">
      <p className="pn-eyebrow">
        {formatWeddingDateLong(weddingDate)}
        {days !== null && days > 0 && <span className="pn-tnum"> · {days === 1 ? "mañana es el día" : `faltan ${formatCount(days)} días`}</span>}
        {days === 0 && <span> · hoy es el día</span>}
      </p>
      <h1 className="pn-display pn-h1 pn-h1--names">
        {partnerName1} <em>y</em> {partnerName2}
      </h1>
      <div className="pn-head-links">
        <Link href={`/b/${slug}`} className="pn-link pn-press">Ver vuestra web</Link>
        <span className="pn-muted pn-head-slug font-mono text-xs">/b/{slug}</span>
        <CopyLinkButton url={guestUrl} />
        {children}
      </div>
    </header>
  );
}

/** Días naturales hasta la boda (fecha civil, mediodía local para no saltar por husos). null sin fecha. */
export function daysUntil(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const target = new Date(`${date}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
