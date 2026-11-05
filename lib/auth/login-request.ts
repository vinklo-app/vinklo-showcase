/**
 * Cookie «este navegador pidió el enlace» (anti login-CSRF).
 *
 * Un enlace con token_hash inicia sesión en QUIEN lo abre. Si un atacante
 * pide un enlace para su cuenta y consigue que la víctima lo abra, la
 * víctima entraría en la cuenta del atacante. Al pedir el enlace, la página
 * de acceso deja `vk_login_req=1` en este navegador; /auth/confirm y
 * /auth/callback solo entran solos si la cookie está presente. Sin ella
 * piden una confirmación explícita. Sin dependencias de servidor: se usa
 * también desde el navegador.
 */

export const LOGIN_REQUEST_COOKIE = "vk_login_req";

/** Tipos de token_hash aceptados por /auth/callback y /auth/confirm. */
export const ALLOWED_TOKEN_HASH_TYPES: readonly string[] = ["email", "magiclink", "signup", "recovery", "invite", "email_change"];
const MAX_AGE_SECS = 60 * 60;

/** Valor de `document.cookie` para marcar la petición (Secure en producción). */
export function loginRequestCookie(secure: boolean): string {
  return `${LOGIN_REQUEST_COOKIE}=1; path=/; max-age=${MAX_AGE_SECS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Valor de `document.cookie` para borrarla. */
export function clearLoginRequestCookie(secure: boolean): string {
  return `${LOGIN_REQUEST_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** true si la cabecera Cookie / document.cookie trae vk_login_req=1. */
export function hasLoginRequestCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim() === `${LOGIN_REQUEST_COOKIE}=1`);
}

/** Navegador: marca que este navegador ha pedido un enlace. */
export function markLoginRequested(): void {
  try {
    document.cookie = loginRequestCookie(location.protocol === "https:");
  } catch { /* Sin cookies: se verá la pantalla de confirmación, no un fallo. */ }
}

/** Navegador: ¿está la marca? */
export function loginWasRequestedHere(): boolean {
  try {
    return hasLoginRequestCookie(document.cookie);
  } catch {
    return false;
  }
}

/** Navegador: borra la marca tras confirmar. */
export function clearLoginRequested(): void {
  try {
    document.cookie = clearLoginRequestCookie(location.protocol === "https:");
  } catch { /* nada */ }
}

/**
 * Decisión del GET /auth/callback con token_hash: verificar ya (cookie
 * presente) o mandar a la pantalla de confirmación conservando los parámetros.
 */
export function tokenHashCallbackDecision(input: {
  cookieHeader: string | null | undefined;
  tokenHash: string;
  type: string;
}): { action: "verify" } | { action: "confirm"; path: string } {
  if (hasLoginRequestCookie(input.cookieHeader)) return { action: "verify" };
  const qs = new URLSearchParams({ token_hash: input.tokenHash, type: input.type });
  return { action: "confirm", path: `/auth/confirm?${qs.toString()}` };
}
