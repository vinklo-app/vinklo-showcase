/**
 * Server-only Stripe client singleton.
 *
 * Lazy init: the client is only constructed on first use, so a missing
 * STRIPE_SECRET_KEY does not crash `next build` — it fails at request time
 * with a clear message instead.
 */
import "server-only";
import Stripe from "stripe";

/**
 * API version pinned to the one stripe-node 22.x ships with
 * (node_modules/stripe/cjs/apiVersion.js).
 */
export const STRIPE_API_VERSION = "2026-06-24.dahlia";

let stripeSingleton: Stripe | null = null;

/** Returns the shared Stripe client, creating it on first call. */
export function getStripe(): Stripe {
  if (stripeSingleton === null) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Add it to .env.local (see .env.local.example).",
      );
    }
    stripeSingleton = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: "vinklo" },
    });
  }
  return stripeSingleton;
}
