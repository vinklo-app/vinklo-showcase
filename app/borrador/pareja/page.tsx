import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHead } from "@/components/panel/page-head";
import { PartnerCard } from "@/components/panel/partner-card";
import { PartnerInviteNotice } from "@/components/panel/partner-invite-notice";
import { JoinView } from "@/components/panel/join-view";
import type { PartnerState } from "@/lib/actions/partner";
import { acceptErrorMessage, type AcceptCode } from "@/lib/partner/join";
import "@/components/panel/panel.css";

export const metadata: Metadata = { title: "Borrador · pareja", robots: { index: false, follow: false } };

/**
 * Preview de la segunda cuenta de pareja — SOLO en desarrollo (404 en
 * producción). Datos de muestra; los botones llaman a las acciones reales
 * (sin sesión responden «Volved a entrar»).
 *   ?estado=sin|pendiente|caducada|aceptada|pareja|peor|error
 *   ?unirse=sin-sesion|con-sesion|sin-enlace|<código de error> (expired, email_mismatch, has_wedding, full, used)
 *   ?aviso=1  aviso de invitación pendiente de /onboarding
 */
const day = (offset: number) => new Date(Date.now() + offset * 24 * 3600 * 1000).toISOString();
const ana = { email: "ana@ejemplo.es", role: "owner" as const, isMe: true, since: day(-40) };

const STATES: Record<string, PartnerState> = {
  sin: { ok: true, available: true, role: "owner", myEmail: ana.email, members: [ana], invite: null },
  pendiente: { ok: true, available: true, role: "owner", myEmail: ana.email, members: [ana], invite: { email: "luis@ejemplo.es", sentAt: day(-1), expiresAt: day(6), expired: false } },
  caducada: { ok: true, available: true, role: "owner", myEmail: ana.email, members: [ana], invite: { email: "luis@ejemplo.es", sentAt: day(-9), expiresAt: day(-2), expired: true } },
  aceptada: { ok: true, available: true, role: "owner", myEmail: ana.email, members: [ana, { email: "luis@ejemplo.es", role: "partner", isMe: false, since: day(-1) }], invite: null },
  pareja: { ok: true, available: true, role: "partner", myEmail: "luis@ejemplo.es", members: [{ ...ana, isMe: false }, { email: "luis@ejemplo.es", role: "partner", isMe: true, since: day(-1) }], invite: null },
  peor: { ok: true, available: true, role: "owner", myEmail: ana.email, members: [ana], invite: { email: "maria.de.los.angeles.fernandez-villaverde.y.gutierrez-solana@un-dominio-muy-largo-de-empresa.example.com", sentAt: day(-1), expiresAt: day(6), expired: false } },
  error: { ok: false, error: "No hemos podido cargar vuestra pareja. Recargad la página." },
};

const TOKEN = "A".repeat(43);

export default async function BorradorParejaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const unirse = typeof params.unirse === "string" ? params.unirse : null;

  if (unirse) {
    if (unirse === "sin-sesion") return <JoinView token={TOKEN} email={undefined} />;
    if (unirse === "sin-enlace") return <JoinView token={null} email="luis@ejemplo.es" />;
    if (unirse === "con-sesion") return <JoinView token={TOKEN} email="luis@ejemplo.es" />;
    const code = unirse as AcceptCode;
    return <JoinView token={TOKEN} email="luis@ejemplo.es" initial={{ code, error: acceptErrorMessage(code) }} />;
  }

  const key = typeof params.estado === "string" && params.estado in STATES ? params.estado : "sin";
  return (
    <>
      {params.aviso === "1" ? <PartnerInviteNotice /> : null}
      <main className="pn-wrap pn-page pn-page--tight pn-narrow">
        <PageHead eyebrow="Vuestra web" title={<>Vuestra web <em>de boda</em></>} lead="Borrador: sección «Vuestra pareja» de Ajustes con datos de muestra." />
        <div className="mt-8"><PartnerCard state={STATES[key]!} /></div>
      </main>
    </>
  );
}
