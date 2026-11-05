/**
 * Pure builder for the "Premium Boda" Checkout Session params (no Stripe API
 * calls), so the platform-account wiring is unit-testable.
 *
 * Unlike lib/checkout.ts's contribution flow, this is a PLAIN Checkout
 * Session paid to the platform's own Stripe account — no destination charge,
 * no transfer_data, no connected account. Do not merge the two flows.
 */
import type Stripe from "stripe";

/** Normal price of Premium Boda: 99,00 €. */
export const PREMIUM_PRICE_CENTS = 9900;

/** Launch price for the first PREMIUM_LAUNCH_LIMIT weddings: 79,00 €. */
export const PREMIUM_LAUNCH_PRICE_CENTS = 7900;

/** Number of weddings that qualify for the launch price. */
export const PREMIUM_LAUNCH_LIMIT = 20;

/** Contributions included in the free plan (Premium removes the cap). */
export const FREE_CONTRIBUTION_LIMIT = 30;

export interface PremiumCheckoutInput {
  /** id of the wedding upgrading, stored in metadata to resolve on webhook. */
  weddingId: string;
  /** Public slug of the wedding, e.g. "maria-y-jorge". */
  weddingSlug: string;
  /** Absolute origin of the app, no trailing slash, e.g. https://vinklo.es */
  appUrl: string;
  /** true if this wedding is among the first PREMIUM_LAUNCH_LIMIT premium sales. */
  launch: boolean;
}

/**
 * Builds the Checkout Session params for a Premium Boda purchase: a single
 * one-time line item charged to the platform's own Stripe account. Metadata
 * carries `type: "premium"` and `wedding_id` both at the session level and
 * on payment_intent_data, so the webhook can resolve it whether it sees a
 * checkout.session.completed or a payment_intent.succeeded event first.
 */
export function buildPremiumCheckoutParams({
  weddingId,
  appUrl,
  launch,
}: PremiumCheckoutInput): Stripe.Checkout.SessionCreateParams {
  const metadata = { type: "premium", wedding_id: weddingId };
  const unitAmount = launch ? PREMIUM_LAUNCH_PRICE_CENTS : PREMIUM_PRICE_CENTS;

  return {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: unitAmount,
          product_data: {
            name: "Premium Boda — vinklo",
            description: "Pago único para toda la boda",
          },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      metadata,
    },
    success_url: `${appUrl}/panel?premium=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/panel`,
  };
}
