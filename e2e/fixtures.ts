import { test as base, expect } from "@playwright/test";

/**
 * Bypass de la protección de Vercel SIN cabeceras globales (se filtrarían a
 * terceros): una única petición al origen del preview con la cabecera del
 * secreto hace que Vercel responda con una cookie que queda en el contexto y
 * solo viaja a ese host.
 */
export const test = base.extend<{ vercelBypass: void }>({
  vercelBypass: [
    async ({ context, baseURL }, use) => {
      const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (process.env.E2E_BASE_URL && secret && baseURL) {
        // Solo a un preview de Vercel por HTTPS y sin seguir redirecciones (que
        // reenviarían la cabecera a otro origen).
        const url = new URL(baseURL);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
          throw new Error(`E2E_BASE_URL no es un preview de Vercel: ${url.origin}`);
        }
        const res = await context.request.get(url.origin, {
          headers: { "x-vercel-protection-bypass": secret, "x-vercel-set-bypass-cookie": "samesitenone" },
          maxRedirects: 0,
        });
        if (res.status() === 401 || res.status() === 403) {
          throw new Error(`El bypass de Vercel no funcionó (HTTP ${res.status()}): revisad el secreto.`);
        }
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
