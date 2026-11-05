/**
 * Fee math for vinklo — guest-pays model (ticketing style).
 *
 * ALL amounts are integer euro cents. The guest pays the service fee on top
 * of the contribution; the couple receives 100% of the cubierto.
 */

/**
 * Variable part of the guest service fee: 1,9 %.
 * (Decisión 2026-07-07: bajar de 2,95 % + 0,45 € apostando por volumen.
 * Suelo estructural: Stripe cuesta ~1,5 % + 0,25 € del cargo total — por
 * debajo de eso se pierde dinero en CADA transacción.)
 */
export const SERVICE_FEE_RATE = 0.019;

/** Fixed part of the guest service fee: 0,95 €. */
export const SERVICE_FEE_FIXED_CENTS = 95;

/** Minimum total fee per transaction: 1,50 €. */
export const SERVICE_FEE_MIN_CENTS = 150;

function assertValidCents(contributionCents: number): void {
  if (!Number.isInteger(contributionCents)) {
    throw new RangeError(
      `contributionCents must be an integer number of cents, got ${contributionCents}`,
    );
  }
  if (contributionCents < 0) {
    throw new RangeError(
      `contributionCents must be >= 0, got ${contributionCents}`,
    );
  }
}

/**
 * Service fee (in cents) the guest pays on top of their contribution.
 * fee = max(round(contribution * 1,9 %) + 95¢, 150¢)
 */
export function serviceFeeCents(contributionCents: number): number {
  assertValidCents(contributionCents);
  return Math.max(
    Math.round(contributionCents * SERVICE_FEE_RATE) + SERVICE_FEE_FIXED_CENTS,
    SERVICE_FEE_MIN_CENTS,
  );
}

/** Total the guest is charged: contribution + service fee, in cents. */
export function totalChargeCents(contributionCents: number): number {
  return contributionCents + serviceFeeCents(contributionCents);
}

const eurFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

/** Formats integer cents as es-ES currency, e.g. 15000 → "150,00 €". */
export function formatEurCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be an integer, got ${cents}`);
  }
  return eurFormatter.format(cents / 100);
}
