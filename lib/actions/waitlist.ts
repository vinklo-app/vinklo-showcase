"use server";

/**
 * Server action de la lista de espera pre-lanzamiento (landing).
 *
 * La tabla `waitlist` no tiene grants para anon/authenticated a propósito:
 * las inserciones entran SOLO por aquí con el cliente admin (service role).
 * Un email repetido (unique violation 23505) se responde como éxito
 * idéntico al alta nueva para no revelar si un email ya está registrado.
 */

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export type WaitlistResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const GENERIC_ERROR =
  "No hemos podido guardar vuestra solicitud. Probad de nuevo en un momento.";

const waitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Ese email es demasiado largo.")
    .pipe(z.email("Revisa el email: parece que le falta algo.")),
  kind: z.enum(["pareja", "planner", "proveedor", "otro"]),
  weddingDate: z.iso.date("Revisa la fecha de la boda.").optional(),
  consent: z.literal(true, { error: "Necesitamos vuestro permiso para avisaros por email." }),
  /** Casilla «Nos interesa que nuestros invitados puedan hacer su regalo desde la web». */
  interestedInGifts: z.boolean().default(false),
});

export type WaitlistInput = z.input<typeof waitlistSchema>;

export async function joinWaitlist(
  input: WaitlistInput,
): Promise<WaitlistResult> {
  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? GENERIC_ERROR };
  }

  // Rate limit: 5 altas / hora por IP (frena el spam de la lista).
  const allowed = await rateLimit("waitlist", await clientIp(), 5, 3600);
  if (!allowed) {
    return {
      ok: false,
      error: "Has probado varias veces seguidas. Espera un momento y reinténtalo.",
    };
  }

  try {
    const { email, kind, weddingDate, interestedInGifts } = parsed.data;
    const supabase = createAdminClient();
    const row = {
      email,
      kind,
      wedding_date: kind === "pareja" ? weddingDate ?? null : null,
      // La versión identifica el texto de consentimiento aceptado (no ha
      // cambiado); created_at registra el alta.
      source: "landing-waitlist-v2",
    };
    let { error } = await supabase.from("waitlist").insert({ ...row, interested_in_gifts: interestedInGifts });

    // Si el código llega antes que la migración de `interested_in_gifts`
    // (PostgREST: PGRST204; Postgres: 42703), el alta no puede perderse por
    // una casilla opcional: se guarda sin ella y se deja rastro sin datos.
    if (error !== null && (error.code === "PGRST204" || error.code === "42703")) {
      console.error("[waitlist] interested_in_gifts column missing; saved without it");
      ({ error } = await supabase.from("waitlist").insert(row));
    }

    if (error !== null && error.code !== "23505") {
      // No registrar el objeto de Postgres: puede incluir el email enviado.
      console.error("[waitlist] insert failed", error.code);
      return { ok: false, error: GENERIC_ERROR };
    }

    return {
      ok: true,
      message: "Os avisaremos por email cuando podamos invitaros a probar vinklo.",
    };
  } catch {
    console.error("[waitlist] service unavailable");
    return { ok: false, error: GENERIC_ERROR };
  }
}
