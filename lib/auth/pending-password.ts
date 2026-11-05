import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Contraseña elegida al «Crear cuenta», pendiente de que se verifique el correo.
 *
 * Por qué existe (revisión de seguridad del 13-oct-2026):
 *  - F3: si el correo ya tenía cuenta (entraba con código), Supabase no guarda
 *    la contraseña nueva y la pareja la perdía en silencio. Aquí se guarda,
 *    cifrada, en una cookie httpOnly de este navegador y se aplica en cuanto
 *    el código o el enlace demuestran que el correo es suyo.
 *  - F9: alguien podría dejar creada una cuenta sin confirmar para un correo
 *    ajeno con una contraseña que conoce; si el dueño real confirma después
 *    con código o enlace, esa contraseña seguiría valiendo. Si el correo se
 *    confirma ahora mismo y este navegador no trae una contraseña elegida para
 *    él, se cambia la contraseña por una aleatoria (nadie la conoce).
 *
 * Cifrado AES-256-GCM con una clave derivada (HKDF) de un secreto de servidor
 * que ya existe. Sin ninguno, no se guarda nada: la pareja entra igual y puede
 * crear la contraseña con el enlace de recuperación.
 */

export const PENDING_PASSWORD_COOKIE = "vk_pending_pw";
export const PENDING_PASSWORD_TTL_SECS = 60 * 60; // lo que dura el código del correo
/** Margen para considerar que la confirmación del correo es «de ahora». */
export const FRESH_CONFIRMATION_MS = 2 * 60 * 1000;

function serverSecret(): string | null {
  return process.env.RATE_LIMIT_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "vinklo", "pending-password-v1", 32));
}

export function sealPendingPassword(
  email: string,
  password: string,
  now = Date.now(),
  secret: string | null = serverSecret(),
): string | null {
  if (!secret) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const plain = JSON.stringify({ e: email.trim().toLowerCase(), p: password, x: now + PENDING_PASSWORD_TTL_SECS * 1000 });
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openPendingPassword(
  token: string | null | undefined,
  now = Date.now(),
  secret: string | null = serverSecret(),
): { email: string; password: string } | null {
  if (!token || !secret || token.length > 2048) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const data = JSON.parse(plain) as { e?: unknown; p?: unknown; x?: unknown };
    if (typeof data.e !== "string" || typeof data.p !== "string" || typeof data.x !== "number") return null;
    if (now > data.x) return null;
    return { email: data.e, password: data.p };
  } catch {
    return null; // manipulada, de otra clave o corrupta
  }
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** Guarda la contraseña elegida (cifrada) en este navegador. Nunca rompe el registro. */
export async function rememberPendingPassword(email: string, password: string): Promise<void> {
  try {
    const sealed = sealPendingPassword(email, password);
    if (!sealed) return;
    (await cookies()).set(PENDING_PASSWORD_COOKIE, sealed, cookieOptions(PENDING_PASSWORD_TTL_SECS));
  } catch {
    /* Sin cookie: se podrá crear la contraseña con el enlace de recuperación. */
  }
}

type VerifiedUser = { id: string; email?: string | null; email_confirmed_at?: string | null } | null | undefined;

/**
 * Tras verificar un código o enlace del correo (no de recuperación):
 *  - si este navegador trae la contraseña elegida para ESE correo, se aplica;
 *  - si no, y el correo se acaba de confirmar, contraseña aleatoria (F9).
 * La cookie se borra siempre. Nada de esto impide entrar.
 */
export async function finishEmailVerification(
  supabase: SupabaseClient,
  user: VerifiedUser,
  now = Date.now(),
): Promise<void> {
  if (!user?.id) return;
  let pending: { email: string; password: string } | null = null;
  try {
    const jar = await cookies();
    const token = jar.get(PENDING_PASSWORD_COOKIE)?.value;
    if (token) {
      pending = openPendingPassword(token, now);
      jar.set(PENDING_PASSWORD_COOKIE, "", cookieOptions(0));
    }
  } catch {
    /* Sin cookies legibles: se sigue como si no hubiera contraseña pendiente. */
  }

  const email = user.email?.trim().toLowerCase();
  if (pending && email && pending.email === email) {
    // Con la sesión recién creada. Si es la misma que ya tenía (cuenta nueva
    // confirmada en este navegador), Auth responde «igual»: no pasa nada.
    try {
      const { error } = await supabase.auth.updateUser({ password: pending.password });
      if (error && error.status && error.status >= 500) console.error("[auth] pending password not applied", error.status);
    } catch {
      console.error("[auth] pending password not applied");
    }
    return;
  }

  const confirmedAt = user.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN;
  if (Number.isFinite(confirmedAt) && now - confirmedAt >= -FRESH_CONFIRMATION_MS && now - confirmedAt <= FRESH_CONFIRMATION_MS) {
    try {
      const { error } = await createAdminClient().auth.admin.updateUserById(user.id, {
        password: randomBytes(32).toString("base64url"),
      });
      if (error) console.error("[auth] fresh-confirmation password reset failed", error.status);
    } catch {
      console.error("[auth] fresh-confirmation password reset failed");
    }
  }
}
