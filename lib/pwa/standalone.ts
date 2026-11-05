/**
 * Detección del modo «app» (icono en la pantalla de inicio) y de la
 * plataforma, sin depender de `window` directamente para poder probarla.
 *
 * - `display-mode: standalone` (o fullscreen / minimal-ui) lo exponen Chrome,
 *   Edge y Safari modernos.
 * - `navigator.standalone` es la marca histórica de iOS para las webs
 *   añadidas a la pantalla de inicio.
 *
 * Importa porque en iPhone el icono tiene su propio almacén de cookies: un
 * enlace mágico abierto desde el correo inicia sesión en Safari, no dentro
 * del icono. Ahí el acceso tiene que ser con el código de 6 cifras.
 */

export type StandaloneEnv = {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  navigator?: { standalone?: boolean } | undefined;
};

const APP_MODES = ["standalone", "fullscreen", "minimal-ui"] as const;

/** true si la página corre como app instalada (icono en la pantalla de inicio). */
export function isStandalone(env: StandaloneEnv | undefined): boolean {
  if (!env) return false;
  try {
    if (env.navigator?.standalone === true) return true;
    const mm = env.matchMedia;
    if (typeof mm !== "function") return false;
    return APP_MODES.some((mode) => mm(`(display-mode: ${mode})`).matches);
  } catch {
    return false;
  }
}

/** Versión para el navegador; en el servidor siempre false. */
export function isStandaloneNow(): boolean {
  if (typeof window === "undefined") return false;
  return isStandalone({
    matchMedia: typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined,
    navigator: window.navigator as { standalone?: boolean },
  });
}

export type InstallPlatform = "ios" | "android" | "other";

/**
 * Plataforma para elegir las instrucciones: iPhone/iPad (también el iPad
 * que se presenta como Mac, con pantalla táctil) o Android.
 */
export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ua = userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}
