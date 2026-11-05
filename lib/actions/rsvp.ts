"use server";

import * as Sentry from "@sentry/nextjs";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getPublicSiteResult } from "@/lib/data/site-public";
import { cleanRsvpAnswers, rsvpModulesFromDocument } from "@/lib/rsvp-answers";
import { companionListFromRows } from "@/lib/rsvp-companions";
import { HEALTH_CONSENT_VERSION } from "@/lib/rsvp-form-state";

export type RsvpResult = { ok: true } | { ok: false; error: string };
const GENERIC_ERROR = "No hemos podido guardarlo. Prueba de nuevo.";
const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  name: z.string().trim().min(2, "Dinos tu nombre.").max(120),
  attending: z.enum(["si", "no"]),
  companions: z.number().int().min(0).max(10),
  /**
   * «Algo más que debamos saber»: nota logística, sin datos de salud ni
   * consentimiento. undefined = no se toca (ya dejó una que no se le muestra,
   * revisión M1); "" = se borra.
   */
  notes: z.string().trim().max(500).optional(),
  /** «Alergias o intolerancias»: datos de salud (art. 9 RGPD), sin permiso expreso no se guardan. */
  healthNotes: z.string().trim().max(500).optional().default(""),
  healthConsent: z.boolean().optional(),
  /**
   * Ya dejó una nota de salud (no se le muestra, revisión M1) y no escribe
   * otra: se conserva con su consentimiento. Solo con «sí».
   */
  keepHealthNote: z.boolean().optional(),
  invitationToken: z.string().regex(/^[a-f0-9]{64}$/, "Este enlace ya no es válido; pide a los novios uno nuevo.").optional(),
  /** Respuestas a los módulos (autobús, alojamiento…); se validan contra la web publicada. */
  answers: z.unknown().optional(),
  /**
   * Nombres de acompañantes (§4.3, solo con enlace personal). undefined = el
   * formulario no los pregunta (no se tocan); [] = sin nombres (se borran los
   * que escribió el invitado; los de la pareja se quedan).
   */
  companionNames: z.array(z.object({ name: z.string().max(200), kid: z.boolean() })).max(10).optional(),
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const HEALTH_CONSENT_ERROR = "Marca la casilla para enviar tus alergias o déjalas en blanco.";
const RATE_ERROR = "Has enviado varias veces seguidas. Espera un momento, por favor.";
const WITHDRAWN_ERROR = "Esta invitación ya no está disponible. Si crees que es un error, pídele a la pareja que la vuelva a publicar.";
const CLOSED_ERROR = "El plazo para confirmar ya terminó. Si necesitas cambiar algo, escribe directamente a la pareja.";
/** Resultado de guest_rsvp_respond → mensaje para el invitado. */
const OUTCOME_ERRORS: Record<string, string> = {
  // Al invitado, de tú (antes «pedid»): mismo texto que el aviso de la página.
  unavailable: "No se ha guardado la respuesta. Este enlace ya no es válido; pide a los novios uno nuevo.",
  withdrawn: WITHDRAWN_ERROR,
  closed: CLOSED_ERROR,
  rate_limited: "Ahora mismo hay muchas respuestas a la vez. Prueba de nuevo en unos minutos.",
  // Tope de acompañantes (§4.2): el formulario ya avisa con la cifra; esto es el respaldo.
  too_many: "Tu invitación tiene un número máximo de acompañantes. Si necesitas cambiarlo, escribe a la pareja.",
};
/**
 * Límites combinados (auditoría H11). Antes: 10/hora por IP+boda, que podía
 * bloquear a una familia entera en el mismo Wi-Fi. Ahora:
 *  - por enlace personal: 10/hora (un invitado corrigiendo su respuesta);
 *  - por IP+boda: 60/hora (varios invitados en la misma red);
 *  - por IP en cualquier boda: 120/hora (barridos de slugs/tokens).
 * El agregado por boda (600/hora) cuenta solo tokens válidos y vive en la RPC.
 * Se pasa el HASH del token, nunca el token; rateLimit lo vuelve a hashear.
 */
async function withinRateLimits(ip: string, slug: string, tokenHash: string | null): Promise<boolean> {
  const rules: Array<{ action: string; id: string; max: number }> = [];
  if (tokenHash) rules.push({ action: "rsvp-token", id: tokenHash, max: 10 });
  rules.push({ action: "rsvp", id: `${ip}:${slug}`, max: 60 }, { action: "rsvp-ip", id: ip, max: 120 });
  for (const rule of rules) {
    if (!(await rateLimit(rule.action, rule.id, rule.max, 3600))) return false;
  }
  return true;
}

export async function submitRsvp(input: z.input<typeof schema>): Promise<RsvpResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  // Con «no» no se piden ni se guardan alergias (minimización, art. 9 RGPD):
  // lo que llegue se descarta y la RPC borra la nota que el invitado dejó
  // con un «sí» anterior. El consentimiento solo se exige con «sí».
  const healthNotes = parsed.data.attending === "si" ? parsed.data.healthNotes : "";
  if (healthNotes && parsed.data.healthConsent !== true) return { ok: false, error: HEALTH_CONSENT_ERROR };
  try {
    const values = { ...parsed.data, healthNotes };
    // Solo enlace personal. La rama del «enlace general» (respuestas por
    // nombre + cookie del dispositivo) se borró el 9-oct-2026 (plan §5.5):
    // con RSVP_MVP, constante true, nunca se ejecutaba.
    if (!values.invitationToken) return { ok: false, error: "Para confirmar, abre la invitación personal que te ha enviado la pareja." };
    const tokenHash = values.invitationToken ? hash(values.invitationToken) : null;
    if (!(await withinRateLimits(await clientIp(), values.slug, tokenHash))) return { ok: false, error: RATE_ERROR };
    // La pareja pudo retirar la web, o fallar la lectura, entre que el
    // invitado abrió el formulario y lo envió: un token válido de antes no
    // debe seguir guardando respuestas detrás de una web ya no disponible
    // (auditoría H02, 2026-10-04).
    const siteResult = await getPublicSiteResult(values.slug);
    // Un fallo momentáneo de lectura no es «invitación retirada»: que lo reintente.
    if (siteResult.status === "unavailable") return { ok: false, error: GENERIC_ERROR };
    if (siteResult.status !== "ok") return { ok: false, error: WITHDRAWN_ERROR };
    const site = siteResult.site;
    // Módulos: solo se guarda lo que la web publicada pregunta (8-oct-2026).
    const cleaned = cleanRsvpAnswers(values.answers, rsvpModulesFromDocument(site.document), values.attending, values.attending === "si" ? values.companions : 0);
    if (!cleaned.ok) return { ok: false, error: cleaned.error };
    const answers = cleaned.answers;
    const admin = createAdminClient();

    if (tokenHash) {
      // El secreto autoriza SOLO la fila invitada dentro de esta boda. Nunca
      // se usa el nombre para reclamar una fila creada por la pareja. Vale
      // cualquier token ACTIVO del invitado (invitación o recordatorio).
      // Comprobar el token y guardar la respuesta es UNA transacción en
      // guest_rsvp_respond (auditoría H03): bloquea al invitado con el mismo
      // orden que «Regenerar enlace» y re-lee el token bajo el lock, así que
      // un enlace revocado ya no puede colar una respuesta. También aplica
      // web retirada, cierre tras la boda y el límite por boda (H11).
      // Sobrecarga de 10 (20261101100000), con los diez nombres siempre: la
      // nota de salud va con su consentimiento versionado, la logística
      // aparte y «conservar» para la nota que ya no se le muestra. Sin
      // fallback a firmas anteriores: la de 9 borraría esa nota en silencio.
      const { data, error } = await admin.rpc("guest_rsvp_respond", {
        p_slug: values.slug,
        p_token_hash: tokenHash,
        p_status: values.attending,
        p_companions: values.attending === "si" ? values.companions : 0,
        p_health_notes: values.healthNotes || null,
        // '' borra la nota logística anterior; NULL (undefined) la deja como estaba.
        p_logistic_notes: values.notes ?? null,
        p_health_consent_version: values.healthNotes ? HEALTH_CONSENT_VERSION : null,
        // jsonb: interfaces sin firma de índice, así que el tipo `Json` generado no las acepta tal cual.
        p_answers: answers as Json,
        p_companion_list: (values.companionNames ? companionListFromRows(values.companionNames, values.attending === "si" ? values.companions : 0) : null) as Json,
        p_keep_health_notes: values.attending === "si" && !values.healthNotes && values.keepHealthNote === true,
      });
      if (error) {
        // Solo el código: ni token ni hash llegan a los logs.
        console.error("[rsvp] respond rpc failed", error.code);
        Sentry.captureMessage("rsvp respond failed", { level: "error", extra: { code: error.code } });
        return { ok: false, error: GENERIC_ERROR };
      }
      const outcome = typeof data === "string" ? data : "";
      if (outcome !== "ok") return { ok: false, error: OUTCOME_ERRORS[outcome] ?? GENERIC_ERROR };
    }
    revalidatePath("/panel/invitados");
    revalidatePath("/panel");
    revalidatePath("/panel/dia");
    return { ok: true };
  } catch (error) {
    // Ni token ni respuestas: solo el fallo (lib/observability/sentry-scrub.ts limpia el resto).
    Sentry.captureException(error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
