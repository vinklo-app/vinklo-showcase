import type { Metadata } from "next";
import { AiAssistantProvider } from "@/components/panel/ai-assistant-provider";
import { PanelNav } from "@/components/panel/panel-nav";
import { PanelToaster } from "@/components/panel/panel-toaster";
import { PANEL_MANIFEST_PATH } from "@/lib/pwa/panel-manifest";
import "@/components/panel/panel.css";

/**
 * Manifest propio: el icono que se añade desde el panel abre /panel (la web
 * pública sigue con /manifest.webmanifest). Ver lib/pwa/panel-manifest.ts.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  manifest: PANEL_MANIFEST_PATH,
  appleWebApp: { capable: true, title: "vinklo", statusBarStyle: "black-translucent" },
};

/**
 * Cascarón del panel: navegación (pestañas arriba en escritorio, barra
 * inferior fija en móvil) y reserva de espacio para esa barra (.pn-shell).
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bb-scope pn-scope pn-shell min-h-svh">
      <PanelNav />
      <AiAssistantProvider>{children}</AiAssistantProvider>
      <PanelToaster />
    </div>
  );
}
