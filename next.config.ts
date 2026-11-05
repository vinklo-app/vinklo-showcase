import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { BUILDER_TEMPLATES } from "./lib/templates";

/**
 * CSP para un sitio mayoritariamente estático (SSG). El nonce por petición
 * no es viable aquí: casi todas las páginas se prerenderizan en build y el
 * nonce solo funciona en render dinámico — forzar SSR mataría el rendimiento.
 *
 * Sin nonce, los scripts inline de Next exigen 'unsafe-inline', así que la
 * CSP no bloquea la ejecución de un script inyectado; pero SÍ cierra los
 * canales fáciles de exfiltración y otras vías de ataque:
 * - connect-src / img-src a self + Supabase: un script inyectado no puede
 *   mandar la cookie de sesión a un dominio externo por fetch/XHR/beacon/img.
 * - object-src 'none' (sin plugins), base-uri 'none' (sin secuestro de <base>),
 *   frame-ancestors 'none' (anti-clickjacking), form-action 'self' (sin
 *   secuestro de formularios), frame-src solo para el CAPTCHA de Cloudflare.
 * Defensa en profundidad real, sin romper el render estático.
 */
function buildCsp(): string {
  let sbHttps = "";
  let sbWss = "";
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    if (host) {
      sbHttps = ` https://${host}`;
      sbWss = ` wss://${host}`;
    }
  } catch {
    // Sin env de Supabase (build local aislado): connect-src e img-src quedan en 'self'.
  }
  // En desarrollo, el bundler (Turbopack) usa eval y HMR por websocket. La
  // CSP de producción es estricta; en dev añadimos 'unsafe-eval' y ws: para
  // que el hot-reload y los estilos funcionen (nunca sale en el build real).
  const dev = process.env.NODE_ENV !== "production";
  // CAPTCHA de /login (Cloudflare Turnstile): su script y su iframe.
  const turnstile = "https://challenges.cloudflare.com";
  const scriptSrc = dev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${turnstile}`
    : `script-src 'self' 'unsafe-inline' ${turnstile}`;
  const connectSrc = dev
    ? `connect-src 'self' ws: wss:${sbHttps}${sbWss}`
    : `connect-src 'self'${sbHttps}${sbWss}`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // Fotos de la pareja servidas desde el bucket público de Supabase Storage.
    `img-src 'self' data: blob:${sbHttps}`,
    "font-src 'self' data:",
    connectSrc,
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${turnstile}`,
    "object-src 'none'",
    "base-uri 'none'",
    // upgrade-insecure-requests rompe el http local del dev server → solo prod.
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Hostname de Supabase (sin esquema ni puerto) o null si no hay env. */
function supabaseHostname(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
}

const sbHost = supabaseHostname();

const SHARP_LINUX = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

const nextConfig: NextConfig = {
  // La foto de la pareja viaja por server action (uploadCouplePhoto, ≤ 4 MiB
  // por archivo); el límite por defecto de Next es 1 MB. Vercel Functions
  // cortan el cuerpo a 4,5 MB con 413 FUNCTION_PAYLOAD_TOO_LARGE
  // (vercel.com/docs/functions/limitations, revisado 2026-10-04), así que el
  // límite de Next queda por debajo (4,25 MiB = 4 456 448 B) y deja margen
  // para el multipart. Los clientes suben la foto ya reducida (≤ 900 KB).
  experimental: { serverActions: { bodySizeLimit: "4.25mb" } },
  // sharp (recodificar la foto en uploadCouplePhoto, H06) carga su binario
  // nativo con un require dinámico que el file tracing no sigue: sin esto la
  // función de Vercel no lleva @img/sharp-linux-x64 ni libvips y revienta
  // («Could not load the "sharp" module using the linux-x64 runtime»). Solo
  // en las rutas cuyas server actions suben fotos, para no engordar el resto.
  // Las claves son rutas: «/crear/**» no cubría la propia /crear (su función
  // salía sin sharp y Turbopack no podía cargar las server actions de la
  // página: la IA del creador devolvía 500). Se listan la ruta y sus hijas.
  outputFileTracingIncludes: {
    "/panel": SHARP_LINUX,
    "/panel/**": SHARP_LINUX,
    "/onboarding": SHARP_LINUX,
    "/onboarding/**": SHARP_LINUX,
    "/crear": SHARP_LINUX,
    "/crear/**": SHARP_LINUX,
    // Tarjeta social de la invitación: recorta la foto y la pasa a JPEG.
    "/og/**": SHARP_LINUX,
  },
  // next/image: solo las fotos públicas del bucket `wedding-photos`.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: sbHost
      ? [{ protocol: "https", hostname: sbHost, pathname: "/storage/v1/object/public/wedding-photos/**" }]
      : [],
  },
  // Dev: permite que el WebView de iOS (y otros dispositivos de la LAN)
  // consuman el dev server por la IP local sin que Next bloquee los assets.
  // Solo afecta a `next dev`.
  allowedDevOrigins: ["10.100.204.125", "192.168.0.16", "localhost", "127.0.0.1"],
  // www → apex (308): evita el host duplicado que penaliza a un dominio
  // recién nacido (GEO-AUDIT 2026-07-10).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.vinklo.es" }],
        destination: "https://vinklo.es/:path*",
        permanent: true,
      },
      // Enlaces antiguos de la demo (/demo?plantilla=origen): ahora cada
      // plantilla es una ruta estática. Solo ids conocidos: uno inventado sigue
      // viendo la demo base, como antes.
      {
        source: "/demo",
        has: [{ type: "query", key: "plantilla", value: `(?<plantilla>${BUILDER_TEMPLATES.map((t) => t.id).join("|")})` }],
        destination: "/demo/:plantilla",
        permanent: true,
      },
      // La boda de ejemplo /b/ana-y-luis quedó en el pasado: la demo pública
      // es /demo. Segmento exacto (no atrapa ana-y-luis-2) + sub-rutas.
      {
        source: "/b/ana-y-luis/:path*",
        destination: "/demo",
        permanent: true,
      },
      // Guías antiguas sobre dinero/regalos (retiradas el 2026-10-05, fuera
      // del alcance del producto): al índice de guías actual.
      ...[
        "alternativas-lista-de-bodas",
        "como-pagar-la-boda",
        "como-pedir-dinero-boda",
        "cuanto-se-da-en-una-boda",
        "dinero-de-la-boda",
        "mesa-de-regalos-online",
      ].map((slug) => ({
        source: `/guias/${slug}`,
        destination: "/guias",
        permanent: true,
      })),
    ];
  },
  // Cabeceras de seguridad. La CSP (buildCsp) es estática y compatible con
  // el render SSG del sitio; ver la nota de buildCsp para el porqué del
  // enfoque sin nonce.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: buildCsp() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // HSTS con subdominios (no hay subdominios sirviendo HTTP; www
          // redirige a apex por HTTPS). `preload` se deja fuera: es un
          // compromiso irreversible que se envía a la lista de Google
          // aparte, cuando toda la infra esté consolidada.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      {
        // URLs con secretos y datos privados no deben entrar en caches compartidas.
        source: "/b/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/auth/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // /crear?idea=… (frase de la landing): cada visita lee la frase con la
        // IA. No se indexa; /crear sin la frase sí (revisión del bloque 1, F7).
        source: "/crear",
        has: [{ type: "query", key: "idea" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }],
      },
      {
        source: "/v/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // La tarjeta OG es estática (se regenera con un deploy); cache larga
        // en vez del max-age=0 por defecto de /public.
        source: "/og.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=604800, immutable",
          },
        ],
      },
    ];
  },
};

// Sentry (plan maestro 2.3): sin token no sube source maps y el build no
// depende de Sentry; los eventos del navegador pasan por /monitoring.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Solo capturamos errores en el navegador: fuera trazas, replay y debug.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
