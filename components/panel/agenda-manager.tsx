"use client";

/**
 * Gestor de la agenda del día (panel de la pareja): añadir, editar y
 * borrar hitos. Atajos con los momentos típicos de una boda española.
 */
import { useState, useTransition } from "react";

import {
  addAgendaItem,
  deleteAgendaItem,
  updateAgendaItem,
} from "@/lib/actions/agenda";
import { CalendarClockIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/panel/page-head";
import { PlaceCombobox } from "@/components/places/place-combobox";
import { clipPlaceText } from "@/lib/places/places";

export interface AgendaRow {
  id: string;
  title: string;
  time_label: string | null;
  place: string | null;
  address: string | null;
  notes: string | null;
  sort: number;
}

const PRESETS = [
  "Ceremonia",
  "Cóctel",
  "Banquete",
  "Fiesta",
  "Autobuses",
] as const;

// Campos de 48 px (objetivo táctil) con filete --line-strong; foco arcilla (.pn-scope).
const inputClass =
  "min-h-12 w-full rounded-lg border border-line-strong bg-white px-3 text-base text-ink outline-none";

function ItemForm({
  initial,
  onDone,
  submitLabel,
  action,
}: {
  initial?: Partial<AgendaRow> & { title?: string };
  onDone: () => void;
  submitLabel: string;
  action: (fields: {
    title: string;
    timeLabel?: string;
    place?: string;
    address?: string;
    notes?: string;
  }) => Promise<{ ok: boolean; error?: string } | { ok: false; error: string } | { ok: true }>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [timeLabel, setTimeLabel] = useState(initial?.time_label ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await action({ title, timeLabel, place, address, notes });
      if (result.ok) {
        onDone();
      } else {
        setError(("error" in result && result.error) || "No se pudo guardar.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label
            htmlFor="ag-title"
            className="text-xs text-ink-muted"
          >
            Momento
          </Label>
          <input
            id="ag-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ceremonia"
            required
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <Label htmlFor="ag-time" className="text-xs text-ink-muted">
            Hora (como queráis escribirla)
          </Label>
          <input
            id="ag-time"
            value={timeLabel}
            onChange={(e) => setTimeLabel(e.target.value)}
            placeholder="13:00"
            className={`${inputClass} mt-1`}
          />
        </div>
        {/* Sugerencias de lugares: elegir una rellena el lugar y su dirección (todo editable). */}
        <PlaceCombobox
          id="ag-place"
          label="Lugar"
          labelClassName="block text-xs text-ink-muted"
          inputClassName={`${inputClass} mt-1`}
          maxLength={160}
          value={place}
          onChange={setPlace}
          onPick={(picked) => {
            if (!picked.full) setPlace(clipPlaceText(picked.name, 160));
            if (picked.address) setAddress(clipPlaceText(picked.address, 240));
          }}
          placeholder="Iglesia de San Nicolás"
        />
        <div>
          <Label
            htmlFor="ag-address"
            className="text-xs text-ink-muted"
          >
            Dirección o enlace de Maps
          </Label>
          <input
            id="ag-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
            className={`${inputClass} mt-1`}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ag-notes" className="text-xs text-ink-muted">
          Notas para los invitados (opcional)
        </Label>
        <textarea
          id="ag-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Los autobuses salen de Plaza de España a las 12:15 y vuelven a la 1:00 y a las 3:00."
          className="mt-1 w-full rounded-lg border border-line-strong bg-white px-3 py-3 text-base text-ink outline-none"
        />
      </div>
      {error && (
        <p role="alert" className="pn-row-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="pn-btn pn-press">
          {pending ? "Guardando…" : submitLabel}
        </button>
        <button type="button" onClick={onDone} className="pn-link pn-press">
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function AgendaManager({ items }: { items: AgendaRow[] }) {
  const [adding, setAdding] = useState(false);
  const [presetTitle, setPresetTitle] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      await deleteAgendaItem(id);
    });
  }

  return (
    <div>
      {items.length === 0 && !adding && (
        <EmptyState
          icon={CalendarClockIcon}
          title={<>Contad cómo será <em>el día.</em></>}
          body="Añadid los momentos del día — ceremonia, cóctel, banquete, autobuses — y aparecerán en vuestra página de invitados, con horarios y direcciones a mano. Empezad por uno de los atajos de abajo."
        />
      )}

      <ul className="pn-list mt-2">
        {items.map((item) =>
          editingId === item.id ? (
            <li
              key={item.id}
              className="pn-rule-strong border-l-2 py-4 pl-4"
            >
              <ItemForm
                initial={item}
                submitLabel="Guardar cambios"
                onDone={() => setEditingId(null)}
                action={(fields) =>
                  updateAgendaItem({ id: item.id, ...fields })
                }
              />
            </li>
          ) : (
            <li
              key={item.id}
              className="pn-rule flex items-start justify-between gap-3 border-b py-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {item.time_label && (
                    <span className="pn-tnum mr-2 font-mono text-xs font-medium text-ink-muted">{item.time_label}</span>
                  )}
                  {item.title}
                </p>
                {(item.place || item.address) && (
                  <p className="pn-muted mt-0.5 truncate text-sm">
                    {item.place}
                    {item.place && item.address ? " · " : ""}
                    {item.address}
                  </p>
                )}
                {item.notes && (
                  <p className="pn-muted mt-1 text-xs leading-relaxed">
                    {item.notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingId(item.id)}
                  className="pn-link pn-press text-xs"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="pn-link pn-press pn-muted text-xs"
                >
                  Borrar
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <div className="pn-rule-strong mt-4 border-l-2 py-2 pl-4">
          <ItemForm
            initial={{ title: presetTitle }}
            submitLabel="Añadir momento"
            onDone={() => {
              setAdding(false);
              setPresetTitle("");
            }}
            action={addAgendaItem}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPresetTitle(p);
                setAdding(true);
              }}
              className="pn-chip pn-press"
            >
              + {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPresetTitle("");
              setAdding(true);
            }}
            className="pn-link pn-press font-semibold"
          >
            + Otro momento
          </button>
        </div>
      )}
    </div>
  );
}
