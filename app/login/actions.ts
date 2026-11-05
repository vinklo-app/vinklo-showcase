"use server";

/**
 * Acceso por contraseña y por código de /login.
 *
 * - Contraseña (13-oct-2026, Task 10): las parejas pueden crear la cuenta con
 *   correo + contraseña (`signUpWithPasswordAction`) y entrar con ella
 *   (`signInWithPasswordAction`). El enlace/código por correo sigue igual.
 * - Sin enumeración de cuentas: crear cuenta responde lo mismo exista o no el
 *   correo («revisad vuestro correo»), y entrar da el mismo error si la cuenta
 *   no existe o la contraseña está mal.
 * - Crear cuenta no llama a `signUp`: envía el código y la contraseña se
 *   aplica al verificarlo en este navegador (lib/auth/pending-password.ts).
 * - Rate limit por IP y por correo (rl_check, fail-closed) ANTES de tocar Supabase Auth.
 * - Mismo destino que /auth/callback: /unirse, /panel o /onboarding.
 *
 * 2026-10-08: aquí vive también `verifyLoginCodeAction`, el acceso de las
 * parejas con el código de 6 cifras del correo (alternativa al enlace).
 */
import { redirect } from "next/navigation";
import { z } from "zod";

import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { postLoginPath } from "@/lib/auth/post-login";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password-strength";
import { finishEmailVerification, rememberPendingPassword } from "@/lib/auth/pending-password";

/** `needsCode`: la cuenta existe pero falta confirmar el correo; se ha reenviado el código. */
export type PasswordLoginState = { error: string | null; email: string; needsCode?: boolean };

const MAX_ATTEMPTS = 5;
const WINDOW_SECS = 15 * 60;

const schema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(200),
});

const ERRORS = {
  invalid: "Escribid un correo válido y la contraseña.",
  captcha: "No hemos podido comprobar que sois personas. Esperad un segundo y probad de nuevo.",
  credentials: "El correo o la contraseña no son correctos.",
  limited: "Demasiados intentos. Esperad unos minutos y probad de nuevo.",
  generic: "No hemos podido entrar. Probad de nuevo en un momento.",
} as const;

/**
 * Token del CAPTCHA (Cloudflare Turnstile, app/login/captcha.tsx). Supabase lo
 * exige solo con la protección activada; sin ella lo ignora.
 */
function captchaToken(formData: FormData): string | undefined {
  const token = String(formData.get("captchaToken") ?? "").slice(0, 4096);
  return token || undefined;
}

/** Supabase rechazó el token: caducado, ya usado o ausente. */
const isCaptchaError = (error: { code?: string }) => error.code === "captcha_failed";

export type PasswordResetState = { sent: boolean; error: string | null };

const resetSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });

/**
 * Solicita el correo para crear o cambiar la contraseña. Sirve también a
 * quien entraba solo con enlace/código (no tiene contraseña): el enlace de
 * recuperación le deja elegir una. Mismo rate limit fail-closed que el
 * login; el mensaje de éxito es idéntico exista o no la cuenta.
 */
export async function requestPasswordResetAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsed = resetSchema.safeParse({ email: formData.get("email") ?? "" });
  if (!parsed.success) return { sent: false, error: ERRORS.invalid };
  const { email } = parsed.data;

  const allowed = await rateLimit("login-password-reset", await clientIp(), MAX_ATTEMPTS, WINDOW_SECS);
  if (!allowed) return { sent: false, error: ERRORS.limited };
  // Y por correo: ahora está enlazado para todos y cambiar de IP no debe
  // permitir inundar el buzón de alguien con enlaces.
  const allowedEmail = await rateLimit("login-password-reset-email", email, MAX_ATTEMPTS, WINDOW_SECS);
  if (!allowedEmail) return { sent: false, error: ERRORS.limited };

  const supabase = await createClient();
  // La plantilla de "recovery" en Supabase enlaza directo a
  // /auth/confirm?token_hash=...&type=recovery (evita el prefetch de Apple
  // Mail); redirectTo es solo un valor de reserva si algo usa {{ .ConfirmationURL }}.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login/restablecer`,
    captchaToken: captchaToken(formData),
  });
  if (error && isCaptchaError(error)) return { sent: false, error: ERRORS.captcha };
  if (error && error.status && error.status >= 500) {
    console.error("[login] password reset request failed", error.status);
    return { sent: false, error: ERRORS.generic };
  }
  return { sent: true, error: null };
}

export async function signInWithPasswordAction(
  _prev: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const rawEmail = String(formData.get("email") ?? "").slice(0, 320);
  const parsed = schema.safeParse({ email: rawEmail, password: formData.get("password") ?? "" });
  if (!parsed.success) return { error: ERRORS.invalid, email: rawEmail };
  const { email, password } = parsed.data;

  // Fail-closed: si el limitador no está disponible también se bloquea.
  const allowed = await rateLimit("login-password", await clientIp(), MAX_ATTEMPTS, WINDOW_SECS);
  if (!allowed) return { error: ERRORS.limited, email };
  // Y por correo: el límite por IP se esquiva cambiando de red.
  const allowedEmail = await rateLimit("login-password-email", email, MAX_ATTEMPTS, WINDOW_SECS);
  if (!allowedEmail) return { error: ERRORS.limited, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: captchaToken(formData) },
  });
  if (error) {
    if (isCaptchaError(error)) return { error: ERRORS.captcha, email };
    // 400 invalid_credentials → mismo mensaje exista o no la cuenta.
    // 429 del propio Auth → mensaje de espera.
    if (error.status === 429) return { error: ERRORS.limited, email };
    // Cuenta creada con contraseña sin confirmar el correo. Auth solo lo dice
    // tras comprobar la contraseña (GoTrue valida la contraseña antes que la
    // confirmación), así que no revela nada a quien no la sabe: se reenvía el
    // correo y se ofrece el código.
    if (error.code === "email_not_confirmed") {
      await supabase.auth
        .resend({ type: "signup", email, options: { emailRedirectTo: callbackUrl() } })
        .catch(() => undefined);
      // Es su contraseña (Auth la acaba de aceptar): que siga valiendo al confirmar.
      await rememberPendingPassword(email, password);
      return { error: null, email, needsCode: true };
    }
    if (error.status && error.status >= 500) {
      console.error("[login] password sign-in failed", error.status);
      return { error: ERRORS.generic, email };
    }
    return { error: ERRORS.credentials, email };
  }

  // Igual que /auth/callback: invitación pendiente, boda por membresía o crearla.
  const destination = await postLoginPath(supabase);
  // redirect() lanza a propósito: fuera de cualquier try/catch.
  redirect(destination);
}

/** `check-email`: mismo estado tanto si la cuenta es nueva como si ya existía. */
export type SignUpState = { status: "idle" | "check-email"; error: string | null; email: string };

const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // bcrypt (Auth) corta en 72 BYTES, no caracteres: «ñ», tildes o emojis ocupan más.
  password: z
    .string()
    .min(PASSWORD_MIN)
    .max(PASSWORD_MAX)
    .refine((p) => Buffer.byteLength(p, "utf8") <= PASSWORD_MAX),
});

const SIGNUP_ERRORS = {
  invalid: "Escribid un correo válido.",
  password: `La contraseña necesita al menos ${PASSWORD_MIN} caracteres (y como mucho ${PASSWORD_MAX}; las letras con tilde, la «ñ» y los emojis cuentan más).`,
  limited: ERRORS.limited,
  generic: "No hemos podido crear la cuenta. Probad de nuevo en un momento.",
} as const;

const callbackUrl = () => `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;

/**
 * «Crear cuenta» con correo y contraseña, sin `signUp` (revisión de seguridad
 * del 13-oct-2026):
 *  - Se envía el mismo código/enlace que el acceso por correo
 *    (`signInWithOtp`, `shouldCreateUser: true`): la respuesta es idéntica
 *    para correos nuevos y existentes, y una cuenta sin verificar nunca tiene
 *    una contraseña que otro pueda usar (pre-secuestro).
 *  - La contraseña elegida queda cifrada en una cookie httpOnly de este
 *    navegador (lib/auth/pending-password.ts) y se aplica al verificar el
 *    código o el enlace aquí. Vale también para quien ya tenía cuenta.
 *  - Si Auth limita el envío de correos para ese correo (otro envío hace
 *    menos de un minuto), también «revisad el correo»: hay uno reciente, y
 *    responder distinto revelaría algo.
 */
export async function signUpWithPasswordAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const rawEmail = String(formData.get("email") ?? "").slice(0, 320);
  const parsed = signUpSchema.safeParse({ email: rawEmail, password: formData.get("password") ?? "" });
  if (!parsed.success) {
    const badEmail = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return { status: "idle", error: badEmail ? SIGNUP_ERRORS.invalid : SIGNUP_ERRORS.password, email: rawEmail };
  }
  const { email, password } = parsed.data;

  // Fail-closed, por IP y por correo, ANTES de tocar Supabase Auth.
  if (!(await rateLimit("signup-password", await clientIp(), MAX_ATTEMPTS, WINDOW_SECS))) {
    return { status: "idle", error: SIGNUP_ERRORS.limited, email };
  }
  if (!(await rateLimit("signup-password-email", email, MAX_ATTEMPTS, WINDOW_SECS))) {
    return { status: "idle", error: SIGNUP_ERRORS.limited, email };
  }

  const supabase = await createClient();
  const checkEmail: SignUpState = { status: "check-email", error: null, email };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: callbackUrl(), captchaToken: captchaToken(formData) },
  });
  if (error) {
    if (isCaptchaError(error)) return { status: "idle", error: ERRORS.captcha, email };
    if (error.code === "over_email_send_rate_limit") {
      await rememberPendingPassword(email, password);
      return checkEmail;
    }
    if (error.status === 429) return { status: "idle", error: SIGNUP_ERRORS.limited, email };
    if (error.status && error.status >= 500) console.error("[login] password sign-up failed", error.status);
    return { status: "idle", error: SIGNUP_ERRORS.generic, email };
  }
  await rememberPendingPassword(email, password);
  return checkEmail;
}

export type CodeLoginState = { error: string | null };

/**
 * Por correo: 6 cifras son un millón de combinaciones y el límite por IP se
 * esquiva cambiando de red. Con 5 intentos por correo cada 15 minutos (y el
 * código caducando en 15 minutos) adivinarlo no es viable.
 */
const CODE_MAX_PER_EMAIL = 5;
const CODE_MAX_PER_IP = 10;

const codeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // Se aceptan espacios o guiones al pegar («123 456», «123-456»).
  token: z.string().max(32).transform((v) => v.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{6}$/)),
});

const CODE_ERRORS = {
  invalid: "Escribid las 6 cifras del código que os hemos enviado.",
  // Mismo mensaje exista o no la cuenta, y tanto si el código está mal como
  // si ha caducado o ya se usó: no se revela nada.
  wrong: "Ese código no vale: puede que esté mal escrito, que haya caducado o que ya se usara. Revisadlo o pedid uno nuevo.",
  limited: ERRORS.limited,
  generic: ERRORS.generic,
} as const;

/**
 * Acceso con el código de 6 cifras del mismo correo que el enlace mágico.
 * Se verifica en el servidor (verifyOtp type "email": vale tanto para cuentas
 * nuevas como existentes), así la sesión queda en cookies puestas por HTTP y
 * en el navegador (o el icono de la pantalla de inicio) donde está la pareja.
 */
export async function verifyLoginCodeAction(
  _prev: CodeLoginState,
  formData: FormData,
): Promise<CodeLoginState> {
  const parsed = codeSchema.safeParse({
    email: String(formData.get("email") ?? "").slice(0, 320),
    token: String(formData.get("token") ?? ""),
  });
  if (!parsed.success) return { error: CODE_ERRORS.invalid };
  const { email, token } = parsed.data;

  // Fail-closed, por IP y por correo, ANTES de tocar Supabase Auth.
  const ip = await clientIp();
  if (!(await rateLimit("login-code", ip, CODE_MAX_PER_IP, WINDOW_SECS))) return { error: CODE_ERRORS.limited };
  if (!(await rateLimit("login-code-email", email, CODE_MAX_PER_EMAIL, WINDOW_SECS))) return { error: CODE_ERRORS.limited };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    if (error.status === 429) return { error: CODE_ERRORS.limited };
    if (error.status && error.status >= 500) {
      console.error("[login] code verification failed", error.status);
      return { error: CODE_ERRORS.generic };
    }
    return { error: CODE_ERRORS.wrong };
  }

  // Contraseña elegida en «Crear cuenta» (cookie de este navegador) o, si el
  // correo se acaba de confirmar sin ella, contraseña aleatoria (pre-secuestro).
  await finishEmailVerification(supabase, data?.user);

  const destination = await postLoginPath(supabase);
  // redirect() lanza a propósito: fuera de cualquier try/catch.
  redirect(destination);
}
