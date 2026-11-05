/**
 * Validación (perezosa) de las variables de entorno del servidor.
 *
 * No sustituye a las ~60 lecturas de `process.env` repartidas por el código:
 * es un único sitio donde se declara qué variables existen, cuáles son
 * imprescindibles y cuáles se esperan en producción. Se usa donde un fallo
 * silencioso salía caro (correo transaccional, cron).
 *
 *  - Imprescindibles (Supabase URL/anon/service): `serverEnv()` lanza en
 *    producción si faltan; la app no puede funcionar sin ellas.
 *  - Esperadas (RESEND_API_KEY, CRON_SECRET…): en producción se avisa UNA
 *    vez por proceso con console.error + Sentry.captureMessage, sin lanzar.
 *    Antes, un RESEND_API_KEY ausente se saltaba los correos sin que nadie
 *    lo viera.
 *  - Opcionales (IA, Stripe…): se validan si están presentes, sin avisos.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

/** Cadena vacía = no definida (los `.env` con `CLAVE=` literal). */
const text = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);
const url = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);

const schema = z.object({
  // Imprescindibles
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: text,
  SUPABASE_SERVICE_ROLE_KEY: text,
  // Esperadas en producción
  NEXT_PUBLIC_APP_URL: url,
  CRON_SECRET: text,
  RESEND_API_KEY: text,
  GOOGLE_MAPS_API_KEY: text,
  SENTRY_DSN: text,
  // sentry.server.config.ts usa SENTRY_DSN ?? NEXT_PUBLIC_SENTRY_DSN.
  NEXT_PUBLIC_SENTRY_DSN: text,
  ADMIN_EMAILS: text,
  // Nueva; si falta, lib/rate-limit.ts usa CRON_SECRET (ver `missingExpected`).
  RATE_LIMIT_SECRET: text,
  // Opcionales (la IA va por OIDC en Vercel; Stripe es backlog)
  AI_GATEWAY_API_KEY: text,
  ANTHROPIC_API_KEY: text,
  VINKLO_AI_PROVIDER: text,
  VINKLO_AI_CRM: text,
  STRIPE_SECRET_KEY: text,
  STRIPE_WEBHOOK_SECRET: text,
});

export type ServerEnv = z.infer<typeof schema>;

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const satisfies readonly (keyof ServerEnv)[];

const EXPECTED = [
  "NEXT_PUBLIC_APP_URL",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "SENTRY_DSN",
  "ADMIN_EMAILS",
  "RATE_LIMIT_SECRET",
] as const satisfies readonly (keyof ServerEnv)[];

export interface EnvReport {
  env: ServerEnv;
  /** Imprescindibles ausentes o con formato inválido. */
  missingRequired: string[];
  /** Esperadas en producción y ausentes. */
  missingExpected: string[];
}

let cached: EnvReport | null = null;
let reported = false;

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function build(): EnvReport {
  const parsed = schema.safeParse(process.env);
  const env: ServerEnv = parsed.success ? parsed.data : {};
  const invalid = new Set<string>(
    parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0])),
  );
  // Si una variable tiene formato inválido, se lee igualmente en bruto para no
  // perder las demás, pero se cuenta como ausente.
  if (!parsed.success) {
    for (const key of Object.keys(schema.shape) as (keyof ServerEnv)[]) {
      if (!invalid.has(key)) {
        const value = process.env[key];
        if (value && value.trim() !== "") env[key] = value;
      }
    }
  }
  const missing = (k: keyof ServerEnv) => invalid.has(k) || !env[k];

  return {
    env,
    missingRequired: REQUIRED.filter(missing),
    missingExpected: EXPECTED.filter((k) => {
      // RATE_LIMIT_SECRET cae a CRON_SECRET: solo falta si no hay ninguno.
      if (k === "RATE_LIMIT_SECRET") return missing(k) && missing("CRON_SECRET");
      // SENTRY_DSN cae a NEXT_PUBLIC_SENTRY_DSN.
      if (k === "SENTRY_DSN") return missing(k) && missing("NEXT_PUBLIC_SENTRY_DSN");
      return missing(k);
    }),
  };
}

function reportOnce(report: EnvReport): void {
  if (reported || !isProduction()) return;
  if (report.missingExpected.length === 0 && report.missingRequired.length === 0) return;
  reported = true;
  const parts: string[] = [];
  if (report.missingRequired.length) parts.push(`imprescindibles: ${report.missingRequired.join(", ")}`);
  if (report.missingExpected.length) parts.push(`esperadas: ${report.missingExpected.join(", ")}`);
  const message = `[env] Faltan variables de entorno en producción (${parts.join("; ")})`;
  console.error(message);
  Sentry.captureMessage(message, {
    level: report.missingRequired.length ? "error" : "warning",
    extra: { missingRequired: report.missingRequired, missingExpected: report.missingExpected },
  });
}

/**
 * Valida el entorno sin lanzar nunca y, en producción, avisa una vez por
 * proceso de lo que falte. Para rutas que no deben romperse (correo, cron).
 */
export function checkEnv(): EnvReport {
  cached ??= build();
  reportOnce(cached);
  return cached;
}

/**
 * Como `checkEnv()`, pero lanza en producción si falta algo imprescindible.
 * Fuera de producción devuelve lo que haya (dev/preview/tests sin Supabase).
 */
export function serverEnv(): ServerEnv {
  const report = checkEnv();
  if (isProduction() && report.missingRequired.length > 0) {
    throw new Error(
      `Faltan variables de entorno imprescindibles: ${report.missingRequired.join(", ")}`,
    );
  }
  return report.env;
}

/** Solo para tests: olvida la caché y el aviso único. */
export function resetEnvForTests(): void {
  cached = null;
  reported = false;
}
