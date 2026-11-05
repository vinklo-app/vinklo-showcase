"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { plural } from "@/components/panel/guest-status";
import type { GiftCsvResult } from "@/lib/messages/gift-csv";

export const GIFT_CSV_LABEL = "Descargar regalos y agradecimientos (CSV)";

/**
 * Descarga TODOS los regalos anotados con quién, importe, notas y si están
 * agradecidos (lo que se borra a los 12 meses de la boda, 20261026100000).
 * El BOM se añade aquí, como en GuestCsvButton. `compact` = texto corto para
 * la barra de la lista de invitados (el nombre completo va en aria-label).
 */
export function GiftCsvButton({ exportCsv, compact = false }: { exportCsv: () => Promise<GiftCsvResult>; compact?: boolean }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      try {
        const result = await exportCsv();
        if (!result.ok) { toast(result.error); return; }
        if (result.rows === 0) { toast("Todavía no habéis anotado ningún regalo: no hay nada que descargar."); return; }
        const blob = new Blob(["﻿" + result.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`Descargado: ${plural(result.rows, "regalo", "regalos")}.`);
      } catch { toast("No hemos podido preparar el archivo. Probad de nuevo."); }
    });
  }

  return (
    <button type="button" onClick={download} disabled={pending} className="pn-act pn-press" aria-label={compact ? GIFT_CSV_LABEL : undefined}>
      <DownloadIcon aria-hidden="true" className="size-4" />{pending ? "Preparando…" : compact ? "Descargar regalos" : GIFT_CSV_LABEL}
    </button>
  );
}
