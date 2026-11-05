"use client";

/**
 * «Eliminar nuestra boda» y «Eliminar mi cuenta» (Ajustes, plan maestro
 * §5.10). Cada acción se despliega con un botón y pide escribir algo para
 * confirmar: la dirección de la boda o el propio correo. El servidor vuelve
 * a comprobarlo todo (lib/actions/account.ts).
 */
import { useActionState, useId, useState } from "react";

import { deleteAccount, deleteWedding, type DeletionState } from "@/lib/actions/account";
import { normalizeConfirmation } from "@/lib/deletion-notice";

const INITIAL: DeletionState = { error: null };

interface DangerZoneProps {
  role: "owner" | "partner";
  slug: string;
  email: string | null;
  hasPartner: boolean;
}

export function DangerZone({ role, slug, email, hasPartner }: DangerZoneProps) {
  return (
    <section id="eliminar" aria-labelledby="eliminar-title" className="pn-ed-section">
      <h2 id="eliminar-title" className="pn-display pn-h2">Eliminar datos</h2>
      <p className="pn-help">
        No se puede deshacer. Si queréis conservar la lista de invitados, descargadla antes desde Invitados.
      </p>
      <div className="mt-4 grid gap-6">
        {role === "owner" ? <DeleteWeddingForm slug={slug} /> : null}
        <DeleteAccountForm role={role} email={email} hasPartner={hasPartner} />
      </div>
    </section>
  );
}

function DeleteWeddingForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteWedding, INITIAL);
  const inputId = useId();
  const matches = normalizeConfirmation(typed) === slug.toLowerCase();

  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold">Eliminar nuestra boda</h3>
      <p className="pn-muted text-sm">
        Borra la web, los invitados y sus respuestas, los mensajes, las mesas, el presupuesto, las tareas y las fotos.
        {" "}Vuestra pareja también dejará de verla. Vuestras cuentas siguen existiendo.
      </p>
      {open ? (
        <form action={action} className="grid gap-3">
          <label className="pn-field" htmlFor={inputId}>
            <span>Para confirmar, escribid <strong>{slug}</strong></span>
            <input
              id={inputId}
              name="confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={state.error ? true : undefined}
            />
          </label>
          <div className="pn-form-actions">
            <button type="submit" className="pn-btn pn-btn--danger pn-press" disabled={pending || !matches}>
              {pending ? "Eliminando…" : "Eliminar la boda para siempre"}
            </button>
            <button type="button" className="pn-link pn-press" disabled={pending} onClick={() => { setOpen(false); setTyped(""); }}>
              Cancelar
            </button>
          </div>
          {state.error ? <p role="alert" className="pn-row-error">{state.error}</p> : null}
        </form>
      ) : (
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => setOpen(true)}>
            Eliminar nuestra boda
          </button>
        </div>
      )}
    </div>
  );
}

function DeleteAccountForm({ role, email, hasPartner }: Omit<DangerZoneProps, "slug">) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteAccount, INITIAL);
  const inputId = useId();
  const expected = (email ?? "").toLowerCase();
  const matches = expected !== "" && normalizeConfirmation(typed) === expected;
  const consequence =
    role === "partner"
      ? "Dejarás de gestionar la boda; tu pareja la conserva tal cual."
      : hasPartner
        ? "La boda no se borra: pasa a tu pareja, que podrá seguir gestionándola."
        : "Como nadie más gestiona la boda, también se borra entera, con sus invitados y fotos.";

  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold">Eliminar mi cuenta</h3>
      <p className="pn-muted text-sm">Borra tu acceso y tu correo de vinklo. {consequence}</p>
      {open ? (
        <form action={action} className="grid gap-3">
          <label className="pn-field" htmlFor={inputId}>
            <span>Para confirmar, escribe tu correo{email ? <> (<strong>{email}</strong>)</> : null}</span>
            <input
              id={inputId}
              name="confirm"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={state.error ? true : undefined}
            />
          </label>
          <div className="pn-form-actions">
            <button type="submit" className="pn-btn pn-btn--danger pn-press" disabled={pending || !matches}>
              {pending ? "Eliminando…" : "Eliminar mi cuenta para siempre"}
            </button>
            <button type="button" className="pn-link pn-press" disabled={pending} onClick={() => { setOpen(false); setTyped(""); }}>
              Cancelar
            </button>
          </div>
          {state.error ? <p role="alert" className="pn-row-error">{state.error}</p> : null}
        </form>
      ) : (
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => setOpen(true)}>
            Eliminar mi cuenta
          </button>
        </div>
      )}
    </div>
  );
}
