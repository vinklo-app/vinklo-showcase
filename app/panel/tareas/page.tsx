import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getTasks, getWeddingDate } from "@/lib/data/planning";
import { todayIn } from "@/lib/planning/dates";
import { PageHead } from "@/components/panel/page-head";
import { TasksBoardLive } from "@/components/panel/tasks-wired";

export const metadata: Metadata = {
  title: "Tareas",
  robots: { index: false, follow: false },
};

/**
 * Lista de tareas (módulo de «Planificar», 2026-10-06). Lee `wedding_tasks`
 * (20261014200000) con la sesión; sin la migración aplicada, lo avisa y no
 * pinta nada más. «Hoy» se calcula aquí en Madrid y baja al cliente.
 */
export default async function PanelTareasPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/login");
  const today = todayIn();
  const [read, weddingDate] = await Promise.all([
    getTasks(context.supabase, context.wedding.id),
    getWeddingDate(context.supabase, context.wedding.id),
  ]);

  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight">
      <PageHead eyebrow="Tareas" back={{ href: "/panel/planificar", label: "Planificar" }} title={<>Lo que queda <em>por hacer</em></>}
        lead="Vuestra lista hasta la boda: lo que vence esta semana arriba, lo vencido destacado y lo hecho, a un toque de deshacer." />
      {read.status === "ok" ? (
        <TasksBoardLive initial={read.data} today={today} weddingDate={weddingDate} />
      ) : (
        <p role="alert" className="pn-note pn-note--warn">
          {read.status === "missing"
            ? "La lista de tareas todavía no está disponible en vuestra cuenta. Volved en un rato; el resto del panel sigue igual."
            : "No hemos podido cargar las tareas. Actualizad la página para volver a intentarlo."}{" "}
          <Link href="/panel" className="underline underline-offset-4">Volver al resumen</Link>
        </p>
      )}
    </main>
  );
}
