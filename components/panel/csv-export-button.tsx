"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { ContributionRow } from "@/components/panel/types";
import { netCents } from "@/components/panel/types";
import { csvCell } from "@/lib/messages/guest-csv";
import { centsToDecimalComma } from "@/lib/format/money";

const METHOD_LABELS: Record<ContributionRow["method"], string> = {
  card: "Tarjeta",
  bizum_manual: "Bizum",
};

const STATUS_LABELS: Record<ContributionRow["status"], string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  failed: "Fallida",
};

function centsToCsv(cents: number): string {
  return centsToDecimalComma(cents);
}

function buildCsv(rows: ContributionRow[]): string {
  const header = [
    "Fecha",
    "Invitado",
    "Email",
    "Personas",
    "Regalo (EUR)",
    "Aportación (EUR)",
    "Método",
    "Estado",
  ].join(";");

  const lines = rows.map((row) =>
    [
      new Date(row.created_at).toLocaleDateString("es-ES"),
      csvCell(row.guest_name),
      csvCell(row.guest_email ?? ""),
      String(row.n_cubiertos),
      centsToCsv(row.gift_cents),
      centsToCsv(netCents(row)),
      METHOD_LABELS[row.method],
      STATUS_LABELS[row.status],
    ].join(";")
  );

  return [header, ...lines].join("\n");
}

/**
 * Exportación CSV de las contribuciones. En el plan gratuito el botón se
 * muestra desactivado con distintivo Premium (los gates completos son M3).
 */
export function CsvExportButton({
  rows,
  plan,
}: {
  rows: ContributionRow[];
  plan: "free" | "premium";
}) {
  const download = () => {
    // BOM para que Excel abra el UTF-8 con acentos correctos.
    const blob = new Blob(["\uFEFF" + buildCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "contribuciones-vinklo.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (plan === "free") {
    return (
      <span className="inline-flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          className="border-[var(--tinta)]/15 bg-transparent text-[var(--tinta)]"
        >
          Exportar CSV
        </Button>
        <span className="inline-flex h-5 items-center rounded-full bg-[var(--cava)]/15 px-2 text-xs font-medium text-[color-mix(in_srgb,var(--cava)_55%,var(--tinta))]">
          Premium
        </span>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      className="border-[var(--tinta)]/15 bg-transparent text-[var(--tinta)] hover:bg-[var(--tinta)]/5"
    >
      Exportar CSV
    </Button>
  );
}
