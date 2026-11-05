"use client";

/**
 * Último paso de «crear o cambiar la contraseña» (también para quien
 * siempre entró con código y aún no tiene). Se llega aquí ya autenticados
 * por el enlace de recuperación (verificado en /auth/confirm); aquí solo se
 * pide la contraseña nueva con supabase.auth.updateUser.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { isRecoveryAccessToken } from "@/lib/auth/recovery-session";
import { LazoIcon } from "@/components/brand/icons";
import { PASSWORD_MAX, PASSWORD_MIN as MIN_LENGTH } from "@/lib/auth/password-strength";
import { PasswordField } from "@/app/login/password-field";
import "@/app/login/access.css";

export default function RestablecerPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      // Solo se puede fijar una contraseña nueva con una sesión que viene de
      // un enlace de recuperación (amr "recovery"); cualquier otra, fuera.
      setHasSession(isRecoveryAccessToken(data.session?.access_token) ? "yes" : "no");
    });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasSession !== "yes") return;
    if (password.length < MIN_LENGTH) {
      setStatus("error");
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setStatus("error");
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setStatus("saving");
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setStatus("error");
      setError("No hemos podido guardar la contraseña. Probad de nuevo en un momento.");
      return;
    }
    router.replace("/panel");
  }

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

      <section className="ac-center" aria-labelledby="reset-title">
        <div className="ac-card">
          <p className="font-label ac-eyebrow">Vuestra cuenta</p>
          {hasSession === "checking" ? (
            <>
              <h1 id="reset-title" className="ac-h1">Un momento.</h1>
              <p role="status" className="ac-status">Comprobando el enlace…</p>
            </>
          ) : hasSession === "no" ? (
            <>
              <h1 id="reset-title" className="ac-h1">
                Este enlace <em>ya no vale.</em>
              </h1>
              <p className="ac-lead">
                Ha caducado o ya se usó: cada enlace sirve una sola vez. Pedid uno nuevo.
              </p>
              <Link href="/login" className="ac-btn ac-btn--inline">
                Volver al acceso
              </Link>
            </>
          ) : (
            <>
              <h1 id="reset-title" className="ac-h1">
                Elegid <em>una contraseña nueva.</em>
              </h1>
              <p className="ac-lead">Al menos {MIN_LENGTH} caracteres.</p>
              <form onSubmit={handleSubmit} className="ac-form">
                <div className="ac-fields">
                  <PasswordField
                    id="new-password"
                    label="Contraseña nueva"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    showStrength
                  />
                  <div className="ac-field">
                    <label htmlFor="confirm-password" className="ac-label">Repetidla</label>
                    <input
                      id="confirm-password"
                      name="confirm"
                      type="password"
                      className="ac-input"
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      required
                      minLength={MIN_LENGTH}
                      maxLength={PASSWORD_MAX}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <button type="submit" className="ac-btn" disabled={status === "saving"}>
                  {status === "saving" ? "Guardando…" : "Guardar contraseña"}
                </button>

                {status === "error" && error ? (
                  <p role="alert" className="ac-note ac-note--err">{error}</p>
                ) : null}
              </form>
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
