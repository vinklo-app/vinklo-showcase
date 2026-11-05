/**
 * «Vuestra historia» en el creador (8-oct-2026): tres preguntas cortas que se
 * convierten en capítulos de la escena «historia».
 *
 * Frontera limpia para la IA: aquí el texto entra TAL CUAL lo escribió la
 * pareja (solo se recortan espacios y el tope del contrato). Si más adelante
 * se pule con IA, se hace sobre `StoryAnswers` antes de llamar a
 * `storyChaptersFromAnswers`, o sobre los capítulos que devuelve; nunca
 * dentro, para que esta función siga siendo pura y determinista.
 */
import type { StoryChapter } from "./site-document";

/** Máximo de cada respuesta (= texto de un capítulo en el contrato). */
export const STORY_ANSWER_MAX = 600;

export const STORY_QUESTIONS = [
  { id: "met", question: "¿Cómo os conocisteis?", chapter: "cómo nos conocimos", placeholder: "En la universidad, en una boda, por una amiga…" },
  { id: "proposal", question: "¿Cómo fue la pedida?", chapter: "la pedida", placeholder: "Dónde, quién lo preguntó, qué pasó después…" },
  { id: "ahead", question: "¿Qué os hace más ilusión de este día?", chapter: "lo que viene", placeholder: "Veros a todos juntos, la fiesta, el viaje…" },
] as const;

export type StoryAnswerId = (typeof STORY_QUESTIONS)[number]["id"];
export type StoryAnswers = Record<StoryAnswerId, string>;
export const EMPTY_STORY: StoryAnswers = { met: "", proposal: "", ahead: "" };

/** Respuestas → capítulos (solo las contestadas, en orden; `titles` cambia el título, nunca el texto). Puro. */
export function storyChaptersFromAnswers(answers: Partial<StoryAnswers> | undefined, titles: Partial<Record<StoryAnswerId, string>> = {}): StoryChapter[] {
  if (!answers) return [];
  const chapters: StoryChapter[] = [];
  for (const item of STORY_QUESTIONS) {
    const body = (answers[item.id] ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, STORY_ANSWER_MAX);
    if (body) chapters.push({ id: `c-${item.id === "met" ? "conocimos" : item.id === "proposal" ? "pedida" : "ilusion"}`, title: titles[item.id] ?? item.chapter, body, images: [] });
  }
  return chapters;
}
