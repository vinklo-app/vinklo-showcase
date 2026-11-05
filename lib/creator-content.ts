/**
 * Contenido de partida que el creador (/crear) deja en la web de la pareja
 * para que se parezca a /demo desde el primer día (8-oct-2026): historia,
 * fotos, programa, detalles y preguntas.
 *
 * Regla de oro: nada inventado. Solo dos clases de texto:
 *  - plantillas (una pregunta o un título de tarjeta sin respuesta): la
 *    pareja las completa en el panel y, mientras tanto, el invitado no las ve
 *    (`guestVisibleScene` / `sceneHasContent`, lib/site-document.ts);
 *  - respuestas que son verdad por cómo está configurada la web (el
 *    formulario pregunta las alergias; si activaron el menú, se elige al
 *    confirmar…). Ni horas, ni lugares, ni códigos, ni plazos.
 *
 * Voz: lo escribe la pareja a su invitado → primera persona del plural
 * («nos», «dinos») y tú al invitado (docs/COPY-Y-VOZ-VINKLO.md).
 *
 * Puro (sin servidor): lo usan el preview del creador y la creación.
 */
import type { DetailCard, FaqItem } from "./site-document";

/** Lo que el contenido de partida necesita saber del borrador. */
export interface StarterSource {
  modules?: ReadonlyArray<string>;
  /** ¿Hay paradas de autobús con nombre? (la escena de autobuses se ve). */
  hasBusStops?: boolean;
  /** ¿Hay hoteles con nombre? (la escena de alojamiento se ve). */
  hasHotels?: boolean;
}

/** Preguntas frecuentes: las de siempre como plantilla y las que la configuración ya responde. */
export function starterFaq(source: StarterSource): FaqItem[] {
  const on = new Set(source.modules ?? []);
  const items: FaqItem[] = [
    { id: "q-confirmar", question: "¿Hasta cuándo puedo confirmar?", answer: "" },
    {
      id: "q-ninos",
      question: "¿Puedo ir con niños?",
      // Activar «Niños» es pedir cuántos vienen: los niños están invitados.
      answer: on.has("kids") ? "Sí. Al confirmar tu asistencia, dinos cuántos niños vienen contigo." : "",
    },
    { id: "q-aparcamiento", question: "¿Hay aparcamiento?", answer: "" },
    { id: "q-vestimenta", question: "¿Hay código de vestimenta?", answer: "" },
    // El formulario de asistencia siempre pregunta por alergias e intolerancias.
    { id: "q-alergias", question: "¿Puedo avisar de alergias o intolerancias?", answer: "Sí. Al confirmar tu asistencia puedes contárnoslas en el formulario." },
  ];
  if (on.has("bus") && source.hasBusStops) {
    items.push({ id: "q-autobus", question: "¿Hay autobús?", answer: "Sí. Tienes las paradas y los horarios en «Autobuses»; al confirmar, dinos si lo vas a usar." });
  }
  if (on.has("hotels") && source.hasHotels) {
    items.push({ id: "q-alojamiento", question: "¿Dónde puedo alojarme?", answer: "En «Dónde alojarse» tienes los hoteles que te recomendamos." });
  }
  if (on.has("song")) {
    items.push({ id: "q-cancion", question: "¿Puedo pedir una canción?", answer: "Claro. Al confirmar tu asistencia, dinos cuál no puede faltar." });
  }
  return items;
}

/** Tarjetas de detalles: títulos de siempre; solo llevan texto lo que la configuración ya dice. */
export function starterDetails(source: StarterSource): DetailCard[] {
  const on = new Set(source.modules ?? []);
  const card = (id: string, title: string, body = ""): DetailCard => ({ id, title, teaser: "", body, linkLabel: "" });
  const cards: DetailCard[] = [card("d-vestimenta", "Dress code"), card("d-llegar", "Cómo llegar")];
  cards.push(on.has("menu") ? card("d-menu", "Menú", "Al confirmar tu asistencia podrás elegir el menú de cada persona.") : card("d-menu", "Menú"));
  return cards;
}
