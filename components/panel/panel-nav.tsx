"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClockIcon, HomeIcon, LayoutGridIcon, PenLineIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { LazoIcon } from "@/components/brand/icons";
import { PANEL_MODULES, readyModules } from "@/lib/panel/modules";

/**
 * Tercera pestaña. Mientras «Planificar» tenga un único módulo listo (hoy,
 * «El día»), la pestaña ES ese módulo: una página índice con un solo
 * elemento gastaba el mejor sitio de la navegación (auditoría 2026-10-05).
 * Con dos o más módulos vuelve «Planificar» sin tocar nada aquí.
 */
const ready = readyModules();
const planning: readonly [string, string, LucideIcon] = ready.length === 1
  ? [ready[0].href, ready[0].label, ready[0].id === "dia" ? CalendarClockIcon : LayoutGridIcon]
  : ["/panel/planificar", "Planificar", LayoutGridIcon];

const pages: ReadonlyArray<readonly [string, string, LucideIcon]> = [
  ["/panel", "Resumen", HomeIcon],
  ["/panel/invitados", "Invitados", UsersIcon],
  planning,
  ["/panel/ajustes", "Vuestra web", PenLineIcon],
];

/** Las páginas de los módulos (tareas, presupuesto, mesas…, el día) cuelgan de la tercera pestaña. */
const PLANNING_PATHS = ["/panel/planificar", ...PANEL_MODULES.map((module) => module.href)];

/**
 * Navegación del panel. Escritorio (≥640): cabecera flotante y translúcida
 * (la `.site-header` de la landing: desenfoque, filete al desplazar, opaca
 * con transparencia reducida o contraste alto) con wordmark y pestañas en
 * cápsula. Móvil: barra inferior fija de cuatro destinos (zona del pulgar),
 * también translúcida. Solo una de las dos está visible (display:none en la
 * otra). `current` permite forzar el destino activo (ruta de borrador).
 */
export function PanelNav({ current }: { current?: string }) {
  const pathname = usePathname();
  const path = current ?? pathname;
  // Subpáginas (Invitados › Mensajes / Recordatorios) mantienen su pestaña.
  const isActive = (href: string) =>
    path === href ||
    (href !== "/panel" && path.startsWith(`${href}/`)) ||
    (href === planning[0] && PLANNING_PATHS.some((module) => path === module || path.startsWith(`${module}/`)));
  return (
    <>
      <nav aria-label="Panel de vuestra boda" className="site-header pn-nav-top">
        <div className="pn-wrap pn-nav-top-inner">
          <Link href="/panel" className="pn-wordmark pn-press" aria-label="vinklo, vuestro panel">
            <LazoIcon className="h-5 w-5" aria-hidden="true" />
            <span aria-hidden="true">v<span style={{ color: "var(--clay)" }}>ı</span>nklo</span>
          </Link>
          <div className="pn-nav-tabs">
            {pages.map(([href, label]) => (
              <Link key={href} href={href} className="pn-press" aria-current={isActive(href) ? "page" : undefined}>{label}</Link>
            ))}
          </div>
        </div>
      </nav>
      <nav aria-label="Panel de vuestra boda" className="pn-nav-bottom">
        {pages.map(([href, label, Icon]) => (
          <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className="pn-press">
            <Icon aria-hidden="true" strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
