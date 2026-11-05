/**
 * Evento de calendario de una boda a partir de su documento publicado (lo
 * usan la ruta /b/[slug]/calendario.ics y el renderer). Mismo criterio que
 * los botones de la invitación: con escena de lugar visible, su hora, nombre
 * y dirección; sin ella, día completo sin lugar. Las horas del programa solo
 * alargan el evento (ver weddingEventSpan). Puro y client-safe.
 */
import { enabledScenes, findScene, type SiteDocument } from "@/lib/site-document";
import type { WeddingIcsInput } from "./format";

/** Ruta pública del .ics (misma visibilidad que la página: solo webs publicadas). */
export function calendarPath(slug: string): string {
  return `/b/${slug}/calendario.ics`;
}

/** Horas del programa en su orden (escena de agenda activa). */
export function programTimesFromDocument(document: Pick<SiteDocument, "scenes">): string[] {
  const agenda = document.scenes.find((scene) => scene.type === "agenda" && scene.enabled);
  return agenda?.type === "agenda" ? agenda.props.items.map((item) => item.timeLabel).filter(Boolean) : [];
}

export function calendarEventFromDocument(document: SiteDocument): WeddingIcsInput | null {
  const cover = findScene(document, "cover");
  if (!cover || !cover.props.weddingDate) return null;
  const { partnerName1, partnerName2, weddingDate } = cover.props;
  const venue = enabledScenes(document).find((scene) => scene.type === "venue");
  const shown = venue?.type === "venue" && Boolean(venue.props.venue || venue.props.address || venue.props.time);
  return {
    partnerName1,
    partnerName2,
    weddingDate,
    time: shown && venue?.type === "venue" ? venue.props.time : "",
    venue: shown && venue?.type === "venue" ? venue.props.venue : "",
    address: shown && venue?.type === "venue" ? venue.props.address : "",
    programTimes: programTimesFromDocument(document),
  };
}
