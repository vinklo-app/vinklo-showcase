/**
 * Piezas compartidas del flujo /unirse (segunda cuenta de pareja).
 * Sin "server-only": los mensajes también los pinta el cliente.
 */

/** Cookie httpOnly con el token mientras la persona invitada entra por /login. */
export const JOIN_COOKIE = "vinklo_unirse";

/** Tokens de 32 bytes en base64url (43 caracteres); el SQL admite 32–128. */
export const JOIN_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export type AcceptCode =
  | "ok"
  | "already_member"
  | "invalid"
  | "used"
  | "expired"
  | "email_mismatch"
  | "has_wedding"
  | "full"
  | "unauthenticated";

const MESSAGES: Record<AcceptCode, string> = {
  ok: "",
  already_member: "",
  invalid: "Este enlace no es válido. Pedid a vuestra pareja que os envíe la invitación de nuevo.",
  used: "Esta invitación ya se ha usado. Si eras tú, entra con el mismo correo; si no, pide otra.",
  expired: "Esta invitación ha caducado. Pide a tu pareja que la reenvíe desde Ajustes.",
  email_mismatch: "Has entrado con un correo distinto al invitado. Sal y entra con el correo en el que recibiste la invitación.",
  has_wedding: "Tu cuenta ya gestiona otra boda. Cada cuenta lleva una sola boda: entra con otro correo o pide a tu pareja que invite a esa cuenta.",
  full: "Esta boda ya tiene a sus dos personas. Si es un error, pedid que os quiten el acceso anterior.",
  unauthenticated: "Tu sesión ha caducado. Vuelve a entrar con tu correo.",
};

export function acceptErrorMessage(code: AcceptCode | string): string {
  return MESSAGES[code as AcceptCode] || "No hemos podido completar la invitación. Probad de nuevo en un momento.";
}
