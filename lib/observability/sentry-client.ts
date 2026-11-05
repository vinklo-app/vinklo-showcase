import { sentryBaseOptions } from "@/lib/observability/sentry-scrub";

type SentryModule = typeof import("@/lib/observability/sentry-browser");

/** Errores que llegan antes de que Sentry cargue: se guardan unos pocos y se envían al iniciar. */
const EARLY_MAX = 10;
const SKIPPED_INTEGRATIONS = new Set(["BrowserSession", "BrowserTracing"]);

/**
 * Sentry del navegador en diferido (P1-4): el SDK pesa y se ejecutaba al
 * hidratar en todas las páginas, también la del invitado. Se descarga con
 * `import()` cuando el navegador queda libre tras `load`; hasta entonces los
 * errores no capturados se apuntan y se mandan después. Sin DSN no se
 * descarga nada.
 */
export function createLazySentry({ dsn, load, target }: { dsn: string | undefined; load: () => Promise<SentryModule>; target?: Pick<Window, "addEventListener" | "removeEventListener"> }) {
  let loading: Promise<SentryModule | null> | null = null;
  let sentry: SentryModule | null = null;
  const early: unknown[] = [];
  const onError = (event: Event) => {
    if (early.length < EARLY_MAX) early.push((event as ErrorEvent).error ?? (event as ErrorEvent).message);
  };
  const onRejection = (event: Event) => {
    if (early.length < EARLY_MAX) early.push((event as PromiseRejectionEvent).reason);
  };
  if (dsn && target) {
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
  }

  function stopBuffering() {
    target?.removeEventListener("error", onError);
    target?.removeEventListener("unhandledrejection", onRejection);
  }

  function start(): Promise<SentryModule | null> {
    if (!dsn) return Promise.resolve(null);
    loading ??= load()
      .then((mod) => {
        // Solo errores: fuera las trazas (BrowserTracing instrumenta fetch e
        // historial aunque no se muestree) y las sesiones de release health.
        mod.init({ dsn, ...sentryBaseOptions, integrations: (defaults) => defaults.filter((i) => !SKIPPED_INTEGRATIONS.has(i.name)) });
        sentry = mod;
        stopBuffering();
        // Sin capturar de verdad: se marcan como tales (no como handled).
        for (const error of early.splice(0)) mod.captureException(error, { mechanism: { type: "auto.browser.lazy_buffer", handled: false } });
        return mod;
      })
      .catch(() => {
        // Sin SDK (bloqueado, sin red): no se sigue acumulando nada.
        stopBuffering();
        early.length = 0;
        return null;
      });
    return loading;
  }

  /** Para los límites de error de React (se tragan el fallo antes de window.onerror). */
  function captureException(error: unknown): void {
    void start().then((mod) => mod?.captureException(error));
  }

  return { start, captureException, loaded: () => sentry };
}

export const lazySentry = createLazySentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  load: () => import("@/lib/observability/sentry-browser"),
  target: typeof window === "undefined" ? undefined : window,
});

/** Lanza la carga cuando la página ya ha cargado y el hilo principal está libre. */
export function startSentryWhenIdle(): void {
  if (typeof window === "undefined") return;
  const idle = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => void lazySentry.start(), { timeout: 4000 });
    else setTimeout(() => void lazySentry.start(), 1500);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

/** Captura un error desde un límite de error de React (carga Sentry si aún no estaba). */
export function captureClientException(error: unknown): void {
  lazySentry.captureException(error);
}
