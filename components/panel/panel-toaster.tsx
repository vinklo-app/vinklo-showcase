"use client";

import { Toaster } from "@/components/ui/sonner";

/**
 * Avisos del panel (deshacer «Marcar enviada», foto quitada, cambios
 * aplicados). Abajo al centro, por encima de la barra inferior y del botón
 * flotante en móvil (64 px de barra + 72 px de FAB + safe-area). Tema claro
 * fijo: el panel no tiene modo oscuro.
 */
export function PanelToaster() {
  return (
    <Toaster
      theme="light"
      position="bottom-center"
      offset={{ bottom: 24 }}
      mobileOffset={{ bottom: "calc(136px + env(safe-area-inset-bottom, 0px))", left: 16, right: 16 }}
      style={{ "--normal-bg": "var(--ink)", "--normal-text": "var(--paper)", "--normal-border": "var(--ink)", "--border-radius": "var(--radius-lg)" } as React.CSSProperties}
      toastOptions={{ classNames: { toast: "pn-toast", title: "pn-toast-title", actionButton: "pn-toast-action" } }}
    />
  );
}
