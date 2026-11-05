"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

/** Copia el enlace de la página de invitados al portapapeles. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback silencioso: seleccionable desde el enlace del header.
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button type="button" onClick={copy} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">
        {copied ? <CheckIcon aria-hidden="true" className="size-4" /> : <CopyIcon aria-hidden="true" className="size-4" />}
        {copied ? "Enlace copiado" : "Copiar enlace"}
      </button>
      <span role="status" className="sr-only">{copied ? "Enlace copiado" : ""}</span>
    </>
  );
}
