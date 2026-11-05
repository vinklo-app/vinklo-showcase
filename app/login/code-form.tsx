"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { clearPendingCode, savePendingCode, sessionStore } from "@/lib/auth/pending-code";
import { verifyLoginCodeAction, type CodeLoginState } from "./actions";

const CODE_LENGTH = 6;

/**
 * Código de 6 cifras del correo (2026-10-08). Sirve donde el enlace no
 * llega: el enlace se abre a menudo en el navegador de la app de correo, y
 * en el icono de la pantalla de inicio del iPhone (que tiene sus propias
 * cookies) siempre se abriría fuera. Al completar las 6 cifras se envía
 * solo; también se puede pegar «123 456».
 */
export function CodeForm({ email, autoFocus }: { email: string; autoFocus: boolean }) {
  const [code, setCode] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const lastSubmitted = useRef("");
  const [state, formAction, pending] = useActionState<CodeLoginState, FormData>(
    verifyLoginCodeAction,
    { error: null },
  );

  // Al enviar se olvida el «código pendiente» (si entra, no debe reaparecer
  // al cerrar sesión); si el código falla, se recuerda de nuevo.
  useEffect(() => {
    if (state.error) savePendingCode(sessionStore(), email);
  }, [state, email]);

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    // Envío automático una sola vez por código completo (no en bucle si falla).
    if (digits.length === CODE_LENGTH && digits !== lastSubmitted.current && !pending) {
      lastSubmitted.current = digits;
      queueMicrotask(() => formRef.current?.requestSubmit());
    }
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={() => clearPendingCode(sessionStore())} className="ac-form">
      <input type="hidden" name="email" value={email} />
      <div className="ac-fields">
        <div className="ac-field">
          <label htmlFor="login-code" className="ac-label">
            Escribid el código de 6 cifras que os hemos enviado
          </label>
          <input
            id="login-code"
            name="token"
            type="text"
            className="ac-input ac-input--code"
            value={code}
            onChange={(event) => onChange(event.target.value)}
            required
            autoFocus={autoFocus}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            enterKeyHint="go"
            spellCheck={false}
            aria-describedby="login-code-hint"
            aria-invalid={state.error ? true : undefined}
          />
          <p id="login-code-hint" className="ac-hint">
            Viene en el mismo correo que el enlace. Caduca en 15 minutos.
          </p>
        </div>
      </div>

      <button type="submit" className="ac-btn" disabled={pending || code.length !== CODE_LENGTH}>
        {pending ? "Entrando…" : "Entrar con el código"}
      </button>

      {state.error ? (
        <p role="alert" className="ac-note ac-note--err">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
