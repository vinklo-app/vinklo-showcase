"use client";

/**
 * Botón de aceptar de /unirse (con sesión). Muestra con qué correo se entra
 * y los errores de la RPC con un texto claro (caducada, otro correo, ya
 * tienes boda…). Nunca pinta datos de la boda.
 */
import { useActionState } from "react";

import { acceptPartnerInvite, dismissJoin, switchJoinAccount, type AcceptState } from "@/lib/actions/partner";

const INITIAL: AcceptState = { error: null, code: null };

export function JoinAcceptForm({ token, email, initial = INITIAL }: { token: string; email: string | null; initial?: AcceptState }) {
  const [state, action, pending] = useActionState(acceptPartnerInvite, initial);
  const wrongAccount = state.code === "email_mismatch" || state.code === "has_wedding";

  return (
    <>
      <p className="ac-lead">
        Entras como <strong>{email ?? "tu cuenta"}</strong>. Al aceptar gestionaréis la misma boda,
        cada uno con su correo: invitados, mensajes, regalos, mesas y la web.
      </p>

      {state.error ? (
        <p role="alert" className="ac-note ac-note--err">{state.error}</p>
      ) : null}

      {!wrongAccount && state.code !== "expired" && state.code !== "used" && state.code !== "full" ? (
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="ac-btn" disabled={pending}>
            {pending ? "Uniéndote…" : "Aceptar y entrar"}
          </button>
        </form>
      ) : null}

      <form action={switchJoinAccount} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={wrongAccount ? "ac-btn" : "ac-link"}>
          {wrongAccount ? "Entrar con otro correo" : "No soy yo: entrar con otro correo"}
        </button>
      </form>
      <form action={dismissJoin} className="mt-2">
        <button type="submit" className="ac-link">Ahora no</button>
      </form>
    </>
  );
}
