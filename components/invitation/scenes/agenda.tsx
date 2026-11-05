import type { SceneOf } from "@/lib/site-document";
import type { InvitationMode } from "../types";
import { editPath, editScene } from "../edit-targets";

export interface AgendaSceneProps {
  scene: SceneOf<"agenda">;
  mode: InvitationMode;
  /** Solo en el editor: marcas de «Seleccionar». */
  edit?: boolean;
}

/** Solo enlaces https absolutos; cualquier otra cosa se muestra como texto. */
export function isDirectionsUrl(address: string): boolean {
  return /^https:\/\/\S+$/.test(address);
}

const directionsClass =
  "mt-1.5 inline-flex min-h-11 items-center text-sm font-medium text-tinta underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-cava/50";

/**
 * Agenda como página de revista: antetítulo en versalitas, título a escala
 * de portada y, debajo, cada momento con la hora en Playfair cursiva del
 * acento (cifras tabulares) alineada a la línea base del título del momento.
 * Filete marcado bajo la cabecera y filetes finos entre momentos; sin línea
 * vertical ni puntos.
 */
export function AgendaScene({ scene, mode, edit }: AgendaSceneProps) {
  const { title, items } = scene.props;
  if (items.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-agenda mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <p aria-hidden="true" className="sp-eyebrow font-mono text-[11px] font-medium text-cava-texto uppercase">
        Programa
      </p>
      <h2 id={titleId} className="sp-h2 font-display mt-4 text-tinta" {...editPath(edit, `${scene.id}/title`)}>
        {title}
      </h2>
      <ol className="sp-timeline sp-rule-strong mt-7 border-t">
        {items.map((item) => (
          <li
            key={item.id}
            className="sp-rule grid items-baseline border-t py-5 first:border-t-0"
          >
            {item.timeLabel ? (
              <p className="sp-time font-script tabular text-cava-texto">{item.timeLabel}</p>
            ) : (
              <span aria-hidden="true" />
            )}
            <div>
              <p className="sp-item-title font-display text-tinta" {...editPath(edit, `${scene.id}/items/${item.id}/title`)}>{item.title}</p>
              {item.place && <p className="mt-1.5 text-sm text-tinta/75">{item.place}</p>}
              {item.address &&
                (isDirectionsUrl(item.address) ? (
                  mode === "public" ? (
                    <a href={item.address} target="_blank" rel="noopener noreferrer" className={directionsClass}>
                      Cómo llegar
                    </a>
                  ) : (
                    // En el preview los enlaces no navegan.
                    <span aria-disabled="true" className={directionsClass}>
                      Cómo llegar
                    </span>
                  )
                ) : (
                  <p className="mt-1 text-sm text-tinta/60">{item.address}</p>
                ))}
              {item.notes && <p className="mt-1.5 text-xs leading-relaxed text-tinta/60">{item.notes}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
