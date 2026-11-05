import { NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { postLoginPath } from "@/lib/auth/post-login";
import { finishEmailVerification } from "@/lib/auth/pending-password";
import { ALLOWED_TOKEN_HASH_TYPES, clearLoginRequestCookie, tokenHashCallbackDecision } from "@/lib/auth/login-request";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!code && tokenHash && type && ALLOWED_TOKEN_HASH_TYPES.includes(type)) {
    // Anti login-CSRF: un enlace con token_hash solo entra solo si ESTE
    // navegador lo pidió (cookie vk_login_req); si no, pantalla de confirmación.
    const decision = tokenHashCallbackDecision({
      cookieHeader: request.headers.get("cookie"),
      tokenHash,
      type,
    });
    if (decision.action === "confirm") return NextResponse.redirect(`${origin}${decision.path}`);
  }

  const supabase = await createClient();

  let authenticated = false;
  let verifiedUser: Parameters<typeof finishEmailVerification>[1] = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    authenticated = !error;
    verifiedUser = data?.user;
  } else if (tokenHash && type && ALLOWED_TOKEN_HASH_TYPES.includes(type)) {
    // Fallback: enlaces mágicos o de recuperación con token_hash (según plantilla de email).
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    authenticated = !error;
    verifiedUser = data?.user;
  }

  if (!authenticated) {
    // Vuelta de Google sin código (canceló o el proveedor falló): aviso propio,
    // no el de «ese enlace ya no vale» del correo.
    const oauthError = !code && !tokenHash && searchParams.has("error");
    return NextResponse.redirect(`${origin}/login?error=${oauthError ? "google" : "auth"}`);
  }

  // Enlace de «crear o cambiar la contraseña» (también para quien solo
  // entraba con código). Antes de entrar, que elijan una nueva.
  // Verificado por token_hash: la marca anti login-CSRF ya cumplió, se borra.
  const clearMark = (res: NextResponse) => {
    if (tokenHash && !code) res.headers.append("set-cookie", clearLoginRequestCookie(origin.startsWith("https:")));
    return res;
  };
  if (type === "recovery") {
    return clearMark(NextResponse.redirect(`${origin}/login/restablecer`));
  }

  // Contraseña elegida en «Crear cuenta» en este navegador, o aleatoria si el
  // correo se acaba de confirmar sin ella (pre-secuestro).
  if (type !== "email_change") await finishEmailVerification(supabase, verifiedUser);

  // Invitación de pareja pendiente → /unirse; boda (propia o aceptada, por
  // membresía) → /panel; si no → /onboarding.
  const destination = await postLoginPath(supabase);
  return clearMark(NextResponse.redirect(`${origin}${destination}`));
}
