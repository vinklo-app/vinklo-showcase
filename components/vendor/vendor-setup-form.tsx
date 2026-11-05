"use client";

/**
 * Formulario del portal de proveedor (/v/[token]) — sin sesión: el token
 * es la única llave y viaja en el FormData hacia submitVendorSetup.
 * Estilo editorial v7 (hairlines de tinta, esquinas rectas).
 */
import { useState, useTransition } from "react";

import { submitVendorSetup } from "@/lib/actions/vendors";
import { MAX_TRANCHES } from "@/lib/vendors";

interface TrancheRow {
  label: string;
  amountEur: string;
  dueDate: string;
}

const inputClass =
  "h-10 w-full rounded-none border border-[var(--tinta)]/30 bg-white px-3 text-sm text-[var(--tinta)] outline-none focus-visible:border-[var(--tinta)] focus-visible:ring-3 focus-visible:ring-[var(--tinta)]/25";

export function VendorSetupForm({
  token,
  ibanLocked,
}: {
  token: string;
  /** Con el proveedor ya activo, el IBAN no puede cambiarse desde aquí. */
  ibanLocked: boolean;
}) {
  const [tranches, setTranches] = useState<TrancheRow[]>([
    { label: "Señal", amountEur: "", dueDate: "" },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function updateTranche(i: number, patch: Partial<TrancheRow>) {
    setTranches((rows) =>
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  }

  function onSubmit(formData: FormData) {
    setMessage(null);
    formData.set("token", token);
    formData.set(
      "tranchesJson",
      JSON.stringify(
        tranches
          .filter((t) => t.label.trim() !== "" || t.amountEur.trim() !== "")
          .map((t) => ({
            label: t.label,
            amountEur: t.amountEur,
            dueDate: t.dueDate === "" ? undefined : t.dueDate,
          })),
      ),
    );
    startTransition(async () => {
      const result = await submitVendorSetup(formData);
      setOk(result.ok);
      setMessage(
        result.ok
          ? "¡Recibido! La pareja ya puede ver vuestra factura y calendario."
          : result.error,
      );
    });
  }

  return (
    <form action={onSubmit} className="mt-8 space-y-6">
      <div>
        <label
          htmlFor="v-total"
          className="text-sm font-medium text-[var(--tinta)]"
        >
          Importe total (€)
        </label>
        <input
          id="v-total"
          name="totalEur"
          inputMode="decimal"
          placeholder="4.500"
          required
          className={`${inputClass} mt-1.5`}
        />
      </div>

      <div>
        <label
          htmlFor="v-iban"
          className="text-sm font-medium text-[var(--tinta)]"
        >
          IBAN de cobro {ibanLocked && "(ya establecido — bloqueado)"}
        </label>
        <input
          id="v-iban"
          name="iban"
          placeholder="ES00 0000 0000 0000 0000 0000"
          required
          readOnly={ibanLocked}
          aria-describedby={ibanLocked ? "v-iban-lock" : undefined}
          className={`${inputClass} mt-1.5 ${ibanLocked ? "bg-[var(--rubor)] text-[var(--tinta)]/60" : ""}`}
        />
        {ibanLocked && (
          <p id="v-iban-lock" className="mt-1.5 text-xs text-[var(--tinta)]/65">
            Por seguridad, el IBAN no puede cambiarse desde este enlace.
            Escribid el mismo IBAN; para cambiarlo, contactad con la pareja.
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--tinta)]">
          Calendario de pagos
        </legend>
        <div className="mt-2 space-y-3">
          {tranches.map((t, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                aria-label={`Concepto del plazo ${i + 1}`}
                value={t.label}
                onChange={(e) => updateTranche(i, { label: e.target.value })}
                placeholder="Señal"
                className={inputClass}
              />
              <input
                aria-label={`Importe del plazo ${i + 1} en euros`}
                value={t.amountEur}
                onChange={(e) =>
                  updateTranche(i, { amountEur: e.target.value })
                }
                inputMode="decimal"
                placeholder="1.500"
                className={inputClass}
              />
              <input
                aria-label={`Fecha de vencimiento del plazo ${i + 1}`}
                type="date"
                value={t.dueDate}
                onChange={(e) => updateTranche(i, { dueDate: e.target.value })}
                className={inputClass}
              />
            </div>
          ))}
        </div>
        {tranches.length < MAX_TRANCHES && (
          <button
            type="button"
            onClick={() =>
              setTranches((r) => [
                ...r,
                { label: "", amountEur: "", dueDate: "" },
              ])
            }
            className="mt-3 text-sm font-bold text-[var(--tinta)] underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-[var(--tinta)]/25"
          >
            + Añadir plazo
          </button>
        )}
      </fieldset>

      <div>
        <label
          htmlFor="v-invoice"
          className="text-sm font-medium text-[var(--tinta)]"
        >
          Factura o presupuesto (PDF, máx. 10&nbsp;MB)
        </label>
        <input
          id="v-invoice"
          name="invoice"
          type="file"
          accept="application/pdf"
          required
          className="mt-1.5 block w-full text-sm text-[var(--tinta)] file:mr-3 file:rounded-none file:border file:border-[var(--tinta)] file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--tinta)]"
        />
      </div>

      <div>
        <label
          htmlFor="v-notes"
          className="text-sm font-medium text-[var(--tinta)]"
        >
          Notas (opcional)
        </label>
        <textarea
          id="v-notes"
          name="notes"
          rows={3}
          maxLength={500}
          className="mt-1.5 w-full rounded-none border border-[var(--tinta)]/30 bg-white px-3 py-2 text-sm text-[var(--tinta)] outline-none focus-visible:border-[var(--tinta)] focus-visible:ring-3 focus-visible:ring-[var(--tinta)]/25"
        />
      </div>

      {message && (
        <p
          role="status"
          className={`text-sm font-medium ${ok ? "text-[var(--salvia)]" : "text-[var(--granate)]"}`}
        >
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-none bg-[var(--tinta)] px-6 text-[13px] font-semibold tracking-[0.08em] text-white uppercase transition-colors outline-none hover:bg-[var(--ciruela-hover)] disabled:opacity-60 focus-visible:ring-3 focus-visible:ring-[var(--tinta)]/40 focus-visible:ring-offset-2"
      >
        {pending ? "Enviando…" : "Enviar a la pareja"}
      </button>
    </form>
  );
}
