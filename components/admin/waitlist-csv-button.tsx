"use client";

import { Button } from "@/components/ui/button";
import {
  WAITLIST_KIND_LABELS,
  type WaitlistRow,
} from "@/components/admin/types";
import { csvCell } from "@/lib/messages/guest-csv";

function buildCsv(rows: WaitlistRow[]): string {
  const header = ["Email", "Nombre", "Tipo", "Fecha de boda", "Origen", "Alta"].join(
    ";"
  );

  const lines = rows.map((row) =>
    [
      csvCell(row.email),
      csvCell(row.name ?? ""),
      WAITLIST_KIND_LABELS[row.kind],
      row.wedding_date ?? "",
      csvCell(row.source ?? ""),
      new Date(row.created_at).toLocaleDateString("es-ES"),
    ].join(";")
  );

  return [header, ...lines].join("\n");
}

/** Exporta la waitlist completa a CSV (separador ; para Excel es-ES). */
export function WaitlistCsvButton({ rows }: { rows: WaitlistRow[] }) {
  const download = () => {
    // BOM para que Excel abra el UTF-8 con acentos correctos.
    const blob = new Blob(["\uFEFF" + buildCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "waitlist-vinklo.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={rows.length === 0}
      className="border-[var(--tinta)]/15 bg-transparent text-[var(--tinta)] hover:bg-[var(--tinta)]/5"
    >
      Exportar CSV
    </Button>
  );
}
