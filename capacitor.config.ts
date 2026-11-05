import type { CapacitorConfig } from "@capacitor/cli";

/**
 * vinklo es una app Next.js server-driven (server actions + Stripe + Supabase),
 * no exportable a estático. Por eso el contenedor nativo carga el sitio en
 * producción (server.url) dentro de un WKWebView, en vez de empaquetar un
 * bundle. El webDir es solo una pantalla de carga de reserva por si el sitio
 * no responde.
 *
 * Para probar contra tu Mac en desarrollo, cambia server.url a
 * http://TU_IP_LOCAL:3000 y pon allowNavigation con esa IP.
 */
// Modo dev / live-reload: exporta CAP_SERVER_URL con la URL de tu servidor
// local (p. ej. http://192.168.0.16:3000) antes de `cap sync` y la app
// cargará tu dev server con recarga en caliente. Sin esa variable apunta
// SIEMPRE a producción — el build de release nunca sale con una IP local.
const DEV_URL = process.env.CAP_SERVER_URL;
const isDev = Boolean(DEV_URL);

const config: CapacitorConfig = {
  appId: "es.vinklo.app",
  appName: "vinklo",
  webDir: "native/www",
  server: {
    url: DEV_URL ?? "https://vinklo.es",
    // http en la LAN solo en dev; en producción, https estricto.
    cleartext: isDev,
    // Dominios a los que el WebView puede navegar dentro de la app (Stripe
    // Checkout redirige fuera del dominio y debe volver).
    allowNavigation: [
      "vinklo.es",
      "*.vinklo.es",
      "checkout.stripe.com",
      "*.stripe.com",
      ...(isDev ? ["192.168.*", "localhost"] : []),
    ],
  },
  ios: {
    // Deja que el contenido gestione sus propios insets (usamos safe-area en CSS).
    contentInset: "always",
    backgroundColor: "#ffffff",
  },
};

export default config;
