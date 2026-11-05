import { z } from "zod";
import {
  DEFAULT_OPENING,
  SITE_LAYOUT_IDS, SITE_MAX_BUS_STOPS, SITE_MAX_HOTELS, SITE_OPENING_IDS,
  SITE_PALETTE_IDS,
  SITE_THEME_IDS,
  documentFromBuilderDraft,
  findScene,
  mapImages,
  parseSiteDocument,
  publishIssues,
  type Scene,
  type SceneImage,
  type AgendaItem,
  type SiteDocument,
  type SiteOpeningId,
  type SitePaletteId,
  type SiteThemeId,
} from "./site-document";
import { starterDetails, starterFaq, type StarterSource } from "./creator-content";
import { templateStarter } from "./template-content";
import { findBuilderTemplate } from "./templates";
import { STORY_ANSWER_MAX, storyChaptersFromAnswers } from "./creator-story";
import { PLACE_ID_PATTERN } from "./places/places";
import { DAY_CARDS_MAX, DAY_MOMENTS_MAX, DAY_QUESTIONS_MAX, FIXED_MOMENT_IDS, builderDayCardSchema, builderDayKnownSchema, builderDayMomentSchema, builderDayQuestionSchema, handAgendaItems, handDetailCards, handFaqItems, momentRow, ownedCardRow, ownedList, ownedQuestionRow, placeMoments } from "./creator-day";
import { applySectionOverlays, builderSectionsSchema, canonical, notAppliedMessage, sectionOverlays, unappliedSections, type BuilderSections, type OverlayType } from "./creator-sections";

/**
 * Módulos que la pareja activa al crear (8-oct-2026): autobuses y
 * alojamiento (escenas con su pregunta en el formulario) y menú, niños y
 * canción (solo preguntas). La lectura de la idea los propone; la pareja los
 * marca o desmarca en el paso «gente».
 */
export const BUILDER_MODULE_IDS = ["bus", "hotels", "menu", "kids", "song"] as const;
export type BuilderModuleId = (typeof BUILDER_MODULE_IDS)[number];
export const BUILDER_MODULE_LABELS: Record<BuilderModuleId, { label: string; help: string }> = {
  bus: { label: "Autobuses", help: "Paradas y horarios; os dirán quién lo usa y desde dónde." },
  hotels: { label: "Hoteles", help: "Hoteles con código y enlace; os dirán dónde se alojan." },
  menu: { label: "Menú", help: "Cada invitado elige carne, pescado o vegetariano." },
  kids: { label: "Niños", help: "Cuántos niños vienen en cada grupo." },
  song: { label: "Canción", help: "Una canción que no puede faltar en la fiesta." },
};

/**
 * Borrador local del creador (/crear y /onboarding). Vive en localStorage
 * hasta que la pareja crea la web. La clave conserva el nombre histórico
 * (`:v1`) para que un borrador guardado antes de este cambio se recupere; la
 * forma la decide el campo `version` (v1 se migra al leer).
 *
 * Nunca guarda la foto: ni `blob:`, ni `data:`, ni base64. El archivo vive en
 * el navegador (IndexedDB, `components/creator/photo-store.ts`) y aquí solo
 * queda la decisión de la pareja (`photo`).
 */
export const BUILDER_STORAGE_KEY = "vinklo:wedding-draft:v1";
export const BUILDER_IDEA_MAX = 600;
/**
 * Pasos del creador, en orden. El borrador guarda el índice (`step`); cuando
 * se inserta un paso, sube `version` y `parseBuilderDraft` traduce el índice
 * antiguo por su nombre (así un borrador a medias reabre en la misma
 * pregunta). v4 (8-oct-2026): «Vuestro día» y «Vuestra historia» (opcional)
 * detrás de «Vuestra gente».
 */
export const BUILDER_STEPS = ["idea", "nombres", "foto", "fecha", "lugar", "gente", "dia", "historia", "bienvenida", "web"] as const;
export type BuilderStepId = (typeof BUILDER_STEPS)[number];
/** Índice de cada paso por su nombre: STEP.fecha, STEP.web… */
export const STEP = Object.fromEntries(BUILDER_STEPS.map((id, index) => [id, index])) as Record<BuilderStepId, number>;
export const BUILDER_LAST_STEP = BUILDER_STEPS.length - 1;
/** Paso de la foto (insertado en v2 detrás de los nombres). */
export const BUILDER_PHOTO_STEP = STEP.foto;
/** Los 8 pasos de los borradores v2 y v3, para traducir su `step`. */
const V3_STEPS: readonly BuilderStepId[] = ["idea", "nombres", "foto", "fecha", "lugar", "gente", "bienvenida", "web"];
const V3_LAST_STEP = V3_STEPS.length - 1;

/**
 * Lo que la edición con IA puede cambiar y el modelo antiguo (page_config) no
 * conoce. `null` en cada campo = lo que trae el documento por defecto.
 */
export const builderDesignSchema = z.strictObject({
  eyebrow: z.string().max(60).nullable(),
  showCountdown: z.boolean().nullable(),
  agendaTitle: z.string().max(80).nullable(),
  rsvpTitle: z.string().max(80).nullable(),
  scenes: z.array(z.strictObject({ id: z.string().max(40), enabled: z.boolean() })).max(12).nullable(),
});
export type BuilderDesign = z.infer<typeof builderDesignSchema>;

/** Hora "HH:MM" o vacío (input type="time"). */
const builderTime = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/);

const baseFields = {
  idea: z.string().max(BUILDER_IDEA_MAX),
  partnerName1: z.string().max(80),
  partnerName2: z.string().max(80),
  weddingDate: z.string().max(10),
  guestCount: z.string().max(4),
  style: z.enum(SITE_THEME_IDS),
  venue: z.string().max(160),
  address: z.string().max(240),
  time: z.string().max(5),
  welcomeMessage: z.string().max(400),
};

const builderDraftV1Schema = z.object({ version: z.literal(1), ...baseFields, step: z.number().int().min(0).max(6) });

const v2Fields = {
  ...baseFields,
  step: z.number().int().min(0).max(V3_LAST_STEP),
  /** Paleta elegida a mano o por la IA. null = la del estilo (`style`). */
  palette: z.enum(SITE_PALETTE_IDS).nullable(),
  /** "pending" = aún sin decidir; "photo" = eligieron foto (vive en IndexedDB); "initials" = siguen sin foto. */
  photo: z.enum(["pending", "photo", "initials"]),
  design: builderDesignSchema.nullable(),
};
const builderDraftV2Schema = z.object({ version: z.literal(2), ...v2Fields });

const v3Fields = {
  ...v2Fields,
  /** Maqueta: "historia" (Story) o "web" (scroll largo). null = la de siempre ("historia"). */
  layout: z.enum(SITE_LAYOUT_IDS).nullable(),
  /**
   * Sobre de apertura (7-oct-2026): "sobre" (relieve floral), "sobre-liso" o
   * "ninguno" (sin sobre). Al leer (`parseBuilderDraft`) siempre queda
   * explícito: ausente → "sobre" (lo de por defecto) y `null` (cómo se
   * guardaba «Sin sobre» antes del 8-oct-2026) → "ninguno".
   */
  opening: z.enum(SITE_OPENING_IDS).nullable().optional(),
  /** Módulos (8-oct-2026). Opcional: los borradores anteriores siguen valiendo. */
  modules: z.array(z.enum(BUILDER_MODULE_IDS)).max(BUILDER_MODULE_IDS.length).optional(),
  /** Lo que la pareja escribió en su idea (paradas, hoteles): solo para rellenar los módulos. */
  moduleHints: z.strictObject({
    stops: z.array(z.string().trim().min(1).max(80)).max(8),
    hotels: z.array(z.string().trim().min(1).max(80)).max(6),
  }).optional(),
  /**
   * Autobuses y hoteles con sus datos (8-oct-2026), preguntados en el paso
   * «Vuestra gente» al activar el módulo. Opcionales: sin ellos se usan los
   * nombres de `moduleHints`. Las filas sin nombre no llegan a la web.
   */
  busStops: z.array(z.strictObject({ name: z.string().max(80), time: builderTime, place: z.string().max(160) })).max(SITE_MAX_BUS_STOPS).optional(),
  busReturn: z.strictObject({ time: builderTime, place: z.string().max(120) }).optional(),
  stayHotels: z.array(z.strictObject({ name: z.string().max(80), code: z.string().max(40), link: z.string().max(2048) })).max(SITE_MAX_HOTELS).optional(),
};
const builderDraftV3Schema = z.object({ version: z.literal(3), ...v3Fields });

/**
 * Un momento del día: hora y sitio, los dos opcionales. `address`
 * (8-oct-2026): la dirección de la sugerencia elegida al escribir el sitio;
 * opcional, los borradores anteriores siguen valiendo.
 */
const builderMoment = z.strictObject({ time: builderTime, place: z.string().max(160), address: z.string().max(240).optional() });

/**
 * Forma actual (v4 = v3 + paso «Vuestro día»). Para LEER un borrador guardado
 * (navegador o `builder_draft_stash`) usad `parseBuilderDraft`, que migra v1,
 * v2 y v3.
 */
export const builderDraftSchema = z.object({
  version: z.literal(4),
  ...v3Fields,
  step: z.number().int().min(0).max(BUILDER_LAST_STEP),
  /**
   * «Vuestro día» (8-oct-2026): ceremonia, cóctel y banquete con hora y
   * sitio (pueden ser sitios distintos). Llena el programa; lo vacío no se
   * enseña. Las salidas y la vuelta del autobús viven en `busStops` /
   * `busReturn` (el paso las edita también).
   */
  day: z.strictObject({ ceremony: builderMoment, cocktail: builderMoment, banquet: builderMoment }).optional(),
  /**
   * place_id de Google del lugar de la celebración si la pareja eligió una
   * sugerencia (8-oct-2026). Escribir a mano el lugar o la dirección lo quita.
   */
  venuePlaceId: z.string().regex(PLACE_ID_PATTERN).optional(),
  /** «Vuestra historia» (opcional): respuestas tal como las escribió la pareja → capítulos (lib/creator-story.ts). */
  story: z.strictObject({ met: z.string().max(STORY_ANSWER_MAX), proposal: z.string().max(STORY_ANSWER_MAX), ahead: z.string().max(STORY_ANSWER_MAX) }).optional(),
  /**
   * Plantilla de la landing elegida (10-oct-2026, /crear?plantilla=…): fija
   * estilo, paleta, maqueta y sobre como en su /demo. Mientras está, la idea
   * (y su lectura con IA) no cambia el estilo ni los colores.
   */
  template: z.string().max(40).optional(),
  /**
   * Última edición de la pareja en este navegador (P2-4, 11-oct-2026). La
   * copia del servidor no pisa una más reciente con otra más antigua.
   */
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  /**
   * Contenido de secciones que cambió la IA (o «Seleccionar» a mano) y que no
   * tiene campo propio: programa, historia, detalles, preguntas, autobuses y
   * alojamiento (13-oct-2026, lib/creator-sections.ts). Opcional: los
   * borradores anteriores siguen valiendo.
   */
  sections: builderSectionsSchema.optional(),
  /**
   * Lo que la pareja añade a mano en «Vuestro día» (13-oct-2026, punto 9):
   * más momentos del programa, tarjetas de detalles y preguntas
   * (lib/creator-day.ts). Filas laxas: solo llega a la web lo que tiene
   * título. Opcionales: los borradores anteriores siguen valiendo.
   */
  dayMoments: z.array(builderDayMomentSchema).max(DAY_MOMENTS_MAX).optional(),
  dayCards: z.array(builderDayCardSchema).max(DAY_CARDS_MAX).optional(),
  dayQuestions: z.array(builderDayQuestionSchema).max(DAY_QUESTIONS_MAX).optional(),
  /**
   * Con él, las filas de detalles y preguntas mandan sobre toda la lista,
   * también las de plantilla (que se editan y se quitan en «Vuestro día»):
   * ids de plantilla que ya pasaron a filas (`materializeDay`, `ownedList`).
   */
  dayKnown: builderDayKnownSchema.optional(),
});
export type BuilderDraft = z.infer<typeof builderDraftSchema>;
export type BuilderMomentId = keyof NonNullable<BuilderDraft["day"]>;
export const EMPTY_DAY: NonNullable<BuilderDraft["day"]> = { ceremony: { time: "", place: "" }, cocktail: { time: "", place: "" }, banquet: { time: "", place: "" } };
export type BuilderBusStop = NonNullable<BuilderDraft["busStops"]>[number];
export type BuilderHotel = NonNullable<BuilderDraft["stayHotels"]>[number];

/**
 * Bienvenida de partida (8-oct-2026: en «tú», como el resto de textos al
 * invitado). La anterior («Os invitamos…») sigue contando como «de partida»
 * para que la lectura de la idea pueda proponer otra en borradores antiguos.
 */
export const DEFAULT_WELCOME_MESSAGES: readonly string[] = ["Te invitamos a formar parte de la historia que estamos construyendo juntos.", "Os invitamos a formar parte de la historia que estamos construyendo juntos."];

export const EMPTY_DRAFT: BuilderDraft = {
  version: 4, idea: "", partnerName1: "", partnerName2: "", weddingDate: "", guestCount: "", style: "editorial", venue: "", address: "", time: "", welcomeMessage: "Te invitamos a formar parte de la historia que estamos construyendo juntos.", step: 0, palette: null, photo: "pending", design: null, layout: "web", opening: "sobre",
};

/** A small, explicit style suggestion; no external model or fabricated generation. */
export function suggestWeddingStyle(idea: string): BuilderDraft["style"] {
  const text = idea.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/natur|jardin|campo|verde|bosque|olivo|flor/.test(text)) return "natural";
  if (/clas|tradici|romantic|palacio|atemporal/.test(text)) return "clasico";
  return "editorial";
}

/**
 * Aplica la idea que llega por `?idea=` (prompt de la landing) sobre el
 * borrador guardado, sin pisar nada que la pareja ya haya escrito:
 *  - sin borrador → borrador vacío con la idea, su estilo sugerido y paso 0;
 *  - borrador con idea → se conserva tal cual (incluido su paso);
 *  - borrador sin idea → se añade la idea; el estilo solo cambia si seguía
 *    siendo el de partida (si la pareja eligió uno a mano, se respeta).
 * Puro: recorta a BUILDER_IDEA_MAX y nunca lanza.
 */
export function prefillBuilderIdea(saved: BuilderDraft | null, idea: string | null | undefined): BuilderDraft {
  const text = (idea ?? "").trim().slice(0, BUILDER_IDEA_MAX);
  if (!text) return saved ?? EMPTY_DRAFT;
  if (!saved) return { ...EMPTY_DRAFT, idea: text, style: suggestWeddingStyle(text), step: 0 };
  if (saved.idea.trim()) return saved;
  return { ...saved, idea: text, style: saved.style === EMPTY_DRAFT.style ? suggestWeddingStyle(text) : saved.style };
}

/** Lo que una plantilla de la landing fija del diseño (lo mismo que enseña su /demo). */
export interface BuilderTemplate { id: string; themeId: SiteThemeId; palette: SitePaletteId }

/** Aplica una plantilla: el mismo estilo, colores, «Como una web» y sobre que su demo. Lo escrito no cambia. */
export function applyBuilderTemplate(draft: BuilderDraft, template: BuilderTemplate): BuilderDraft {
  return { ...draft, template: template.id, style: template.themeId, palette: template.palette, layout: "web", opening: "sobre" };
}

/** ¿Ha escrito ya algo la pareja? Un borrador recién abierto (o solo con la idea de la landing sin avanzar) no cuenta. */
export function hasBuilderProgress(draft: BuilderDraft | null): draft is BuilderDraft {
  if (!draft) return false;
  return draft.step > 0 || Boolean(draft.partnerName1.trim() || draft.partnerName2.trim() || draft.weddingDate || draft.venue.trim());
}

/**
 * Qué borrador se abre al entrar al creador con sesión: el de este navegador
 * o la copia que el servidor guardó al pedir el enlace (`builder_draft_stash`).
 * Manda el de este navegador si tiene avance (es el mismo o más reciente);
 * si no lo hay o está vacío —el enlace se abrió en otro navegador—, la copia.
 */
export function pickBuilderDraft(local: BuilderDraft | null, stashed: BuilderDraft | null | undefined): BuilderDraft | null {
  if (hasBuilderProgress(local)) return local;
  if (hasBuilderProgress(stashed ?? null)) return stashed ?? null;
  return local;
}

/**
 * Valida un borrador ya deserializado y lo lleva a la forma actual (v3):
 *  - v3 tal cual;
 *  - v2 (sin maqueta) → `layout: null`, la Story de siempre;
 *  - v1 (7 pasos, sin foto ni paleta): el paso de la foto se inserta detrás
 *    de los nombres, así que un borrador v1 en el paso ≥ 2 avanza uno y queda
 *    con la foto «pendiente» (la pareja la verá al volver atrás).
 * Lo usan el navegador (localStorage) y la copia del servidor
 * (`builder_draft_stash`, que puede guardar borradores v2 de hasta 7 días).
 * Nunca lanza.
 */
export function parseBuilderDraft(value: unknown): BuilderDraft | null {
  const current = builderDraftSchema.safeParse(clampDayLists(value));
  if (current.success) return { ...current.data, opening: draftOpening(current.data) };
  // v3 y anteriores: 8 pasos. El índice se traduce por el nombre del paso.
  const fromV3 = (step: number) => STEP[V3_STEPS[step] ?? "idea"];
  const v3 = builderDraftV3Schema.safeParse(value);
  if (v3.success) return { ...v3.data, version: 4, step: fromV3(v3.data.step), opening: draftOpening(v3.data) };
  const v2 = builderDraftV2Schema.safeParse(value);
  if (v2.success) return { ...v2.data, version: 4, step: fromV3(v2.data.step), layout: null, opening: DEFAULT_OPENING };
  const legacy = builderDraftV1Schema.safeParse(value);
  if (!legacy.success) return null;
  const { step, ...rest } = legacy.data;
  return { ...rest, version: 4, step: fromV3(step >= 2 ? step + 1 : step), palette: null, photo: "pending", design: null, layout: null, opening: DEFAULT_OPENING };
}

/**
 * Defensa: un borrador con más filas del día que el tope no se descarta entero
 * (se perdería todo al recargar); se recortan las listas antes de validar.
 */
function clampDayLists(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draft = { ...(value as Record<string, unknown>) };
  const caps: Array<[string, number]> = [["dayMoments", DAY_MOMENTS_MAX], ["dayCards", DAY_CARDS_MAX], ["dayQuestions", DAY_QUESTIONS_MAX]];
  for (const [key, max] of caps) {
    const list = draft[key];
    if (Array.isArray(list) && list.length > max) draft[key] = list.slice(0, max);
  }
  return draft;
}

/**
 * Apertura que guardará la web. Ausente (borradores anteriores al 7-oct-2026)
 * = el sobre floral por defecto; `null` = «Sin sobre» elegido con el formato
 * anterior → "ninguno". Nunca devuelve ausencia: el documento la lleva escrita.
 */
export function draftOpening(draft: Pick<BuilderDraft, "opening">): SiteOpeningId {
  if (draft.opening === null) return "ninguno";
  return draft.opening ?? DEFAULT_OPENING;
}

/** Lee el borrador guardado en el navegador (JSON) con `parseBuilderDraft`. Nunca lanza. */
export function restoreBuilderDraft(raw: string | null): BuilderDraft | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return parseBuilderDraft(value);
}

/** Recorta a `max` sin dejar espacios colgando (los límites del contrato son de caracteres). */
const clip = (value: string, max: number) => value.trim().slice(0, max);

/**
 * Documento de la web a partir del borrador: el adaptador v1 (nombres, fecha,
 * estilo, bienvenida, lugar) + todas las escenas de /demo con su contenido de
 * partida (`builderScenes`, lib/creator-content.ts) + lo que el modelo
 * antiguo no conoce (sobre, paleta, maqueta y los cambios de la IA en
 * `design`: titular, cuenta atrás, títulos y orden de escenas). Lo del
 * borrador manda en los datos.
 *
 * `image` solo se pasa con una URL ya alojada (https) al guardar, o con el
 * `blob:` local SOLO para el preview en memoria: ese documento nunca se
 * valida, se guarda ni se envía.
 */
export function composeBuilderDocument(draft: BuilderDraft, image: SceneImage | null = null): SiteDocument {
  const legacy = documentFromBuilderDraft(draft);
  const design = draft.design;
  const designed = applySectionOverlays(builderScenes(legacy.scenes, draft), draft.sections).map((scene): Scene => {
    switch (scene.type) {
      case "cover":
        return { ...scene, props: { ...scene.props, image: null, ...(design?.eyebrow != null ? { eyebrow: clip(design.eyebrow, 60) } : {}), ...(design?.showCountdown != null ? { showCountdown: design.showCountdown } : {}) } };
      case "agenda":
        return design?.agendaTitle ? { ...scene, props: { ...scene.props, title: clip(design.agendaTitle, 80) } } : scene;
      case "rsvp":
        return design?.rsvpTitle ? { ...scene, props: { ...scene.props, title: clip(design.rsvpTitle, 80) } } : scene;
      default:
        return scene;
    }
  });
  const candidate: SiteDocument = {
    ...legacy,
    ...(draft.palette ? { palette: draft.palette } : {}),
    ...(draft.layout ? { layout: draft.layout } : {}),
    opening: draftOpening(draft),
    // El orden y la visibilidad que pidió la IA se aplican sobre TODAS las
    // escenas, también las de los módulos (antes se añadían después y se
    // perdía lo que la IA hubiese ocultado o movido).
    scenes: orderScenes(designed, design?.scenes ?? null),
  };
  // Se revalida: una URL `blob:` no pasaría el contrato, por eso la imagen
  // entra después; al guardar, `saveSiteDraft` vuelve a validar la URL https.
  const parsed = parseSiteDocument(candidate);
  const doc = parsed.ok ? parsed.document : { ...legacy, opening: draftOpening(draft) };
  if (!image) return doc;
  return { ...doc, scenes: doc.scenes.map((scene) => (scene.type === "cover" ? { ...scene, props: { ...scene.props, image } } : scene)) };
}

/** Ids de las escenas que crea el creador (los mismos que usa el editor del panel). */
export const BUILDER_SCENE_IDS = { gallery: "fotos", story: "historia", details: "detalles", faq: "preguntas", transport: "autobuses", stay: "alojamiento" } as const;

/**
 * Todas las escenas de la web, en el orden de /demo: portada, fotos,
 * historia, lugar, programa, autobuses y alojamiento (si están activados),
 * detalles, preguntas y asistencia. Las que aún no tienen contenido existen
 * (el panel las rellena sin crearlas) pero el invitado no las ve
 * (`sceneHasContent`).
 */
function builderScenes(legacyScenes: Scene[], draft: BuilderDraft): Scene[] {
  const of = <T extends Scene["type"]>(type: T) => legacyScenes.find((s): s is Extract<Scene, { type: T }> => s.type === type);
  const cover = of("cover");
  const venue = of("venue");
  const agenda = of("agenda");
  const rsvp = of("rsvp");
  const on = new Set(draft.modules ?? []);
  const starter: StarterSource = {
    modules: draft.modules,
    hasBusStops: on.has("bus") && builderBusStops(draft).some((stop) => stop.name.trim()),
    hasHotels: on.has("hotels") && builderHotels(draft).some((hotel) => hotel.name.trim()),
  };
  const items = builderAgendaItems(draft);
  const dayAgenda = agenda ? { ...agenda, enabled: items.length > 0, props: { ...agenda.props, items } } : undefined;
  // Con plantilla de la landing: detalles, preguntas y títulos de la historia de la demo (genéricos).
  const tpl = findBuilderTemplate(draft.template) ? templateStarter(starter) : null;
  const scenes: Scene[] = [
    ...(cover ? [cover] : []),
    { id: BUILDER_SCENE_IDS.gallery, type: "gallery", enabled: true, props: { title: "", images: [] } },
    { id: BUILDER_SCENE_IDS.story, type: "story", enabled: true, props: { title: tpl?.story.title ?? "Nuestra historia", intro: "", chapters: storyChaptersFromAnswers(draft.story, tpl?.story.chapterTitles) } },
    ...(venue ? [venue] : []),
    ...(dayAgenda ? [dayAgenda] : []),
    { id: BUILDER_SCENE_IDS.details, type: "details", enabled: true, props: { title: tpl?.details.title ?? "Algunos detalles más", intro: tpl?.details.intro ?? "", cards: dayList(tpl?.details.cards ?? starterDetails(starter), draft.dayCards, draft.dayKnown?.cards, handDetailCards, DAY_CARDS_MAX) } },
    { id: BUILDER_SCENE_IDS.faq, type: "faq", enabled: true, props: { title: tpl?.faq.title ?? "Preguntas y respuestas", contact: tpl ? faqContact(cover) : "", items: dayList(tpl?.faq.items ?? starterFaq(starter), draft.dayQuestions, draft.dayKnown?.questions, handFaqItems, DAY_QUESTIONS_MAX) } },
    ...(rsvp ? [rsvp] : []),
  ];
  return withBuilderModules(scenes, draft);
}

/**
 * Detalles o preguntas: con `dayKnown`, las filas mandan sobre toda la lista
 * (`ownedList`); sin él (borradores que aún no abrieron «Vuestro día» tras el
 * 13-oct-2026), lo de plantilla y detrás las filas a mano.
 */
function dayList<R extends { id: string; auto?: true }, T extends { id: string }>(starter: T[], rows: R[] | undefined, known: readonly string[] | undefined, emit: (rows: R[]) => T[], max: number): T[] {
  return known ? ownedList(starter, rows, known, emit, max) : withHand(starter, emit(rows ?? []), max);
}

/** Lo de partida y, detrás, lo añadido a mano en «Vuestro día», sin pasar del tope del contrato. */
function withHand<T extends { id: string }>(base: T[], hand: T[], max: number): T[] {
  const taken = new Set(base.map((item) => item.id));
  return [...base, ...hand.filter((item) => !taken.has(item.id))].slice(0, max);
}

/**
 * Línea de contacto de las preguntas, como en la demo de la plantilla, con
 * los nombres de la pareja (son suyos: no se inventa nada). Sin nombres, nada.
 */
function faqContact(cover: Extract<Scene, { type: "cover" }> | undefined): string {
  const a = cover?.props.partnerName1.trim() ?? "";
  const b = cover?.props.partnerName2.trim() ?? "";
  if (!a || !b) return "";
  const text = `¿No encuentras la respuesta? Escribe a ${a} o a ${b}.`;
  // El contrato admite 160: con nombres muy largos, mejor sin línea que cortada.
  return text.length <= 160 ? text : "";
}

/**
 * Documento que el creador manda a `createWedding` (lo que la pareja vio en
 * el móvil), saneado en el servidor antes de publicarlo como primera versión:
 *  - tiene que cumplir el contrato y poder publicarse;
 *  - nombres y fecha de la portada son los validados de la boda (`legacy`,
 *    el adaptador v1 de esos mismos valores), nunca los del cliente;
 *  - sin fotos: la portada se sube después, al bucket privado de la boda
 *    (finish-wedding.ts). Una URL ajena nunca entra por aquí.
 * Devuelve null si no vale (el servidor publica entonces `legacy`). Puro.
 */
export function creatorSiteDocument(input: unknown, legacy: SiteDocument): SiteDocument | null {
  const parsed = parseSiteDocument(input);
  if (!parsed.ok) return null;
  const legacyCover = findScene(legacy, "cover");
  if (!legacyCover) return null;
  const withoutPhotos = mapImages(parsed.document, () => null);
  const scenes = withoutPhotos.scenes.map((scene): Scene => (scene.type === "cover"
    ? { ...scene, props: { ...scene.props, partnerName1: legacyCover.props.partnerName1, partnerName2: legacyCover.props.partnerName2, weddingDate: legacyCover.props.weddingDate, image: null } }
    : scene));
  const checked = parseSiteDocument({ ...withoutPhotos, scenes });
  if (!checked.ok || publishIssues(checked.document).length > 0) return null;
  return checked.document;
}

/**
 * Añade los módulos marcados en el creador: autobuses y alojamiento como
 * escenas (con las paradas y hoteles que la pareja nombró, sin inventar
 * nada) detrás del programa; menú, niños y canción como preguntas.
 */
export function withBuilderModules(scenes: Scene[], draft: Pick<BuilderDraft, "modules" | "moduleHints" | "busStops" | "busReturn" | "stayHotels">): Scene[] {
  const on = new Set(draft.modules ?? []);
  if (on.size === 0) return scenes;
  const extra: Scene[] = [];
  if (on.has("bus") && !scenes.some((s) => s.type === "transport")) {
    const stops = builderBusStops(draft).filter((stop) => stop.name.trim()).map((stop, i) => ({ id: `p-${i + 1}`, name: clip(stop.name, 80), time: stop.time, place: clip(stop.place, 160) }));
    // Sin paradas no se pregunta en el formulario (no hay a qué subirse) y la
    // escena no se ve hasta que la pareja las añada en el panel.
    extra.push({ id: BUILDER_SCENE_IDS.transport, type: "transport", enabled: true, props: { title: "Autobuses", intro: "", stops, returnNote: busReturnNote(draft.busReturn), ask: stops.length > 0 } });
  }
  if (on.has("hotels") && !scenes.some((s) => s.type === "stay")) {
    const hotels = builderHotels(draft).filter((hotel) => hotel.name.trim()).map((hotel, i) => {
      const link = httpsLink(hotel.link);
      return { id: `h-${i + 1}`, name: clip(hotel.name, 80), note: "", code: clip(hotel.code, 40), bookBy: "", ...(link ? { link } : {}) };
    });
    extra.push({ id: BUILDER_SCENE_IDS.stay, type: "stay", enabled: true, props: { title: "Dónde alojarse", intro: "", hotels, ask: true } });
  }
  // Detrás del programa (lo práctico junto); sin programa, antes de la asistencia.
  const agendaAt = scenes.findIndex((s) => s.type === "agenda");
  const rsvpAt = scenes.findIndex((s) => s.type === "rsvp");
  const at = agendaAt !== -1 ? agendaAt + 1 : rsvpAt;
  const next = at === -1 ? [...scenes, ...extra] : [...scenes.slice(0, at), ...extra, ...scenes.slice(at)];
  return next.map((scene) => {
    if (scene.type !== "rsvp") return scene;
    const props = { ...scene.props };
    if (on.has("song")) props.song = true;
    if (on.has("kids")) props.kids = true;
    if (on.has("menu") && !props.menuOptions?.length) props.menuOptions = [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }, { id: "m-3", label: "Vegetariano" }];
    return { ...scene, props };
  });
}

export const BUILDER_MOMENT_LABELS: Record<BuilderMomentId, string> = { ceremony: "Ceremonia", cocktail: "Cóctel", banquet: "Banquete" };

/**
 * Programa del día a partir de «Vuestro día»: salida del autobús (si está
 * activado y la primera parada tiene hora), ceremonia, cóctel, banquete y
 * vuelta. Solo los momentos con hora o sitio; nada inventado. Puro.
 */
export function builderAgendaItems(draft: Pick<BuilderDraft, "day" | "modules" | "busStops" | "moduleHints" | "busReturn" | "dayMoments">): AgendaItem[] {
  const items: AgendaItem[] = [];
  const item = (id: string, title: string, time: string, place: string, address = "") => {
    if (!time && !place.trim()) return;
    items.push({ id, title, timeLabel: time, place: clip(place, 160), address: place.trim() ? clip(address, 240) : "", notes: "" });
  };
  const bus = (draft.modules ?? []).includes("bus");
  const first = bus ? builderBusStops(draft).find((stop) => stop.name.trim()) : undefined;
  if (first?.time) item("m-salida", "Salida de los autobuses", first.time, first.name);
  const day = draft.day ?? EMPTY_DAY;
  item("m-ceremonia", BUILDER_MOMENT_LABELS.ceremony, day.ceremony.time, day.ceremony.place, day.ceremony.address);
  item("m-coctel", BUILDER_MOMENT_LABELS.cocktail, day.cocktail.time, day.cocktail.place, day.cocktail.address);
  item("m-banquete", BUILDER_MOMENT_LABELS.banquet, day.banquet.time, day.banquet.place, day.banquet.address);
  if (bus && draft.busReturn?.time) item("m-vuelta", "Vuelta en autobús", draft.busReturn.time, draft.busReturn.place);
  // Lo añadido a mano en «Vuestro día» entra por su hora (lib/creator-day.ts).
  return withHand([], placeMoments(items, handAgendaItems(draft.dayMoments).filter((hand) => !FIXED_MOMENT_IDS.has(hand.id))), DAY_MOMENTS_MAX);
}

export interface DayListRoom { room: number; taken: string[] }

/**
 * Para el paso «Vuestro día»: cuántas filas a mano caben aún en el programa,
 * los detalles y las preguntas (el tope del contrato cuenta lo que ya se ve y
 * las filas a medio escribir) y qué ids ya usa cada lista, también los que
 * recuerda la capa de secciones (`nextHandId`).
 */
export function dayRoom(draft: BuilderDraft): Record<"moments" | "cards" | "questions", DayListRoom> {
  const doc = composeBuilderDocument(draft);
  const agenda = findScene(doc, "agenda")?.props.items ?? [];
  const cards = findScene(doc, "details")?.props.cards ?? [];
  const faq = findScene(doc, "faq")?.props.items ?? [];
  const layerIds = (type: OverlayType) => {
    const layer = draft.sections?.[type];
    return layer ? [...layer.order, ...layer.known, ...layer.items.map((item) => item.id)] : [];
  };
  const list = <T extends { id: string }>(shown: { id: string }[], rows: T[] | undefined, untitled: (row: T) => boolean, max: number, type: OverlayType): DayListRoom => ({
    // Tope doble: lo que se ve en la invitación y lo que cabe en el borrador
    // (las filas de plantilla ocultas también cuentan para el esquema).
    room: Math.max(0, Math.min(max - shown.length - (rows ?? []).filter(untitled).length, max - (rows ?? []).length)),
    taken: [...new Set([...shown.map((item) => item.id), ...(rows ?? []).map((row) => row.id), ...layerIds(type)])],
  });
  return {
    moments: list(agenda, draft.dayMoments, (row) => !row.title.trim(), DAY_MOMENTS_MAX, "agenda"),
    cards: list(cards, draft.dayCards, (row) => !row.title.trim(), DAY_CARDS_MAX, "details"),
    questions: list(faq, draft.dayQuestions, (row) => !row.question.trim(), DAY_QUESTIONS_MAX, "faq"),
  };
}

/** Paradas del creador: las escritas en el paso «gente» o, si no, los nombres que dio la idea. */
export function builderBusStops(draft: Pick<BuilderDraft, "busStops" | "moduleHints">): BuilderBusStop[] {
  return draft.busStops ?? (draft.moduleHints?.stops ?? []).map((name) => ({ name, time: "", place: "" }));
}
/** Hoteles del creador: los escritos en el paso «gente» o, si no, los nombres que dio la idea. */
export function builderHotels(draft: Pick<BuilderDraft, "stayHotels" | "moduleHints">): BuilderHotel[] {
  return draft.stayHotels ?? (draft.moduleHints?.hotels ?? []).map((name) => ({ name, code: "", link: "" }));
}

/** «01:00 desde la puerta de la finca», «A las 01:00», «Desde la finca» o vacío. */
export function busReturnNote(back: BuilderDraft["busReturn"]): string {
  const time = back?.time ?? "";
  const place = clip(back?.place ?? "", 120);
  if (time && place) return `${time} desde ${place}`;
  if (time) return `A las ${time}`;
  return place ? `Desde ${place}` : "";
}

/** Enlace de hotel: solo https y bien formado (el contrato no admite otro); si no, nada. */
export function httpsLink(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  if (!text) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname.includes(".") && candidate.length <= 2048 ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Orden y visibilidad pedidos por la IA; la portada siempre primera y visible. */
function orderScenes<T extends { id: string; type: string; enabled: boolean }>(scenes: T[], wanted: BuilderDesign["scenes"]): T[] {
  if (!wanted || wanted.length === 0) return scenes;
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const used = new Set<string>();
  const ordered: T[] = [];
  for (const item of wanted) {
    const scene = byId.get(item.id);
    if (!scene || used.has(item.id) || scene.type === "cover") continue;
    used.add(item.id);
    ordered.push({ ...scene, enabled: item.enabled });
  }
  const cover = scenes.filter((scene) => scene.type === "cover");
  const rest = scenes.filter((scene) => scene.type !== "cover" && !used.has(scene.id));
  return [...cover, ...ordered, ...rest];
}

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const asTime = (value: string) => (HHMM.test(value) ? value : "");
/** Momentos del programa que salen de «Vuestro día» (id → momento). */
const MOMENT_IDS: Record<string, BuilderMomentId> = { "m-ceremonia": "ceremony", "m-coctel": "cocktail", "m-banquete": "banquet" };
/** Capítulos que salen de las respuestas de «Vuestra historia» (id → respuesta). */
const CHAPTER_ANSWERS = { "c-conocimos": "met", "c-pedida": "proposal", "c-ilusion": "ahead" } as const;

/**
 * Devuelve a los campos del borrador lo que tiene paso propio en el creador
 * (horas y sitios del día, respuestas de la historia, paradas, hoteles y sus
 * módulos), para que esos pasos enseñen lo que pidió la IA. Lo demás va a la
 * capa de secciones (`sectionOverlays`).
 */
function contentIntoFields(draft: BuilderDraft, proposed: SiteDocument): BuilderDraft {
  const next: BuilderDraft = { ...draft };
  const modules = new Set(draft.modules ?? []);
  const agenda = findScene(proposed, "agenda");
  if (agenda) {
    const items = new Map(agenda.props.items.map((item) => [item.id, item]));
    const oldDay = draft.day ?? EMPTY_DAY;
    const day = { ...oldDay };
    for (const [id, moment] of Object.entries(MOMENT_IDS)) {
      const item = items.get(id);
      const old = oldDay[moment];
      // La dirección elegida en su paso solo sigue valiendo con el mismo sitio.
      day[moment] = item ? { time: asTime(item.timeLabel), place: item.place, ...(old.address && item.place === old.place ? { address: old.address } : {}) } : { time: "", place: "" };
    }
    if (draft.day || Object.values(day).some((m) => m.time || m.place)) next.day = day;
  }
  const story = findScene(proposed, "story");
  if (story) {
    const answers = { met: "", proposal: "", ahead: "" };
    for (const chapter of story.props.chapters) {
      const key = CHAPTER_ANSWERS[chapter.id as keyof typeof CHAPTER_ANSWERS];
      if (key) answers[key] = chapter.body;
    }
    if (draft.story || Object.values(answers).some(Boolean)) next.story = answers;
  }
  const transport = findScene(proposed, "transport");
  if (transport && (modules.has("bus") || transport.props.stops.length > 0)) {
    modules.add("bus");
    next.busStops = transport.props.stops.map((stop) => ({ name: stop.name, time: asTime(stop.time), place: stop.place }));
  }
  // Salida y vuelta del autobús también salen en el programa: si la IA las
  // cambió ahí (y no en Autobuses), manda el programa.
  if (agenda && modules.has("bus")) {
    const items = new Map(agenda.props.items.map((item) => [item.id, item]));
    const before = new Map((findScene(composeBuilderDocument(draft), "agenda")?.props.items ?? []).map((item) => [item.id, item]));
    const changed = (id: string) => canonical(items.get(id) ?? null) !== canonical(before.get(id) ?? null);
    if (changed("m-salida")) {
      const stops = builderBusStops(next).map((stop) => ({ ...stop }));
      const first = stops.find((stop) => stop.name.trim());
      const salida = items.get("m-salida");
      if (first) {
        first.time = salida ? asTime(salida.timeLabel) : "";
        if (salida?.place.trim()) first.name = clip(salida.place, 80);
        next.busStops = stops;
      }
    }
    if (changed("m-vuelta")) {
      const vuelta = items.get("m-vuelta");
      next.busReturn = { time: vuelta ? asTime(vuelta.timeLabel) : "", place: vuelta ? clip(vuelta.place, 120) : draft.busReturn?.place ?? "" };
    }
  }
  const stay = findScene(proposed, "stay");
  if (stay && (modules.has("hotels") || stay.props.hotels.length > 0)) {
    modules.add("hotels");
    next.stayHotels = stay.props.hotels.map((hotel) => ({ name: hotel.name, code: hotel.code, link: hotel.link ?? "" }));
  }
  if (modules.size !== (draft.modules ?? []).length) next.modules = BUILDER_MODULE_IDS.filter((id) => modules.has(id));
  return withHandRows(next, draft, proposed);
}

/**
 * Lo añadido a mano en «Vuestro día» (y lo nuevo que proponga la IA en el
 * programa, los detalles y las preguntas) vuelve a sus filas: el paso enseña
 * lo mismo que la invitación y se puede seguir editando ahí. Lo de partida
 * (las preguntas y tarjetas de plantilla) sigue en la capa de secciones. Las
 * filas a medio escribir (sin título) se conservan.
 */
function withHandRows(next: BuilderDraft, draft: BuilderDraft, proposed: SiteDocument): BuilderDraft {
  const out: BuilderDraft = { ...next };
  const pending = <T>(rows: T[] | undefined, titled: (row: T) => boolean) => (rows ?? []).filter((row) => !titled(row));
  const agenda = findScene(proposed, "agenda");
  if (agenda) {
    const rows = [...agenda.props.items.filter((item) => !FIXED_MOMENT_IDS.has(item.id)).map(momentRow), ...pending(draft.dayMoments, (row) => Boolean(row.title.trim()))].slice(0, DAY_MOMENTS_MAX);
    if (draft.dayMoments || rows.length > 0) out.dayMoments = rows;
  }
  // Lo de plantilla: lo que genera el borrador sin filas, sin `dayKnown` y sin capa.
  const base = composeBuilderDocument({ ...out, dayCards: undefined, dayQuestions: undefined, dayKnown: undefined, sections: undefined, design: null });
  const baseCards = new Map((findScene(base, "details")?.props.cards ?? []).map((card) => [card.id, card]));
  const baseFaq = new Map((findScene(base, "faq")?.props.items ?? []).map((item) => [item.id, item]));
  const details = findScene(proposed, "details");
  const faq = findScene(proposed, "faq");
  // Detalles y preguntas pasan enteros a filas (también los de plantilla,
  // `auto` mientras sigan como la plantilla): desde aquí se editan y se quitan.
  // Se conservan las filas a medio escribir y las de plantilla que ahora no se
  // ven (p. ej. «¿Hay autobús?» con los autobuses apagados): vuelven si la plantilla las genera otra vez.
  const shown = composeBuilderDocument(draft);
  const shownCards = new Set((findScene(shown, "details")?.props.cards ?? []).map((card) => card.id));
  const shownFaq = new Set((findScene(shown, "faq")?.props.items ?? []).map((item) => item.id));
  const keepCard = (row: NonNullable<BuilderDraft["dayCards"]>[number]) => Boolean(row.title.trim()) && !(row.auto && !shownCards.has(row.id));
  const keepQuestion = (row: NonNullable<BuilderDraft["dayQuestions"]>[number]) => Boolean(row.question.trim()) && !(row.auto && !shownFaq.has(row.id));
  if (details) out.dayCards = [...details.props.cards.map((card) => ownedCardRow(card, baseCards.get(card.id))), ...pending(draft.dayCards, keepCard)].slice(0, DAY_CARDS_MAX);
  if (faq) out.dayQuestions = [...faq.props.items.map((item) => ownedQuestionRow(item, baseFaq.get(item.id))), ...pending(draft.dayQuestions, keepQuestion)].slice(0, DAY_QUESTIONS_MAX);
  if (details && faq) {
    const union = (old: readonly string[] | undefined, now: Iterable<string>) => [...new Set([...(old ?? []), ...now])].slice(-40);
    out.dayKnown = { cards: union(draft.dayKnown?.cards, baseCards.keys()), questions: union(draft.dayKnown?.questions, baseFaq.keys()) };
  }
  return out;
}

/**
 * Al abrir «Vuestro día» (una vez por borrador): todo lo que la invitación
 * enseña en detalles y preguntas (también lo de plantilla y lo que añadió la
 * IA antes de existir las filas) y los momentos que añadió la IA pasan a
 * filas editables. La capa de esas listas se queda solo con sus textos
 * (título, entrada). Sin riesgo: si la invitación no quedase exactamente
 * igual, no se cambia nada.
 */
export function materializeDay(draft: BuilderDraft): BuilderDraft {
  if (draft.dayKnown) return draft;
  const doc = composeBuilderDocument(draft);
  const out = withHandRows({ ...draft }, draft, doc);
  if (!out.dayKnown) return draft;
  const sections: BuilderSections = { ...(draft.sections ?? {}) };
  for (const type of ["details", "faq"] as const) {
    const layer = sections[type];
    if (!layer) continue;
    if (layer.text.length > 0) sections[type] = { order: [], known: [], items: [], text: layer.text };
    else delete sections[type];
  }
  const agendaLayer = sections.agenda;
  if (agendaLayer) {
    const rows = new Set((out.dayMoments ?? []).map((row) => row.id));
    sections.agenda = { ...agendaLayer, items: agendaLayer.items.filter((item) => !rows.has(item.id)) };
  }
  const next: BuilderDraft = { ...out, sections: Object.keys(sections).length > 0 ? sections : undefined };
  if (!next.sections) delete next.sections;
  return canonical(composeBuilderDocument(next)) === canonical(doc) ? next : draft;
}

/** Paradas y hoteles: sus ids los genera el borrador por posición. */
const BY_POSITION: ReadonlySet<OverlayType> = new Set<OverlayType>(["transport", "stay"]);

/**
 * Adopta una propuesta de la IA (documento completo ya validado por el
 * servidor) en el borrador: lo que tiene campo propio vuelve a su campo
 * (estilo, paleta, bienvenida, lugar, día, historia, paradas, hoteles), el
 * contenido de las secciones va a `sections` y el resto a `design`. Los
 * nombres y la fecha nunca cambian desde aquí (la IA no puede tocarlos).
 *
 * Desde el 13-oct-2026 la IA no cambia la apertura (siempre el sobre) ni
 * pasa la maqueta a «Como una Story»: aquí tampoco se adoptan.
 */
export function adoptProposal(draft: BuilderDraft, proposed: SiteDocument): BuilderDraft {
  const cover = findScene(proposed, "cover");
  const venue = findScene(proposed, "venue");
  const agenda = findScene(proposed, "agenda");
  const rsvp = findScene(proposed, "rsvp");
  const fields: BuilderDraft = {
    ...contentIntoFields(draft, proposed),
    style: proposed.themeId,
    palette: proposed.palette ?? null,
    // Se refleja la propuesta (también «Deshacer» a una versión sin «web»). Que
    // la IA nunca pase a la Story lo garantiza el servidor (applySitePatch).
    layout: proposed.layout === "web" ? "web" : draft.layout === "web" ? null : draft.layout,
    welcomeMessage: cover ? cover.props.welcomeMessage : draft.welcomeMessage,
    venue: venue ? venue.props.venue : draft.venue,
    address: venue ? venue.props.address : draft.address,
    time: venue ? venue.props.time : draft.time,
    // El sitio exacto solo sigue valiendo si la IA no cambió el lugar ni la dirección.
    venuePlaceId: !venue || (venue.props.venue === draft.venue && venue.props.address === draft.address) ? draft.venuePlaceId : undefined,
  };
  // Capas sobre lo que el borrador ya genera con sus campos (sin capas ni diseño).
  const derived = composeBuilderDocument({ ...fields, sections: undefined, design: null });
  const sections = sectionOverlays(derived, proposed, BY_POSITION);
  const withSections: BuilderDraft = { ...fields, sections };
  if (!sections) delete withSections.sections;
  const base = composeBuilderDocument({ ...withSections, design: null });
  const baseCover = findScene(base, "cover");
  const baseAgenda = findScene(base, "agenda");
  const baseRsvp = findScene(base, "rsvp");
  const sameOrder = base.scenes.length === proposed.scenes.length && base.scenes.every((scene, index) => scene.id === proposed.scenes[index]?.id && scene.enabled === proposed.scenes[index]?.enabled);
  const design: BuilderDesign = {
    eyebrow: cover && cover.props.eyebrow !== baseCover?.props.eyebrow ? cover.props.eyebrow : null,
    showCountdown: cover && cover.props.showCountdown !== baseCover?.props.showCountdown ? cover.props.showCountdown : null,
    agendaTitle: agenda && agenda.props.title !== baseAgenda?.props.title ? agenda.props.title : null,
    rsvpTitle: rsvp && rsvp.props.title !== baseRsvp?.props.title ? rsvp.props.title : null,
    scenes: sameOrder ? null : proposed.scenes.map((scene) => ({ id: scene.id, enabled: scene.enabled })),
  };
  const empty = Object.values(design).every((value) => value === null);
  return { ...withSections, design: empty ? null : design };
}

/**
 * `adoptProposal` comprobado: el «Aplicado» del chat del creador. Si lo que
 * el borrador recompone no es lo propuesto, no se adopta nada y se dice qué
 * secciones no se han podido aplicar (nombres sin espacios, como el
 * documento que se envió a la IA).
 */
export function adoptChecked(draft: BuilderDraft, proposed: SiteDocument): { ok: true; draft: BuilderDraft } | { ok: false; error: string } {
  const adopted = adoptProposal(draft, proposed);
  const missing = unappliedSections(proposed, composeBuilderDocument({ ...adopted, partnerName1: adopted.partnerName1.trim(), partnerName2: adopted.partnerName2.trim() }));
  return missing.length > 0 ? { ok: false, error: notAppliedMessage(missing) } : { ok: true, draft: adopted };
}

/** Paleta efectiva que ve la pareja en el selector. */
export function selectedPalette(draft: Pick<BuilderDraft, "palette" | "style">): (typeof SITE_PALETTE_IDS)[number] {
  return draft.palette ?? draft.style;
}
