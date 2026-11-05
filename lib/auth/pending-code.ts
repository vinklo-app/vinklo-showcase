/**
 * Recuerda, solo en esta pestaña (sessionStorage), que ya se pidió un código
 * y para qué correo. En el icono de la pantalla de inicio de iPhone la
 * pareja sale a leer el correo y, al volver, iOS suele recargar la página:
 * sin esto volvería al campo del correo, y pedir otro código invalidaría el
 * que tiene en la mano. Caduca antes que el código (1 hora).
 */

export const PENDING_CODE_KEY = "vinklo:login-code";
export const PENDING_CODE_TTL_MS = 55 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function savePendingCode(storage: StorageLike | undefined, email: string, now = Date.now()) {
  try {
    storage?.setItem(PENDING_CODE_KEY, JSON.stringify({ email, sentAt: now }));
  } catch { /* Sin almacenamiento: solo se pierde el atajo al recargar. */ }
}

/** Correo con un código pedido hace menos de 55 minutos, o null. */
export function readPendingCode(storage: StorageLike | undefined, now = Date.now()): string | null {
  try {
    const raw = storage?.getItem(PENDING_CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; sentAt?: unknown };
    if (typeof parsed.email !== "string" || !parsed.email.includes("@") || parsed.email.length > 320) return null;
    if (typeof parsed.sentAt !== "number" || now - parsed.sentAt < 0 || now - parsed.sentAt > PENDING_CODE_TTL_MS) return null;
    return parsed.email;
  } catch {
    return null;
  }
}

export function clearPendingCode(storage: StorageLike | undefined) {
  try {
    storage?.removeItem(PENDING_CODE_KEY);
  } catch { /* nada */ }
}

/** sessionStorage del navegador, o undefined (servidor o bloqueado). */
export function sessionStore(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
