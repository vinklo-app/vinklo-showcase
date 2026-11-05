/**
 * «Abierta» del embudo: primera vez que el invitado abre SU enlace personal
 * (/b/<slug>?invitacion=<token>). Server-only y a fuego perdido: se llama desde
 * after() en la página pública y jamás retrasa ni rompe la invitación.
 *
 * - El token en claro no sale de aquí: se envía su SHA-256, como en el RSVP.
 * - La RPC guest_invitation_opened (service_role) valida token activo de ESA
 *   boda, web no retirada y conserva la primera apertura.
 * - No cuenta la vista previa de la pareja: si hay sesión de Supabase se
 *   resuelve el usuario y la RPC lo compara con weddings.couple_id. Si hay
 *   cookie de sesión pero no se puede resolver, no se cuenta (mejor perder una
 *   apertura que atribuir la de la pareja al invitado).
 * - Vistas previas de enlaces (WhatsApp, iMessage, Telegram…): al pegar el
 *   enlace, el móvil de la pareja lo descarga para pintar la tarjeta. Esos
 *   agentes se ignoran por User-Agent. Limitación conocida: un agente que no
 *   se identifique como tal contaría como apertura.
 */
import "server-only";

import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9-]{3,60}$/;

/** Agentes de vista previa de enlaces y robots conocidos. */
const PREVIEW_AGENT = /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|telegrambot|slackbot|slack-imgproxy|discordbot|linkedinbot|skypeuripreview|applebot|googlebot|bingbot|pinterest|embedly|vkshare|redditbot|preview|bot\b|crawler|spider|curl\/|wget\//i;

export function isLinkPreviewAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  // Sin User-Agent: casi siempre un script, no un navegador.
  return ua === "" || PREVIEW_AGENT.test(ua);
}

export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export interface OpenSignal {
  slug: string;
  token: string;
  userAgent: string | null;
  /** Cookies de sesión de Supabase (sb-*) leídas ANTES de after(). */
  sessionCookies: { name: string; value: string }[];
}

/** Filtra las cookies de sesión de Supabase (sb-<ref>-auth-token, troceadas .0/.1…). */
export function supabaseSessionCookies(all: { name: string; value: string }[]): { name: string; value: string }[] {
  return all.filter((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"))
    .map(({ name, value }) => ({ name, value }));
}

/** undefined = la sesión existe pero no se pudo resolver → no contar. */
async function viewerId(sessionCookies: OpenSignal["sessionCookies"]): Promise<string | null | undefined> {
  if (sessionCookies.length === 0) return null;
  try {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => sessionCookies, setAll: () => {} },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return undefined;
    return data.user.id;
  } catch { return undefined; }
}

export async function trackInvitationOpened(signal: OpenSignal): Promise<void> {
  try {
    if (!SLUG.test(signal.slug) || !isInvitationToken(signal.token) || isLinkPreviewAgent(signal.userAgent)) return;
    const viewer = await viewerId(signal.sessionCookies);
    if (viewer === undefined) return;
    const admin = createAdminClient();
    await admin.rpc("guest_invitation_opened", {
      p_slug: signal.slug,
      p_token_hash: createHash("sha256").update(signal.token).digest("hex"),
      p_viewer_id: viewer,
    });
  } catch {
    // Nunca propagar: es una señal del CRM, no puede romper la invitación.
  }
}
