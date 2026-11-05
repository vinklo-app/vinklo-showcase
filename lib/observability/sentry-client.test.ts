import { describe, expect, it, vi } from "vitest";

import { createLazySentry } from "./sentry-client";
import { scrubEvent } from "./sentry-scrub";

function fakeSentry() {
  const init = vi.fn();
  const captureException = vi.fn();
  return { mod: { init, captureException } as unknown as typeof import("./sentry-browser"), init, captureException };
}

function errorEvent(error: unknown): Event {
  const event = new Event("error");
  Object.assign(event, { error, message: String(error) });
  return event;
}

describe("createLazySentry", () => {
  it("no descarga el SDK sin DSN", async () => {
    const load = vi.fn();
    const sentry = createLazySentry({ dsn: undefined, load, target: new EventTarget() as unknown as Window });
    expect(await sentry.start()).toBeNull();
    sentry.captureException(new Error("x"));
    expect(load).not.toHaveBeenCalled();
  });

  it("inicia una sola vez, con el filtro de datos y sin trazas ni sesiones", async () => {
    const { mod, init } = fakeSentry();
    const load = vi.fn(async () => mod);
    const sentry = createLazySentry({ dsn: "https://k@o0.ingest.sentry.io/0", load });
    await Promise.all([sentry.start(), sentry.start()]);
    expect(load).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0];
    expect(options.dsn).toBe("https://k@o0.ingest.sentry.io/0");
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.tracesSampleRate).toBe(0);
    const names = options.integrations([{ name: "BrowserTracing" }, { name: "BrowserSession" }, { name: "GlobalHandlers" }]).map((i: { name: string }) => i.name);
    expect(names).toEqual(["GlobalHandlers"]);
    expect(sentry.loaded()).toBe(mod);
  });

  it("envía los errores no capturados de antes de cargar y deja de escuchar", async () => {
    const { mod, captureException } = fakeSentry();
    const target = new EventTarget();
    const sentry = createLazySentry({ dsn: "https://k@o0.ingest.sentry.io/0", load: async () => mod, target: target as unknown as Window });
    const early = new Error("antes de cargar");
    target.dispatchEvent(errorEvent(early));
    await sentry.start();
    expect(captureException).toHaveBeenCalledWith(early, { mechanism: { type: "auto.browser.lazy_buffer", handled: false } });
    // Tras iniciar, los manejadores globales son los de Sentry: no se duplica.
    target.dispatchEvent(errorEvent(new Error("después")));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("captureException carga Sentry si hace falta y envía el error", async () => {
    const { mod, captureException } = fakeSentry();
    const sentry = createLazySentry({ dsn: "https://k@o0.ingest.sentry.io/0", load: async () => mod });
    const boom = new Error("límite de error");
    sentry.captureException(boom);
    await sentry.start();
    expect(captureException).toHaveBeenCalledWith(boom);
  });

  it("si el SDK no descarga, no rompe la página y deja de escuchar", async () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    const sentry = createLazySentry({ dsn: "https://k@o0.ingest.sentry.io/0", load: () => Promise.reject(new Error("offline")), target: target as unknown as Window });
    expect(await sentry.start()).toBeNull();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(["error", "unhandledrejection"]);
    expect(() => sentry.captureException(new Error("x"))).not.toThrow();
  });
});
