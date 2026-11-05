/**
 * Registro de eventos ligeros en public.events (analítica barata,
 * PLAN.md §4). Server-only; todos los fallos se tragan: la analítica
 * jamás debe romper la página del invitado.
 */
import "server-only";

import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/** Ventana de deduplicación de visitas por IP+boda. */
const VIEW_DEDUPE_SECS = 600;

/**
 * Cuenta una visita a la página pública del invitado. La vista
 * weddings_public no expone el id (contrato de columnas seguras), así
 * que se resuelve por slug aquí, con el cliente admin y a fuego perdido.
 *
 * Hardening 2026-09-07: una misma IP solo cuenta una visita por boda cada
 * 10 minutos (rl_check). Antes, cada GET insertaba una fila con service
 * role sin límite — un bucle de peticiones podía inflar `events` sin
 * tope. La IP se resuelve en la página (headers() no está disponible
 * dentro de after()).
 *
 * Limitación conocida: cuenta también bots/preview de WhatsApp; sirve
 * como orden de magnitud, no como analítica exacta.
 */
export async function trackGuestPageView(slug: string, ip: string): Promise<void> {
  try {
    const fresh = await rateLimit("view", `${ip}:${slug}`, 1, VIEW_DEDUPE_SECS);
    if (!fresh) return;

    const admin = createAdminClient();
    const { data: wedding } = await admin
      .from("weddings")
      .select("id")
      .eq("slug", slug)
      .is("deleted_at", null) // boda en borrado (P2-5): sin eventos nuevos
      .maybeSingle();
    if (!wedding) return;
    await admin
      .from("events")
      .insert({ wedding_id: wedding.id, type: "guest_page_view" });
  } catch {
    // Nunca propagar: analítica best-effort.
  }
}

/** Nº de visitas registradas de la página de invitados de una boda. */
export async function countGuestPageViews(weddingId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { count } = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", weddingId)
      .eq("type", "guest_page_view");
    return count ?? 0;
  } catch {
    return 0;
  }
}
