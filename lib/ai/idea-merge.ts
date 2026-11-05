import { DEFAULT_WELCOME_MESSAGES, EMPTY_DAY, type BuilderDraft, type BuilderMomentId } from "@/lib/wedding-builder";

/**
 * Parte de cliente de la lectura de la idea (lib/ai/idea-reader.ts es de
 * servidor): el tipo de la sugerencia y cómo se aplica al borrador.
 */

export const IDEA_MIN_LENGTH = 12;

/** Campos del borrador que la lectura puede proponer. */
export type IdeaSuggestion = Partial<Pick<BuilderDraft, "partnerName1" | "partnerName2" | "weddingDate" | "guestCount" | "venue" | "address" | "time" | "style" | "palette" | "welcomeMessage" | "modules" | "moduleHints">> & {
  /** «Vuestro día»: hora y sitio de cada momento que aparezcan escritos. */
  day?: Partial<Record<BuilderMomentId, { time?: string; place?: string }>>;
};

/**
 * Aplica la sugerencia sin pisar nada: solo campos vacíos (o aún con el valor
 * de partida). Devuelve el borrador nuevo; si no cambia nada, el mismo objeto.
 */
export function mergeIdeaSuggestion(draft: BuilderDraft, suggestion: IdeaSuggestion): BuilderDraft {
  const next: BuilderDraft = { ...draft };
  let changed = false;
  const fill = <K extends "partnerName1" | "partnerName2" | "weddingDate" | "guestCount" | "venue" | "address" | "time">(key: K) => {
    const value = suggestion[key];
    if (value && !draft[key].trim()) { next[key] = value; changed = true; }
  };
  if (suggestion.partnerName1 && suggestion.partnerName2 && !draft.partnerName1.trim() && !draft.partnerName2.trim()) {
    fill("partnerName1");
    fill("partnerName2");
  }
  fill("weddingDate");
  fill("guestCount");
  fill("venue");
  fill("address");
  fill("time");
  if (suggestion.palette && draft.palette === null) { next.palette = suggestion.palette; changed = true; }
  if (suggestion.welcomeMessage && DEFAULT_WELCOME_MESSAGES.includes(draft.welcomeMessage)) { next.welcomeMessage = suggestion.welcomeMessage; changed = true; }
  // Módulos: solo si la pareja aún no los ha tocado (undefined); si ya marcó o
  // desmarcó alguno, manda lo suyo.
  if (suggestion.modules?.length && draft.modules === undefined) {
    next.modules = suggestion.modules;
    if (suggestion.moduleHints && !draft.moduleHints) next.moduleHints = suggestion.moduleHints;
    changed = true;
  }
  // «Vuestro día»: solo los huecos (hora o sitio) que sigan vacíos.
  if (suggestion.day) {
    const day = { ...(draft.day ?? EMPTY_DAY) };
    let filled = false;
    for (const moment of ["ceremony", "cocktail", "banquet"] as const) {
      const found = suggestion.day[moment];
      if (!found) continue;
      const current = day[moment];
      const time = !current.time && found.time ? found.time : current.time;
      const place = !current.place.trim() && found.place ? found.place : current.place;
      if (time !== current.time || place !== current.place) { day[moment] = { time, place }; filled = true; }
    }
    if (filled) { next.day = day; changed = true; }
  }
  return changed ? next : draft;
}
