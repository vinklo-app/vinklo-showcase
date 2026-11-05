import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { readyModules } from "@/lib/panel/modules";
import { PageHead } from "@/components/panel/page-head";

export const metadata: Metadata = {
  title: "Planificar",
  robots: { index: false, follow: false },
};

/**
 * Centro de planificación: todo lo que no es la lista de invitados ni la web
 * (programa del día, tareas, presupuesto, proveedores, mesas, informes).
 * Los módulos se registran en lib/panel/modules.ts.
 */
export default async function PanelPlanificarPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/login");
  const modules = readyModules();
  // Con un único módulo listo, la navegación ya enlaza directamente a él: aquí solo se redirige.
  if (modules.length === 1) redirect(modules[0].href);

  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight">
      <PageHead eyebrow="Planificar" title={<>Todo vuestro día, <em>en un sitio</em></>} lead="Lo que necesitáis para organizar la boda sin hojas de cálculo ni otras aplicaciones." />
      <ul className="pn-steps">
        {modules.map((module) => (
          <li key={module.id}>
            <Link href={module.href} className="pn-step pn-press">
              <span className="pn-step-title">{module.label}</span>
              <span className="pn-sub pn-muted text-sm">{module.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
