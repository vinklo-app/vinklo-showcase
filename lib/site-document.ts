/**
 * Contrato versionado de la web de boda (fase 1 del motor de webs).
 *
 * Un documento describe TODO el contenido público de una boda: escenas con
 * id estable, tipo del catálogo, orden y props tipadas. El editor, el preview
 * y la página publicada comparten este contrato y el mismo renderer.
 *
 * Reglas:
 *  - Solo contenido público. Nada de invitados, tokens, respuestas ni pagos.
 *  - Límites de escenas, caracteres y tamaño viven aquí; ningún cliente los
 *    puede saltar porque el servidor vuelve a validar antes de guardar.
 *  - `schemaVersion` sube cuando cambia la forma del documento; cada versión
 *    publicada conserva soporte o tiene una migración explícita.
 *  - Las bodas creadas antes de este contrato siguen funcionando mediante el
 *    adaptador v1 (`documentFromLegacy`) a partir de `weddings.page_config`.
 *
 * Este módulo es puro (sin "server-only", sin Supabase): el wizard lo usa en
 * el navegador para el preview.
 */
import { z } from "zod";
import { PLACE_ID_PATTERN } from "./places/places";
import { pageConfigSchema, isValidWeddingDate, type WeddingPageConfig } from "./wedding-settings";
import type { BuilderDraft } from "./wedding-builder";
import { whatsappNumber } from "./whatsapp-number";

export const SITE_SCHEMA_VERSION = 1 as const;
export const SITE_TEMPLATE_ID = "papel-calido" as const;
export const SITE_TEMPLATE_VERSION = 1 as const;
export const SITE_LOCALE = "es-ES" as const;
export const SITE_THEME_IDS = ["editorial", "clasico", "natural"] as const;
export type SiteThemeId = (typeof SITE_THEME_IDS)[number];

// ---------------------------------------------------------------------------
// Paletas curadas (colores cambiables de la web)
// ---------------------------------------------------------------------------

/**
 * Paletas de color de la web. `themeId` sigue siendo el estilo base (3
 * valores: tipografía y compatibilidad con `page_config.style`); `palette`
 * es opcional y solo cambia los colores. Sin `palette`, la web usa la paleta
 * con el mismo id que `themeId` (las 3 primeras son idénticas a
 * `WEDDING_PAGE_THEMES`).
 *
 * Todas cumplen WCAG AA verificado por test: tinta sobre papel ≥ 7:1 y
 * acento sobre papel ≥ 4.5:1.
 */
export const SITE_PALETTE_IDS = ["editorial", "clasico", "natural", "terracota", "rosa", "mar", "lavanda", "oro"] as const;
export type SitePaletteId = (typeof SITE_PALETTE_IDS)[number];

export interface SitePalette {
  id: SitePaletteId;
  /** Nombre visible (es-ES). */
  label: string;
  paper: string;
  ink: string;
  accent: string;
  surface: string;
}

export const SITE_PALETTES: readonly SitePalette[] = [
  { id: "editorial", label: "Editorial", paper: "#f6f2ed", ink: "#28221f", accent: "#9e3b22", surface: "#ebe3da" },
  { id: "clasico", label: "Clásico", paper: "#fffdf8", ink: "#2c3043", accent: "#8a703d", surface: "#f1ede3" },
  { id: "natural", label: "Natural", paper: "#f4f5ec", ink: "#293b30", accent: "#52734c", surface: "#e5eadb" },
  { id: "terracota", label: "Terracota", paper: "#f8efe6", ink: "#2e1f18", accent: "#a0432a", surface: "#efdfd0" },
  { id: "rosa", label: "Rosa empolvado", paper: "#faf1ef", ink: "#2f1f24", accent: "#9a3d55", surface: "#f1dfdc" },
  { id: "mar", label: "Azul mar", paper: "#f1f4f5", ink: "#1c2a33", accent: "#2f5f78", surface: "#dfe8ec" },
  { id: "lavanda", label: "Lavanda", paper: "#f5f2f7", ink: "#272233", accent: "#5f4b8b", surface: "#e7e1ee" },
  { id: "oro", label: "Oro viejo", paper: "#f3efe7", ink: "#1d2230", accent: "#7a5a1f", surface: "#e6dfd2" },
];

const PALETTE_BY_ID = new Map<string, SitePalette>(SITE_PALETTES.map((p) => [p.id, p]));

export function isSitePaletteId(value: unknown): value is SitePaletteId {
  return typeof value === "string" && PALETTE_BY_ID.has(value);
}

export function getSitePalette(id: SitePaletteId): SitePalette {
  return PALETTE_BY_ID.get(id) ?? SITE_PALETTES[0]!;
}

/**
 * Apertura de la web (opcional, independiente del tema y la paleta).
 * "sobre": el invitado abre un sobre lacrado (relieve floral) con las
 * iniciales antes de ver la portada; "sobre-liso": el mismo sobre, liso;
 * "ninguno": la web abre directa en la portada (elección explícita).
 *
 * Sin la clave = "sobre" (8-oct-2026): la landing promete el sobre y las webs
 * creadas no guardaban la apertura. Quien elige «Directa» guarda "ninguno";
 * así una ausencia nunca se confunde con una elección.
 */
export const SITE_OPENING_IDS = ["sobre", "sobre-liso", "ninguno"] as const;
export type SiteOpeningId = (typeof SITE_OPENING_IDS)[number];
/** Apertura cuando el documento no dice nada. */
export const DEFAULT_OPENING: SiteOpeningId = "sobre";

/** Apertura efectiva del documento (sin `opening` = el sobre floral). */
export function resolveOpening(doc: Pick<SiteDocument, "opening">): SiteOpeningId {
  return doc.opening ?? DEFAULT_OPENING;
}

/**
 * Maqueta de la web (opcional, independiente del tema, la paleta y la
 * apertura). "historia": una escena por pantalla (reproductor Story, lo de
 * siempre). "web": las mismas escenas como una página de scroll largo con
 * movimiento ligado al scroll. Sin la clave = "historia": los documentos
 * guardados antes no cambian su JSON canónico.
 */
export const SITE_LAYOUT_IDS = ["historia", "web"] as const;
export type SiteLayoutId = (typeof SITE_LAYOUT_IDS)[number];

/** Maqueta efectiva del documento (sin `layout` = "historia"). */
export function resolveLayout(doc: Pick<SiteDocument, "layout">): SiteLayoutId {
  return doc.layout ?? "historia";
}

/**
 * ¿Puede la pareja elegir «Como una Story»? Desde el 13-oct-2026 es Premium
 * (aún sin venta): con plan Premium, sí; sin él, solo la conserva quien ya la
 * tiene guardada (los documentos antiguos sin `layout` también son Story).
 */
export function storyLayoutAvailable(premium: boolean, saved: Pick<SiteDocument, "layout">): boolean {
  return premium || resolveLayout(saved) === "historia";
}

/**
 * Cambia la maqueta. "historia" es lo de siempre: se guarda sin la clave (JSON
 * canónico intacto). Al pasar a web se quita también el ritmo de la Story
 * (`storySeconds`): ahí no aplica y volver a la Story arranca en 6 s.
 */
export function withSiteLayout(doc: SiteDocument, layout: SiteLayoutId): SiteDocument {
  const next = { ...doc };
  delete next.layout;
  if (layout !== "web") return next;
  delete next.storySeconds;
  return { ...next, layout };
}

/** Autoavance de la Story: segundos por escena (por defecto y límites del contrato). */
export const DEFAULT_STORY_SECONDS = 6;
export const STORY_SECONDS_MIN = 3;
export const STORY_SECONDS_MAX = 15;

/** Segundos por escena efectivos (sin `storySeconds` = 6). */
export function resolveStorySeconds(doc: Pick<SiteDocument, "storySeconds">): number {
  return doc.storySeconds ?? DEFAULT_STORY_SECONDS;
}

/** Paleta efectiva del documento: `palette` si existe; si no, la de `themeId`. */
export function resolvePalette(doc: Pick<SiteDocument, "themeId" | "palette">): SitePalette {
  return getSitePalette(doc.palette ?? doc.themeId);
}

/**
 * Presupuesto del documento serializado (JSONB en la revisión). 48 KB: un
 * documento con todas las escenas v2 al máximo ronda los 40 KB; la BD corta
 * en 64 KB (check de wedding_sites y site_document_issue).
 */
export const SITE_DOCUMENT_MAX_BYTES = 48 * 1024;
export const SITE_MAX_SCENES = 14;
export const SITE_MAX_AGENDA_ITEMS = 40;
/** Escenas v2 (6-oct-2026, estilo cordially.io/demo): topes por escena. */
export const SITE_MAX_STORY_CHAPTERS = 6;
export const SITE_MAX_CHAPTER_IMAGES = 4;
export const SITE_MAX_GALLERY_IMAGES = 12;
export const SITE_MAX_DETAIL_CARDS = 8;
export const SITE_MAX_FAQ_ITEMS = 12;
/** Módulos (8-oct-2026): autobuses, alojamiento y preguntas del formulario. */
export const SITE_MAX_BUS_STOPS = 8;
export const SITE_MAX_HOTELS = 6;
export const SITE_MAX_MENU_OPTIONS = 6;

// ---------------------------------------------------------------------------
// Tipos básicos
// ---------------------------------------------------------------------------

const sceneId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "Identificador de escena no válido.");
const shortText = (max: number, message: string) => z.string().trim().max(max, message);
const timeLabel = z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/, "Elegid una hora válida.").default("");

const civilDate = z
  .string()
  .refine((v) => v === "" || isValidWeddingDate(v), "Elegid una fecha válida.")
  .default("");

/**
 * Imagen ya alojada (Storage o URL remota aprobada). Nunca base64 ni otros
 * esquemas: solo `https:` (rechaza `data:`, `javascript:`, `http:`, incluido
 * `http://localhost`). Si el Storage local va por http, el preview de dev no
 * muestra la foto; es preferible a dejar pasar esquemas peligrosos.
 */
export const sceneImageSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }).trim().max(2048),
  alt: shortText(160, "El texto alternativo puede tener hasta 160 caracteres.").default(""),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(10_000).optional(),
  /** Pie de foto visible (historia, galería). Opcional y sin default: el JSON de las fotos de siempre no cambia. */
  caption: shortText(120, "El pie de foto puede tener hasta 120 caracteres.").optional(),
});
export type SceneImage = z.output<typeof sceneImageSchema>;

// ---------------------------------------------------------------------------
// Catálogo de escenas (fase 1: los bloques que ya existen en /b/[slug])
// ---------------------------------------------------------------------------

const coverScene = z.strictObject({
  id: sceneId,
  type: z.literal("cover"),
  enabled: z.literal(true).default(true),
  props: z.strictObject({
    partnerName1: shortText(80, "El nombre es demasiado largo.").default(""),
    partnerName2: shortText(80, "El nombre es demasiado largo.").default(""),
    weddingDate: civilDate,
    eyebrow: shortText(60, "El titular pequeño puede tener hasta 60 caracteres.").default("¡Nos casamos!"),
    welcomeMessage: shortText(400, "El mensaje puede tener hasta 400 caracteres.").default(""),
    image: sceneImageSchema.nullable().default(null),
    showCountdown: z.boolean().default(true),
  }),
});

const venueScene = z.strictObject({
  id: sceneId,
  type: z.literal("venue"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    venue: shortText(160, "El lugar puede tener hasta 160 caracteres.").default(""),
    address: shortText(240, "La dirección puede tener hasta 240 caracteres.").default(""),
    time: timeLabel,
    /**
     * place_id de Google del lugar elegido entre las sugerencias (8-oct-2026):
     * «Ver en el mapa» abre el sitio exacto. Opcional y sin default: el JSON
     * de las webs ya guardadas no cambia. Cambiar el nombre o la dirección a
     * mano lo quita (el editor y la IA), para no señalar un sitio antiguo.
     */
    placeId: z.string().regex(PLACE_ID_PATTERN, "El identificador del lugar no es válido.").optional(),
  }),
});

export const agendaItemSchema = z.strictObject({
  id: sceneId,
  title: shortText(120, "El título puede tener hasta 120 caracteres.").min(1, "Cada momento necesita un título."),
  timeLabel: shortText(20, "La hora es demasiado larga.").default(""),
  place: shortText(160, "El lugar puede tener hasta 160 caracteres.").default(""),
  address: shortText(240, "La dirección puede tener hasta 240 caracteres.").default(""),
  notes: shortText(400, "Las notas pueden tener hasta 400 caracteres.").default(""),
});
export type AgendaItem = z.output<typeof agendaItemSchema>;

const agendaScene = z.strictObject({
  id: sceneId,
  type: z.literal("agenda"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("El día de la boda"),
    items: z.array(agendaItemSchema).max(SITE_MAX_AGENDA_ITEMS, `Como máximo ${SITE_MAX_AGENDA_ITEMS} momentos.`).default([]),
  }),
});

/** Opción de menú que el invitado elige por persona (carne, pescado, vegetariano…). */
export const menuOptionSchema = z.strictObject({
  id: sceneId,
  label: shortText(60, "Cada opción de menú puede tener hasta 60 caracteres.").min(1, "Cada opción de menú necesita un nombre."),
});
export type MenuOption = z.output<typeof menuOptionSchema>;

export const RSVP_WHATSAPP_MAX = 24;
export const RSVP_WHATSAPP_INVALID = "Escribid un móvil válido: 612 345 678, o con prefijo, +34 612 345 678.";

const rsvpScene = z.strictObject({
  id: sceneId,
  type: z.literal("rsvp"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Confirma tu asistencia"),
    body: shortText(200, "El texto puede tener hasta 200 caracteres.").default("Nos ayuda mucho saber cuántos seréis."),
    // Preguntas opcionales del formulario (8-oct-2026). Sin default: el JSON
    // de las webs ya guardadas no cambia; ausente = apagada.
    /** «Una canción que no puede faltar». */
    song: z.boolean().optional(),
    /** «¿Cuántos de vosotros sois niños?». */
    kids: z.boolean().optional(),
    /** Opciones de menú; vacío o ausente = sin pregunta de menú. */
    menuOptions: z.array(menuOptionSchema).max(SITE_MAX_MENU_OPTIONS, `Como máximo ${SITE_MAX_MENU_OPTIONS} opciones de menú.`).optional(),
    /**
     * WhatsApp de la pareja (18-oct-2026): con el enlace general, el
     * invitado ve «Pedir mi invitación» y les escribe. Opcional y sin
     * default; se publica con la web, así que lo ve cualquiera con el enlace.
     */
    whatsapp: z.string().trim().max(RSVP_WHATSAPP_MAX, RSVP_WHATSAPP_INVALID).refine((value) => whatsappNumber(value) !== null, RSVP_WHATSAPP_INVALID).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Escenas v2 (6-oct-2026): la web de cada pareja al estilo cordially.io/demo.
// Todas opcionales, repetibles y sin datos inventados: cada texto lo escribe
// la pareja (los defaults son títulos de sección, no contenido).
// ---------------------------------------------------------------------------

/** Capítulo de «vuestra historia»: título, texto y hasta 4 fotos apiladas. */
export const storyChapterSchema = z.strictObject({
  id: sceneId,
  title: shortText(80, "El título del capítulo puede tener hasta 80 caracteres.").default(""),
  body: shortText(600, "El texto del capítulo puede tener hasta 600 caracteres.").default(""),
  images: z.array(sceneImageSchema).max(SITE_MAX_CHAPTER_IMAGES, `Como máximo ${SITE_MAX_CHAPTER_IMAGES} fotos por capítulo.`).default([]),
});
export type StoryChapter = z.output<typeof storyChapterSchema>;

const storyScene = z.strictObject({
  id: sceneId,
  type: z.literal("story"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Nuestra historia"),
    /** Frase de entrada (p. ej. «Os invitamos a celebrar la historia de…»). */
    intro: shortText(200, "La frase de entrada puede tener hasta 200 caracteres.").default(""),
    chapters: z.array(storyChapterSchema).max(SITE_MAX_STORY_CHAPTERS, `Como máximo ${SITE_MAX_STORY_CHAPTERS} capítulos.`).default([]),
  }),
});

/** Fotos sueltas: en la web, un collage que se mueve con el scroll. */
const galleryScene = z.strictObject({
  id: sceneId,
  type: z.literal("gallery"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default(""),
    images: z.array(sceneImageSchema).max(SITE_MAX_GALLERY_IMAGES, `Como máximo ${SITE_MAX_GALLERY_IMAGES} fotos.`).default([]),
  }),
});

/** Tarjeta de detalles (viaje y alojamiento, dress code, menú…): libre. */
export const detailCardSchema = z.strictObject({
  id: sceneId,
  title: shortText(80, "El título puede tener hasta 80 caracteres.").min(1, "Cada tarjeta necesita un título."),
  teaser: shortText(120, "El resumen puede tener hasta 120 caracteres.").default(""),
  body: shortText(800, "El texto puede tener hasta 800 caracteres.").default(""),
  /** Enlace opcional (solo https): hotel, mapa, lista… */
  link: z.url({ protocol: /^https$/ }).trim().max(2048).optional(),
  linkLabel: shortText(40, "El texto del enlace puede tener hasta 40 caracteres.").default(""),
});
export type DetailCard = z.output<typeof detailCardSchema>;

const detailsScene = z.strictObject({
  id: sceneId,
  type: z.literal("details"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Algunos detalles más"),
    intro: shortText(200, "La frase de entrada puede tener hasta 200 caracteres.").default(""),
    cards: z.array(detailCardSchema).max(SITE_MAX_DETAIL_CARDS, `Como máximo ${SITE_MAX_DETAIL_CARDS} tarjetas.`).default([]),
  }),
});

export const faqItemSchema = z.strictObject({
  id: sceneId,
  question: shortText(160, "La pregunta puede tener hasta 160 caracteres.").min(1, "Cada pregunta necesita texto."),
  answer: shortText(800, "La respuesta puede tener hasta 800 caracteres.").default(""),
});
export type FaqItem = z.output<typeof faqItemSchema>;

const faqScene = z.strictObject({
  id: sceneId,
  type: z.literal("faq"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Preguntas y respuestas"),
    /** Texto de contacto bajo el título (p. ej. «¿Otra duda? Escribidnos»). */
    contact: shortText(160, "El texto de contacto puede tener hasta 160 caracteres.").default(""),
    items: z.array(faqItemSchema).max(SITE_MAX_FAQ_ITEMS, `Como máximo ${SITE_MAX_FAQ_ITEMS} preguntas.`).default([]),
  }),
});

/** Parada de autobús de ida: dónde y a qué hora sale. */
export const busStopSchema = z.strictObject({
  id: sceneId,
  name: shortText(80, "La parada puede tener hasta 80 caracteres.").min(1, "Cada parada necesita un nombre."),
  time: timeLabel,
  place: shortText(160, "El punto de recogida puede tener hasta 160 caracteres.").default(""),
});
export type BusStop = z.output<typeof busStopSchema>;

/** Autobuses: se muestran en la web y el formulario pregunta quién los usa. */
const transportScene = z.strictObject({
  id: sceneId,
  type: z.literal("transport"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Autobuses"),
    intro: shortText(200, "La frase de entrada puede tener hasta 200 caracteres.").default(""),
    stops: z.array(busStopSchema).max(SITE_MAX_BUS_STOPS, `Como máximo ${SITE_MAX_BUS_STOPS} paradas.`).default([]),
    /** Vuelta: horarios y punto, en texto libre («01:00 y 03:30 desde la finca»). */
    returnNote: shortText(200, "La vuelta puede tener hasta 200 caracteres.").default(""),
    /** Preguntar en el formulario si usarán el autobús. */
    ask: z.boolean().default(true),
  }),
});

/** Hotel recomendado por la pareja (con o sin código de descuento). */
export const hotelSchema = z.strictObject({
  id: sceneId,
  name: shortText(80, "El hotel puede tener hasta 80 caracteres.").min(1, "Cada hotel necesita un nombre."),
  note: shortText(300, "La nota puede tener hasta 300 caracteres.").default(""),
  code: shortText(40, "El código puede tener hasta 40 caracteres.").default(""),
  /** Reservar antes de (fecha civil) o vacío. */
  bookBy: civilDate,
  link: z.url({ protocol: /^https$/ }).trim().max(2048).optional(),
});
export type Hotel = z.output<typeof hotelSchema>;

/** Alojamiento: hoteles en la web y, si la pareja quiere, «¿dónde te alojas?». */
const stayScene = z.strictObject({
  id: sceneId,
  type: z.literal("stay"),
  enabled: z.boolean().default(true),
  props: z.strictObject({
    title: shortText(80, "El título puede tener hasta 80 caracteres.").default("Dónde alojarse"),
    intro: shortText(200, "La frase de entrada puede tener hasta 200 caracteres.").default(""),
    hotels: z.array(hotelSchema).max(SITE_MAX_HOTELS, `Como máximo ${SITE_MAX_HOTELS} hoteles.`).default([]),
    /** Preguntar en el formulario dónde se aloja cada invitado. */
    ask: z.boolean().default(true),
  }),
});

export const sceneSchema = z.discriminatedUnion("type", [coverScene, venueScene, agendaScene, rsvpScene, storyScene, galleryScene, detailsScene, faqScene, transportScene, stayScene]);
export type Scene = z.output<typeof sceneSchema>;
export type SceneType = Scene["type"];
export type SceneOf<T extends SceneType> = Extract<Scene, { type: T }>;
export const SCENE_TYPES = ["cover", "venue", "agenda", "rsvp", "story", "gallery", "details", "faq", "transport", "stay"] as const satisfies readonly SceneType[];
/** Escenas v2 (las que la pareja puede añadir desde el editor). */
export const CONTENT_SCENE_TYPES = ["story", "gallery", "details", "faq", "transport", "stay"] as const satisfies readonly SceneType[];
export type ContentSceneType = (typeof CONTENT_SCENE_TYPES)[number];

/** Escenas que solo pueden aparecer una vez. */
const SINGLETON_SCENES: ReadonlySet<SceneType> = new Set(["cover", "rsvp", "transport", "stay"]);

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

export const siteDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    templateId: z.literal(SITE_TEMPLATE_ID),
    templateVersion: z.literal(SITE_TEMPLATE_VERSION),
    themeId: z.enum(SITE_THEME_IDS).default("editorial"),
    /** Opcional y sin default: los documentos guardados antes no cambian su JSON canónico. */
    palette: z.enum(SITE_PALETTE_IDS).optional(),
    /** Igual que `palette`: opcional y sin default. */
    opening: z.enum(SITE_OPENING_IDS).optional(),
    /** Igual que `palette`: opcional y sin default ("historia" si falta). */
    layout: z.enum(SITE_LAYOUT_IDS).optional(),
    /**
     * Segundos por escena del autoavance de la Story (13-oct-2026). Opcional
     * y sin default (6 s si falta, DEFAULT_STORY_SECONDS): los documentos
     * guardados antes no cambian su JSON canónico. Sin efecto en la web.
     */
    storySeconds: z.number().int().min(STORY_SECONDS_MIN).max(STORY_SECONDS_MAX).optional(),
    locale: z.literal(SITE_LOCALE).default(SITE_LOCALE),
    scenes: z.array(sceneSchema).min(1, "La web necesita al menos la portada.").max(SITE_MAX_SCENES, `Como máximo ${SITE_MAX_SCENES} escenas.`),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    const seenTypes = new Set<SceneType>();
    doc.scenes.forEach((scene, index) => {
      if (ids.has(scene.id)) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "id"], message: "Hay dos escenas con el mismo identificador." });
      }
      ids.add(scene.id);
      if (SINGLETON_SCENES.has(scene.type) && seenTypes.has(scene.type)) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "type"], message: `Solo puede haber una escena «${scene.type}».` });
      }
      seenTypes.add(scene.type);
    });
    if (doc.scenes[0]?.type !== "cover") {
      ctx.addIssue({ code: "custom", path: ["scenes", 0], message: "La primera escena debe ser la portada." });
    }
  });

export type SiteDocument = z.output<typeof siteDocumentSchema>;
export type SiteDocumentInput = z.input<typeof siteDocumentSchema>;

export type SiteDocumentIssue = { path: string; message: string };
export type ParseResult = { ok: true; document: SiteDocument } | { ok: false; issues: SiteDocumentIssue[] };

/**
 * Valida un documento recibido de cualquier cliente. Comprueba la forma, las
 * reglas de catálogo y el presupuesto de tamaño; nunca lanza.
 */
export function parseSiteDocument(input: unknown): ParseResult {
  const parsed = siteDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const bytes = documentByteSize(parsed.data);
  if (bytes > SITE_DOCUMENT_MAX_BYTES) {
    return { ok: false, issues: [{ path: "", message: `El contenido ocupa ${bytes} bytes; el máximo es ${SITE_DOCUMENT_MAX_BYTES}.` }] };
  }
  return { ok: true, document: parsed.data };
}

export function documentByteSize(doc: SiteDocument): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/**
 * Requisitos para publicar (más estrictos que para guardar un borrador):
 * nombres y fecha reales en la portada.
 */
export function publishIssues(doc: SiteDocument): SiteDocumentIssue[] {
  const issues: SiteDocumentIssue[] = [];
  const cover = findScene(doc, "cover");
  if (!cover) {
    issues.push({ path: "scenes", message: "Falta la portada." });
    return issues;
  }
  if (cover.props.partnerName1.length < 2 || cover.props.partnerName2.length < 2) {
    issues.push({ path: "scenes.0.props", message: "Escribid los dos nombres antes de publicar." });
  }
  if (!cover.props.weddingDate) {
    issues.push({ path: "scenes.0.props.weddingDate", message: "Elegid la fecha de la boda antes de publicar." });
  }
  return issues;
}

export function findScene<T extends SceneType>(doc: SiteDocument, type: T): SceneOf<T> | undefined {
  return doc.scenes.find((s): s is SceneOf<T> => s.type === type);
}

export function enabledScenes(doc: SiteDocument): Scene[] {
  return doc.scenes.filter((s) => s.enabled);
}

/**
 * Todas las imágenes del documento (portada, capítulos, galería), en orden.
 * Es la única lista que el servidor usa para validar pertenencia, firmar
 * previews y copiar al bucket público al publicar: una escena nueva con
 * fotos debe entrar aquí o sus fotos no se publicarán.
 */
export function collectImages(doc: SiteDocument): SceneImage[] {
  const out: SceneImage[] = [];
  for (const scene of doc.scenes) {
    switch (scene.type) {
      case "cover":
        if (scene.props.image) out.push(scene.props.image);
        break;
      case "story":
        for (const chapter of scene.props.chapters) out.push(...chapter.images);
        break;
      case "gallery":
        out.push(...scene.props.images);
        break;
      case "venue":
      case "agenda":
      case "rsvp":
      case "details":
      case "faq":
      case "transport":
      case "stay":
        break;
      default: {
        const exhaustive: never = scene;
        return exhaustive;
      }
    }
  }
  return out;
}

/**
 * Copia del documento con cada imagen pasada por `fn` (null = quitarla).
 * Puro: no muta el original. Mismo recorrido que `collectImages`.
 */
export function mapImages(doc: SiteDocument, fn: (image: SceneImage) => SceneImage | null): SiteDocument {
  const list = (images: SceneImage[]) => images.map(fn).filter((i): i is SceneImage => i !== null);
  return {
    ...doc,
    scenes: doc.scenes.map((scene): Scene => {
      switch (scene.type) {
        case "cover":
          return { ...scene, props: { ...scene.props, image: scene.props.image ? fn(scene.props.image) : null } };
        case "story":
          return { ...scene, props: { ...scene.props, chapters: scene.props.chapters.map((c) => ({ ...c, images: list(c.images) })) } };
        case "gallery":
          return { ...scene, props: { ...scene.props, images: list(scene.props.images) } };
        default:
          return scene;
      }
    }),
  };
}

/**
 * Plantillas sin rellenar (8-oct-2026): el creador deja preguntas y tarjetas
 * con solo el título para que la pareja las complete en el panel. Hasta que
 * tengan respuesta o texto, el invitado no las ve (ni la escena, si no queda
 * nada). Lo mismo para capítulos vacíos.
 */
export function faqItemHasAnswer(item: FaqItem): boolean {
  return item.answer.trim().length > 0;
}
export function detailCardHasContent(card: DetailCard): boolean {
  return Boolean(card.teaser.trim() || card.body.trim() || card.link);
}
export function storyChapterHasContent(chapter: StoryChapter): boolean {
  return Boolean(chapter.title.trim() || chapter.body.trim() || chapter.images.length > 0);
}

/**
 * La escena tal como la ve el invitado: sin preguntas sin responder, sin
 * tarjetas solo con título y sin capítulos vacíos. El resto, igual. Puro.
 */
export function guestVisibleScene<T extends Scene>(scene: T): T {
  switch (scene.type) {
    case "faq":
      return { ...scene, props: { ...scene.props, items: scene.props.items.filter(faqItemHasAnswer) } };
    case "details":
      return { ...scene, props: { ...scene.props, cards: scene.props.cards.filter(detailCardHasContent) } };
    case "story":
      return { ...scene, props: { ...scene.props, chapters: scene.props.chapters.filter(storyChapterHasContent) } };
    default:
      return scene;
  }
}

/** ¿Tiene la escena algo que enseñar? Las v2 vacías (o solo con plantillas) no se pintan. */
export function sceneHasContent(scene: Scene): boolean {
  switch (scene.type) {
    case "cover":
    case "rsvp":
      return true;
    case "venue":
      return Boolean(scene.props.venue || scene.props.address || scene.props.time);
    case "agenda":
      return scene.props.items.length > 0;
    case "story":
      return scene.props.chapters.some(storyChapterHasContent);
    case "gallery":
      return scene.props.images.length > 0;
    case "details":
      return scene.props.cards.some(detailCardHasContent);
    case "faq":
      return scene.props.items.some(faqItemHasAnswer);
    case "transport":
      return scene.props.stops.length > 0 || Boolean(scene.props.returnNote || scene.props.intro);
    case "stay":
      return scene.props.hotels.length > 0;
    default: {
      const exhaustive: never = scene;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Adaptador v1: bodas existentes (columnas + page_config) → documento
// ---------------------------------------------------------------------------

/** Filas tal como las expone hoy `weddings_public` + agenda publicada. */
export interface LegacyWeddingSource {
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  cover_image_url: string | null;
  page_config: Partial<WeddingPageConfig> | null | undefined;
  agenda?: ReadonlyArray<{
    id: string;
    title: string;
    time_label: string | null;
    place: string | null;
    address: string | null;
    notes: string | null;
  }>;
}

/** Ids estables para las escenas del adaptador; el editor las conserva. */
export const LEGACY_SCENE_IDS = { cover: "portada", venue: "lugar", rsvp: "asistencia", agenda: "programa" } as const;

/**
 * Convierte una boda anterior al contrato en un documento equivalente. Es
 * determinista y no pierde información: el renderer muestra exactamente lo
 * que la página pública mostraba antes de la fase 1.
 */
export function documentFromLegacy(source: LegacyWeddingSource): SiteDocument {
  const config = pageConfigSchema.safeParse(source.page_config ?? {});
  const page = config.success ? config.data : pageConfigSchema.parse({});
  const weddingDate = source.wedding_date && isValidWeddingDate(source.wedding_date) ? source.wedding_date : "";
  // La imagen solo entra si cumple el contrato completo (https, ≤ 2048):
  // una URL rara en `cover_image_url` degrada al monograma, nunca lanza.
  const imageCandidate = source.cover_image_url
    ? sceneImageSchema.safeParse({ url: source.cover_image_url, alt: `Foto de ${source.partner_name_1} y ${source.partner_name_2}`.slice(0, 160) })
    : null;
  const image = imageCandidate?.success ? imageCandidate.data : null;
  const agendaItems: AgendaItem[] = (source.agenda ?? []).slice(0, SITE_MAX_AGENDA_ITEMS).map((row, index) => ({
    id: legacyAgendaItemId(row.id, index),
    title: (row.title ?? "").trim().slice(0, 120) || "Momento",
    timeLabel: (row.time_label ?? "").slice(0, 20),
    place: (row.place ?? "").slice(0, 160),
    address: (row.address ?? "").slice(0, 240),
    notes: (row.notes ?? "").slice(0, 400),
  }));

  const input: SiteDocumentInput = {
    schemaVersion: SITE_SCHEMA_VERSION,
    templateId: SITE_TEMPLATE_ID,
    templateVersion: SITE_TEMPLATE_VERSION,
    themeId: page.style,
    locale: SITE_LOCALE,
    scenes: [
      {
        id: LEGACY_SCENE_IDS.cover,
        type: "cover",
        enabled: true,
        props: {
          partnerName1: source.partner_name_1.trim().slice(0, 80),
          partnerName2: source.partner_name_2.trim().slice(0, 80),
          weddingDate,
          welcomeMessage: page.welcomeMessage,
          image,
          showCountdown: true,
        },
      },
      {
        id: LEGACY_SCENE_IDS.venue,
        type: "venue",
        enabled: Boolean(page.venue || page.address || page.time),
        props: { venue: page.venue, address: page.address, time: page.time, ...(page.placeId ? { placeId: page.placeId } : {}) },
      },
      // El programa antes de la asistencia: la asistencia cierra la web (8-oct-2026).
      { id: LEGACY_SCENE_IDS.agenda, type: "agenda", enabled: agendaItems.length > 0, props: { items: agendaItems } },
      { id: LEGACY_SCENE_IDS.rsvp, type: "rsvp", enabled: true, props: {} },
    ],
  };
  // El adaptador construye un documento válido por construcción; si no lo
  // fuera sería un bug del adaptador, no un dato del usuario.
  return siteDocumentSchema.parse(input);
}

/** Un id de fila (uuid) no cumple el patrón de sceneId; se deriva uno estable. */
function legacyAgendaItemId(rowId: string, index: number): string {
  const compact = rowId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  return `m-${compact || index}`;
}

/** Borrador local del wizard (sin guardar) → documento para el preview. */
export function documentFromBuilderDraft(draft: BuilderDraft): SiteDocument {
  return documentFromLegacy({
    partner_name_1: draft.partnerName1,
    partner_name_2: draft.partnerName2,
    wedding_date: isValidWeddingDate(draft.weddingDate) ? draft.weddingDate : null,
    cover_image_url: null,
    page_config: { style: draft.style, welcomeMessage: draft.welcomeMessage, venue: draft.venue, address: draft.address, time: draft.time, ...(draft.venuePlaceId ? { placeId: draft.venuePlaceId } : {}) },
  });
}

/**
 * Fusiona el estado recién guardado del modelo antiguo (ajustes + agenda →
 * `legacy`, salido de `documentFromLegacy`) con el borrador actual, de modo
 * que ajustes y agenda alimenten el borrador sin pisar lo que el modelo
 * antiguo no conoce:
 *  - orden de escenas y escenas que `legacy` no trae (futuras del editor);
 *  - `enabled`: cover siempre true; rsvp conserva el actual; venue/agenda
 *    siguen al contenido: sin contenido → false; si el contenido aparece por
 *    primera vez → true; si ya había contenido → se respeta lo que la pareja
 *    había decidido;
 *  - portada: `eyebrow`, `showCountdown` e `image` del borrador (la foto se
 *    edita solo en el borrador; `cover_image_url` es la proyección de lo
 *    publicado y no debe devolver una foto que la pareja quitó);
 *  - rsvp: `title` y `body`; agenda: `title` (los items vienen de la agenda).
 * Puro y determinista; nunca lanza (si la fusión no validase, devuelve `legacy`).
 */
export function mergeLegacyIntoDocument(current: SiteDocument | null, legacy: SiteDocument): SiteDocument {
  if (!current) return legacy;
  const used = new Set<string>();
  const pick = (scene: Scene): Scene | undefined => {
    const match = current.scenes.find((s) => s.id === scene.id && !used.has(s.id)) ?? current.scenes.find((s) => s.type === scene.type && !used.has(s.id));
    if (match) used.add(match.id);
    return match;
  };

  // id del borrador actual → escena fusionada; lo que legacy trae de nuevo va al final.
  const replacementFor = new Map<string, Scene>();
  const unmatched: Scene[] = [];
  for (const scene of legacy.scenes) {
    const prev = pick(scene);
    if (prev) replacementFor.set(prev.id, mergeScene(prev, scene));
    else unmatched.push(scene);
  }
  // Orden del borrador actual (conservando escenas que legacy no conoce).
  const ordered: Scene[] = current.scenes.map((prev) => replacementFor.get(prev.id) ?? prev);
  ordered.push(...unmatched);

  // `palette`, `opening`, `layout` y `storySeconds` no existen en el modelo antiguo: se conservan las del borrador.
  const candidate = {
    ...legacy,
    ...(current.palette ? { palette: current.palette } : {}),
    ...(current.opening ? { opening: current.opening } : {}),
    ...(current.layout ? { layout: current.layout } : {}),
    ...(current.storySeconds ? { storySeconds: current.storySeconds } : {}),
    scenes: ordered,
  };
  const parsed = siteDocumentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : legacy;
}

function mergeScene(prev: Scene, next: Scene): Scene {
  if (prev.type !== next.type) return next;
  switch (next.type) {
    case "cover": {
      const p = prev as SceneOf<"cover">;
      return { ...next, props: { ...next.props, eyebrow: p.props.eyebrow, showCountdown: p.props.showCountdown, image: p.props.image } };
    }
    case "rsvp": {
      const p = prev as SceneOf<"rsvp">;
      // Todo lo del borrador (título, texto y preguntas opcionales) se conserva.
      return { ...next, enabled: p.enabled, props: { ...next.props, ...p.props } };
    }
    case "venue": {
      const p = prev as SceneOf<"venue">;
      const hadContent = Boolean(p.props.venue || p.props.address || p.props.time);
      return { ...next, enabled: next.enabled ? (hadContent ? p.enabled : true) : false };
    }
    case "agenda": {
      const p = prev as SceneOf<"agenda">;
      const hadContent = p.props.items.length > 0;
      return { ...next, enabled: next.enabled ? (hadContent ? p.enabled : true) : false, props: { ...next.props, title: p.props.title } };
    }
    // El modelo antiguo no conoce las escenas v2: se conserva el borrador.
    case "story":
    case "gallery":
    case "details":
    case "faq":
    case "transport":
    case "stay":
      return prev;
  }
}

/**
 * Proyección inversa para mantener `weddings.page_config` coherente mientras
 * convivan ambos modelos (ajustes antiguos siguen leyendo page_config).
 */
export function legacyConfigFromDocument(doc: SiteDocument): WeddingPageConfig {
  const cover = findScene(doc, "cover");
  const venue = findScene(doc, "venue");
  return pageConfigSchema.parse({
    style: doc.themeId,
    welcomeMessage: cover?.props.welcomeMessage ?? "",
    venue: venue?.enabled ? venue.props.venue : "",
    address: venue?.enabled ? venue.props.address : "",
    time: venue?.enabled ? venue.props.time : "",
    ...(venue?.enabled && venue.props.placeId ? { placeId: venue.props.placeId } : {}),
  });
}
