/**
 * Lectura pública de la boda para /b/[slug] (página, metadata y OG image).
 *
 * El invitado es anónimo: se lee SIEMPRE la vista `weddings_public`
 * (contrato de columnas seguras, sin PII más allá de lo publicado).
 * `cache()` dedupe entre generateMetadata y la página en un mismo request.
 */
import "server-only";
import { RSVP_MVP } from "@/lib/product-scope";
import { createHash } from "node:crypto";
import { cache } from "react";
import { z } from "zod";
import { pageConfigSchema, type WeddingPageConfig } from "@/lib/wedding-settings";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseGuestRsvpCurrent, type GuestRsvpCurrent } from "@/lib/rsvp-previous";

export interface WeddingPublic {
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  cubierto_price_cents: number;
  cover_image_url: string | null;
  stripe_onboarded: boolean;
  plan: "free" | "premium";
  page_config: WeddingPageConfig;
}

const SLUG_RE = /^[a-z0-9-]{3,60}$/;
const publicWeddingSchema = z.object({
  slug: z.string(),
  partner_name_1: z.string(),
  partner_name_2: z.string(),
  wedding_date: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  plan: z.enum(["free", "premium"]),
  cubierto_price_cents: z.number().default(0),
  stripe_onboarded: z.boolean().default(false),
  page_config: pageConfigSchema.catch(() => pageConfigSchema.parse({})),
});

export const getWeddingPublic = cache(
  async (slug: string): Promise<WeddingPublic | null> => {
    if (!SLUG_RE.test(slug)) return null;
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("weddings_public")
      .select(
        RSVP_MVP
          ? "slug, partner_name_1, partner_name_2, wedding_date, cover_image_url, plan, page_config"
          : "slug, partner_name_1, partner_name_2, wedding_date, cubierto_price_cents, cover_image_url, stripe_onboarded, plan, page_config",
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    // A dynamic projection has no useful inferred row type from PostgREST.
    // Validate the actual response before using it in the public page.
    const parsed = publicWeddingSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  },
);

const rsvpDatesSchema = z.object({
  wedding_date: z.string().nullable(),
  rsvp_deadline: z.string().nullable(),
});

/**
 * Fechas que deciden el plazo de respuesta (misma fuente que la RPC:
 * weddings.wedding_date, no la fecha de la portada). Lectura aparte de
 * getWeddingPublic a propósito: si falla (p. ej. código desplegado antes de
 * la migración 20261006300000), devuelve null y la página muestra el
 * formulario como antes, sin tumbar el adaptador legado. La RPC sigue
 * rechazando fuera de plazo.
 */
export const getWeddingRsvpDates = cache(
  async (slug: string): Promise<{ weddingDate: string | null; rsvpDeadline: string | null } | null> => {
    if (!SLUG_RE.test(slug)) return null;
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("weddings_public")
        .select("wedding_date, rsvp_deadline")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !data) return null;
      const parsed = rsvpDatesSchema.safeParse(data);
      return parsed.success ? { weddingDate: parsed.data.wedding_date, rsvpDeadline: parsed.data.rsvp_deadline } : null;
    } catch {
      return null;
    }
  },
);

/**
 * Estado del enlace personal:
 *  - "valid": la RPC lo reconoce; `current` trae la respuesta anterior (o
 *    ninguna) y el tope de acompañantes.
 *  - "invalid": la RPC respondió bien y dijo NULL (token revocado al
 *    «Regenerar enlace», de otra boda o mal formado). La página lo explica en
 *    lugar de pintar un formulario que fallaría al enviar.
 *  - "closed": el enlace es válido pero ya no acepta respuestas
 *    (`{"closed": true}`, 20261101110000: fecha límite, boda pasada o enlace
 *    caducado). La página lo dice en lugar de pintar un formulario vacío.
 *  - "error": fallo de lectura (red, migración sin aplicar, forma inesperada).
 *    NO es «enlace no válido»: la página no pinta el formulario (vacío
 *    borraría lo ya guardado); enseña «No hemos podido cargar…» con
 *    Reintentar (components/guest/rsvp-read-error.tsx).
 */
export type GuestLinkState = { status: "valid"; current: GuestRsvpCurrent } | { status: "invalid" } | { status: "closed" } | { status: "error" };

/**
 * Respuesta anterior del invitado con enlace personal (plan maestro §2.5),
 * para rellenar el formulario, y su tope de acompañantes (§4.2). RPC `guest_rsvp_current` (service_role) con
 * la misma validación de enlace que guest_rsvp_respond: token de otra boda
 * o revocado → NULL → "invalid". Viaja solo el hash; ni token ni hash llegan a logs.
 * La página es `private, no-store` (next.config.ts): esto no se cachea.
 */
export const getGuestRsvpCurrent = cache(
  async (slug: string, invitationToken: string): Promise<GuestLinkState> => {
    if (!SLUG_RE.test(slug) || !/^[a-f0-9]{64}$/.test(invitationToken)) return { status: "invalid" };
    try {
      const supabase = createAdminClient();
      const tokenHash = createHash("sha256").update(invitationToken).digest("hex");
      const { data, error } = await supabase.rpc("guest_rsvp_current", { p_slug: slug, p_token_hash: tokenHash });
      if (error) return { status: "error" };
      // Solo un NULL de una lectura correcta significa «enlace no válido».
      if (data == null) return { status: "invalid" };
      if (typeof data === "object" && !Array.isArray(data) && (data as { closed?: unknown }).closed === true) return { status: "closed" };
      const current = parseGuestRsvpCurrent(data);
      return current ? { status: "valid", current } : { status: "error" };
    } catch {
      return { status: "error" };
    }
  },
);

export interface AgendaPublicItem {
  id: string;
  title: string;
  time_label: string | null;
  place: string | null;
  address: string | null;
  notes: string | null;
  sort: number;
}

/** Agenda del día publicada por la pareja (vista curada, sin PII). */
export const getWeddingAgenda = cache(
  async (slug: string): Promise<AgendaPublicItem[]> => {
    if (!SLUG_RE.test(slug)) return [];
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("wedding_agenda_public")
      .select("id, title, time_label, place, address, notes, sort")
      .eq("slug", slug)
      .order("sort", { ascending: true });
    return (data ?? []) as AgendaPublicItem[];
  },
);
