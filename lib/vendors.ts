/**
 * Pure helpers for the vendor portal (PLAN.md §1, M2): the category set
 * shared between the invite form and the read-only vendor view, and a
 * loose Spanish IBAN check. No Supabase/Next imports here on purpose —
 * kept testable without mocks.
 */

export const VENDOR_CATEGORIES = [
  "finca",
  "catering",
  "fotografia",
  "musica",
  "flores",
  "otros",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  finca: "Finca",
  catering: "Catering",
  fotografia: "Fotografía",
  musica: "Música",
  flores: "Flores",
  otros: "Otros",
};

/** Between 1 and 6 tranches per vendor (real contracts rarely need more). */
export const MIN_TRANCHES = 1;
export const MAX_TRANCHES = 6;

/** Invoice PDF size cap. */
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/**
 * Loose structural check for a Spanish IBAN: "ES" + 22 digits (24 chars
 * total once spaces are stripped). No MOD-97 checksum — this is a
 * friendly typo-catcher for a form field, not a bank-grade validator.
 */
export function isValidIbanEs(raw: string): boolean {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return /^ES\d{22}$/.test(compact);
}

/** Normalizes an IBAN for storage: uppercase, no spaces. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
