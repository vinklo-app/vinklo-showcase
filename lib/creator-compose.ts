/**
 * Creador (/crear y /onboarding): reglas puras de qué
 * falta, qué se ha entendido, a dónde va cada mensaje del compositor y qué
 * editor abre cada hueco tocado en la invitación. Sin React ni DOM: lo usan
 * el creador y los tests.
 */
import { storyChaptersFromAnswers } from "./creator-story";
import { parseEditPath } from "./site-chat/edit-focus";
import { isValidWeddingDate } from "./wedding-settings";
import { BUILDER_IDEA_MAX, BUILDER_LAST_STEP, BUILDER_STEPS, DEFAULT_WELCOME_MESSAGES, EMPTY_DRAFT, STEP, builderAgendaItems, prefillBuilderIdea, suggestWeddingStyle, type BuilderDraft, type BuilderStepId } from "./wedding-builder";
import { IDEA_MIN_LENGTH } from "./ai/idea-merge";
import { LEGACY_SCENE_IDS, SITE_PALETTES } from "./site-document";

/** Editores que abre el creador (uno por hoja). */
export type CreatorField = "names" | "date" | "venue" | "guests" | "day" | "story" | "welcome" | "photo" | "design";
/**
 * Apartado del diseño que abre cada botón del dock. «Forma» (Story o web) y
 * «Sobre» salieron del creador el 13-oct-2026: toda invitación nueva abre
 * con el sobre y la Story pasa a ser premium (backlog, puntos 4 y 5).
 */
export type DesignSection = "colores" | "letra";
/** Lo imprescindible para crear la web. */
export type Essential = "names" | "date";

/** Ruta del hueco de la fecha en la portada (solo la pinta la vista previa del creador). */
export const DATE_GAP_FIELD = "weddingDate";

export function hasNames(draft: Pick<BuilderDraft, "partnerName1" | "partnerName2">): boolean {
  return draft.partnerName1.trim().length >= 2 && draft.partnerName2.trim().length >= 2;
}
export function hasDate(draft: Pick<BuilderDraft, "weddingDate">): boolean {
  return isValidWeddingDate(draft.weddingDate);
}

/** Lo que aún falta para poder crear la web, en el orden en que se pide. */
export function missingEssentials(draft: BuilderDraft): Essential[] {
  const missing: Essential[] = [];
  if (!hasNames(draft)) missing.push("names");
  if (!hasDate(draft)) missing.push("date");
  return missing;
}

/**
 * A dónde va lo que escriben en «Contadnos vuestra boda»: mientras falten los
 * nombres o la fecha, es la idea (la IA la lee y rellena lo que encuentre);
 * con los dos, es una petición de cambios («Pedid cambios»).
 */
export function composerRoute(draft: BuilderDraft): "idea" | "chat" {
  return missingEssentials(draft).length === 0 ? "chat" : "idea";
}

/**
 * La idea solo se guarda si aún no había una: un segundo mensaje se lee con
 * IA (rellena huecos) pero no sustituye lo que contaron primero.
 */
export function withIdeaText(draft: BuilderDraft, text: string, max: number): BuilderDraft {
  const clean = text.trim().slice(0, max);
  if (!clean || draft.idea.trim()) return draft;
  return { ...draft, idea: clean };
}

/** `?idea=` de la landing → frase del creador: sin espacios sobrantes y al límite del borrador; vacía → undefined. */
export function landingIdeaParam(value: string | null | undefined): string | undefined {
  const text = (value ?? "").trim().slice(0, BUILDER_IDEA_MAX).trim();
  return text || undefined;
}

/** Lo que el creador hace con la frase que llega de la landing (`/crear?idea=`). */
export interface LandingIdeaPlan {
  /** Borrador con el que abre el creador. */
  draft: BuilderDraft;
  /** Frase que hay que leer con IA al abrir (null: nada que leer). */
  read: string | null;
  /** Frase nueva que choca con otra idea ya guardada: se pregunta, nunca se pisa en silencio. */
  conflict: string | null;
  /** Frase demasiado corta para leerla: queda en el compositor para completarla. */
  short: string | null;
}

/**
 * Llegada desde la landing con `?idea=` (la promesa «contadnos vuestra boda
 * en una frase y os la preparamos»). Puro, sin red:
 *  - sin frase → el borrador guardado, sin lectura;
 *  - borrador sin idea → se guarda la frase (prefillBuilderIdea) y se lee;
 *  - borrador con la MISMA idea → nada (es una recarga: ya se leyó y no se
 *    gasta otra lectura);
 *  - borrador con OTRA idea → se conserva la guardada y se pregunta;
 *  - frase de menos de IDEA_MIN_LENGTH → se guarda pero no se lee: se deja a
 *    la vista para que la completen.
 */
export function planLandingIdea(saved: BuilderDraft | null, idea: string | null | undefined): LandingIdeaPlan {
  const text = (idea ?? "").trim().slice(0, BUILDER_IDEA_MAX);
  const base = saved ?? EMPTY_DRAFT;
  if (!text) return { draft: base, read: null, conflict: null, short: null };
  const current = saved?.idea.trim() ?? "";
  if (current === text) return { draft: base, read: null, conflict: null, short: null };
  if (current) return { draft: base, read: null, conflict: text, short: null };
  const draft = prefillBuilderIdea(saved, text);
  return text.length >= IDEA_MIN_LENGTH
    ? { draft, read: text, conflict: null, short: null }
    : { draft, read: null, conflict: null, short: text };
}

/**
 * «Usar la nueva»: la frase de la landing sustituye a la idea guardada. Lo
 * demás escrito se conserva (la lectura solo rellena huecos); el estilo solo
 * se re-sugiere sin plantilla y si seguía siendo el sugerido por la idea vieja.
 */
export function replaceIdea(draft: BuilderDraft, text: string): BuilderDraft {
  const clean = text.trim().slice(0, BUILDER_IDEA_MAX);
  if (!clean) return draft;
  const restyle = !draft.template && draft.style === suggestWeddingStyle(draft.idea);
  return { ...draft, idea: clean, style: restyle ? suggestWeddingStyle(clean) : draft.style };
}

/**
 * `step` sigue en el borrador por compatibilidad (borradores guardados y la
 * copia del servidor, `hasBuilderProgress`). El creador ya no tiene pasos:
 * se escribe un valor coherente con lo que hay. Vacío = 0; con nombres y
 * fecha = el último; si no, el del primer imprescindible que falta.
 */
export function draftStep(draft: BuilderDraft): number {
  const written = Boolean(draft.idea.trim() || draft.partnerName1.trim() || draft.partnerName2.trim() || draft.weddingDate || draft.venue.trim());
  if (!written) return 0;
  const missing = missingEssentials(draft);
  if (missing.length === 0) return BUILDER_LAST_STEP;
  return missing[0] === "names" ? STEP.nombres : STEP.fecha;
}

/** Rutas de la vista previa que se marcan como hueco (nombres, fecha). */
export function gapPaths(draft: BuilderDraft, coverId: string = LEGACY_SCENE_IDS.cover): string[] {
  return missingEssentials(draft).map((field) => (field === "names" ? `${coverId}/names` : `${coverId}/${DATE_GAP_FIELD}`));
}

/**
 * Editor que abre un toque en la invitación. Solo textos que el creador sabe
 * editar en su sitio: nombres, fecha y bienvenida de la portada; nombre y
 * dirección del lugar. Lo demás → null (no se intercepta el toque).
 */
export function fieldForEditPath(path: string, ids: { cover: string; venue: string } = { cover: LEGACY_SCENE_IDS.cover, venue: LEGACY_SCENE_IDS.venue }): CreatorField | null {
  const parsed = parseEditPath(path);
  if (!parsed || parsed.list || !parsed.field) return null;
  if (parsed.sceneId === ids.cover) {
    if (parsed.field === "names") return "names";
    if (parsed.field === DATE_GAP_FIELD) return "date";
    if (parsed.field === "welcomeMessage") return "welcome";
    return null;
  }
  if (parsed.sceneId === ids.venue && (parsed.field === "venue" || parsed.field === "address")) return "venue";
  return null;
}

/** Fecha larga en español («19 de junio de 2027»), sin zona horaria. */
export function longDate(value: string): string {
  if (!isValidWeddingDate(value)) return "";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

const THEME_LABEL: Record<BuilderDraft["style"], string> = { editorial: "Editorial", clasico: "Caligráfica", natural: "Serena" };

export interface UnderstoodChip { field: CreatorField; label: string; value: string }

/**
 * Lo entendido (tras leer la idea, y siempre a partir del borrador): solo lo
 * que tiene valor. La bienvenida de partida no cuenta como «entendida».
 */
export function understoodChips(draft: BuilderDraft): UnderstoodChip[] {
  const chips: UnderstoodChip[] = [];
  if (hasNames(draft)) chips.push({ field: "names", label: "Vosotros", value: `${draft.partnerName1.trim()} y ${draft.partnerName2.trim()}` });
  if (hasDate(draft)) chips.push({ field: "date", label: "La fecha", value: longDate(draft.weddingDate) });
  if (draft.venue.trim()) chips.push({ field: "venue", label: "El lugar", value: draft.venue.trim() });
  const palette = SITE_PALETTES.find((item) => item.id === (draft.palette ?? draft.style))?.label;
  if (draft.palette || draft.template || draft.idea.trim()) chips.push({ field: "design", label: "Estilo", value: [...new Set([THEME_LABEL[draft.style], palette].filter(Boolean))].join(" · ") });
  const welcome = draft.welcomeMessage.trim();
  if (welcome && !DEFAULT_WELCOME_MESSAGES.includes(welcome)) chips.push({ field: "welcome", label: "Bienvenida", value: welcome });
  return chips;
}

export interface CreatorExtra { field: CreatorField; label: string; done: boolean }

/** «Añadir más»: lo opcional, con su marca de hecho. */
export function creatorExtras(draft: BuilderDraft, hasPhoto: boolean): CreatorExtra[] {
  const story = draft.story;
  return [
    { field: "photo", label: "Vuestra foto", done: hasPhoto || draft.photo === "initials" },
    { field: "venue", label: "El lugar", done: Boolean(draft.venue.trim()) },
    { field: "day", label: "El programa del día", done: builderAgendaItems(draft).length > 0 },
    { field: "story", label: "Vuestra historia", done: storyChaptersFromAnswers(story).length > 0 },
    { field: "welcome", label: "La bienvenida", done: Boolean(draft.welcomeMessage.trim()) && !DEFAULT_WELCOME_MESSAGES.includes(draft.welcomeMessage.trim()) },
    { field: "guests", label: "Invitados y extras", done: Boolean(draft.guestCount.trim()) || (draft.modules?.length ?? 0) > 0 },
  ];
}

/** Invitados: vacío vale (opcional); si lo escriben, entre 1 y 2.000. */
export function guestCountValid(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 2000;
}

/**
 * Estimación que se manda al crear. Vacía → 100: la pareja la ajusta en su
 * panel (no crea invitados; solo orienta el plan).
 */
export function guestEstimate(value: string): number {
  const text = value.trim();
  return text && guestCountValid(text) ? Number(text) : 100;
}

export interface EssentialIssue { field: CreatorField; inputId: string; message: string }

/**
 * Lo que impide crear la web, con el mismo texto de error de siempre y el
 * campo donde se corrige. null = se puede crear.
 */
export function essentialIssue(draft: BuilderDraft): EssentialIssue | null {
  if (draft.partnerName1.trim().length < 2 || draft.partnerName2.trim().length < 2) {
    return { field: "names", inputId: draft.partnerName1.trim().length < 2 ? "wb-name-1" : "wb-name-2", message: "Escribid los dos nombres, con al menos dos letras cada uno." };
  }
  if (!hasDate(draft)) return { field: "date", inputId: "wb-date", message: "Elegid una fecha válida para vuestra boda." };
  if (!guestCountValid(draft.guestCount)) return { field: "guests", inputId: "wb-guests", message: "Indicad entre 1 y 2.000 personas. Podréis ajustarlo después." };
  return null;
}

/** Editor del creador que abre cada paso histórico del asistente. */
const FIELD_OF_STEP: Partial<Record<BuilderStepId, Exclude<CreatorField, "design">>> = {
  nombres: "names", foto: "photo", fecha: "date", lugar: "venue", gente: "guests", dia: "day", historia: "story", bienvenida: "welcome",
};
/** Orden de «Siguiente» en los editores: el de los pasos del asistente (`BUILDER_STEPS`). */
export const CREATOR_FIELD_ORDER: readonly Exclude<CreatorField, "design">[] = BUILDER_STEPS.flatMap((id) => {
  const field = FIELD_OF_STEP[id];
  return field ? [field] : [];
});
/** Orden de «Siguiente» en el diseño (dock). */
export const DESIGN_SECTION_ORDER: readonly DesignSection[] = ["colores", "letra"];

export interface CreatorStep { field: CreatorField; section?: DesignSection }

/**
 * Paso al que lleva «Siguiente» desde el editor abierto. null = es el último:
 * su botón dice «Hecho» y cierra.
 */
export function nextCreatorStep(current: CreatorStep): CreatorStep | null {
  if (current.field === "design") {
    const index = DESIGN_SECTION_ORDER.indexOf(current.section ?? "colores");
    const section = DESIGN_SECTION_ORDER[index + 1];
    return section ? { field: "design", section } : null;
  }
  const index = CREATOR_FIELD_ORDER.indexOf(current.field);
  const field = index >= 0 ? CREATOR_FIELD_ORDER[index + 1] : undefined;
  return field ? { field } : null;
}
