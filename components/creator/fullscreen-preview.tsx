"use client";

/**
 * «Ver a pantalla completa» (8-oct-2026): la web tal como la verá vuestra
 * gente, a pantalla completa y antes de registraros. Es el mismo renderer
 * que el móvil del creador y que /b/[slug] (mode="preview": no envía nada),
 * con el mismo documento en memoria (la foto local incluida; nunca se sube).
 * <dialog> modal: el foco queda dentro, Escape cierra y el foco vuelve al botón.
 */
import { useEffect, useRef } from "react";
import { XIcon } from "lucide-react";
import { InvitationRenderer } from "@/components/invitation/renderer";
import type { SiteDocument } from "@/lib/site-document";

export function FullscreenPreview({ document, open, onClose }: { document: SiteDocument; open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="wb-fullscreen" aria-label="Vuestra web a pantalla completa" onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <button type="button" className="wb-fullscreen-close" onClick={onClose} autoFocus>
            <XIcon aria-hidden="true" size={18} strokeWidth={1.75} />
            Volver al creador
          </button>
          <div className="wb-fullscreen-page">
            <InvitationRenderer document={document} mode="preview" plan="free" fullPage />
          </div>
        </>
      )}
    </dialog>
  );
}
