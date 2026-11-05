/**
 * Módulos de «Planificar» (2026-10-05): un registro para que cada módulo del
 * CRM se añada con una línea, sin tocar la navegación. La página
 * /panel/planificar pinta los que estén `ready`; los `soon` no se muestran.
 * Cada agente/módulo solo cambia SU entrada (status y textos).
 */
export type PanelModuleId = "tareas" | "presupuesto" | "proveedores" | "mesas" | "informes" | "dia";

export interface PanelModule {
  id: PanelModuleId;
  href: string;
  label: string;
  /** Una línea: para qué sirve, en «vosotros». */
  description: string;
  status: "ready" | "soon";
}

export const PANEL_MODULES: readonly PanelModule[] = [
  { id: "tareas", href: "/panel/tareas", label: "Tareas", description: "Lo que queda por hacer, con lo de esta semana y lo vencido arriba.", status: "ready" },
  { id: "presupuesto", href: "/panel/presupuesto", label: "Presupuesto", description: "Lo previsto, lo gastado y lo que falta por pagar.", status: "soon" },
  { id: "proveedores", href: "/panel/proveedores", label: "Proveedores y presupuesto", description: "Con quién trabajáis, lo acordado y los pagos que anotáis.", status: "ready" },
  { id: "mesas", href: "/panel/mesas", label: "Mesas", description: "Quién se sienta con quién, con alergias a la vista.", status: "ready" },
  { id: "informes", href: "/panel/informes", label: "Informes", description: "Menús, alergias y listas listas para el catering.", status: "soon" },
  { id: "dia", href: "/panel/dia", label: "El día", description: "El programa de la boda, hora a hora.", status: "ready" },
];

export function readyModules(): PanelModule[] {
  return PANEL_MODULES.filter((module) => module.status === "ready");
}
