import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke de navegador (P1-9). Dos modos:
 * - Local/CI: `next start` en :3400 con env ficticio (sin Supabase). Hay que
 *   tener `.next` construido; con E2E_BUILD=1 el propio config lo construye.
 * - Preview de Vercel: E2E_BASE_URL=https://… (no arranca servidor). El bypass
 *   de protección (cookie, solo para ese origen) lo gestiona e2e/fixtures.ts.
 */
const externalUrl = process.env.E2E_BASE_URL;
const baseURL = externalUrl ?? "http://localhost:3400";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    // En preview las trazas guardarían el secreto de bypass: nada de trazas ni vídeo.
    trace: externalUrl ? "off" : "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    // Móvil: es donde se abren las invitaciones.
    ...devices["Pixel 7"],
  },
  webServer: externalUrl
    ? undefined
    : {
        command: `${process.env.E2E_BUILD ? "npm run build && " : ""}npm run start -- -p 3400`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ci-placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "ci-placeholder-anon-key",
          NEXT_PUBLIC_APP_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
