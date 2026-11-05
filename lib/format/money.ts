/**
 * Dinero en céntimos → texto es-ES, a mano (DESIGN.md §3: Intl no es fiable
 * en todos los builds). Un solo núcleo para el panel de regalos, el
 * presupuesto, el admin y los CSV; cada sitio conserva su salida exacta
 * mediante opciones (lo fijan los tests de caracterización).
 *
 * `lib/fees.ts formatEurCents` NO pasa por aquí: usa Intl (NBSP antes del €,
 * sin separador de miles en cuatro cifras) y es la cifra de cobros y emails.
 */

export interface FormatEurosOptions {
  /** «auto»: sin «,00» si no hay céntimos (defecto) · «always»: siempre dos decimales · «never»: solo euros. */
  cents?: "auto" | "always" | "never";
  /** Signo de los negativos: guion ASCII (defecto) o menos tipográfico U+2212. */
  minus?: "hyphen" | "typographic";
  /** Céntimos fraccionarios: «round» (defecto) o «trunc». Con enteros es idéntico. */
  rounding?: "round" | "trunc";
}

/** 1234567 → «1.234.567». Solo enteros no negativos. */
export function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 125000 → «1.250 €» · 125050 → «1.250,50 €». No finito → «0 €». */
export function formatEuros(cents: number, opts: FormatEurosOptions = {}): string {
  if (!Number.isFinite(cents)) return "0 €";
  const { cents: mode = "auto", minus = "hyphen", rounding = "round" } = opts;
  const abs = rounding === "round" ? Math.round(Math.abs(cents)) : Math.trunc(Math.abs(cents));
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  const sign = cents < 0 ? (minus === "typographic" ? "−" : "-") : "";
  const decimals = mode === "never" || (mode === "auto" && !rest) ? "" : `,${String(rest).padStart(2, "0")}`;
  return `${sign}${groupThousands(euros)}${decimals} €`;
}

/** 15000 → «150,00»: coma decimal, sin miles ni símbolo (celdas de CSV y campos de importe). */
export function centsToDecimalComma(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
