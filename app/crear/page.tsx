import type { Metadata, Viewport } from "next";
import { CreateWizard } from "@/components/panel/create-wizard";

/** «Pedid cambios» llama a la IA desde esta página (5–25 s): las server
 *  actions heredan la duración de la página (datos-ia.md §3). */
export const maxDuration = 60;

/** Teclado virtual: en Android encoge el viewport (el compositor queda encima);
 *  iOS no lo soporta y lo resuelve `useKeyboardAwareShell` con visualViewport.
 *  Se repiten los valores del layout porque el viewport de la página lo sustituye. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };


export const metadata: Metadata = { title: "Dad forma a vuestra invitación", description: "Empezad con vuestra idea. Añadid los detalles de la boda y ved vuestra invitación tomar forma, paso a paso." };

/** Estática: `?idea=` y `?plantilla=` se leen en el cliente (CreateWizard). */
export default function CreatePage() {
  return <CreateWizard />;
}
