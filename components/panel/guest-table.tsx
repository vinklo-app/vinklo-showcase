"use client";

/**
 * Vista «Tabla» de los invitados (backlog 13-oct-2026, punto 14): toda la
 * lista del filtro activo como una hoja de cálculo, con los campos propios
 * importados del Excel. Columnas ordenables, cabecera y primera columna
 * fijas, desplazamiento horizontal SOLO dentro de la tabla y búsqueda al
 * escribir (en lo ya cargado; no viaja nada al servidor). Tocar el nombre
 * abre la misma ficha que la lista.
 */
import { useDeferredValue, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, LayoutListIcon, SearchIcon, Table2Icon } from "lucide-react";
import "@/components/panel/guest-import.css";
import { GUEST_STATUS_LABELS, displayStatus, formatCount, guestStatus, plural } from "@/components/panel/guest-status";
import type { GuestRow } from "@/components/panel/guest-list";
import type { GuestSide } from "@/lib/crm/tags";
import { extraFieldKeys, type GuestView } from "@/lib/crm/guest-view";

export type { GuestView };

interface Column { key: string; label: string; value: (guest: GuestRow) => string; numeric?: boolean }

const searchKey = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export function GuestTable({ guests, onEdit, sideLabels }: {
  guests: GuestRow[];
  onEdit: (guest: GuestRow) => void;
  sideLabels?: Record<GuestSide, string>;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const searchId = useId();
  const extraKeys = useMemo(() => extraFieldKeys(guests.map((guest) => guest.extra_fields)), [guests]);
  const columns = useMemo<Column[]>(() => {
    const list: Column[] = [
      { key: "name", label: "Nombre", value: (g) => g.name },
      { key: "phone", label: "Teléfono", value: (g) => g.phone ?? "" },
      { key: "status", label: "Estado", value: (g) => GUEST_STATUS_LABELS[displayStatus(guestStatus(g), g.crm?.invitationOpenedAt ?? null)] },
      { key: "companions", label: "Acompañantes", numeric: true, value: (g) => (g.rsvp_status === "si" ? String(g.rsvp_companions) : typeof g.max_companions === "number" ? `máx. ${g.max_companions}` : "") },
    ];
    if (guests.some((g) => g.group_name)) list.push({ key: "group", label: "Grupo", value: (g) => g.group_name ?? "" });
    if (sideLabels && guests.some((g) => g.side)) list.push({ key: "side", label: "Lado", value: (g) => (g.side ? sideLabels[g.side] : "") });
    if (guests.some((g) => g.tags?.length)) list.push({ key: "tags", label: "Etiquetas", value: (g) => (g.tags ?? []).join(" · ") });
    if (guests.some((g) => g.rsvp_notes)) list.push({ key: "notes", label: "Notas", value: (g) => g.rsvp_notes ?? "" });
    if (guests.some((g) => g.rsvp_logistic_notes)) list.push({ key: "logistic", label: "Otras notas", value: (g) => g.rsvp_logistic_notes ?? "" });
    if (guests.some((g) => g.answers_text)) list.push({ key: "answers", label: "Respuestas", value: (g) => g.answers_text ?? "" });
    for (const key of extraKeys) list.push({ key: `x:${key}`, label: key, value: (g) => g.extra_fields?.[key] ?? "" });
    return list;
  }, [guests, extraKeys, sideLabels]);

  const rows = useMemo(() => {
    const needle = searchKey(deferred.trim());
    const filtered = needle ? guests.filter((guest) => columns.some((column) => searchKey(column.value(guest)).includes(needle))) : guests;
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return filtered;
    // Vacíos siempre al final, en los dos sentidos.
    return [...filtered].sort((a, b) => {
      const va = column.value(a);
      const vb = column.value(b);
      if (!va || !vb) return va ? -1 : vb ? 1 : 0;
      return collator.compare(va, vb) * sort.dir;
    });
  }, [guests, columns, deferred, sort]);

  function toggleSort(key: string) {
    setSort((current) => (current?.key !== key ? { key, dir: 1 } : current.dir === 1 ? { key, dir: -1 } : null));
  }

  return (
    <div className="pn-gt">
      <div className="pn-search pn-gt-search">
        <SearchIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
        <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en la tabla" aria-label="Buscar en la tabla" autoComplete="off" maxLength={120} />
      </div>
      <p className="pn-help pn-tnum" aria-live="polite">
        {deferred.trim() ? `${plural(rows.length, "coincidencia", "coincidencias")} de ${formatCount(guests.length)}` : `${plural(guests.length, "invitación", "invitaciones")}${extraKeys.length ? ` · ${plural(extraKeys.length, "campo propio", "campos propios")}` : ""}`}
      </p>
      <div className="pn-gt-scroll" role="region" aria-label="Tabla de invitados" tabIndex={0}>
        <table className="pn-gt-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const Icon = !active ? ArrowUpDownIcon : sort!.dir === 1 ? ArrowUpIcon : ArrowDownIcon;
                return (
                  <th key={column.key} scope="col" aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"} data-extra={column.key.startsWith("x:") ? "true" : undefined}>
                    <button type="button" className="pn-gt-sort pn-press" onClick={() => toggleSort(column.key)}>
                      <span>{column.label}</span><Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((guest) => (
              <tr key={guest.id}>
                {columns.map((column, index) => index === 0 ? (
                  <th key={column.key} scope="row">
                    <button type="button" className="pn-gt-name pn-press" onClick={() => onEdit(guest)} aria-label={`Abrir la ficha de ${guest.name}`}>{guest.name}</button>
                  </th>
                ) : (
                  <td key={column.key} data-col={column.key}>{column.value(guest)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="pn-help pn-gt-empty">Nada coincide con «{deferred.trim()}».</p>}
      </div>
    </div>
  );
}

/** Lista / Tabla. Con `hrefs` son enlaces (borrador); si no, guarda la cookie y recarga los datos. */
export function GuestViewToggle({ view, onChange, hrefs }: { view: GuestView; onChange?: (view: GuestView) => void; hrefs?: Record<GuestView, string> }) {
  const items: Array<{ value: GuestView; label: string; Icon: typeof Table2Icon }> = [
    { value: "lista", label: "Lista", Icon: LayoutListIcon },
    { value: "tabla", label: "Tabla", Icon: Table2Icon },
  ];
  return (
    <div className="pn-gt-toggle" role="group" aria-label="Ver como">
      {items.map(({ value, label, Icon }) => hrefs ? (
        <Link key={value} href={hrefs[value]} className="pn-gt-toggle-item pn-press" aria-current={view === value ? "true" : undefined} replace scroll={false}>
          <Icon aria-hidden="true" className="size-4" />{label}
        </Link>
      ) : (
        <button key={value} type="button" className="pn-gt-toggle-item pn-press" aria-pressed={view === value} onClick={() => { if (view !== value) onChange?.(value); }}>
          <Icon aria-hidden="true" className="size-4" />{label}
        </button>
      ))}
    </div>
  );
}

/** Campos propios en la ficha del invitado (solo lectura: vienen del Excel). */
export function GuestImportedFields({ fields }: { fields?: Record<string, string> | null }) {
  const entries = Object.entries(fields ?? {}).filter(([, value]) => value);
  if (entries.length === 0) return null;
  return (
    <section className="pn-xl-fields" aria-label="Datos importados">
      <h3 className="pn-xl-fields-title">Datos importados</h3>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key} className="pn-xl-field">
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
