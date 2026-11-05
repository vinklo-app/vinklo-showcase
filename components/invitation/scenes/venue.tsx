import type { SceneOf } from "@/lib/site-document";
import type { InvitationMode } from "../types";
import { WeddingActions, type WeddingActionsData } from "./wedding-actions";
import { editPath, editScene } from "../edit-targets";

export interface VenueSceneProps {
  scene: SceneOf<"venue">;
  mode?: InvitationMode;
  /** Datos de la portada (nombres, fecha) para «Añadir al calendario». */
  actions?: Pick<WeddingActionsData, "partnerName1" | "partnerName2" | "weddingDate" | "programTimes" | "calendarHref">;
  /** Solo en el editor: marcas de «Seleccionar». */
  edit?: boolean;
}

/** Nombres de lugar más largos que esto bajan un escalón de tamaño. */
const LONG_VENUE = 60;

/** ¿Tiene algo que mostrar? El renderer no crea una escena vacía. */
export function venueHasContent(scene: SceneOf<"venue">): boolean {
  const { venue, address, time } = scene.props;
  return Boolean(venue || address || time);
}

/**
 * Lugar: escena propia en el lenguaje de la portada. Antetítulo en
 * versalitas, el nombre del lugar a escala de revista alineado a la
 * izquierda, la dirección y «Te esperamos a las HH:MM» en cursiva del
 * acento, entre filetes; debajo, las dos acciones que el invitado busca
 * aquí: guardar la fecha y abrir el mapa.
 */
export function VenueScene({ scene, mode = "public", actions, edit }: VenueSceneProps) {
  const { venue, address, time, placeId } = scene.props;
  if (!venueHasContent(scene)) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-venue mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <h2 id={titleId} className="sp-eyebrow font-mono text-[11px] font-medium text-cava-texto uppercase">
        Lugar de la celebración
      </h2>
      <div className="sp-rule mt-6 border-y py-7 text-sm leading-relaxed">
        {venue && (
          <p className="sp-h2 font-display text-tinta" data-long={Array.from(venue).length > LONG_VENUE ? "" : undefined} {...editPath(edit, `${scene.id}/venue`)}>
            {venue}
          </p>
        )}
        {address && <p className="sp-venue-address mt-4 max-w-[30rem] text-[0.9375rem] text-tinta/75" {...editPath(edit, `${scene.id}/address`)}>{address}</p>}
        {time && <p className="sp-venue-time font-script mt-5 text-cava-texto">Te esperamos a las {time}</p>}
      </div>
      {actions && <WeddingActions mode={mode} data={{ ...actions, time, venue, address, placeId }} />}
    </section>
  );
}
