/**
 * Historia a partir de 2–3 respuestas cortas de la pareja (parte pura, sin
 * red): validación de la entrada, capítulos sin IA (respaldo) y la guarda que
 * comprueba que el texto pulido no añade datos. La llamada al modelo está en
 * `story-polish.ts`; el creador llama a la server action `polishStoryAnswers`
 * (lib/ai/actions.ts).
 */
import { storyChapterSchema, SITE_MAX_STORY_CHAPTERS, type StoryChapter } from "@/lib/site-document";
import { newFacts } from "./fact-guard";

export const STORY_ANSWERS_MIN = 2;
export const STORY_ANSWERS_MAX = 3;
/** Por respuesta. Un capítulo admite 600; dejamos margen para pulir. */
export const STORY_ANSWER_MAX = 500;
const QUESTION_MAX = 160;
const TITLE_MAX = 80;
const BODY_MAX = 600;

/** Una respuesta del paso «vuestra historia»: la pregunta que se enseñó y lo que escribió la pareja. */
export interface StoryAnswer {
  /** Pregunta del creador, p. ej. «¿Cómo os conocisteis?». Opcional; ayuda a titular. */
  question?: string;
  answer: string;
}

export const STORY_ERRORS = {
  few: `Contadnos al menos ${STORY_ANSWERS_MIN} cosas de vuestra historia.`,
  many: `Como máximo ${STORY_ANSWERS_MAX} respuestas.`,
  long: `Cada respuesta puede tener hasta ${STORY_ANSWER_MAX} caracteres.`,
} as const;

const clean = (value: string) => value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Recorta en el último espacio antes de `max` (los límites del contrato son de caracteres). */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Valida lo que llega del cliente. Respuestas vacías se ignoran; hacen falta
 * entre 2 y 3 con texto.
 */
export function parseStoryAnswers(input: unknown): { ok: true; answers: StoryAnswer[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: STORY_ERRORS.few };
  const answers: StoryAnswer[] = [];
  for (const raw of input) {
    const entry = typeof raw === "string" ? { answer: raw } : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (!entry || typeof entry.answer !== "string") continue;
    const answer = clean(entry.answer);
    if (!answer) continue;
    if (answer.length > STORY_ANSWER_MAX) return { ok: false, error: STORY_ERRORS.long };
    const question = typeof entry.question === "string" ? clean(entry.question).slice(0, QUESTION_MAX) : "";
    answers.push(question ? { question, answer } : { answer });
  }
  if (answers.length < STORY_ANSWERS_MIN) return { ok: false, error: STORY_ERRORS.few };
  if (answers.length > STORY_ANSWERS_MAX) return { ok: false, error: STORY_ERRORS.many };
  return { ok: true, answers };
}

/** Capítulos sin IA: el texto de la pareja tal cual (sin título). Siempre válidos. */
export function storyChaptersFromAnswers(answers: readonly StoryAnswer[]): StoryChapter[] {
  return answers.slice(0, SITE_MAX_STORY_CHAPTERS).map((a, i) => storyChapterSchema.parse({ id: `c-${i + 1}`, title: "", body: clip(a.answer, BODY_MAX), images: [] }));
}

/**
 * Funde la propuesta del modelo (un capítulo por respuesta, en orden) con la
 * guarda de datos: el título o el texto que traiga algo que no está en las
 * respuestas (número, mes, día, enlace, nombre propio) se sustituye por el
 * respaldo (sin título / el texto de la pareja). `context` admite datos ya
 * conocidos, como los nombres de la pareja.
 */
export function vetPolishedChapters(
  proposed: ReadonlyArray<{ title: string; body: string }>,
  answers: readonly StoryAnswer[],
  context: readonly string[] = [],
): { chapters: StoryChapter[]; replaced: number } {
  const allowed = [...answers.flatMap((a) => [a.answer, a.question ?? ""]), ...context].join("\n");
  const fallback = storyChaptersFromAnswers(answers);
  let replaced = 0;
  const chapters = fallback.map((base, i) => {
    const p = proposed[i];
    if (!p) {
      replaced++;
      return base;
    }
    const titleRaw = clip(clean(p.title).replace(/\s+/g, " "), TITLE_MAX);
    const bodyRaw = clip(clean(p.body), BODY_MAX);
    const title = titleRaw && newFacts(titleRaw, allowed).length === 0 ? titleRaw : "";
    const bodyOk = bodyRaw.length > 0 && newFacts(bodyRaw, allowed).length === 0;
    if ((titleRaw && !title) || !bodyOk) replaced++;
    return storyChapterSchema.parse({ id: base.id, title, body: bodyOk ? bodyRaw : base.body, images: [] });
  });
  return { chapters, replaced };
}
