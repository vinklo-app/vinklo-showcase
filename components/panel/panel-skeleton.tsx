import "@/components/panel/skeleton.css";

/**
 * Esqueletos de carga del panel (plan maestro §4.4): la forma de la página
 * mientras llega del servidor, sin texto inventado. Server-safe. El
 * cascarón (navegación) ya está pintado por el layout.
 */
function Bar({ width, tall = false }: { width: string; tall?: boolean }) {
  return <span className="pn-skel" data-tall={tall ? "true" : undefined} style={{ width }} />;
}

function Head() {
  return (
    <div className="pn-head" aria-hidden="true">
      <Bar width="7rem" />
      <Bar width="min(22rem, 80%)" tall />
      <Bar width="min(30rem, 95%)" />
    </div>
  );
}

/** Resumen del panel: cabecera y tres bloques. */
export function PanelHomeSkeleton() {
  return (
    <main className="pn-wrap pn-page pn-page--tight" aria-busy="true">
      <span className="sr-only" role="status">Cargando vuestro panel…</span>
      <Head />
      <div className="pn-skel-grid" aria-hidden="true">
        <span className="pn-skel pn-skel-card" />
        <span className="pn-skel pn-skel-card" />
        <span className="pn-skel pn-skel-card" />
      </div>
    </main>
  );
}

/** Lista de invitados: cabecera, chips de filtro y filas tipo chat. */
export function GuestListSkeleton() {
  return (
    <main className="pn-wrap pn-page pn-page--tight" aria-busy="true">
      <span className="sr-only" role="status">Cargando vuestros invitados…</span>
      <Head />
      <div className="pn-skel-chips" aria-hidden="true">
        {["5rem", "6.5rem", "5.5rem", "7rem"].map((width, index) => <span key={index} className="pn-skel pn-skel-chip" style={{ width }} />)}
      </div>
      <ul className="pn-skel-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="pn-skel-row">
            <span className="pn-skel pn-skel-avatar" />
            <span className="pn-skel-lines">
              <Bar width={`${55 + ((index * 17) % 30)}%`} />
              <Bar width={`${30 + ((index * 11) % 25)}%`} />
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** Subpáginas de una sola columna (envío en serie, recordatorios): cabecera y una tarjeta. */
export function PanelPageSkeleton() {
  return (
    <main className="pn-wrap pn-narrow pn-page pn-page--tight" aria-busy="true">
      <span className="sr-only" role="status">Cargando…</span>
      <Head />
      <span className="pn-skel pn-skel-card" aria-hidden="true" />
    </main>
  );
}
