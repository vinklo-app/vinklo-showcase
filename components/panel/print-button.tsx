"use client";

import { PrinterIcon } from "lucide-react";

/** «Imprimir»: el diálogo del navegador (también «Guardar como PDF»). */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" className="pn-btn pn-press pn-print-hide" onClick={() => window.print()}>
      <PrinterIcon aria-hidden="true" className="size-4" />{label}
    </button>
  );
}
