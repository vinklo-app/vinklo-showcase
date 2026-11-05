"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * CAPTCHA de Cloudflare Turnstile para /login (14-oct-2026).
 *
 * Supabase Auth exige el token (`captchaToken`) al crear cuenta, entrar con
 * contraseña, pedir el código y pedir el enlace de contraseña cuando la
 * protección está activada en Attack Protection. Sin
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY no se pinta nada y todo sigue como antes.
 *
 * Modo «interaction-only»: casi siempre es invisible; solo aparece la casilla
 * si Cloudflare duda. Cada token sirve UNA vez: tras cada envío hay que
 * pedir otro con `reset()`.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export const captchaEnabled = () => SITE_KEY !== "";

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
      script.onerror = () => {
        // Que el siguiente intento vuelva a cargarlo (p. ej. tras perder la red).
        scriptPromise = null;
        reject(new Error("turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** Texto del botón mientras Turnstile no ha dado token: que no parezca roto. */
export const CAPTCHA_WAIT_LABEL = "Comprobando…";

/** Texto del botón de envío: enviando > esperando al CAPTCHA > normal. */
export function submitLabel({ pending, pendingLabel, ready, label }: { pending: boolean; pendingLabel: string; ready: boolean; label: string }): string {
  if (pending) return pendingLabel;
  return ready ? label : CAPTCHA_WAIT_LABEL;
}

export type Captcha = {
  /** Contenedor del widget (vacío si no hay clave). */
  widget: React.ReactNode;
  /** Token vigente, o "" si aún no hay (o no hace falta). */
  token: string;
  /** Sin clave configurada no se espera ningún token. */
  ready: boolean;
  /** Pide un token nuevo: el anterior ya se gastó. */
  reset: () => void;
};

export function useCaptcha(): Captcha {
  const enabled = captchaEnabled();
  // Ref de callback: el formulario del código se monta después (al cambiar
  // de método) y el widget debe pintarse entonces, no solo al principio.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState("");
  // Si Cloudflare no carga (bloqueador, red), no dejar el botón muerto: se
  // envía sin token y, si Auth lo exige, la pareja ve el mensaje del CAPTCHA.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !box) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId.current = api.render(box, {
          sitekey: SITE_KEY,
          language: "es",
          appearance: "interaction-only",
          size: "flexible",
          "refresh-expired": "auto",
          callback: (t: string) => {
            setFailed(false);
            setToken(t);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setFailed(true);
          },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      setToken("");
    };
  }, [enabled, box]);

  const reset = useCallback(() => {
    setToken("");
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  return {
    widget: enabled ? <div ref={setBox} className="ac-captcha" /> : null,
    token,
    ready: !enabled || token !== "" || failed,
    reset,
  };
}

