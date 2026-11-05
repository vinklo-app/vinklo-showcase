/**
 * Vista del resumen del admin (presentacional: sin Supabase ni server-only).
 * La usan /admin (datos reales) y /borrador/admin (fixtures, solo dev).
 * Modo «operar»: denso, cifras tabulares, filetes, un solo acento (arcilla).
 */
import Link from "next/link";

import { percentOf } from "@/lib/admin/overview";
import {
  SITE_STATE_LABELS,
  WAITLIST_KINDS,
  WAITLIST_KIND_LABELS,
  type AdminOverview,
  type AdminWeddingSummary,
  type DailyCount,
  type Metric,
  type SiteState,
} from "@/lib/admin/types";
import { SITE_PALETTES } from "@/lib/site-document";
import { fmtCivilDate, fmtDate, fmtDateTime, fmtEur, fmtInt, fmtPct } from "./format";

const PALETTE_LABEL = new Map(SITE_PALETTES.map((p) => [p.id as string, p.label]));
const PALETTE_SWATCH = new Map(SITE_PALETTES.map((p) => [p.id as string, p.accent]));

function Stat({ label, value, detail, emphasis = false }: { label: string; value: Metric; detail?: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="ad-stat">
      <dt className="ad-label">{label}</dt>
      <dd className={emphasis ? "ad-num ad-num--xl" : "ad-num"}>{fmtInt(value)}</dd>
      {detail ? <dd className="ad-detail">{detail}</dd> : null}
    </div>
  );
}

function Section({ id, folio, title, aside, children }: { id: string; folio: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="ad-section">
      <header className="ad-section-head">
        <p className="ad-folio" aria-hidden="true">
          {folio}
        </p>
        <h2 id={id} className="ad-h2">
          {title}
        </h2>
        {aside ? <div className="ad-section-aside">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Sparkline({ daily }: { daily: DailyCount[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const bar = 8;
  const gap = 2;
  const h = 48;
  const width = daily.length * (bar + gap) - gap;
  const total = daily.reduce((sum, d) => sum + d.count, 0);
  const first = daily[0]?.date;
  const last = daily.at(-1)?.date;
  return (
    <figure className="ad-spark">
      <svg
        viewBox={`0 0 ${width} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Altas diarias de los últimos ${daily.length} días: ${total} en total, máximo ${max === 1 && total === 0 ? 0 : max} en un día.`}
      >
        {daily.map((d, i) => {
          const bh = d.count === 0 ? 1 : Math.max(3, Math.round((d.count / max) * (h - 2)));
          return (
            <rect key={d.date} x={i * (bar + gap)} y={h - bh} width={bar} height={bh} className={i === daily.length - 1 ? "ad-spark-today" : d.count === 0 ? "ad-spark-zero" : "ad-spark-bar"}>
              <title>{`${fmtCivilDate(d.date)}: ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="ad-spark-axis">
        <span>{fmtCivilDate(first ?? null).slice(0, 5)}</span>
        <span>hoy</span>
      </figcaption>
      <span className="sr-only">{last ? `Último día: ${fmtCivilDate(last)}` : null}</span>
    </figure>
  );
}

function Bar({ value, max }: { value: Metric; max: Metric }) {
  const pct = value !== null && max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="ad-bar" aria-hidden="true">
      <span className="ad-bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
    </span>
  );
}

function StateBadge({ state }: { state: SiteState }) {
  return <span className={`ad-badge ad-badge--${state}`}>{SITE_STATE_LABELS[state]}</span>;
}

function Rsvp({ yes, no, pending }: { yes: Metric; no: Metric; pending: Metric }) {
  const total = (yes ?? 0) + (no ?? 0) + (pending ?? 0);
  const seg = (v: Metric) => (total > 0 && v ? `${(v / total) * 100}%` : "0%");
  return (
    <div className="ad-rsvp">
      <div className="ad-rsvp-bar" aria-hidden="true">
        <span className="ad-rsvp-yes" style={{ width: seg(yes) }} />
        <span className="ad-rsvp-no" style={{ width: seg(no) }} />
        <span className="ad-rsvp-pending" style={{ width: seg(pending) }} />
      </div>
      <dl className="ad-rsvp-legend">
        <div>
          <dt>
            <i className="ad-dot ad-dot--yes" aria-hidden="true" />
            Vienen
          </dt>
          <dd>{fmtInt(yes)}</dd>
        </div>
        <div>
          <dt>
            <i className="ad-dot ad-dot--no" aria-hidden="true" />
            No vienen
          </dt>
          <dd>{fmtInt(no)}</dd>
        </div>
        <div>
          <dt>
            <i className="ad-dot ad-dot--pending" aria-hidden="true" />
            Sin respuesta
          </dt>
          <dd>{fmtInt(pending)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function WeddingsTable({ rows, showWeddingDate = false }: { rows: AdminWeddingSummary[]; showWeddingDate?: boolean }) {
  return (
    <div className="ad-table-wrap">
      <table className="ad-table">
        <thead>
          <tr>
            <th scope="col">Web</th>
            <th scope="col">Pareja</th>
            {showWeddingDate ? <th scope="col">Boda</th> : null}
            <th scope="col">Creada</th>
            <th scope="col">Estado</th>
            <th scope="col">Paleta</th>
            <th scope="col">Foto</th>
            <th scope="col" className="ad-right">
              Invitados
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td className="ad-ellipsis">
                <Link href={`/b/${w.slug}`} className="ad-link ad-strong" prefetch={false}>
                  /b/{w.slug}
                </Link>
              </td>
              <td>
                <span className="ad-with-badge">
                  <span className="ad-ellipsis">{w.partnerNames}</span>
                  {w.isInternal ? <span className="ad-badge">Prueba</span> : null}
                </span>
              </td>
              {showWeddingDate ? <td className="ad-tnum">{fmtCivilDate(w.weddingDate)}</td> : null}
              <td className="ad-tnum ad-muted">{fmtDate(w.createdAt)}</td>
              <td>
                <StateBadge state={w.siteState} />
              </td>
              <td>{w.palette ? PALETTE_LABEL.get(w.palette) ?? w.palette : "—"}</td>
              <td>{w.hasPhoto ? "Sí" : "No"}</td>
              <td className="ad-right ad-num">{fmtInt(w.guestCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  "auth.users": "cuentas (Auth)",
  weddings: "bodas",
  wedding_sites: "webs (wedding_sites)",
  wedding_guests: "invitados",
  "wedding_guests.count": "invitados por boda (agregados de PostgREST desactivados)",
  "wedding_guests.invitation_prepared_at": "invitación preparada",
  "wedding_guests.invitation_sent_at": "invitación enviada",
  waitlist: "waitlist",
  "waitlist.interested_in_gifts": "interés en regalos",
};

export function OverviewView({ data }: { data: AdminOverview }) {
  const { users, weddings, guests, waitlist, funnel, latestWeddings, payments, unavailable } = data;
  const funnelTop = funnel[0]?.count ?? null;

  return (
    <div className="ad-root">
      <header className="ad-page-head">
        <div>
          <p className="ad-folio">Resumen</p>
          <h1 className="ad-h1">Cómo va vinklo</h1>
        </div>
        <p className="ad-meta">Datos a {fmtDateTime(data.generatedAt)} · sin caché</p>
      </header>

      {/* ---- Cifras de cabecera ---- */}
      <dl className="ad-kpis" aria-label="Indicadores principales">
        <Stat
          label="Cuentas"
          value={users?.total ?? null}
          emphasis
          detail={users ? `+${fmtInt(users.last7d)} en 7 días · ${fmtInt(users.internalTotal)} de prueba` : "Auth no disponible"}
        />
        <Stat label="Bodas creadas" value={weddings.total} emphasis detail={`${fmtInt(weddings.published)} con web publicada`} />
        <Stat label="Invitados" value={guests.total} emphasis detail={`${fmtInt(guests.sent)} con envío confirmado`} />
        <Stat label="Respuestas" value={guests.yes === null || guests.no === null ? null : guests.yes + guests.no} emphasis detail={`${fmtInt(guests.yes)} sí · ${fmtInt(guests.no)} no`} />
        <Stat label="Waitlist" value={waitlist.total} emphasis detail={`${fmtInt(waitlist.interestedInGifts)} interesados en regalos`} />
      </dl>

      <div className="ad-grid">
        {/* ---- Cuentas ---- */}
        <Section id="ad-cuentas" folio="Nº 01" title="Cuentas">
          {users ? (
            <>
              <dl className="ad-row-stats">
                <Stat label="24 h" value={users.last24h} />
                <Stat label="7 días" value={users.last7d} />
                <Stat label="30 días" value={users.last30d} />
              </dl>
              <Sparkline daily={users.daily} />
              {users.truncated ? <p className="ad-note">Más de 20.000 cuentas: las cifras son un mínimo.</p> : null}
              <h3 className="ad-h3">Últimos accesos</h3>
              {users.recentSignIns.length === 0 ? (
                <p className="ad-empty">Nadie ha entrado todavía.</p>
              ) : (
                <ol className="ad-list">
                  {users.recentSignIns.map((u) => (
                    <li key={u.email}>
                      <span className="ad-with-badge">
                        <span className="ad-ellipsis">{u.email}</span>
                        {u.isInternal ? <span className="ad-badge">Prueba</span> : null}
                      </span>
                      <span className="ad-muted ad-tnum">{fmtDateTime(u.lastSignInAt)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="ad-empty">No se han podido leer las cuentas de Supabase Auth.</p>
          )}
        </Section>

        {/* ---- Embudo ---- */}
        <Section id="ad-embudo" folio="Nº 02" title="Embudo">
          <ol className="ad-funnel">
            {funnel.map((step, i) => {
              const prev = i > 0 ? funnel[i - 1]!.count : null;
              return (
                <li key={step.key}>
                  <span className="ad-funnel-label">{step.label}</span>
                  <span className="ad-num ad-funnel-num">{fmtInt(step.count)}</span>
                  <Bar value={step.count} max={funnelTop} />
                  <span className="ad-muted ad-tnum ad-funnel-pct">{i === 0 ? "100 %" : fmtPct(percentOf(step.count, prev))}</span>
                </li>
              );
            })}
          </ol>
          <p className="ad-note">El porcentaje es sobre el paso anterior. «Invitado» y «respuesta» cuentan bodas distintas.</p>
        </Section>

        {/* ---- Bodas ---- */}
        <Section id="ad-bodas" folio="Nº 03" title="Bodas" aside={<Link href="/admin/bodas" className="ad-link">Ver todas</Link>}>
          <dl className="ad-row-stats">
            <Stat label="Creadas" value={weddings.total} />
            <Stat label="Publicadas" value={weddings.published} detail={fmtPct(percentOf(weddings.published, weddings.total))} />
            <Stat label="Con foto" value={weddings.withPhoto} detail={fmtPct(percentOf(weddings.withPhoto, weddings.total))} />
          </dl>
          <h3 className="ad-h3">Por paleta</h3>
          {weddings.palettes === null ? (
            <p className="ad-empty">No disponible.</p>
          ) : weddings.palettes.length === 0 ? (
            <p className="ad-empty">Aún no hay bodas.</p>
          ) : (
            <ul className="ad-palettes">
              {weddings.palettes.map((p) => (
                <li key={p.id}>
                  <i className="ad-swatch" style={{ background: PALETTE_SWATCH.get(p.id) ?? "var(--line-strong)" }} aria-hidden="true" />
                  <span>{p.label}</span>
                  <Bar value={p.count} max={weddings.total} />
                  <span className="ad-num">{fmtInt(p.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- Invitados ---- */}
        <Section id="ad-invitados" folio="Nº 04" title="Invitados">
          <dl className="ad-row-stats">
            <Stat label="Añadidos" value={guests.total} />
            <Stat label="Preparada" value={guests.prepared} />
            <Stat label="Enviada" value={guests.sent} />
          </dl>
          <Rsvp yes={guests.yes} no={guests.no} pending={guests.pending} />
          <p className="ad-note">«Preparada» = enlace personal creado; «Enviada» = la pareja confirmó el envío: WhatsApp no acredita entrega ni lectura. Solo totales; ningún dato personal de invitados.</p>
        </Section>
      </div>

      {/* ---- Waitlist ---- */}
      <Section id="ad-waitlist" folio="Nº 05" title="Waitlist" aside={<Link href="/admin/waitlist" className="ad-link">Ver y exportar</Link>}>
        <dl className="ad-row-stats ad-row-stats--wide">
          <Stat label="Total" value={waitlist.total} />
          {WAITLIST_KINDS.map((k) => (
            <Stat key={k} label={WAITLIST_KIND_LABELS[k]} value={waitlist.byKind[k]} />
          ))}
          <Stat label="Regalos" value={waitlist.interestedInGifts} />
        </dl>
        <h3 className="ad-h3">Últimas 20 altas</h3>
        {waitlist.latest.length === 0 ? (
          <p className="ad-empty">Aún no hay altas. Cuando alguien se apunte desde la landing, aparecerá aquí.</p>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Boda</th>
                  <th scope="col">Regalos</th>
                  <th scope="col" className="ad-right">
                    Alta
                  </th>
                </tr>
              </thead>
              <tbody>
                {waitlist.latest.map((row) => (
                  <tr key={row.id}>
                    <td className="ad-ellipsis ad-strong">{row.email}</td>
                    <td>{WAITLIST_KIND_LABELS[row.kind] ?? row.kind}</td>
                    <td className="ad-tnum">{fmtCivilDate(row.wedding_date)}</td>
                    <td>{row.interested_in_gifts === undefined ? "—" : row.interested_in_gifts ? "Sí" : "No"}</td>
                    <td className="ad-right ad-tnum ad-muted">{fmtDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- Últimas bodas ---- */}
      <Section id="ad-ultimas" folio="Nº 06" title="Últimas bodas" aside={<Link href="/admin/bodas" className="ad-link">Ver todas</Link>}>
        {latestWeddings.length === 0 ? (
          <p className="ad-empty">Aún no hay bodas creadas. Cuando una pareja complete el creador, aparecerá aquí.</p>
        ) : (
          <WeddingsTable rows={latestWeddings} />
        )}
      </Section>

      {/* ---- Histórico de pagos (solo si hubo aportaciones) ---- */}
      {payments ? (
        <details className="ad-section ad-history">
          <summary className="ad-h2">Histórico de pagos</summary>
          <p className="ad-note">Pagos desactivados en el producto actual. Cifras del modelo anterior, solo lectura.</p>
          <dl className="ad-row-stats">
            <Stat label="Aportaciones" value={payments.contributions} detail={`${fmtInt(payments.confirmed)} confirmadas`} />
            <div className="ad-stat">
              <dt className="ad-label">Volumen confirmado</dt>
              <dd className="ad-num">{fmtEur(payments.confirmedCents)}</dd>
            </div>
            <div className="ad-stat">
              <dt className="ad-label">Comisiones (tarjeta)</dt>
              <dd className="ad-num">{fmtEur(payments.cardFeesCents)}</dd>
            </div>
          </dl>
        </details>
      ) : null}

      {unavailable.length > 0 ? (
        <p className="ad-note ad-footnote">
          «—» = sin datos: no se ha podido leer {unavailable.map((s) => SOURCE_LABELS[s] ?? s).join(", ")}. Suele ser una migración pendiente en este entorno.
        </p>
      ) : null}
    </div>
  );
}
