"use client";

/**
 * Página intermedia del enlace mágico — inmune al prefetch de Apple
 * Mail/iCloud (que "visita" los enlaces de los emails y quemaba el token
 * de un solo uso antes del clic real). El email enlaza AQUÍ con
 * token_hash; la verificación ocurre en JavaScript al cargar la página,
 * y los prefetchers no ejecutan JS. Requiere las plantillas de email
 * personalizadas en Supabase (docs/ops/supabase-auth.md).
 *
 * Tipos aceptados: email/magiclink/signup (→ /panel), recovery (→
 * /login/restablecer), invite y email_change (→ /panel, igual que
 * email). Refresh 2026-10-04: se añaden invite/email_change al
 * allowlist tras rediseñar esas plantillas con el formato vinklo; la
 * verificación (verifyOtp, redirecciones) no cambia más allá de eso.
 *
 * 2026-10-08: verifyOtp se ejecuta en una server action
 * (./actions.ts) en vez de en el navegador, para que las cookies de
 * sesión las ponga el servidor y Safari no las caduque a los 7 días.
 */
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { LazoIcon } from "@/components/brand/icons";
import "@/app/login/access.css";
import { ALLOWED_TOKEN_HASH_TYPES, clearLoginRequested, loginWasRequestedHere } from "@/lib/auth/login-request";
import { confirmEmailLinkAction } from "./actions";

function ConfirmInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<"working" | "ask" | "error">("working");
  const fired = useRef(false);
  const link = useRef<{ tokenHash: string; type: EmailOtpType } | null>(null);

  // 2026-10-08: la verificación va a una server action para que la sesión
  // llegue en cookies HTTP (Safari corta a 7 días las escritas por JS).
  // Destino: /login/restablecer (recuperación) o /unirse, /panel u
  // /onboarding según la cuenta.
  function confirm() {
    const current = link.current;
    if (!current) {
      setState("error");
      return;
    }
    setState("working");
    confirmEmailLinkAction(current)
      .then((result) => {
        if (result.ok) {
          clearLoginRequested();
          router.replace(result.to);
        } else setState("error");
      })
      .catch(() => setState("error"));
  }

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const tokenHash = searchParams.get("token_hash");
    const type = (searchParams.get("type") ?? "email") as EmailOtpType;
    if (!tokenHash) {
      setState("error");
      return;
    }

    window.history.replaceState(null, "", "/auth/confirm");
    if (!ALLOWED_TOKEN_HASH_TYPES.includes(type)) {
      setState("error");
      return;
    }
    link.current = { tokenHash, type };
    // Anti login-CSRF: solo entra solo quien pidió el enlace desde ESTE
    // navegador (cookie vk_login_req). Si no, que lo confirme a mano.
    if (loginWasRequestedHere()) confirm();
    else setState("ask");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  return (
    <main className="ac-page">
      <header className="ac-top">
        <Link href="/" aria-label="vinklo, inicio" className="ac-wordmark">
          <LazoIcon aria-hidden="true" />
          <span aria-hidden="true">
            v<span className="ac-wordmark-i">ı</span>nklo
          </span>
        </Link>
      </header>

      <section className="ac-center" aria-live="polite">
        <div className="ac-card">
          <p className="font-label ac-eyebrow">Acceso de los novios</p>
          {state === "working" ? (
            <>
              <h1 className="ac-h1">Un momento.</h1>
              <p role="status" className="ac-status">
                Comprobando el enlace y entrando…
              </p>
            </>
          ) : state === "ask" ? (
            <>
              <h1 className="ac-h1">¿Entráis en vinklo?</h1>
              <p className="ac-lead">
                Este enlace no se pidió desde este navegador. Si lo habéis pedido vosotros,
                continuad; si os lo ha mandado otra persona, cerrad esta página.
              </p>
              <button type="button" className="ac-btn" onClick={confirm}>
                Entrar
              </button>
            </>
          ) : (
            <>
              <h1 className="ac-h1">
                Este enlace <em>ya no vale.</em>
              </h1>
              <p className="ac-lead">
                Ha caducado o ya se usó: cada enlace sirve una sola vez.
                Pedid uno nuevo desde la pantalla de acceso.
              </p>
              <Link href="/login" className="ac-btn ac-btn--inline">
                Pedir un enlace nuevo
              </Link>
            </>
          )}
        </div>
      </section>

      <footer className="ac-foot">
        <nav aria-label="Legal">
          <Link href="/aviso-legal">Aviso legal</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </footer>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmInner />
    </Suspense>
  );
}
