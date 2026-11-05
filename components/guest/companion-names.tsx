"use client";

/**
 * «¿Quiénes vienen contigo?» (plan maestro §4.3): nombre opcional de cada
 * acompañante y si es niño o niña. Lo usa el formulario de asistencia con
 * enlace personal. Sin dependencias pesadas (nada de zod): es parte de la
 * invitación pública. Una fila por acompañante; las vacías no se guardan,
 * pero «Es niño/a» cuenta para el número de niños.
 */
import { COMPANION_NAME_MAX, resizeCompanionRows, type CompanionRow } from "@/lib/rsvp-companions";

export function CompanionNames({ rows, companions, onChange, labelClass, inputClass }: {
  rows: CompanionRow[];
  companions: number;
  onChange(rows: CompanionRow[]): void;
  labelClass: string;
  inputClass: string;
}) {
  const shown = resizeCompanionRows(rows, companions);
  if (shown.length === 0) return null;
  const update = (index: number, patch: Partial<CompanionRow>) => onChange(shown.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="sp-appear mt-7 border-0 p-0" data-rsvp-companion-names="">
      <legend className={labelClass}>{shown.length === 1 ? "¿Quién viene contigo? (opcional)" : "¿Quiénes vienen contigo? (opcional)"}</legend>
      <p className="mt-1 text-sm leading-relaxed text-tinta/65">Con sus nombres, la pareja puede preparar las mesas y las tarjetas de cada sitio.</p>
      <ol className="m-0 mt-2 grid list-none gap-3 p-0">
        {shown.map((row, index) => (
          <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <label className="min-w-0">
              <span className="sr-only">Nombre del acompañante {index + 1}</span>
              <input
                value={row.name}
                onChange={(event) => update(index, { name: event.target.value })}
                maxLength={COMPANION_NAME_MAX}
                autoComplete="off"
                placeholder={`Acompañante ${index + 1}`}
                className={inputClass}
              />
            </label>
            <label className="inline-flex min-h-12 items-center gap-2 text-sm text-tinta/80">
              <input
                type="checkbox"
                checked={row.kid}
                onChange={(event) => update(index, { kid: event.target.checked })}
                className="size-5 shrink-0 accent-[var(--cava)]"
              />
              <span>Es niño/a</span>
            </label>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}
