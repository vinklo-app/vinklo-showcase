/**
 * Manifest propio del panel, servido en /panel/manifest.webmanifest
 * (app/panel/manifest.webmanifest/route.ts) y enlazado desde
 * app/panel/layout.tsx. La web pública sigue con app/manifest.ts.
 *
 * - `id` y `start_url` = /panel: el icono que la pareja añade desde el panel
 *   abre el panel, y es una «app» distinta de la web pública (id "/").
 * - `scope` = "/" a propósito, no "/panel": sin sesión el panel redirige a
 *   /login, y el acceso (/login, /auth/*, /onboarding, /unirse) tiene que
 *   seguir DENTRO del icono. Fuera de ámbito, iOS lo abriría en una hoja de
 *   navegador con otras cookies y la sesión no llegaría a la app.
 * - Público y sin datos privados: el navegador lo pide sin cookies, por eso
 *   el middleware lo deja pasar sin sesión (lib/supabase/middleware.ts).
 */
export const PANEL_MANIFEST_PATH = "/panel/manifest.webmanifest";

export const PANEL_MANIFEST = {
  id: "/panel",
  name: "vinklo — Vuestra boda",
  short_name: "vinklo",
  description: "Vuestro panel de boda: invitados, respuestas, mesas y vuestra web, a mano.",
  lang: "es",
  dir: "ltr",
  start_url: "/panel",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#F8F7FA",
  theme_color: "#F8F7FA",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
} as const;
