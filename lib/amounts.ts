/**
 * Parsing de importes escritos por personas en es-ES.
 *
 * Acepta: "150" · "150,5" · "150.50" · "1.000" · "1.000,50" · "1 000,50" · "150 €"
 * Devuelve céntimos (entero) o null si el texto no es un importe.
 *
 * Regla para el punto, que en es-ES es separador de miles y en teclados
 * anglos es decimal: si hay punto Y coma, los puntos son de miles; si solo
 * hay puntos y TODOS agrupan de tres en tres ("1.000", "12.345.678"), son de
 * miles; en cualquier otro caso ("150.50") el punto es decimal.
 */
export function parseEsAmountToCents(raw: string): number | null {
  let s = raw.replace(/[\s€]/g, "");
  if (s === "") return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Ambos presentes: solo es válido el formato es-ES completo "1.234,56".
    if (!/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
