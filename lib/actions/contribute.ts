"use server";

import { RSVP_MVP, BACKLOG_MESSAGE } from "@/lib/product-scope";

/**
 * Server actions de aportación de invitados (anónimos).
 *
 * El invitado NO tiene sesión: RLS bloquea inserts anónimos a propósito,
 * así que aquí se usa el cliente admin (service role). Nunca se devuelve
 * la fila de `weddings` al cliente — solo mensajes de error cálidos.
 *
 * Contrato con el webhook: la Checkout Session lleva
 * `metadata.contribution_id` (y también `payment_intent_data.metadata.
 * contribution_id`) apuntando a la fila `contributions` en estado 'pending'.
 */

import { redirect } from "next/navigation";
import { z } from "zod";

import { buildContributionCheckoutParams } from "@/lib/checkout";
import { serviceFeeCents } from "@/lib/fees";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const TOO_MANY =
  "Has hecho varios intentos seguidos. Espera un momento y prueba de nuevo.";

export type ActionFailure = { ok: false; error: string };
export type ActionSuccess = { ok: true };

export interface CardContributionInput {
  slug: string;
  guestName: string;
  /** Importe libre elegido por el invitado, en céntimos. Sin mínimos de
   *  producto (decisión 2026-07-08); solo el suelo técnico de Stripe. */
  amountCents: number;
  message?: string;
  email?: string;
}

export interface BizumContributionInput {
  slug: string;
  guestName: string;
  amountCents: number;
  message?: string;
  email?: string;
}

const GENERIC_ERROR =
  "Vaya, algo no ha salido como esperábamos. Inténtalo de nuevo en un momento.";

const baseFields = {
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,60}$/, "No encontramos esta boda."),
  guestName: z
    .string()
    .trim()
    .min(2, "Cuéntanos tu nombre para que los novios sepan a quién agradecer.")
    .max(80, "Tu nombre es un poco largo para la tarjeta: acórtalo un poquito."),
  message: z
    .string()
    .trim()
    .max(500, "Tu mensaje es precioso, pero no cabe: máximo 500 caracteres.")
    .optional(),
  email: z
    .email("Ese email no parece correcto: revísalo para poder enviarte el recibo.")
    .max(120, "Ese email es demasiado largo.")
    .optional(),
};

// Sin mínimo de producto: 1 € es el suelo técnico del cobro con tarjeta.
const amountField = z
  .number()
  .int()
  .min(100, "El importe no parece correcto: revísalo.")
  .max(1000000, "Para un importe tan generoso, mejor hablad con los novios.");

const cardSchema = z.object({ ...baseFields, amountCents: amountField });

const bizumSchema = z.object({
  ...baseFields,
  amountCents: z
    .number()
    .int()
    .min(50, "El importe no parece correcto: revísalo.")
    .max(1000000, "Para un importe tan generoso, mejor hablad con los novios."),
});

interface WeddingRow {
  id: string;
  slug: string;
  stripe_account_id: string | null;
  stripe_onboarded: boolean;
  bizum_phone: string | null;
}

async function fetchWeddingBySlug(slug: string): Promise<WeddingRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("weddings")
    .select(
      "id, slug, stripe_account_id, stripe_onboarded, bizum_phone",
    )
    .eq("slug", slug)
    // service_role se salta RLS: una boda en borrado (P2-5) no acepta aportaciones.
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return data as WeddingRow;
}

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? GENERIC_ERROR;
}

/**
 * Camino tarjeta: inserta la aportación 'pending' y redirige a Stripe
 * Checkout (destination charge; el invitado paga los gastos de gestión).
 * En éxito NO retorna: lanza el redirect de Next hacia session.url.
 */
export async function startCardContribution(
  input: CardContributionInput,
): Promise<ActionFailure> {
  if (RSVP_MVP) return { ok: false, error: BACKLOG_MESSAGE };
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error) };
  }
  const { slug, guestName, amountCents, message, email } = parsed.data;

  // Rate limit: 15 sesiones de pago / hora por IP+boda (abuso de creación de
  // Checkout Sessions). Generoso para no estorbar reintentos legítimos.
  if (!(await rateLimit("contribute", `${await clientIp()}:${slug}`, 15, 3600))) {
    return { ok: false, error: TOO_MANY };
  }

  const wedding = await fetchWeddingBySlug(slug);
  if (!wedding) {
    return { ok: false, error: "No encontramos esta boda. Revisa el enlace." };
  }
  if (!wedding.stripe_onboarded || !wedding.stripe_account_id) {
    return {
      ok: false,
      error:
        "Los pagos con tarjeta estarán disponibles muy pronto. ¡Gracias por la paciencia!",
    };
  }

  const contributionCents = amountCents;
  const feeCents = serviceFeeCents(contributionCents);

  const supabase = createAdminClient();
  const { data: inserted, error: insertError } = await supabase
    .from("contributions")
    .insert({
      wedding_id: wedding.id,
      guest_name: guestName,
      guest_email: email ?? null,
      n_cubiertos: 1,
      cubierto_cents: contributionCents,
      gift_cents: 0,
      total_cents: contributionCents,
      service_fee_cents: feeCents,
      message: message && message.length > 0 ? message : null,
      method: "card",
      status: "pending",
    })
    .select("id")
    .single();

  const contributionId: string | undefined = inserted
    ? (inserted as { id: string }).id
    : undefined;
  if (insertError || !contributionId) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  let checkoutUrl: string | null = null;
  try {
    const params = buildContributionCheckoutParams({
      weddingSlug: wedding.slug,
      stripeAccountId: wedding.stripe_account_id,
      contributionCents,
      feeCents,
      guestName,
      appUrl,
    });

    const session = await getStripe().checkout.sessions.create({
      ...params,
      // Contrato con el webhook: contribution_id viaja en la sesión Y en el
      // PaymentIntent (checkout.session.completed lee session.metadata).
      metadata: {
        contribution_id: contributionId,
        wedding_id: wedding.id,
      },
      payment_intent_data: {
        ...params.payment_intent_data,
        metadata: {
          contribution_id: contributionId,
          wedding_id: wedding.id,
        },
      },
      ...(email ? { customer_email: email } : {}),
    });
    checkoutUrl = session.url;
  } catch {
    checkoutUrl = null;
  }

  if (!checkoutUrl) {
    await supabase
      .from("contributions")
      .update({ status: "failed" })
      .eq("id", contributionId);
    return {
      ok: false,
      error:
        "No hemos podido preparar el pago. Inténtalo de nuevo en un momento.",
    };
  }

  redirect(checkoutUrl);
}

/**
 * Camino Bizum manual: el invitado ya ha enviado su Bizum al teléfono de los
 * novios; aquí solo se apunta la aportación 'pending' (sin gastos de gestión)
 * para que la pareja la confirme en un toque desde su panel.
 */
export async function logBizumContribution(
  input: BizumContributionInput,
): Promise<ActionSuccess | ActionFailure> {
  if (RSVP_MVP) return { ok: false, error: BACKLOG_MESSAGE };
  const parsed = bizumSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error) };
  }
  const { slug, guestName, amountCents, message, email } = parsed.data;

  // Rate limit: 15 registros de Bizum / hora por IP+boda.
  if (!(await rateLimit("bizum", `${await clientIp()}:${slug}`, 15, 3600))) {
    return { ok: false, error: TOO_MANY };
  }

  const wedding = await fetchWeddingBySlug(slug);
  if (!wedding) {
    return { ok: false, error: "No encontramos esta boda. Revisa el enlace." };
  }
  if (!wedding.bizum_phone) {
    return {
      ok: false,
      error: "Esta boda no tiene Bizum activado. Prueba con tarjeta.",
    };
  }

  const supabase = createAdminClient();
  const { error: insertError } = await supabase.from("contributions").insert({
    wedding_id: wedding.id,
    guest_name: guestName,
    guest_email: email ?? null,
    n_cubiertos: 1,
    cubierto_cents: amountCents,
    gift_cents: 0,
    total_cents: amountCents,
    service_fee_cents: 0,
    message: message && message.length > 0 ? message : null,
    method: "bizum_manual",
    status: "pending",
  });

  if (insertError) {
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true };
}
