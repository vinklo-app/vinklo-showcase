"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { CRM_GUEST_FILTER_LABELS, GUEST_FILTER_LABELS, type GuestListFilter } from "@/lib/messages/filters";
import { plural } from "@/components/panel/guest-status";
import type { GroupFilter } from "@/lib/crm/groups";
import type { SideFilter } from "@/lib/crm/tags";

/** Etiqueta y lado del filtro activo (20261020100000). */
export interface GuestCsvExtra { tag?: string | null; side?: SideFilter }
export type GuestCsvExport = (filter: string, search?: string, group?: GroupFilter, extra?: GuestCsvExtra) => Promise<{ ok: true; csv: string; filename: string; rows: number } | { ok: false; error: string }>;

function filterName(filter: GuestListFilter): string {
  if (filter === "sin_respuesta") return "Sin respuesta";
  return filter in GUEST_FILTER_LABELS ? GUEST_FILTER_LABELS[filter as keyof typeof GUEST_FILTER_LABELS] : CRM_GUEST_FILTER_LABELS[filter as keyof typeof CRM_GUEST_FILTER_LABELS];
}

/**
 * Exporta a CSV exactamente lo que se ve: filtro activo + búsqueda (mismo
 * predicado SQL que la lista). El BOM se añade aquí para que Excel abra bien
 * las tildes. Nunca incluye enlaces ni tokens.
 */
export function GuestCsvButton({ filter, query, group, tag = null, side = null, sideLabel, exportCsv }: {
  filter: GuestListFilter; query: string; group?: GroupFilter; exportCsv: GuestCsvExport;
  /** Etiqueta y lado elegidos en la lista (y el texto del lado para el aviso). */
  tag?: string | null; side?: SideFilter; sideLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const groupScope = [
    group?.kind === "named" ? `grupo «${group.name}»` : group?.kind === "none" ? "sin grupo" : null,
    tag ? `etiqueta «${tag}»` : null,
    side === "none" ? "sin lado" : side ? (sideLabel ?? "un lado").toLocaleLowerCase("es") : null,
  ].filter(Boolean).join(", ") || null;
  const base = filter === "todos" ? (query ? `búsqueda «${query}»` : "toda la lista") : `${filterName(filter)}${query ? `, búsqueda «${query}»` : ""}`;
  const scope = groupScope ? (filter === "todos" && !query ? groupScope : `${base}, ${groupScope}`) : base;

  function download() {
    startTransition(async () => {
      try {
        const extra = tag || side ? { tag, side } : undefined;
        const result = extra ? await exportCsv(filter, query, group, extra) : group && group.kind !== "all" ? await exportCsv(filter, query, group) : await exportCsv(filter, query);
        if (!result.ok) { toast(result.error); return; }
        if (result.rows === 0) { toast("No hay nadie con este filtro: no hay nada que exportar."); return; }
        const blob = new Blob(["﻿" + result.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`Descargado: ${plural(result.rows, "persona", "personas")} (${scope}).`);
      } catch { toast("No hemos podido preparar el archivo. Probad de nuevo."); }
    });
  }

  return (
    <button type="button" onClick={download} disabled={pending} className="pn-act pn-press" aria-label={`Exportar en CSV: ${scope}`}>
      <DownloadIcon aria-hidden="true" className="size-4" />{pending ? "Preparando…" : "Exportar CSV"}
    </button>
  );
}
