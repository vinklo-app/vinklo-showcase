/**
 * Tope de acompañantes por invitación (plan maestro §4.2, 20261021110000).
 * Puro (cliente y servidor). null = sin límite (hasta 10); 0 = solo esa persona.
 */

export const MAX_COMPANIONS = 10;

/** Lo que escribe la pareja en el campo: "" → null (sin límite); números fuera de 0–10 se acotan; enteros. */
export function parseCompanionLimit(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_COMPANIONS, Math.max(0, Math.trunc(value)));
}
