"use server";

/**
 * Verificación del enlace mágico (token_hash) EN EL SERVIDOR.
 *
 * La página /auth/confirm sigue llamando aquí con JavaScript al cargarse
 * (los robots de prefetch de Apple Mail no ejecutan JS y no queman el
 * enlace), pero la sesión ya no la escribe el navegador con
 * `document.cookie`: la ponen las cabeceras Set-Cookie de esta acción.
 * Safari (ITP) limita a 7 días las cookies escritas por JavaScript; las
 * puestas por HTTP duran lo que diga su maxAge (400 días en @supabase/ssr),
 * así una pareja que entra y vuelve a las dos semanas sigue dentro.
 */
import type { EmailOtpType } from "@supabase/supabase-js";

import { postLoginPath } from "@/lib/auth/post-login";
import { finishEmailVerification } from "@/lib/auth/pending-password";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "recovery", "invite", "email_change"];

export type ConfirmResult = { ok: true; to: string } | { ok: false };

export async function confirmEmailLinkAction(input: { tokenHash: unknown; type: unknown }): Promise<ConfirmResult> {
  const tokenHash = typeof input.tokenHash === "string" ? input.tokenHash.trim() : "";
  const type = (typeof input.type === "string" ? input.type : "email") as EmailOtpType;
  if (!tokenHash || tokenHash.length > 512 || !ALLOWED_TYPES.includes(type)) return { ok: false };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return { ok: false };
    // Crear o cambiar la contraseña: primero, la nueva.
    if (type === "recovery") return { ok: true, to: "/login/restablecer" };
    // Contraseña elegida en «Crear cuenta» en este navegador, o aleatoria si
    // el correo se acaba de confirmar sin ella (pre-secuestro).
    if (type !== "email_change") await finishEmailVerification(supabase, data?.user);
    // Invitación de pareja pendiente (/unirse), panel u onboarding.
    return { ok: true, to: await postLoginPath(supabase) };
  } catch {
    return { ok: false };
  }
}
