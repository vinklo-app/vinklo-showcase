/**
 * ¿La sesión actual viene de un enlace de recuperación de contraseña?
 *
 * Supabase pone en el JWT del acceso la claim `amr`: una lista de
 * `{ method, timestamp }` con los métodos usados para autenticar. Tras
 * verificar un enlace `type=recovery` aparece `method: "recovery"`. Sin él
 * (sesión de enlace mágico, código, contraseña…) /login/restablecer no debe
 * dejar cambiar la contraseña.
 *
 * Es solo una puerta de UX: no verifica la firma. La barrera real es que
 * `updateUser` exige una sesión válida en el servidor de Auth.
 */

type Claims = { amr?: unknown } | null | undefined;

/** Decodifica el payload (base64url → JSON) de un JWT. null si no es válido. */
export function decodeJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** true si `amr` contiene el método "recovery". */
export function isRecoverySession(claims: Claims): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === "string") return entry === "recovery";
    return !!entry && typeof entry === "object" && (entry as { method?: unknown }).method === "recovery";
  });
}

/** Atajo: access_token de la sesión → ¿es de recuperación? */
export function isRecoveryAccessToken(token: string | null | undefined): boolean {
  return isRecoverySession(decodeJwtClaims(token));
}
