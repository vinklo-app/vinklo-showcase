/**
 * Confirmación tras borrar la boda o la cuenta (plan maestro §5.10).
 *
 * La server action deja una cookie corta (no httpOnly, 2 min) y redirige a
 * «/»; la landing la lee en el cliente, enseña el aviso y la borra. Así la
 * landing sigue siendo estática (sin searchParams ni cookies en el servidor).
 * Client-safe: sin dependencias de servidor.
 */
export const DELETION_NOTICE_COOKIE = "vinklo_aviso";
export const DELETION_NOTICE_MAX_AGE = 120;

export type DeletionNoticeKind = "boda" | "cuenta";

export const DELETION_NOTICE_TEXT: Record<DeletionNoticeKind, string> = {
  boda: "Hemos eliminado vuestra boda: la web, los invitados, sus respuestas y las fotos.",
  cuenta: "Hemos eliminado tu cuenta. Gracias por haber preparado vuestra boda con nosotros.",
};

/** Lee el aviso de una cadena `document.cookie`. */
export function readDeletionNotice(cookieString: string): DeletionNoticeKind | null {
  for (const part of cookieString.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === DELETION_NOTICE_COOKIE && (value === "boda" || value === "cuenta")) return value;
  }
  return null;
}

/** El nombre de la boda escrito para confirmar: sin espacios ni mayúsculas. */
export function normalizeConfirmation(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
