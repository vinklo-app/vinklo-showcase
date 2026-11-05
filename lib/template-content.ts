/**
 * Contenido de partida de las plantillas de la landing (Tarea 11): la
 * estructura y los textos genéricos de /demo, sin nada de su pareja (nombres,
 * lugares, fechas, códigos) y sin sus fotos. Puro y pequeño: lo usan el
 * preview del creador (cliente) y la creación (servidor); no importa la demo.
 *
 * Misma regla de oro que creator-content.ts: las tarjetas y preguntas nacen
 * solo con título/pregunta; el invitado no las ve hasta que la pareja las
 * rellena (`sceneHasContent`). Solo llevan texto las respuestas que son
 * verdad por cómo está configurada la web. Los capítulos de la historia
 * nunca se escriben aquí: su texto sale de las respuestas de la pareja.
 */
import { starterDetails, starterFaq, type StarterSource } from "./creator-content";
import type { DetailCard, FaqItem } from "./site-document";
import type { StoryAnswerId } from "./creator-story";

export interface TemplateStarter {
  details: { title: string; intro: string; cards: DetailCard[] };
  faq: { title: string; items: FaqItem[] };
  story: { title: string; chapterTitles: Partial<Record<StoryAnswerId, string>> };
}

const card = (id: string, title: string, body = ""): DetailCard => ({ id, title, teaser: "", body, linkLabel: "" });

/** Contenido de partida de una plantilla, ajustado a los módulos que activó la pareja. */
export function templateStarter(source: StarterSource): TemplateStarter {
  const on = new Set(source.modules ?? []);
  // Respuestas ya verdaderas por la configuración (alergias, autobús, niños…): se conservan del starter genérico.
  // «¿Puedo ir con niños?» ya la cubre la pregunta de acompañantes de la plantilla.
  const answered = starterFaq(source).filter((item) => item.answer.trim() && item.id !== "q-ninos");
  const base: FaqItem[] = [
    { id: "q-confirmar", question: "¿Hasta cuándo puedo confirmar?", answer: "" },
    { id: "q-vestimenta", question: "¿Hay un código de vestimenta?", answer: "" },
    { id: "q-aire-libre", question: "¿La boda es al aire libre?", answer: "" },
    { id: "q-acompanantes", question: "¿Puedo llevar acompañante o niños?", answer: "" },
  ];
  const items = [...base, ...answered];
  return {
    details: {
      title: "Y ahora, algunos detalles más…",
      intro: "Las personas, los sitios y lo práctico para que el fin de semana sea fácil.",
      cards: [
        card("d-viaje", "Viaje y alojamiento"),
        card("d-vestimenta", "Dress code"),
        starterDetails(source).find((c) => c.id === "d-menu") ?? card("d-menu", "Menú"),
        card("d-musica", "Música", on.has("song") ? "Si hay una canción que no puede faltar, dínoslo al confirmar tu asistencia." : ""),
      ],
    },
    faq: { title: "Preguntas y respuestas", items },
    // Demo: «cómo nos conocimos» / «enamorarnos» / «el siguiente paso». La pedida es el siguiente paso;
    // «lo que viene» no tiene equivalente en la demo y conserva su título.
    story: { title: "Nuestra historia", chapterTitles: { met: "cómo nos conocimos", proposal: "el siguiente paso" } },
  };
}
