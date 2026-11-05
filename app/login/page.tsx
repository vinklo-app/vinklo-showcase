"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BRAND_TAGLINE } from "@/lib/brand";
import { BUILDER_STORAGE_KEY, hasBuilderProgress, restoreBuilderDraft } from "@/lib/wedding-builder";
import { LazoIcon } from "@/components/brand/icons";
import { isStandaloneNow } from "@/lib/pwa/standalone";
import { clearPendingCode, readPendingCode, savePendingCode, sessionStore } from "@/lib/auth/pending-code";
import { markLoginRequested } from "@/lib/auth/login-request";
import { googleLoginEnabled, googleOAuthOptions, showGoogleLogin } from "@/lib/auth/google-login";
import { submitLabel, useCaptcha } from "./captcha";
import { CodeForm } from "./code-form";
import { keepBuilderDraft } from "./keep-draft";
import { bindPublishIntent, browserStorage, clearPublishIntent, hasPublishIntent } from "@/components/creator/publish-intent";
import { PasswordAccess, type OnSent, type PasswordMode } from "./password-access";
import "./access.css";

/** «G» de Google en sus colores (las normas de marca de Google piden el logotipo original). */
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

type Sent = { email: string; draftKept: boolean; kind: "code" | "signup" | "confirm" };

/**
 * Acceso de los novios.
 *
 * 13-oct-2026 (Task 10): dos formas de entrar, a elegir.
 *  - Correo + contraseña («Crear cuenta» / «Entrar»), en password-access.tsx.
 *    Desde el creador (`?registro=1` o con borrador pendiente) se abre en
 *    «Crear cuenta». `?clave=1` (enlace antiguo de las cuentas de prueba)
 *    abre «Entrar».
 *  - Código de 6 cifras / enlace por correo (Supabase OTP), como hasta ahora:
 *    el mismo correo trae el enlace y el código (verifyLoginCodeAction, en
 *    servidor). Se empieza por el código dentro del icono de la pantalla de
 *    inicio y al llegar desde /unirse.
 * Cuando sale un correo (código, confirmación de la cuenta nueva o reenvío de
 * la confirmación) se enseña el mismo paso: «revisad el correo» + el código.
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("error") === "auth";
  const passwordParam = searchParams.get("clave") === "1";
  const registerParam = searchParams.get("registro") === "1";
  // Viene de /unirse (invitación de pareja): tras el enlace vuelve allí.
  const joining = searchParams.get("unirse") === "1";

  // Quien viene de una invitación de pareja (/unirse) casi nunca tiene cuenta
  // ni contraseña: empieza en el código.
  const [method, setMethod] = useState<"password" | "code">(joining ? "code" : "password");
  const [pwMode, setPwMode] = useState<PasswordMode>(registerParam ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "sending" | "error" | "captcha">("idle");
  const [sent, setSent] = useState<Sent | null>(null);
  // Quien llega desde el creador ve, antes de pedir el enlace, que su
  // invitación está guardada (auditoría 2026-10-05).
  const [pendingCouple, setPendingCouple] = useState<string | null>(null);
  // Dentro del icono de la pantalla de inicio el enlace del correo abriría
  // el navegador (en iPhone, con otras cookies): ahí se prioriza el código.
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const inApp = isStandaloneNow();
    setStandalone(inApp);
    // En el icono de la pantalla de inicio el código va primero (el enlace
    // del correo se abriría fuera); la contraseña sigue a un toque.
    if (inApp) setMethod("code");
    // Volver de leer el correo (iOS suele recargar el icono): seguir en el
    // paso del código en vez de pedir otro.
    const pending = readPendingCode(sessionStore());
    if (pending) {
      setEmail(pending);
      setMethod("code");
      setSent({ email: pending, draftKept: false, kind: "code" });
    }
  }, []);
  // «Crear cuenta y publicar» (publish-intent.ts): la marca solo sigue viva
  // en /login?registro=1, adonde manda el creador. Sin `registro` (aquí
  // aterriza todo «Cerrar sesión», o alguien entra con otra cuenta) se borra;
  // con `?error=auth` se conserva para pedir otro enlace.
  const [publishIntent, setPublishIntent] = useState(false);
  useEffect(() => {
    const storage = browserStorage();
    if (!registerParam && !authError) { clearPublishIntent(storage); return; }
    setPublishIntent(hasPublishIntent(storage));
  }, [registerParam, authError]);
  /** Al pedir el correo desde el creador: la marca queda atada a ese email. */
  const bindIntent = (address: string) => { if (registerParam || authError) bindPublishIntent(browserStorage(), address); };

  useEffect(() => {
    try {
      const draft = restoreBuilderDraft(localStorage.getItem(BUILDER_STORAGE_KEY));
      if (!hasBuilderProgress(draft)) return;
      const names = [draft.partnerName1.trim(), draft.partnerName2.trim()].filter(Boolean).join(" y ");
      setPendingCouple(names || "");
      // Con algo preparado en /crear lo normal es estrenar cuenta.
      if (!passwordParam) setPwMode("signup");
    } catch { /* Sin almacenamiento local: nada que anunciar. */ }
  }, [passwordParam]);

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;
  // CAPTCHA del envío del código (solo se pinta en el formulario del código).
  const captcha = useCaptcha();

  // «Continuar con Google» (apagado salvo NEXT_PUBLIC_GOOGLE_LOGIN=on). El
  // borrador de /crear sigue en el localStorage de este navegador, que es al
  // que vuelve Google: /onboarding lo recupera como con el enlace del correo.
  const showGoogle = showGoogleLogin({ enabled: googleLoginEnabled(), standalone, passwordMode: passwordParam });
  const googleError = searchParams.get("error") === "google";
  const [googleStatus, setGoogleStatus] = useState<"idle" | "going" | "error">("idle");
  async function handleGoogle() {
    setGoogleStatus("going");
    const supabase = createClient();
    // PKCE (cliente de @supabase/ssr): el verificador queda en una cookie y
    // /auth/callback canjea el código en el servidor.
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: googleOAuthOptions(process.env.NEXT_PUBLIC_APP_URL) });
    if (error) setGoogleStatus("error");
  }

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCodeStatus("sending");
    bindIntent(email);
    const draftKept = await keepBuilderDraft(email);
    // Anti login-CSRF: este navegador pidió el enlace (ver /auth/confirm).
    markLoginRequested();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // El mismo enlace sirve para entrar Y para crear la cuenta.
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true, captchaToken: captcha.token || undefined },
    });
    // Cada token sirve una vez: otro nuevo para el siguiente envío.
    captcha.reset();
    if (error) {
      setCodeStatus(error.code === "captcha_failed" ? "captcha" : "error");
      return;
    }
    savePendingCode(sessionStore(), email);
    setCodeStatus("idle");
    setSent({ email, draftKept, kind: "code" });
  }

  const onPasswordSent: OnSent = (next) => {
    savePendingCode(sessionStore(), next.email);
    setSent(next);
  };

  const heading =
    method === "code" ? (
      <>Entrad <em>con vuestro email.</em></>
    ) : pwMode === "signup" ? (
      <>Cread <em>vuestra cuenta.</em></>
    ) : (
      <>Entrad <em>en vinklo.</em></>
    );
  const lead =
    method === "code"
      ? standalone
        ? "Os mandamos un código de 6 cifras: escribidlo aquí y entráis sin salir de la app. Si es la primera vez, creamos vuestra cuenta con él."
        : "Os enviamos un código de 6 cifras por correo. Sin contraseñas."
      : pwMode === "signup"
        ? "Con vuestro correo y una contraseña: así, la próxima vez entráis al momento."
        : "Con vuestro correo y vuestra contraseña. Si siempre entrabais con el código del correo, podéis seguir así.";

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

      <section className="ac-center" aria-labelledby="login-title">
        <div className="ac-card">
          {/* Desde el creador: volver sin perder nada (el borrador sigue en
              este navegador y /crear lo abre tal cual). */}
          {(registerParam || pendingCouple !== null) && !sent ? (
            <Link href="/crear" className="ac-link ac-back">
              <span aria-hidden="true">←&nbsp;</span>Volver a vuestra invitación
            </Link>
          ) : null}
          <p className="font-label ac-eyebrow">Acceso de los novios</p>
          <h1 id="login-title" className="ac-h1">
            {heading}
          </h1>
          <p className="ac-lead">{lead}</p>

          {joining && !sent ? (
            <p role="status" className="ac-note ac-note--ok">
              <strong>Te han invitado a una boda.</strong> Entra con el correo en el que
              recibiste la invitación; al volver podrás aceptarla.
            </p>
          ) : null}

          {pendingCouple !== null && !sent ? (
            <p role="status" className="ac-note ac-note--ok">
              <strong>{pendingCouple ? `${pendingCouple}, vuestra invitación está guardada.` : "Vuestra invitación está guardada."}</strong>{" "}
              {pwMode === "signup" && method === "password"
                ? "Cread vuestra cuenta y seguiréis donde lo dejasteis."
                : "Entrad con vuestro email y seguiréis donde lo dejasteis."}
              {publishIntent ? (pwMode === "signup" && method === "password" ? " Al confirmarla en este navegador, publicamos vuestra web." : " Al entrar en este navegador, publicamos vuestra web.") : null}
            </p>
          ) : null}

          {authError && !sent ? (
            <p role="alert" className="ac-note ac-note--err">
              Ese enlace ya no vale: caducó o ya se usó, porque solo sirven
              una vez. Pedid uno nuevo aquí.
            </p>
          ) : null}

          {sent ? (
            <>
              <div role="status" className="ac-note ac-note--ok">
                {sent.kind === "confirm" ? (
                  <>
                    <p>
                      <strong>Falta confirmar vuestro correo.</strong>
                    </p>
                    <p>
                      Os hemos reenviado a {sent.email} un código de 6 cifras.
                      Escribidlo abajo o abrid el enlace del correo.
                    </p>
                  </>
                ) : sent.kind === "signup" ? (
                  <>
                    <p>
                      <strong>Revisad vuestro correo: {sent.email}.</strong>
                    </p>
                    <p>
                      Os hemos enviado un código de 6 cifras para terminar.
                      Escribidlo abajo: así guardamos también vuestra
                      contraseña. Si abrís el enlace del correo en otro
                      navegador entraréis igual, pero la contraseña habrá
                      que crearla después. Si no llega, mirad en spam o en
                      promociones.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <strong>Correo enviado a {sent.email}.</strong>
                    </p>
                    <p>
                      {standalone
                        ? "Escribid abajo el código que trae. Mejor que el enlace: el enlace se abriría en el navegador, fuera de esta app."
                        : "Escribid abajo el código que trae o abrid su enlace; los dos sirven una sola vez. Si no llega, mirad en spam o en promociones."}
                    </p>
                  </>
                )}
                {publishIntent ? (
                  <p>
                    Con el código, aquí mismo, entráis y publicamos vuestra
                    web.{sent.draftKept ? " Si abrís el enlace en otro navegador, la veréis allí y la publicáis con un toque." : null}
                  </p>
                ) : null}
                {sent.draftKept ? (
                  <p>
                    Lo que ya habéis preparado está guardado: al entrar
                    seguiréis donde lo dejasteis, también desde otro
                    dispositivo. Solo la foto habrá que elegirla de nuevo si
                    cambiáis de navegador.
                  </p>
                ) : null}
              </div>
              <CodeForm email={sent.email} autoFocus={standalone} />
              <button
                type="button"
                className="ac-link"
                onClick={() => {
                  clearPendingCode(sessionStore());
                  setSent(null);
                }}
              >
                {sent.kind === "code" ? "Usar otro correo o pedir otro código" : "Usar otro correo"}
              </button>
            </>
          ) : (
            <>
              {/* «Continuar con Google»: apagado hasta configurar el
              proveedor en Supabase y poner NEXT_PUBLIC_GOOGLE_LOGIN=on
              (lib/auth/google-login.ts; pasos en el plan maestro, §11). */}
              {showGoogle ? (
                <div className="ac-oauth">
                  <button
                    type="button"
                    className="ac-btn ac-btn--google"
                    onClick={handleGoogle}
                    disabled={googleStatus === "going"}
                  >
                    <GoogleMark />
                    {googleStatus === "going" ? "Abriendo Google…" : "Continuar con Google"}
                  </button>
                  {googleStatus === "error" || googleError ? (
                    <p role="alert" className="ac-note ac-note--err">
                      No hemos podido entrar con Google. Probad de nuevo o
                      entrad con vuestro email.
                    </p>
                  ) : null}
                  <p className="ac-or" aria-hidden="true"><span>o con vuestro email</span></p>
                </div>
              ) : null}

              {method === "password" ? (
                <PasswordAccess mode={pwMode} onModeChange={setPwMode} onSent={onPasswordSent} onEmail={bindIntent} />
              ) : (
                <form onSubmit={handleMagicLink} className="ac-form">
                  <div className="ac-fields">
                    <div className="ac-field">
                      <label htmlFor="email" className="ac-label">
                        Correo electrónico
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        className="ac-input"
                        placeholder="vosotros@ejemplo.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        autoComplete="email"
                        inputMode="email"
                        spellCheck={false}
                        aria-describedby="email-hint"
                      />
                      <p id="email-hint" className="ac-hint">
                        Con el correo de uno de los dos basta.
                      </p>
                    </div>
                  </div>
                  {captcha.widget}

                  <button
                    type="submit"
                    className="ac-btn"
                    disabled={codeStatus === "sending" || !captcha.ready}
                  >
                    {submitLabel({ pending: codeStatus === "sending", pendingLabel: "Enviando…", ready: captcha.ready, label: "Enviar el código" })}
                  </button>

                  {codeStatus === "captcha" ? (
                    <p role="alert" className="ac-note ac-note--err">
                      No hemos podido comprobar que sois personas. Esperad un
                      segundo y probad de nuevo.
                    </p>
                  ) : null}
                  {codeStatus === "error" ? (
                    <p role="alert" className="ac-note ac-note--err">
                      No hemos podido enviar el correo a {email}. Probad de
                      nuevo en un momento.
                    </p>
                  ) : null}
                </form>
              )}

              <p className="ac-switch">
                <button
                  type="button"
                  className="ac-link"
                  onClick={() => setMethod(method === "password" ? "code" : "password")}
                >
                  {method === "password"
                    ? "Prefiero un código por correo, sin contraseña"
                    : "Entrar o crear la cuenta con contraseña"}
                </button>
              </p>
            </>
          )}
        </div>
      </section>

      <footer className="ac-foot">
        <p>{BRAND_TAGLINE}</p>
        <nav aria-label="Legal">
          <Link href="/aviso-legal">Aviso legal</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </footer>
    </main>
  );
}

/** useSearchParams exige un límite de Suspense en páginas prerenderizadas. */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
