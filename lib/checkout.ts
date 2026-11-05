/**
 * Pure builders for Stripe Checkout params (no Stripe API calls),
 * so the destination-charge wiring is unit-testable.
 */
import type Stripe from "stripe";

export interface ContributionCheckoutInput {
  /** Public slug of the wedding, e.g. "maria-y-jorge". */
  weddingSlug: string;
  /** Connected Stripe account of the couple (acct_...). */
  stripeAccountId: string;
  /** Cubierto amount in integer cents — the couple receives 100% of this. */
  contributionCents: number;
  /** Guest service fee in integer cents — kept by the platform. */
  feeCents: number;
  /** Name of the contributing guest (shown on the line item). */
  guestName: string;
  /** Absolute origin of the app, no trailing slash, e.g. https://vinklo.es */
  appUrl: string;
}

/**
 * Builds the Checkout Session params for a guest contribution:
 * destination charge to the couple's connected account, with the guest
 * paying the service fee on top (application_fee_amount = feeCents).
 */
export function buildContributionCheckoutParams({
  weddingSlug,
  stripeAccountId,
  contributionCents,
  feeCents,
  guestName,
  appUrl,
}: ContributionCheckoutInput): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    // Klarna: "Paga en 3" sin intereses (spec 2026-07-08). Stripe decide la
    // elegibilidad por invitado (mínimo 35 € en España); la pareja cobra el
    // total al instante igualmente — Klarna asume el cobro a plazos.
    payment_method_types: ["card", "klarna"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: contributionCents,
          product_data: {
            name: `Cubierto de ${guestName}`,
            description: "Vuestra aportación para los novios",
          },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: feeCents,
          product_data: {
            name: "Gastos de gestión",
          },
        },
      },
    ],
    payment_intent_data: {
      transfer_data: {
        destination: stripeAccountId,
      },
      application_fee_amount: feeCents,
    },
    success_url: `${appUrl}/b/${weddingSlug}/gracias?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/b/${weddingSlug}`,
  };
}
