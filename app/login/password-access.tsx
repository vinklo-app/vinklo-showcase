"use client";

import { useActionState, useState } from "react";

import { markLoginRequested } from "@/lib/auth/login-request";
import { PASSWORD_MIN } from "@/lib/auth/password-strength";
import {
  requestPasswordResetAction,
  signInWithPasswordAction,
  signUpWithPasswordAction,
  type PasswordLoginState,
  type PasswordResetState,
  type SignUpState,
} from "./actions";
import { submitLabel, useCaptcha } from "./captcha";
import { keepBuilderDraft } from "./keep-draft";
import { PasswordField } from "./password-field";

export type PasswordMode = "signup" | "signin";

/** El correo ya salió: el padre enseña «Revisad el correo» y el campo del código. */
export type OnSent = (sent: { email: string; draftKept: boolean; kind: "signup" | "confirm" }) => void;

function EmailField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ac-field">
      <label htmlFor={id} className="ac-label">
        Correo electrónico
      </label>
      <input
        id={id}
        name="email"
        type="email"
        className="ac-input"
        placeholder="vosotros@ejemplo.com"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
      />
    </div>
  );
}

/**
 * Crear la cuenta con contraseña. Antes de llamar al servidor hace lo mismo
 * que el envío del código: copia del borrador de /crear (la confirmación
 * puede abrirse en otro navegador) y la marca anti login-CSRF (el enlace de
 * confirmación llega a /auth/confirm).
 */
type EmailProps = { email: string; setEmail: (v: string) => void; /** Al enviar: el correo escrito (ata la marca de «Crear cuenta y publicar», publish-intent.ts). */ onEmail?: (email: string) => void };

function SignUpForm({ onSent, email, setEmail, onEmail }: { onSent: OnSent } & EmailProps) {
  const [password, setPassword] = useState("");
  const captcha = useCaptcha();
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(
    async (prev, formData) => {
      onEmail?.(email.trim());
      const draftKept = await keepBuilderDraft(email.trim());
      markLoginRequested();
      // Si el servidor redirige (cuenta con sesión), la promesa no trae estado.
      const next = (await signUpWithPasswordAction(prev, formData)) as SignUpState | undefined;
      // El token del CAPTCHA ya se gastó: uno nuevo por si hay que reintentar.
      captcha.reset();
      if (next?.status === "check-email") onSent({ email: next.email, draftKept, kind: "signup" });
      return next ?? prev;
    },
    { status: "idle", error: null, email: "" },
  );
  const tooShort = password.length < PASSWORD_MIN;

  return (
    <form action={formAction} className="ac-form">
      <div className="ac-fields">
        <EmailField id="signup-email" value={email} onChange={setEmail} />
        <PasswordField
          id="signup-password"
          label="Elegid una contraseña"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
        />
      </div>
      <input type="hidden" name="captchaToken" value={captcha.token} />
      {captcha.widget}

      <button type="submit" className="ac-btn" disabled={pending || tooShort || !captcha.ready}>
        {submitLabel({ pending, pendingLabel: "Creando la cuenta…", ready: captcha.ready, label: "Crear la cuenta" })}
      </button>

      {state.error ? (
        <p role="alert" className="ac-note ac-note--err">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Entrar con contraseña. Mismo error exista o no la cuenta (ver actions.ts). */
function SignInForm({ onSent, onForgot, email, setEmail, onEmail }: { onSent: OnSent; onForgot: () => void } & EmailProps) {
  const [password, setPassword] = useState("");
  const captcha = useCaptcha();
  const [state, formAction, pending] = useActionState<PasswordLoginState, FormData>(
    async (prev, formData) => {
      // Si falta confirmar el correo, el servidor lo reenvía: que el enlace
      // entre solo en este navegador.
      onEmail?.(email.trim());
      markLoginRequested();
      // Al entrar bien el servidor redirige y la promesa no trae estado.
      const next = (await signInWithPasswordAction(prev, formData)) as PasswordLoginState | undefined;
      captcha.reset();
      if (next?.needsCode) onSent({ email: next.email, draftKept: false, kind: "confirm" });
      return next ?? prev;
    },
    { error: null, email: "" },
  );

  return (
    <form action={formAction} className="ac-form">
      <div className="ac-fields">
        <EmailField id="pw-email" value={email} onChange={setEmail} />
        <PasswordField
          id="pw-password"
          label="Contraseña"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </div>
      <input type="hidden" name="captchaToken" value={captcha.token} />
      {captcha.widget}

      <button type="submit" className="ac-btn" disabled={pending || !captcha.ready}>
        {submitLabel({ pending, pendingLabel: "Entrando…", ready: captcha.ready, label: "Entrar" })}
      </button>

      {state.error ? (
        <p role="alert" className="ac-note ac-note--err">
          {state.error}
        </p>
      ) : null}

      <button type="button" className="ac-link" onClick={onForgot}>
        ¿Aún no tenéis contraseña o la habéis olvidado?
      </button>
    </form>
  );
}

/**
 * Enlace para crear o cambiar la contraseña. Vale también para quien
 * siempre entró con código: al abrirlo elige una en /login/restablecer.
 */
function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const captcha = useCaptcha();
  const [state, formAction, pending] = useActionState<PasswordResetState, FormData>(
    async (prev, formData) => {
      const next = await requestPasswordResetAction(prev, formData);
      captcha.reset();
      return next;
    },
    { sent: false, error: null },
  );

  if (state.sent) {
    return (
      <div role="status" className="ac-note ac-note--ok">
        <p>
          <strong>Si ese correo tiene cuenta, le hemos enviado un enlace.</strong>
        </p>
        <p>Abridlo para elegir vuestra contraseña; sirve una sola vez. Si no llega, mirad en spam o en promociones.</p>
        <button type="button" className="ac-link" onClick={onBack}>
          Volver a entrar
        </button>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        // Anti login-CSRF: el enlace de recuperación llega a /auth/confirm.
        markLoginRequested();
        return formAction(formData);
      }}
      className="ac-form"
    >
      <p className="ac-hint">
        Os enviamos un enlace para elegir una contraseña nueva. Sirve también si
        hasta ahora entrabais solo con el código del correo.
      </p>
      <div className="ac-fields ac-fields--after-hint">
        <div className="ac-field">
          <label htmlFor="forgot-email" className="ac-label">
            Correo electrónico
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            className="ac-input"
            required
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      </div>
      <input type="hidden" name="captchaToken" value={captcha.token} />
      {captcha.widget}

      <button type="submit" className="ac-btn" disabled={pending || !captcha.ready}>
        {submitLabel({ pending, pendingLabel: "Enviando…", ready: captcha.ready, label: "Enviarme el enlace" })}
      </button>

      {state.error ? (
        <p role="alert" className="ac-note ac-note--err">
          {state.error}
        </p>
      ) : null}

      <button type="button" className="ac-link" onClick={onBack}>
        Volver a entrar
      </button>
    </form>
  );
}

/**
 * Correo + contraseña (13-oct-2026): «Crear cuenta» o «Entrar», con el
 * enlace de «crear o cambiar la contraseña». El modo lo decide /login
 * (desde el creador se abre en «Crear cuenta»).
 */
export function PasswordAccess({
  mode,
  onModeChange,
  onSent,
  onEmail,
}: {
  mode: PasswordMode;
  onModeChange: (mode: PasswordMode) => void;
  onSent: OnSent;
  onEmail?: (email: string) => void;
}) {
  const [forgot, setForgot] = useState(false);
  // El correo se conserva al cambiar entre «Crear cuenta» y «Entrar».
  const [email, setEmail] = useState("");
  if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;

  return (
    <>
      <div className="ac-seg" role="group" aria-label="Cuenta nueva o existente">
        <button type="button" aria-pressed={mode === "signup"} onClick={() => onModeChange("signup")}>
          Crear cuenta
        </button>
        <button type="button" aria-pressed={mode === "signin"} onClick={() => onModeChange("signin")}>
          Entrar
        </button>
      </div>
      {mode === "signup" ? (
        <SignUpForm onSent={onSent} email={email} setEmail={setEmail} onEmail={onEmail} />
      ) : (
        <SignInForm onSent={onSent} onForgot={() => setForgot(true)} email={email} setEmail={setEmail} onEmail={onEmail} />
      )}
    </>
  );
}
