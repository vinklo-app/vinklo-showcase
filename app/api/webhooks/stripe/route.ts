/**
 * Stripe webhook endpoint (M1).
 *
 * - Verifies the signature (STRIPE_WEBHOOK_SECRET) — 400 only on bad signature.
 * - Idempotency (H09): a durable inbox state machine lives in the existing
 *   `events.payload` jsonb — no schema change. One gate row per Stripe event
 *   id (unique index on payload->>'stripe_event_id'), with payload.status
 *   cycling processing → processed | failed. A redelivery that hits the
 *   unique violation does NOT blindly ack: it reads the row and only acks
 *   200 when status is "processed". A "failed" row, or a "processing" row
 *   whose claim lease has expired (its process almost certainly died
 *   mid-handler, the original gap this closes), is reclaimed and the
 *   handler actually re-runs instead of acking work nobody finished. A
 *   "processing" row still inside its lease answers non-2xx so Stripe
 *   retries later rather than racing a request still in flight.
 * - Business logic:
 *   - checkout.session.completed → confirm the contribution referenced by
 *     session.metadata.contribution_id, store the payment intent id, log a
 *     'contribution_confirmed' event, then send receipt + couple emails
 *     (each fire-and-forget: email failure never fails the webhook). Sessions
 *     with metadata.type === "premium" are a different purchase entirely
 *     (Premium Boda, paid to the platform account) and are routed to
 *     handlePremiumCheckoutCompleted instead — see the dispatch in POST.
 *   - payment_intent.succeeded   → defensive fallback confirmation (event
 *     ordering vs checkout.session.completed is not guaranteed).
 *   - account.updated            → sync weddings.stripe_onboarded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { sendEmail } from "@/lib/emails/send";
import {
  coupleNotificationHtml,
  guestReceiptHtml,
} from "@/lib/emails/templates";
import { formatEurCents } from "@/lib/fees";
import { FREE_CONTRIBUTION_LIMIT } from "@/lib/premium";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

const UNIQUE_VIOLATION = "23505";

/** Idempotency-gate state machine stored in events.payload (H09, no schema change). */
type GateStatus = "processing" | "processed" | "failed";
interface GatePayload {
  stripe_event_id: string;
  type: string;
  status: GateStatus;
  /** ISO 8601 — when this delivery last claimed the row. */
  claimed_at: string;
}

/**
 * How long a "processing" claim is honored before a redelivery may reclaim
 * and retry it. Comfortably longer than any realistic handler run (well
 * above typical Vercel function timeouts), so a request genuinely still in
 * flight is never raced — only a claim whose owner is certainly dead is
 * reclaimed.
 */
const GATE_LEASE_MS = 5 * 60 * 1000;

function isLeaseExpired(claimedAt: string | undefined): boolean {
  const claimed = claimedAt ? Date.parse(claimedAt) : NaN;
  return !Number.isFinite(claimed) || Date.now() - claimed > GATE_LEASE_MS;
}

function gatePayload(event: Stripe.Event, status: GateStatus): GatePayload {
  return { stripe_event_id: event.id, type: event.type, status, claimed_at: new Date().toISOString() };
}

/** Columns needed to confirm a contribution and build its emails. */
const CONTRIBUTION_COLUMNS =
  "id, wedding_id, guest_name, guest_email, n_cubiertos, total_cents, service_fee_cents, message, method, status";

interface ContributionRow {
  id: string;
  wedding_id: string;
  guest_name: string;
  guest_email: string | null;
  n_cubiertos: number;
  total_cents: number;
  service_fee_cents: number;
  message: string | null;
  method: "card" | "bizum_manual";
  status: "pending" | "confirmed" | "failed";
}

interface WeddingRow {
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  couple_id: string;
  plan: "free" | "premium";
  notify_contribution: "inmediato" | "semanal" | "nunca";
}

/**
 * Minimal service-role client, deliberately NOT imported from lib/supabase/
 * (that module is cookie/session-bound and owned by another workstream).
 */
function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * checkout.session.completed for a Premium Boda purchase (session.metadata
 * .type === "premium") — a plain Checkout Session on the PLATFORM's own
 * Stripe account, unrelated to the guest-contribution destination-charge
 * flow below. Flips weddings.plan to 'premium' and logs an audit row.
 *
 * The outer idempotency gate in POST (unique on
 * events.payload->>stripe_event_id for this event.id) already prevents this
 * from running twice for the same Stripe event, so no extra dedup is needed
 * here — setting plan='premium' again would be harmless anyway.
 */
async function handlePremiumCheckoutCompleted(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const weddingId = session.metadata?.wedding_id;
  if (!weddingId) {
    console.warn(
      `checkout.session.completed ${session.id} has metadata.type=premium but no wedding_id — ignoring.`,
    );
    return;
  }

  // Solo desbloqueamos Premium con el pago realmente cobrado (ver guard
  // equivalente en handleCheckoutSessionCompleted).
  if (session.payment_status !== "paid") {
    console.info(
      `Premium session ${session.id} completed with payment_status="${session.payment_status}" — waiting for async payment.`,
    );
    return;
  }

  const { error: updateError } = await supabase
    .from("weddings")
    .update({ plan: "premium" })
    .eq("id", weddingId);
  if (updateError) {
    // Throw so the caller answers 500 and Stripe redelivers: the couple has
    // been charged and this update is the only thing that unlocks Premium.
    throw new Error(
      `Failed to set plan=premium for wedding ${weddingId}: ${updateError.message}`,
    );
  }

  // NB: do not reuse the `stripe_event_id` payload key here — it is what
  // the idempotency gate's unique partial index watches
  // (payload->>'stripe_event_id'), and the gate row for this same event.id
  // was already inserted by POST before this handler ran. Reusing it made
  // this insert violate that unique index on every single call, so this
  // audit row was never actually written (H09 fix, 2026-10-04).
  const { error: eventError } = await supabase.from("events").insert({
    wedding_id: weddingId,
    type: "premium_purchased",
    payload: {
      wedding_id: weddingId,
      source_stripe_event_id: eventId,
    },
  });
  if (eventError) {
    console.error("Failed to log premium_purchased event:", eventError);
  }
}

/**
 * checkout.session.completed — the primary confirmation path.
 * Contribution is located via session.metadata.contribution_id.
 */
async function handleCheckoutSessionCompleted(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const contributionId = session.metadata?.contribution_id;
  if (!contributionId) {
    console.warn(
      `checkout.session.completed ${session.id} has no metadata.contribution_id — ignoring.`,
    );
    return;
  }

  // Solo confirmamos con el pago REALMENTE cobrado. Con Klarna/métodos
  // asíncronos, checkout.session.completed puede llegar con payment_status
  // "unpaid": la confirmación real llega luego por
  // checkout.session.async_payment_succeeded. Sin este guard, se daría por
  // pagada una aportación que aún no lo está.
  if (session.payment_status !== "paid") {
    console.info(
      `Session ${session.id} completed with payment_status="${session.payment_status}" — waiting for async payment before confirming.`,
    );
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  const { data: contributionData, error: updateError } = await supabase
    .from("contributions")
    .update({ status: "confirmed", stripe_payment_intent_id: paymentIntentId })
    .eq("id", contributionId)
    // Solo confirmamos desde "pending": si expiró/falló antes, no se
    // revive por un evento reordenado (defensa, además de la idempotencia).
    .eq("status", "pending")
    .select(CONTRIBUTION_COLUMNS)
    .maybeSingle();

  if (updateError) {
    // Error real de BD: throw → 500 → Stripe reintenta (al invitado ya se
    // le ha cobrado y esta confirmación es lo único que lo registra).
    throw new Error(
      `Failed to confirm contribution ${contributionId}: ${updateError.message}`,
    );
  }
  if (!contributionData) {
    // Ninguna fila en "pending": ya estaba confirmada (redelivery) o
    // expiró/falló. No es un fallo — se hace ack sin reconfirmar ni
    // reenviar el email.
    console.info(
      `Contribution ${contributionId} not pending on session ${session.id} — nothing to confirm.`,
    );
    return;
  }
  const contribution = contributionData as ContributionRow;

  // Audit trail (separate from the idempotency gate row: no stripe_event_id
  // key here, so the partial unique index does not apply).
  const { error: eventError } = await supabase.from("events").insert({
    wedding_id: contribution.wedding_id,
    type: "contribution_confirmed",
    payload: {
      contribution_id: contribution.id,
      stripe_payment_intent_id: paymentIntentId,
      source: "checkout.session.completed",
    },
  });
  if (eventError) {
    console.error("Failed to log contribution_confirmed event:", eventError);
  }

  const { data: weddingData, error: weddingError } = await supabase
    .from("weddings")
    .select(
      "slug, partner_name_1, partner_name_2, couple_id, plan, notify_contribution",
    )
    .eq("id", contribution.wedding_id)
    .single();

  if (weddingError || !weddingData) {
    // Retryable: the contribution update above is idempotent, so the
    // redelivery re-runs it and then sends the emails.
    throw new Error(
      `Wedding ${contribution.wedding_id} not found for contribution ${contribution.id}: ${weddingError?.message ?? "no row"}`,
    );
  }
  const wedding = weddingData as WeddingRow;
  const partnerNames = `${wedding.partner_name_1} y ${wedding.partner_name_2}`;

  // Emails: DB work is done; each send is individually try/caught so an
  // email failure can never make the webhook fail.
  if (contribution.guest_email) {
    try {
      await sendEmail({
        to: contribution.guest_email,
        subject: `¡Gracias, ${contribution.guest_name}! Tu aportación para ${partnerNames}`,
        html: guestReceiptHtml({
          guestName: contribution.guest_name,
          partnerNames,
          totalFormatted: formatEurCents(contribution.total_cents),
          feeFormatted: formatEurCents(contribution.service_fee_cents),
          nCubiertos: contribution.n_cubiertos,
          message: contribution.message,
        }),
      });
    } catch (emailError) {
      console.error(
        `Failed to send guest receipt for contribution ${contribution.id}:`,
        emailError,
      );
    }
  }

  // Preferencia de avisos: 'inmediato' (por defecto) envía cada aportación;
  // 'semanal' las agrupa en el resumen del cron; 'nunca' no envía nada.
  if (wedding.notify_contribution !== "inmediato") return;

  try {
    // profiles has no email column — resolve it from auth.users.
    const { data: userData, error: userError } =
      await supabase.auth.admin.getUserById(wedding.couple_id);
    const coupleEmail = userData.user?.email;
    if (userError || !coupleEmail) {
      console.error(
        `Could not resolve email for couple ${wedding.couple_id}:`,
        userError,
      );
    } else {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://vinklo.es";
      // Plan básico: cuántas aportaciones incluidas le quedan a la boda.
      let remainingFreeSlots: number | null = null;
      if (wedding.plan === "free") {
        const { count } = await supabase
          .from("contributions")
          .select("id", { count: "exact", head: true })
          .eq("wedding_id", contribution.wedding_id)
          .eq("status", "confirmed");
        remainingFreeSlots = Math.max(
          0,
          FREE_CONTRIBUTION_LIMIT - (count ?? 0),
        );
      }
      await sendEmail({
        to: coupleEmail,
        subject: `${contribution.guest_name} acaba de aportar ${formatEurCents(contribution.total_cents)}`,
        html: coupleNotificationHtml({
          guestName: contribution.guest_name,
          amountFormatted: formatEurCents(contribution.total_cents),
          method: contribution.method,
          panelUrl: `${appUrl}/panel`,
          remainingFreeSlots,
        }),
      });
    }
  } catch (emailError) {
    console.error(
      `Failed to send couple notification for contribution ${contribution.id}:`,
      emailError,
    );
  }
}

/**
 * payment_intent.succeeded — defensive fallback (Stripe does not guarantee
 * ordering vs checkout.session.completed). First match by
 * contributions.stripe_payment_intent_id; else by
 * payment_intent.metadata.contribution_id, storing the intent id too.
 */
async function handlePaymentIntentSucceeded(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const { data: existingData, error: lookupError } = await supabase
    .from("contributions")
    .select("id, status")
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Lookup by payment intent ${paymentIntent.id} failed: ${lookupError.message}`,
    );
  }

  const existing = existingData as Pick<
    ContributionRow,
    "id" | "status"
  > | null;

  if (existing) {
    if (existing.status !== "pending") return; // already confirmed elsewhere
    const { error } = await supabase
      .from("contributions")
      .update({ status: "confirmed" })
      .eq("id", existing.id)
      .eq("status", "pending");
    if (error) {
      throw new Error(
        `Failed to confirm contribution ${existing.id}: ${error.message}`,
      );
    }
    return;
  }

  const contributionId = paymentIntent.metadata.contribution_id;
  if (!contributionId) return; // not one of ours (e.g. Premium purchase)

  const { error: fallbackError } = await supabase
    .from("contributions")
    .update({ status: "confirmed", stripe_payment_intent_id: paymentIntent.id })
    .eq("id", contributionId)
    .eq("status", "pending");
  if (fallbackError) {
    throw new Error(
      `Fallback confirmation of contribution ${contributionId} failed: ${fallbackError.message}`,
    );
  }
}

/**
 * checkout.session.expired — the guest opened Checkout but never paid.
 * The pending card row would otherwise sit in the couple's feed forever.
 */
async function handleCheckoutSessionExpired(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const contributionId = session.metadata?.contribution_id;
  if (!contributionId) return; // not one of ours

  const { error } = await supabase
    .from("contributions")
    .update({ status: "failed" })
    .eq("id", contributionId)
    .eq("method", "card")
    .eq("status", "pending");
  if (error) {
    throw new Error(
      `Failed to expire contribution ${contributionId}: ${error.message}`,
    );
  }
}

/**
 * account.updated — flip weddings.stripe_onboarded once the connected
 * account can take charges. Wedding is located via account.id against
 * weddings.stripe_account_id.
 */
async function handleAccountUpdated(
  supabase: SupabaseClient,
  account: Stripe.Account,
): Promise<void> {
  if (!(account.charges_enabled && account.details_submitted)) return;

  const { error } = await supabase
    .from("weddings")
    .update({ stripe_onboarded: true })
    .eq("stripe_account_id", account.id);
  if (error) {
    throw new Error(
      `Failed to mark wedding onboarded for account ${account.id}: ${error.message}`,
    );
  }
}

/**
 * Runs the business-logic switch for one claimed gate row, then marks it
 * processed/failed (update, never delete — H09: keeps a durable trail and
 * means a crash right after commit still leaves an honest status instead of
 * silently vanishing). Handlers are themselves re-run safe (status-guarded
 * updates / idempotent sets — see per-handler comments), so reclaiming and
 * re-running a stuck row is safe even if the first attempt partially ran.
 */
async function runHandler(
  supabase: SupabaseClient,
  event: Stripe.Event,
  gateId: number,
): Promise<Response> {
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Premium Boda purchases are a different flow entirely (platform
        // account, no contribution row) — dispatch before touching the
        // guest-contribution logic below.
        if (session.metadata?.type === "premium") {
          await handlePremiumCheckoutCompleted(supabase, session, event.id);
        } else {
          await handleCheckoutSessionCompleted(supabase, session);
        }
        break;
      }
      // Klarna y otros métodos asíncronos: el cobro se confirma después
      // de la sesión. Mismo handler (ya exige payment_status "paid").
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.metadata?.type === "premium") {
          await handlePremiumCheckoutCompleted(supabase, session, event.id);
        } else {
          await handleCheckoutSessionCompleted(supabase, session);
        }
        break;
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await handleCheckoutSessionExpired(supabase, event.data.object);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(supabase, event.data.object);
        break;
      case "account.updated":
        await handleAccountUpdated(supabase, event.data.object);
        break;
      default:
        // Ignore other event types — acknowledged below.
        break;
    }
  } catch (handlerError) {
    console.error(`Handler for ${event.type} (${event.id}) failed:`, handlerError);
    const { error: markFailedError } = await supabase
      .from("events")
      .update({ payload: gatePayload(event, "failed") })
      .eq("id", gateId);
    if (markFailedError) {
      // Worst case: the row stays "processing" and is only reclaimed once
      // its lease expires — still bounded, unlike the old silent-stuck case.
      console.error(
        `Could not mark gate row ${gateId} failed for ${event.id}:`,
        markFailedError,
      );
    }
    return new Response("Handler failed", { status: 500 });
  }

  const { error: markProcessedError } = await supabase
    .from("events")
    .update({ payload: gatePayload(event, "processed") })
    .eq("id", gateId);
  if (markProcessedError) {
    // The business effect already committed above (handlers are idempotent
    // on retry), so acking 200 here is still correct. Only this row's own
    // status is stale; a redelivery past the lease would just re-run a
    // handler that finds nothing left to do.
    console.error(
      `Could not mark gate row ${gateId} processed for ${event.id}:`,
      markProcessedError,
    );
  }
  return new Response("ok", { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Misconfiguration on our side — let Stripe retry once it is fixed.
    console.error("STRIPE_WEBHOOK_SECRET is not set.");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe signature verification failed:", error);
    return new Response("Invalid signature", { status: 400 });
  }

  // Idempotency gate: claim the event id before doing any work (status
  // "processing"). An insert conflict means a gate row already exists —
  // inspect it below instead of blindly acking (H09).
  const supabase = createServiceRoleClient();
  const { data: inserted, error: insertError } = await supabase
    .from("events")
    .insert({ type: `stripe_webhook:${event.type}`, payload: gatePayload(event, "processing") })
    .select("id")
    .single();

  if (!insertError) {
    return runHandler(supabase, event, (inserted as { id: number }).id);
  }

  if (insertError.code !== UNIQUE_VIOLATION) {
    // Unexpected DB error: 200 would ack an event we did not record.
    // Non-2xx makes Stripe retry later.
    console.error("Failed to record Stripe event:", insertError);
    return new Response("Event storage failed", { status: 500 });
  }

  const { data: existingRow, error: selectError } = await supabase
    .from("events")
    .select("id, payload")
    .eq("payload->>stripe_event_id", event.id)
    .maybeSingle();

  if (selectError || !existingRow) {
    console.error(`Could not read existing gate row for ${event.id}:`, selectError);
    return new Response("Event storage failed", { status: 500 });
  }

  const existing = existingRow as { id: number; payload: Partial<GatePayload> };

  if (existing.payload.status === "processed") {
    return new Response("already processed", { status: 200 });
  }

  if (existing.payload.status === "processing" && !isLeaseExpired(existing.payload.claimed_at)) {
    // A genuinely concurrent delivery is still inside its lease: do not ack
    // and do not run the handler twice at once. Stripe retries later.
    return new Response("processing", { status: 409 });
  }

  // "failed", or a "processing" claim whose lease expired — its process
  // almost certainly died mid-handler, the exact gap H09 closes. Reclaim
  // and actually redo the work instead of acking an event nothing finished.
  const { error: claimError } = await supabase
    .from("events")
    .update({ payload: gatePayload(event, "processing") })
    .eq("id", existing.id);
  if (claimError) {
    console.error(`Could not reclaim gate row for ${event.id}:`, claimError);
    return new Response("Event storage failed", { status: 500 });
  }

  return runHandler(supabase, event, existing.id);
}
