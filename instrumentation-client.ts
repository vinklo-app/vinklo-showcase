import { lazySentry, startSentryWhenIdle } from "@/lib/observability/sentry-client";

// En el navegador solo errores: sin replay ni trazas. Los eventos salen por
// /monitoring (tunnelRoute en next.config.ts), así la CSP no cambia.
// El SDK se carga en diferido (lib/observability/sentry-client.ts): no entra
// en el JS inicial de ninguna página ni compite con el LCP.
startSentryWhenIdle();

// Sin trazas, la transición de ruta no aporta nada hasta que Sentry carga.
export const onRouterTransitionStart: (href: string, navigationType: string) => void = (href, navigationType) => {
  lazySentry.loaded()?.captureRouterTransitionStart(href, navigationType);
};
