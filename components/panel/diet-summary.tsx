import Link from "next/link";

import { DIET_CHIPS, summarizeDiet } from "@/lib/rsvp-diet";
import type { AttendingGuest } from "@/lib/data/catering";

/**
 * Alergias y dietas de quien viene en /panel/dia: los mismos totales que la
 * hoja del catering (summarizeDiet). Solo cuentas: el detalle de cada nota de
 * salud se lee en la hoja, no aquí.
 */
export function DietSummary({ guests }: { guests: ReadonlyArray<Pick<AttendingGuest, "notes" | "answers">> }) {
  const { counts, withDetails } = summarizeDiet(guests);
  const marked = DIET_CHIPS.filter((chip) => counts[chip.id] > 0);

  return (
    <section className="pn-modsum" aria-labelledby="pn-diet-title">
      <div className="pn-modsum-head">
        <div>
          <h2 id="pn-diet-title" className="pn-h3">Alergias y dietas</h2>
          <p className="pn-help">
            {marked.length > 0
              ? "Personas que vienen con cada casilla marcada en el formulario."
              : withDetails > 0
                ? "Todavía no hay totales que contar, pero sí notas que leer."
                : "Nadie que venga ha marcado alergias ni dietas todavía."}
          </p>
        </div>
        <Link href="/panel/dia/imprimir" className="pn-link">Ver la hoja del catering</Link>
      </div>
      {(marked.length > 0 || withDetails > 0) && (
        <div className="pn-modsum-grid">
          <article className="pn-modsum-card" data-diet-card="">
            <h3>Para el catering</h3>
            {marked.length > 0 && <ul>{marked.map((chip) => <li key={chip.id}><span>{chip.label}</span><b className="pn-tnum">{counts[chip.id]}</b></li>)}</ul>}
            {withDetails > 0 && (
              <p className="pn-help pn-tnum mt-2">
                {withDetails === 1 ? "1 nota con más detalles: leedla en la hoja del catering." : `${withDetails} notas con más detalles: leedlas en la hoja del catering.`}
              </p>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
