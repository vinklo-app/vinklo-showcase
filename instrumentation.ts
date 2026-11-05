import * as Sentry from "@sentry/nextjs";

/** Seguimiento de errores (plan maestro 2.3). Sin SENTRY_DSN no envía nada. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
