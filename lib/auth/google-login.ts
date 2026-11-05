/**
 * «Continuar con Google» (8-oct-2026): preparado pero APAGADO. Se enciende
 * con `NEXT_PUBLIC_GOOGLE_LOGIN=on` cuando el proveedor Google esté
 * configurado en Supabase (pasos en docs/plans/2026-10-08-plan-maestro.md
 * §11); sin configurar, Supabase responde 400 «provider is not enabled».
 *
 * Es una variable NEXT_PUBLIC_: se escribe en el JavaScript al compilar, así
 * que cambiarla exige un despliegue nuevo.
 *
 * El borrador del creador sobrevive al viaje a Google igual que con el
 * correo: vive en el localStorage de este navegador (el creador lo escribe
 * antes de ir a /login) y /auth/callback vuelve a este mismo navegador, que
 * lo recupera en /onboarding. No hace falta la copia del servidor
 * (builder_draft_stash), que solo existe para cuando el enlace del correo se
 * abre en otro navegador.
 */

/** true solo con el valor exacto «on» (sin distinguir mayúsculas ni espacios). */
export function googleLoginFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "on";
}

/** El flag del entorno (referencia literal: Next la sustituye al compilar). */
export function googleLoginEnabled(): boolean {
  return googleLoginFlag(process.env.NEXT_PUBLIC_GOOGLE_LOGIN);
}

/**
 * ¿Se enseña el botón? Nunca con `?clave=1` (enlace de las cuentas de
 * prueba) ni dentro del icono de la pantalla de inicio (PWA en iPhone): allí
 * la vuelta de Google se abriría en Safari, con otras cookies, y el
 * verificador PKCE no estaría; esa pantalla prioriza el código del correo.
 */
export function showGoogleLogin(options: { enabled: boolean; standalone: boolean; passwordMode: boolean }): boolean {
  return options.enabled && !options.standalone && !options.passwordMode;
}

/** Opciones de `signInWithOAuth`: vuelve a /auth/callback (intercambio del código PKCE en el servidor). */
export function googleOAuthOptions(appUrl: string | undefined): { redirectTo: string; queryParams: Record<string, string> } {
  const base = (appUrl ?? "").replace(/\/$/, "");
  // select_account: si hay varias cuentas de Google en el móvil, que elijan.
  return { redirectTo: `${base}/auth/callback`, queryParams: { prompt: "select_account" } };
}
