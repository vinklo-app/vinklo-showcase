"use client";

import { useId, useState, useTransition } from "react";
import { reminderSummary } from "@/components/panel/reminders";
import type { GuestActions, GuestRow } from "./types";

/**
 * «No enviarle recordatorios» y el historial de recordatorios de la persona.
 * Fuera del formulario: se guarda al tocar (optimista; vuelve atrás si falla).
 */
export function ReminderSettings({ guest, actions, first = false }: { guest: GuestRow; actions: GuestActions; first?: boolean }) {
  const [optOut, setOptOut] = useState(guest.reminders_opt_out);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const labelId = useId();
  const helpId = useId();
  const summary = reminderSummary(guest.reminder_count, guest.last_reminder_at);
  const waiting = guest.rsvp_status === "pendiente" && guest.invitation_sent_at !== null;

  function toggle() {
    const next = !optOut;
    setOptOut(next); setError(null);
    startTransition(async () => {
      try {
        const result = await actions.setRemindersOptOut(guest.id, next);
        if (!result.ok) { setOptOut(!next); setError(result.error); }
      } catch { setOptOut(!next); setError("No se ha guardado. Comprobad la conexión y probad de nuevo."); }
    });
  }

  return (
    <section className="pn-sheet-section" data-first={first ? "true" : undefined} aria-labelledby={`${labelId}-title`}>
      <h3 id={`${labelId}-title`} className="pn-sheet-section-title">Recordatorios</h3>
      <p className="pn-help">
        {summary ? `${summary} (lo confirmáis vosotros).` : waiting ? "Aún no le habéis enviado ningún recordatorio." : "Los recordatorios son para quien recibió la invitación y aún no ha respondido."}
      </p>
      <div className="pn-switch-row">
        <span>
          <span id={labelId} className="block text-sm font-semibold">No enviarle recordatorios</span>
          <span id={helpId} className="pn-help block">Para quien os lo haya pedido. No aparecerá en «Para recordar».</span>
        </span>
        <button type="button" role="switch" aria-checked={optOut} aria-labelledby={labelId} aria-describedby={helpId} disabled={pending} onClick={toggle} className="pn-switch">
          <span aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
    </section>
  );
}
