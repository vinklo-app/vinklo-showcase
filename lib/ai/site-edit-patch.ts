/**
 * Parche de la edición con IA («pedid cambios por texto»).
 *
 * El modelo NUNCA devuelve un documento: devuelve un parche cerrado con los
 * únicos campos que puede tocar. Este módulo (puro, sin red) lo aplica sobre
 * el documento actual, descarta lo que pueda ser un dato inventado y deja la
 * validación final a `parseSiteDocument` (límites de lib/site-document.ts).
 *
 * Qué puede cambiar:
 *  - diseño: estilo base (`themeId`), paleta, maqueta (`layout`) y apertura
 *    (`opening`);
 *  - portada (titular pequeño, mensaje, cuenta atrás), lugar (nombre,
 *    dirección, hora), títulos de programa y asistencia;
 *  - contenido (plan 4.5, 8-oct-2026): momentos del programa (hora, título,
 *    sitio), capítulos de la historia (solo texto), tarjetas de detalles,
 *    preguntas frecuentes, paradas de autobús (nombre, hora, punto) y hoteles
 *    (nombre, nota, código, enlace), más el título y la frase de entrada de
 *    cada sección. Si la sección no existe, se crea (antes de la asistencia);
 *  - orden y visibilidad de las secciones.
 * Fuera por construcción: nombres, fecha, fotos (y sus pies), notas y
 * dirección de los momentos, «reservar antes de» de los hoteles y las
 * preguntas del formulario.
 *
 * Datos que no se pueden inventar (`fact-guard.ts`):
 *  - campos LITERALES (lugar, dirección, horas, paradas, hoteles, códigos,
 *    enlaces): solo un valor que la pareja escribió en la petición o que ya
 *    está en la web;
 *  - TEXTO LIBRE: se puede reescribir, pero cualquier número, mes, día de la
 *    semana, enlace o nombre propio nuevo debe salir de la petición, del
 *    texto anterior o de la web.
 * Lo descartado se informa al nivel más fino posible (un campo de un
 * elemento), nunca se descarta la sección entera por un dato.
 */
import { z } from "zod";
import {
  SITE_LAYOUT_IDS,
  SITE_OPENING_IDS,
  SITE_PALETTE_IDS,
  SITE_THEME_IDS,
  findScene,
  getSitePalette,
  mapImages,
  parseSiteDocument,
  resolveOpening,
  sceneHasContent,
  type Scene,
  type SceneType,
  type SiteDocument,
  type SiteDocumentIssue,
} from "@/lib/site-document";
import { collectText, introducesNewFacts, isKnownLiteral, monthName, weekdayName } from "./fact-guard";
import { NOT_POSSIBLE_KINDS, SITE_EDIT_MAX_INSTRUCTION, type AiScope } from "./messages";

export { instructionContains, normalizeForMatch } from "./fact-guard";

export { SITE_EDIT_MAX_INSTRUCTION };

/** Nombre visible de cada sección (igual que en «Vuestro contenido»). */
export const SECTION_LABELS: Record<SceneType, string> = {
  cover: "Portada",
  venue: "Lugar",
  agenda: "Programa",
  rsvp: "Confirmación",
  story: "Vuestra historia",
  gallery: "Fotos",
  details: "Detalles",
  faq: "Preguntas",
  transport: "Autobuses",
  stay: "Alojamiento",
};

/** Apertura en el parche: los mismos valores que el documento ("ninguno" = la web abre directa; sin clave = sobre). */
export const PATCH_OPENING_IDS = SITE_OPENING_IDS;

const itemId = z.string().nullable().describe("id del elemento que ya existe en la web; null si es nuevo.");
const LIST = "Lista COMPLETA y en orden: incluid tal cual los que no cambian y omitid los que hay que quitar. null = sin cambios.";
const text = (what: string) => z.string().nullable().describe(`${what}. null = sin cambios.`);
const SECTION = (label: string) => `Sección «${label}». null = no se toca. Si la web no la tiene y añadís contenido, se crea.`;

/**
 * Esquema de salida estructurada del modelo. Todas las claves son
 * obligatorias y `null` significa «sin cambios» (salida estricta: sin
 * opcionales ni claves dinámicas).
 */
export const sitePatchSchema = z.object({
  themeId: z.enum(SITE_THEME_IDS).nullable().describe("Estilo base (tipografía). null = sin cambios."),
  palette: z.enum(SITE_PALETTE_IDS).nullable().describe("Paleta de colores. null = sin cambios."),
  // Las claves siguen (salida estricta y clientes anteriores), pero desde el
  // 13-oct-2026 solo se acepta pasar a web y la apertura no se cambia.
  layout: z.enum(SITE_LAYOUT_IDS).nullable().describe("Maqueta: solo web (scroll largo) si la pareja lo pide; nunca historia. null = sin cambios."),
  opening: z.enum(PATCH_OPENING_IDS).nullable().describe("Apertura: siempre null (todas las invitaciones se abren con el sobre)."),
  coverEyebrow: z.string().nullable().describe("Titular pequeño de la portada (máx. 60 caracteres). null = sin cambios."),
  coverWelcomeMessage: z.string().nullable().describe("Mensaje de bienvenida (máx. 400 caracteres). null = sin cambios."),
  coverShowCountdown: z.boolean().nullable().describe("Mostrar la cuenta atrás. null = sin cambios."),
  venueName: z.string().nullable().describe("Nombre del lugar. Solo si la petición lo escribe literalmente. null = sin cambios."),
  venueAddress: z.string().nullable().describe("Dirección. Solo si la petición la escribe literalmente. null = sin cambios."),
  venueTime: z.string().nullable().describe("Hora HH:MM. Solo si la petición la escribe literalmente. null = sin cambios."),
  agendaTitle: z.string().nullable().describe("Título del programa (máx. 80). null = sin cambios."),
  agendaItems: z
    .array(z.object({ id: itemId, timeLabel: z.string().describe("Hora HH:MM o vacío"), title: z.string().describe("Máx. 120"), place: z.string().describe("Sitio, máx. 160; vacío si no se sabe") }))
    .nullable()
    .describe(`Momentos del programa. ${LIST}`),
  rsvpTitle: z.string().nullable().describe("Título de la confirmación de asistencia (máx. 80). null = sin cambios."),
  story: z
    .object({
      title: text("Título (máx. 80)"),
      intro: text("Frase de entrada (máx. 200)"),
      chapters: z.array(z.object({ id: itemId, title: z.string().describe("Máx. 80"), body: z.string().describe("Máx. 600") })).nullable().describe(`Capítulos (máx. 6), solo texto. ${LIST}`),
    })
    .nullable()
    .describe(SECTION(SECTION_LABELS.story)),
  details: z
    .object({
      title: text("Título (máx. 80)"),
      intro: text("Frase de entrada (máx. 200)"),
      cards: z
        .array(z.object({
          id: itemId,
          title: z.string().describe("Máx. 80"),
          teaser: z.string().describe("Resumen visible con la tarjeta cerrada, máx. 120"),
          body: z.string().describe("Texto, máx. 800"),
          link: z.string().nullable().describe("Enlace https solo si la pareja lo escribe; \"\" = quitar; null = sin cambios"),
          linkLabel: z.string().describe("Texto del enlace, máx. 40"),
        }))
        .nullable()
        .describe(`Tarjetas (máx. 8). ${LIST}`),
    })
    .nullable()
    .describe(SECTION(SECTION_LABELS.details)),
  faq: z
    .object({
      title: text("Título (máx. 80)"),
      contact: text("Texto de contacto bajo el título (máx. 160)"),
      items: z.array(z.object({ id: itemId, question: z.string().describe("Máx. 160"), answer: z.string().describe("Máx. 800; vacío si la pareja no da la respuesta") })).nullable().describe(`Preguntas (máx. 12). ${LIST}`),
    })
    .nullable()
    .describe(SECTION(SECTION_LABELS.faq)),
  transport: z
    .object({
      title: text("Título (máx. 80)"),
      intro: text("Frase de entrada (máx. 200)"),
      returnNote: text("Vuelta: horarios y punto (máx. 200)"),
      stops: z.array(z.object({ id: itemId, name: z.string().describe("Parada, máx. 80"), time: z.string().describe("Hora HH:MM o vacío"), place: z.string().describe("Punto exacto, máx. 160") })).nullable().describe(`Paradas (máx. 8). ${LIST}`),
    })
    .nullable()
    .describe(SECTION(SECTION_LABELS.transport)),
  stay: z
    .object({
      title: text("Título (máx. 80)"),
      intro: text("Frase de entrada (máx. 200)"),
      hotels: z
        .array(z.object({
          id: itemId,
          name: z.string().describe("Hotel, máx. 80"),
          note: z.string().describe("Nota, máx. 300"),
          code: z.string().describe("Código de descuento, máx. 40, o vacío"),
          link: z.string().nullable().describe("Enlace https solo si la pareja lo escribe; \"\" = quitar; null = sin cambios"),
        }))
        .nullable()
        .describe(`Hoteles (máx. 6). ${LIST}`),
    })
    .nullable()
    .describe(SECTION(SECTION_LABELS.stay)),
  scenes: z
    .array(z.object({ id: z.string(), enabled: z.boolean() }))
    .nullable()
    .describe("Orden y visibilidad de TODAS las secciones por id. La portada va primera y siempre visible. null = sin cambios."),
  notPossible: z
    .array(z.enum(NOT_POSSIBLE_KINDS))
    .nullable()
    .describe("Partes de la petición que no se pueden hacer: names, date, photo, gallery (fotos o pies), rsvpQuestions (canción, niños, menú), guests, other. null si todo se puede."),
  summary: z.string().describe("Resumen breve en español de España (vosotros) de lo que cambia, o de por qué no se puede. Nunca uses la palabra «escena»."),
});
export type SitePatch = z.output<typeof sitePatchSchema>;

/** Parche sin cambios (base para tests y simulaciones). */
export const EMPTY_SITE_PATCH: SitePatch = {
  themeId: null, palette: null, layout: null, opening: null,
  coverEyebrow: null, coverWelcomeMessage: null, coverShowCountdown: null,
  venueName: null, venueAddress: null, venueTime: null,
  agendaTitle: null, agendaItems: null, rsvpTitle: null,
  story: null, details: null, faq: null, transport: null, stay: null,
  scenes: null, notPossible: null, summary: "",
};

export interface ApplyPatchOptions {
  /**
   * "all" (panel) y "creator" (creador, 13-oct-2026: el borrador local ya
   * guarda el contenido de las secciones): todo lo anterior. "design"
   * (clientes del creador anteriores a ese cambio): solo diseño, portada,
   * lugar, títulos y orden; el resto vuelve en `blocked`.
   */
  scope?: AiScope;
}

export type ApplyPatchResult =
  | {
      ok: true;
      document: SiteDocument;
      /** Qué cambia, en es-ES y legible: «Preguntas: + ¿Hay aparcamiento?». */
      changes: string[];
      /** Qué se descartó por posible dato inventado. */
      dropped: string[];
      /** Secciones pedidas que este ámbito no permite (creador). */
      blocked: string[];
      /** Lo que queda por completar a mano (p. ej. una respuesta vacía). */
      followUps: string[];
      /** Lo que la IA ya no puede cambiar (apertura, «Como una Story»). */
      refused: RefusedChange[];
    }
  | { ok: false; reason: "no_changes"; dropped: string[]; blocked: string[]; refused: RefusedChange[] }
  | { ok: false; reason: "invalid"; issues: SiteDocumentIssue[]; dropped: string[]; blocked: string[]; refused: RefusedChange[] };

/** Cambios de diseño que la IA no hace (13-oct-2026). */
export type RefusedChange = "layout" | "opening";

const LABELS = {
  themeId: "el estilo",
  palette: "los colores",
  layout: "la maqueta",
  opening: "la apertura",
  coverEyebrow: "el titular de la portada",
  coverWelcomeMessage: "el mensaje de bienvenida",
  coverShowCountdown: "la cuenta atrás",
  venueName: "el nombre del lugar",
  venueAddress: "la dirección",
  venueTime: "la hora",
  agendaTitle: "el título del programa",
  rsvpTitle: "el título de la confirmación",
  scenes: "el orden o la visibilidad de las secciones",
} as const;

const LAYOUT_LABELS = { historia: "Como una Story", web: "Como una web" } as const;

/** Lo que la web ya dice: todo su texto + mes y día de la semana de la fecha. */
function knownText(doc: SiteDocument): string {
  const parts = collectText(mapImages(doc, () => null).scenes);
  const cover = findScene(doc, "cover");
  if (cover?.props.weddingDate) {
    const date = new Date(`${cover.props.weddingDate}T12:00:00Z`);
    parts.push(monthName(date.getUTCMonth()), weekdayName(date.getUTCDay()), String(date.getUTCDate()));
  }
  return parts.join("\n");
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const cleanMultiline = (value: string) => value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const short = (value: string, max = 60) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** "18.30" / "18h30" / "9:00" → "18:30" / "09:00"; otra cosa se devuelve tal cual (y Zod la rechazará). */
function normalizeTime(value: string): string {
  const v = value.trim();
  if (v === "") return "";
  const m = /^(\d{1,2})\s*(?:[:.]|h)\s*(\d{2})$/i.exec(v);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : v;
}

/** Estado de una aplicación: cambios, descartes y comprobaciones de datos. */
class PatchContext {
  readonly changes: string[] = [];
  readonly dropped: string[] = [];
  readonly followUps: string[] = [];
  constructor(readonly instruction: string, readonly known: string) {}

  /** Texto libre: se acepta salvo que traiga datos nuevos; si no, queda `previous`. */
  free(value: string, previous: string, dropLabel: string, multiline = false): string {
    const v = multiline ? cleanMultiline(value) : clean(value);
    if (v === previous) return previous;
    if (introducesNewFacts(v, previous, this.instruction, this.known)) {
      this.dropped.push(dropLabel);
      return previous;
    }
    return v;
  }

  /** Literal: vaciar se permite; un valor nuevo debe estar en la petición o en la web. */
  literal(value: string, previous: string, dropLabel: string): string {
    const v = clean(value);
    if (v === previous) return previous;
    if (v !== "" && !isKnownLiteral(v, this.instruction, this.known)) {
      this.dropped.push(dropLabel);
      return previous;
    }
    return v;
  }

  /** Enlace: null = sin cambios, "" = quitar, otro = https literal. */
  link(value: string | null, previous: string | undefined, dropLabel: string): string | undefined {
    if (value === null) return previous;
    const v = value.trim();
    if (v === "") return undefined;
    if (v === previous) return previous;
    if (!/^https:\/\/\S+$/i.test(v) || !isKnownLiteral(v, this.instruction, this.known)) {
      this.dropped.push(dropLabel);
      return previous;
    }
    return v;
  }

  /** Título, frase de entrada… de una sección. */
  sectionText(section: string, what: string, value: string | null, previous: string): string {
    if (value === null) return previous;
    const article = what === "frase de entrada" || what === "vuelta" ? "la" : "el";
    const next = this.free(value, previous, `${article} ${what} de ${section}`);
    if (next !== previous) this.changes.push(next ? `${section}: ${what} «${short(next)}»` : `${section}: sin ${what}`);
    return next;
  }
}

/** Igualdad de elementos sin depender del orden de las claves. */
function sameItem(a: object, b: object): boolean {
  const canon = (o: object) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return canon(a) === canon(b);
}

/**
 * Funde la lista propuesta (completa) con la actual por id: conserva ids,
 * asigna ids nuevos en el servidor (el modelo no los inventa) y anota altas,
 * bajas, cambios y orden en `ctx.changes`.
 */
function mergeItems<T extends { id: string }, P extends { id: string | null }>(
  ctx: PatchContext,
  section: string,
  old: readonly T[],
  proposed: readonly P[],
  prefix: string,
  build: (item: P, prev: T | undefined) => Omit<T, "id"> | null,
  label: (item: T) => string,
): { items: T[]; added: number } {
  const byId = new Map(old.map((item) => [item.id, item]));
  const taken = new Set(old.map((item) => item.id));
  const used = new Set<string>();
  const items: T[] = [];
  const notes: string[] = [];
  let added = 0;
  for (const proposal of proposed) {
    const prev = proposal.id && byId.has(proposal.id) && !used.has(proposal.id) ? byId.get(proposal.id) : undefined;
    if (prev) used.add(prev.id);
    const built = build(proposal, prev);
    if (!built) continue;
    let id = prev?.id;
    if (!id) {
      for (let n = old.length + added + 1; !id || taken.has(id); n++) id = `${prefix}-${n}`;
      taken.add(id);
    }
    const item = { ...built, id } as T;
    items.push(item);
    if (!prev) {
      added++;
      notes.push(`${section}: + ${short(label(item))}`);
    } else if (!sameItem(item, prev)) {
      notes.push(`${section}: cambia «${short(label(item))}»`);
    }
  }
  for (const item of old) if (!used.has(item.id)) notes.push(`${section}: − ${short(label(item))}`);
  const keptBefore = old.filter((item) => used.has(item.id)).map((item) => item.id);
  const keptAfter = items.filter((item) => byId.has(item.id)).map((item) => item.id);
  if (keptBefore.join() !== keptAfter.join()) notes.push(`${section}: nuevo orden`);
  ctx.changes.push(...notes);
  return { items: notes.length > 0 ? items : [...old], added };
}

// ---------------------------------------------------------------------------
// Secciones de contenido
// ---------------------------------------------------------------------------

type ContentPatchKey = "agendaItems" | "story" | "details" | "faq" | "transport" | "stay";
const CONTENT_PATCH_TYPES: ReadonlyArray<[ContentPatchKey, SceneType]> = [
  ["agendaItems", "agenda"],
  ["story", "story"],
  ["details", "details"],
  ["faq", "faq"],
  ["transport", "transport"],
  ["stay", "stay"],
];
/** ids base de una sección nueva (los mismos que «Vuestro contenido»). */
const BASE_IDS: Partial<Record<SceneType, string>> = { agenda: "programa", story: "historia", details: "detalles", faq: "preguntas", transport: "autobuses", stay: "alojamiento" };

function newScene(type: SceneType, taken: Set<string>): Scene | null {
  const base = BASE_IDS[type];
  if (!base) return null;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  switch (type) {
    case "agenda": return { id, type, enabled: true, props: { title: "El día de la boda", items: [] } };
    case "story": return { id, type, enabled: true, props: { title: "Nuestra historia", intro: "", chapters: [] } };
    case "details": return { id, type, enabled: true, props: { title: "Algunos detalles más", intro: "", cards: [] } };
    case "faq": return { id, type, enabled: true, props: { title: "Preguntas y respuestas", contact: "", items: [] } };
    case "transport": return { id, type, enabled: true, props: { title: "Autobuses", intro: "", stops: [], returnNote: "", ask: true } };
    case "stay": return { id, type, enabled: true, props: { title: "Dónde alojarse", intro: "", hotels: [], ask: true } };
    default: return null;
  }
}

/** Aplica la parte de contenido del parche a su escena; devuelve cuántos elementos se añadieron. */
function applyContent(scene: Scene, patch: SitePatch, ctx: PatchContext): { scene: Scene; added: number } {
  switch (scene.type) {
    case "agenda": {
      if (!patch.agendaItems) return { scene, added: 0 };
      const S = SECTION_LABELS.agenda;
      const { items, added } = mergeItems(ctx, S, scene.props.items, patch.agendaItems, "m", (p, prev) => {
        const title = ctx.free(p.title, prev?.title ?? "", `el momento «${short(p.title)}»`);
        if (!title) return null;
        return {
          title,
          timeLabel: ctx.literal(normalizeTime(p.timeLabel), prev?.timeLabel ?? "", `la hora de «${short(title)}»`),
          place: ctx.literal(p.place, prev?.place ?? "", `el sitio de «${short(title)}»`),
          address: prev?.address ?? "",
          notes: prev?.notes ?? "",
        };
      }, (item) => (item.timeLabel ? `${item.timeLabel} ${item.title}` : item.title));
      return { scene: { ...scene, props: { ...scene.props, items } }, added };
    }
    case "story": {
      const p = patch.story;
      if (!p) return { scene, added: 0 };
      const S = SECTION_LABELS.story;
      const props = { ...scene.props };
      props.title = ctx.sectionText(S, "título", p.title, props.title);
      props.intro = ctx.sectionText(S, "frase de entrada", p.intro, props.intro);
      let added = 0;
      if (p.chapters) {
        const merged = mergeItems(ctx, S, props.chapters, p.chapters, "c", (c, prev) => {
          const title = ctx.free(c.title, prev?.title ?? "", `el título del capítulo «${short(c.title || c.body)}»`);
          const body = ctx.free(c.body, prev?.body ?? "", `el texto del capítulo «${short(title || c.body)}»`, true);
          if (!title && !body) return null;
          return { title, body, images: prev?.images ?? [] };
        }, (item) => item.title || item.body);
        props.chapters = merged.items;
        added = merged.added;
      }
      return { scene: { ...scene, props }, added };
    }
    case "details": {
      const p = patch.details;
      if (!p) return { scene, added: 0 };
      const S = SECTION_LABELS.details;
      const props = { ...scene.props };
      props.title = ctx.sectionText(S, "título", p.title, props.title);
      props.intro = ctx.sectionText(S, "frase de entrada", p.intro, props.intro);
      let added = 0;
      if (p.cards) {
        const merged = mergeItems(ctx, S, props.cards, p.cards, "d", (c, prev) => {
          const title = ctx.free(c.title, prev?.title ?? "", `la tarjeta «${short(c.title)}»`);
          if (!title) return null;
          const link = ctx.link(c.link, prev?.link, `el enlace de «${short(title)}»`);
          return {
            title,
            teaser: ctx.free(c.teaser, prev?.teaser ?? "", `el resumen de «${short(title)}»`),
            body: ctx.free(c.body, prev?.body ?? "", `el texto de «${short(title)}»`, true),
            ...(link ? { link } : {}),
            linkLabel: ctx.free(c.linkLabel, prev?.linkLabel ?? "", `el texto del enlace de «${short(title)}»`),
          };
        }, (item) => item.title);
        props.cards = merged.items;
        added = merged.added;
      }
      return { scene: { ...scene, props }, added };
    }
    case "faq": {
      const p = patch.faq;
      if (!p) return { scene, added: 0 };
      const S = SECTION_LABELS.faq;
      const props = { ...scene.props };
      props.title = ctx.sectionText(S, "título", p.title, props.title);
      props.contact = ctx.sectionText(S, "texto de contacto", p.contact, props.contact);
      let added = 0;
      if (p.items) {
        const merged = mergeItems(ctx, S, props.items, p.items, "q", (q, prev) => {
          const question = ctx.free(q.question, prev?.question ?? "", `la pregunta «${short(q.question)}»`);
          if (!question) return null;
          const answer = ctx.free(q.answer, prev?.answer ?? "", `la respuesta a «${short(question)}»`, true);
          if (!answer) ctx.followUps.push(`Escribid la respuesta a «${short(question)}» en Vuestro contenido.`);
          return { question, answer };
        }, (item) => item.question);
        props.items = merged.items;
        added = merged.added;
      }
      return { scene: { ...scene, props }, added };
    }
    case "transport": {
      const p = patch.transport;
      if (!p) return { scene, added: 0 };
      const S = SECTION_LABELS.transport;
      const props = { ...scene.props };
      props.title = ctx.sectionText(S, "título", p.title, props.title);
      props.intro = ctx.sectionText(S, "frase de entrada", p.intro, props.intro);
      props.returnNote = ctx.sectionText(S, "vuelta", p.returnNote, props.returnNote);
      let added = 0;
      if (p.stops) {
        const merged = mergeItems(ctx, S, props.stops, p.stops, "p", (s, prev) => {
          const name = ctx.literal(s.name, prev?.name ?? "", `la parada «${short(s.name)}»`);
          if (!name) return null;
          return {
            name,
            time: ctx.literal(normalizeTime(s.time), prev?.time ?? "", `la hora de la parada «${short(name)}»`),
            place: ctx.literal(s.place, prev?.place ?? "", `el punto de recogida de «${short(name)}»`),
          };
        }, (item) => (item.time ? `${item.name} (${item.time})` : item.name));
        props.stops = merged.items;
        added = merged.added;
      }
      return { scene: { ...scene, props }, added };
    }
    case "stay": {
      const p = patch.stay;
      if (!p) return { scene, added: 0 };
      const S = SECTION_LABELS.stay;
      const props = { ...scene.props };
      props.title = ctx.sectionText(S, "título", p.title, props.title);
      props.intro = ctx.sectionText(S, "frase de entrada", p.intro, props.intro);
      let added = 0;
      if (p.hotels) {
        const merged = mergeItems(ctx, S, props.hotels, p.hotels, "h", (h, prev) => {
          const name = ctx.literal(h.name, prev?.name ?? "", `el hotel «${short(h.name)}»`);
          if (!name) return null;
          const link = ctx.link(h.link, prev?.link, `el enlace de «${short(name)}»`);
          return {
            name,
            note: ctx.free(h.note, prev?.note ?? "", `la nota de «${short(name)}»`, true),
            code: ctx.literal(h.code, prev?.code ?? "", `el código de «${short(name)}»`),
            bookBy: prev?.bookBy ?? "",
            ...(link ? { link } : {}),
          };
        }, (item) => item.name);
        props.hotels = merged.items;
        added = merged.added;
      }
      return { scene: { ...scene, props }, added };
    }
    default:
      return { scene, added: 0 };
  }
}

/**
 * Aplica el parche sobre `doc` (ya validado). Puro y determinista: nunca
 * lanza. Devuelve el documento revalidado, la lista de cambios (es-ES) y lo
 * que se descartó por posible dato inventado.
 */
export function applySitePatch(doc: SiteDocument, patch: SitePatch, instruction: string, options: ApplyPatchOptions = {}): ApplyPatchResult {
  const scope = options.scope ?? "all";
  const ctx = new PatchContext(instruction, knownText(doc));
  const { changes, dropped } = ctx;
  const blocked: string[] = [];
  const refused: RefusedChange[] = [];
  const next: SiteDocument = structuredClone(doc);

  if (patch.themeId && patch.themeId !== doc.themeId) {
    next.themeId = patch.themeId;
    changes.push(LABELS.themeId);
  }
  if (patch.palette && patch.palette !== (doc.palette ?? doc.themeId)) {
    next.palette = patch.palette;
    changes.push(`${LABELS.palette} (${getSitePalette(patch.palette).label})`);
  }
  // 13-oct-2026: la IA solo puede pasar a «Como una web». «Como una Story»
  // se elige a mano (Task 5: opción premium) y la apertura es siempre el
  // sobre: lo que pida el modelo ahí se ignora y se dice (`refused`).
  if (patch.layout && patch.layout !== (doc.layout ?? "historia")) {
    if (patch.layout === "web") {
      next.layout = "web";
      changes.push(`${LABELS.layout} (${LAYOUT_LABELS.web})`);
    } else {
      refused.push("layout");
    }
  }
  if (patch.opening && patch.opening !== resolveOpening(doc)) refused.push("opening");

  const freeText = (key: keyof typeof LABELS, value: string | null, previous: string, multiline = false): string | null => {
    if (value === null) return null;
    const v = ctx.free(value, previous, LABELS[key], multiline);
    if (v === previous) return null;
    changes.push(LABELS[key]);
    return v;
  };
  const literal = (key: "venueName" | "venueAddress" | "venueTime", value: string | null, previous: string): string | null => {
    if (value === null) return null;
    const v = ctx.literal(value, previous, LABELS[key]);
    if (v === previous) return null;
    changes.push(LABELS[key]);
    return v;
  };

  next.scenes = next.scenes.map((scene): Scene => {
    switch (scene.type) {
      case "cover": {
        const props = { ...scene.props };
        const eyebrow = freeText("coverEyebrow", patch.coverEyebrow, props.eyebrow);
        if (eyebrow !== null) props.eyebrow = eyebrow;
        const welcome = freeText("coverWelcomeMessage", patch.coverWelcomeMessage, props.welcomeMessage, true);
        if (welcome !== null) props.welcomeMessage = welcome;
        if (patch.coverShowCountdown !== null && patch.coverShowCountdown !== props.showCountdown) {
          props.showCountdown = patch.coverShowCountdown;
          changes.push(LABELS.coverShowCountdown);
        }
        return { ...scene, props };
      }
      case "venue": {
        const props = { ...scene.props };
        const name = literal("venueName", patch.venueName, props.venue);
        if (name !== null) props.venue = name;
        const address = literal("venueAddress", patch.venueAddress, props.address);
        if (address !== null) props.address = address;
        const time = patch.venueTime === null ? null : literal("venueTime", normalizeTime(patch.venueTime), props.time);
        if (time !== null) props.time = time;
        // Otro lugar u otra dirección: el sitio exacto elegido antes ya no vale.
        if (props.venue !== scene.props.venue || props.address !== scene.props.address) delete props.placeId;
        return { ...scene, props };
      }
      case "agenda": {
        const title = freeText("agendaTitle", patch.agendaTitle, scene.props.title);
        return title === null ? scene : { ...scene, props: { ...scene.props, title } };
      }
      case "rsvp": {
        const title = freeText("rsvpTitle", patch.rsvpTitle, scene.props.title);
        return title === null ? scene : { ...scene, props: { ...scene.props, title } };
      }
      default:
        return scene;
    }
  });

  // Contenido de secciones: la primera de cada tipo; si no existe, se crea
  // delante de la asistencia y solo se queda si acaba con algo que enseñar.
  for (const [key, type] of CONTENT_PATCH_TYPES) {
    if (patch[key] == null) continue;
    const label = SECTION_LABELS[type];
    if (scope === "design") {
      blocked.push(label === "Vuestra historia" ? "vuestra historia" : label.toLowerCase());
      continue;
    }
    const mark = changes.length;
    let index = next.scenes.findIndex((s) => s.type === type);
    let created = false;
    if (index === -1) {
      const scene = newScene(type, new Set(next.scenes.map((s) => s.id)));
      if (!scene) continue;
      const rsvpAt = next.scenes.findIndex((s) => s.type === "rsvp");
      index = rsvpAt === -1 ? next.scenes.length : rsvpAt;
      next.scenes.splice(index, 0, scene);
      created = true;
    }
    const before = next.scenes[index]!;
    const { scene: applied, added } = applyContent(before, patch, ctx);
    let updated = applied;
    if (created) {
      // Una pregunta sin respuesta cuenta (el invitado no la ve hasta que la
      // pareja la conteste, pero la pide): solo se descarta la sección si no
      // entró nada (p. ej. solo un título).
      if (!sceneHasContent(updated) && added === 0) {
        next.scenes.splice(index, 1);
        changes.length = mark;
        continue;
      }
      changes.splice(mark, 0, `${label}: sección nueva`);
    } else if (!updated.enabled && added > 0) {
      updated = { ...updated, enabled: true } as Scene;
      changes.push(`${label}: se muestra`);
    }
    next.scenes[index] = updated;
  }

  if (patch.scenes) {
    const reordered = applySceneLayout(next.scenes, patch.scenes);
    const before = JSON.stringify(next.scenes.map((s) => [s.id, s.enabled]));
    const after = JSON.stringify(reordered.map((s) => [s.id, s.enabled]));
    if (before !== after) {
      next.scenes = reordered;
      changes.push(LABELS.scenes);
    }
  }

  if (changes.length === 0) return { ok: false, reason: "no_changes", dropped, blocked, refused };
  const parsed = parseSiteDocument(next);
  if (!parsed.ok) return { ok: false, reason: "invalid", issues: parsed.issues, dropped, blocked, refused };
  return { ok: true, document: parsed.document, changes, dropped, blocked, refused, followUps: [...new Set(ctx.followUps)] };
}

/**
 * Orden y visibilidad: las escenas listadas (ids conocidos, sin duplicados)
 * van en ese orden; las no listadas, detrás en su orden original. La
 * portada siempre primera y visible.
 */
function applySceneLayout(scenes: Scene[], layout: ReadonlyArray<{ id: string; enabled: boolean }>): Scene[] {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const ordered: Scene[] = [];
  for (const entry of layout) {
    const scene = byId.get(entry.id);
    if (!scene || seen.has(entry.id)) continue;
    seen.add(entry.id);
    ordered.push(scene.type === "cover" ? scene : ({ ...scene, enabled: entry.enabled } as Scene));
  }
  // Las no listadas (p. ej. una sección recién creada, cuyo id el modelo no
  // conocía) van detrás, pero nunca después de la asistencia.
  const rest = scenes.filter((scene) => !seen.has(scene.id));
  const rsvpAt = ordered.findIndex((s) => s.type === "rsvp");
  if (rsvpAt === -1) ordered.push(...rest);
  else ordered.splice(rsvpAt, 0, ...rest.filter((s) => s.type !== "rsvp"));
  const coverIndex = ordered.findIndex((s) => s.type === "cover");
  if (coverIndex > 0) ordered.unshift(...ordered.splice(coverIndex, 1));
  return ordered;
}
