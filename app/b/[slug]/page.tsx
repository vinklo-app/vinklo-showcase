import type { Metadata, Viewport } from "next";
import { RSVP_MVP } from "@/lib/product-scope";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { ContributionEnvelope } from "@/components/guest/contribution-envelope";
import { InvitationRenderer } from "@/components/invitation/renderer";
import { coupleInitials } from "@/components/invitation/format";
import { BRAND_NAME } from "@/lib/brand";
import { getPublicSiteResult } from "@/lib/data/site-public";
import { initialInvitePhase, inviteThemeColor } from "@/lib/invite-theme-color";
import { clientIp } from "@/lib/rate-limit";
import { findScene } from "@/lib/site-document";
import { trackGuestPageView } from "@/lib/track";
import { isInvitationToken, supabaseSessionCookies, trackInvitationOpened } from "@/lib/crm/track-open";
import { rsvpWindow } from "@/lib/rsvp-window";
import { getGuestRsvpCurrent, getWeddingPublic, getWeddingRsvpDates } from "./wedding-public";
import { GuestUnavailable } from "./guest-unavailable";
import { guestPageDescription } from "./guest-meta";
import { firstName } from "@/lib/messages/first-name";

/** Versión del dibujo de la tarjeta social (sobre de la boda, 13-oct-2026). */
const OG_CARD_VERSION = 2;

// La página del invitado siempre fresca (importe sugerido, Bizum, etc.).
export const dynamic = "force-dynamic";

/** Texto de metadata: espacios colapsados y longitud acotada (con elipsis). */
function metaText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

interface GuestPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invitacion?: string | string[] }>;
}

export async function generateMetadata({ params, searchParams }: GuestPageProps): Promise<Metadata> {
  const { slug } = await params;
  // Mismo documento que pinta la página (cache() dedupe en el request): el
  // título refleja lo publicado, no la fila editable.
  const result = await getPublicSiteResult(slug);
  // Fallo de lectura: no es «no encontrada» (y nada que indexar).
  if (result.status === "unavailable") return { title: "Invitación no disponible ahora mismo", robots: { index: false, follow: false } };
  const site = result.status === "ok" ? result.site : null;
  const cover = site ? findScene(site.document, "cover") : undefined;
  if (!site || !cover) {
    return { title: "Boda no encontrada" };
  }
  // El documento lo escribe la pareja: sin saltos de línea y recortado para
  // la pestaña y la tarjeta social (título ≤ 70, descripción ≤ 160).
  const partnerName1 = metaText(cover.props.partnerName1, 80);
  const partnerName2 = metaText(cover.props.partnerName2, 80);
  const title = metaText(`Boda de ${partnerName1} y ${partnerName2}`, 70);
  // Misma lectura que la página (cache() la comparte en el request).
  const query = await searchParams;
  const token = typeof query.invitacion === "string" ? query.invitacion : undefined;
  const link = isInvitationToken(token) ? await getGuestRsvpCurrent(slug, token) : null;
  const description = metaText(guestPageDescription(partnerName1, partnerName2, link?.status === "valid"), 160);
  const ogImage = `/og/invitacion/${site.slug}/${site.revisionId ?? "legado"}?v=${OG_CARD_VERSION}`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: {
      title,
      description,
      // Tarjeta versionada por revisión (R03): cambia de URL al republicar.
      // `?v=` es la versión del dibujo: al cambiarlo, WhatsApp pide la nueva.
      images: [{ url: ogImage, width: 1200, height: 630, alt: title, type: "image/jpeg" }],
      type: "website",
      locale: "es_ES",
      siteName: BRAND_NAME,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

/**
 * theme-color = el de la primera pantalla (papel con sobre; tinta si la
 * Story abre con foto a sangre; el cliente lo ajusta al abrir/pasar escena).
 * Antes, papel de la paleta de la boda: en Safari de iPhone la franja
 * de la barra de estado se pinta con él y así se funde con la invitación
 * (el defecto del layout raíz, perla de la marca, dejaba una costura). Sin boda se
 * hereda el del layout raíz.
 */
export async function generateViewport({ params }: GuestPageProps): Promise<Viewport> {
  const { slug } = await params;
  const result = await getPublicSiteResult(slug);
  if (result.status !== "ok") return {};
  const site = result.site;
  return { themeColor: inviteThemeColor(site.document, initialInvitePhase(site.document)) };
}

export default async function GuestPage({ params, searchParams }: GuestPageProps) {
  const { slug } = await params;
  const result = await getPublicSiteResult(slug);
  // Fallo de lectura (Supabase caído un momento): «Reintentar», no un 404 que
  // parezca una boda cancelada. Ya está reportado a Sentry y no se cachea.
  if (result.status === "unavailable") return <GuestUnavailable />;
  if (result.status === "not_found") notFound();
  const site = result.site;
  const query = await searchParams;
  const invitationToken = typeof query.invitacion === "string" ? query.invitacion : undefined;

  // Visita contada tras responder (after()): jamás retrasa al invitado.
  // La IP se lee aquí (headers() no está disponible dentro de after()).
  const viewerIp = await clientIp();
  after(() => trackGuestPageView(slug, viewerIp));

  // CRM: primera apertura del enlace personal. User-Agent y cookies de sesión
  // se leen aquí (no existen dentro de after()); el resto, después de responder.
  // Cualquier fallo se traga: nunca bloquea ni rompe la invitación.
  if (isInvitationToken(invitationToken)) {
    try {
      const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
      const signal = {
        slug,
        token: invitationToken,
        userAgent: headerList.get("user-agent"),
        sessionCookies: supabaseSessionCookies(cookieStore.getAll()),
      };
      after(() => trackInvitationOpened(signal));
    } catch {
      // Sin señal: la invitación se sirve igual.
    }
  }

  // ---------- El sobre ----------
  // Bizum retirado del producto (decisión 2026-07-07): solo tarjeta.
  // El componente y el schema lo conservan por si se reactiva. El documento
  // público no lleva datos de pago, así que `stripe_onboarded` se lee de la
  // vista pública solo cuando el sobre está activo.
  let envelope = null;
  if (!RSVP_MVP) {
    const wedding = await getWeddingPublic(slug);
    const cover = findScene(site.document, "cover");
    if (wedding && cover) {
      envelope = (
        <div className="px-4 pt-16 pb-10 sm:pt-20">
          <ContributionEnvelope
            slug={site.slug}
            initials={coupleInitials(cover.props.partnerName1, cover.props.partnerName2)}
            bizumPhone={null}
            stripeOnboarded={wedding.stripe_onboarded}
          />
        </div>
      );
    }
  }

  // Plazo de respuesta con la fecha de hoy en Madrid (página force-dynamic).
  // Sin datos (fallo de lectura) se trata como abierta: la RPC sigue mandando.
  // Respuesta anterior del enlace personal (§2.5): el formulario sale con lo
  // que ya envió. Validación del token en la RPC; una lectura fallida bloquea el formulario.
  // También el tope de acompañantes de la invitación (§4.2).
  // Un enlace revocado («Regenerar enlace»), de otra boda o mal copiado no
  // pinta el formulario: la invitación se ve igual y el RSVP lo explica.
  const [rsvpDates, link] = await Promise.all([
    getWeddingRsvpDates(slug),
    isInvitationToken(invitationToken)
      ? getGuestRsvpCurrent(slug, invitationToken)
      : Promise.resolve(invitationToken ? ({ status: "invalid" } as const) : null),
  ]);
  const rsvpState = rsvpDates ? rsvpWindow(rsvpDates) : undefined;
  const current = link?.status === "valid" ? link.current : null;
  // Saludo (ítem 11): solo el nombre de pila del titular llega al HTML.
  const guestName = current?.guestName ? firstName(current.guestName) || null : null;

  return (
    <InvitationRenderer
      document={site.document}
      mode="public"
      plan={site.plan}
      rsvp={{ slug: site.slug, invitationToken, rsvpMvp: RSVP_MVP, window: rsvpState, previous: current?.previous ?? null, maxCompanions: current?.maxCompanions ?? null, linkInvalid: link?.status === "invalid", linkClosed: link?.status === "closed", readError: link?.status === "error", guestName }}
      afterCover={envelope}
    />
  );
}
