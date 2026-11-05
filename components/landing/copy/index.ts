import { en } from "@/components/landing/copy/en";
import { es, type LandingCopy } from "@/components/landing/copy/es";

/** Idiomas de la landing: español en / (por defecto) e inglés en /en. */
export type Locale = "es" | "en";

const COPY: Record<Locale, LandingCopy> = { es, en };

export function landingCopy(locale: Locale = "es"): LandingCopy {
  return COPY[locale];
}

export type { LandingCopy };
