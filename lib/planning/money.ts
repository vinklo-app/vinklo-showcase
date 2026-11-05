/**
 * Importes del presupuesto de la pareja: enteros en céntimos, nunca coma
 * flotante. Se leen de lo que escribe la pareja («1.200», «1200,50»,
 * «1 200 €») con aritmética de texto y se pintan en formato de España.
 * Son ANOTACIONES de la pareja: Vinklo no cobra ni mueve dinero.
 * Módulo puro: lo usan servidor y cliente.
 */
import { formatEuros as formatEurosBase } from "@/lib/format/money";

/** Tope por importe: 9.999.999,99 € (cabe en int4 y en las sumas de JS). */
export const MAX_CENTS = 999_999_999;

export type ParsedEuros = { ok: true; cents: number | null } | { ok: false; error: string };

const INVALID = "Escribid el importe en euros, por ejemplo 1.200 o 1.200,50.";
const TOO_BIG = "El importe es demasiado alto.";

/**
 * Texto → céntimos. Vacío = sin dato (null).
 *  - Con coma: la coma es el decimal y los puntos/espacios son miles («1.234,5» → 123450).
 *  - Sin coma: «1.200» o «1.200.000» (grupos de tres) son miles; «12.5» o «12.50»
 *    (uno o dos decimales) es decimal con punto, como en un teclado numérico.
 *  - Más de dos decimales, signos o letras: inválido. Negativos: inválidos.
 */
export function parseEuros(input: string): ParsedEuros {
  const raw = (input ?? "").replace(/[\s  ]/g, "").replace(/€|eur(os?)?$/i, "");
  if (raw === "") return { ok: true, cents: null };
  let whole: string;
  let fraction = "";
  if (raw.includes(",")) {
    const [left, right, ...rest] = raw.split(",");
    if (rest.length > 0 || right === undefined || !/^\d{0,2}$/.test(right)) return { ok: false, error: INVALID };
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(left)) return { ok: false, error: INVALID };
    whole = left.replace(/\./g, "");
    fraction = right;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    whole = raw.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    [whole, fraction] = raw.split(".");
  } else if (/^\d+$/.test(raw)) {
    whole = raw;
  } else {
    return { ok: false, error: INVALID };
  }
  if (whole.length > 9) return { ok: false, error: TOO_BIG };
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: TOO_BIG };
  return { ok: true, cents };
}

/** 123450 → «1.234,50 €»; 120000 → «1.200 €» (sin «,00»). Siempre agrupa miles; negativos con «−» (U+2212). */
export function formatEuros(cents: number): string {
  return formatEurosBase(cents, { minus: "typographic", rounding: "trunc" });
}

/** Céntimos → lo que se muestra en un campo editable («1.200» o «1.200,50»); null → "". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return formatEuros(cents).replace(/ €$/, "");
}
