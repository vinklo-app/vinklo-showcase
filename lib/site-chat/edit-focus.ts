/**
 * «Seleccionar» en la vista previa del editor (como las ediciones visuales de
 * Lovable): la pareja toca una sección o un texto de su web y la siguiente
 * petición se centra en eso. Puro y client-safe (sin zod en tiempo de
 * ejecución): lo usan el editor, el creador y los tests.
 *
 * Rutas (`data-edit-path` del renderer, solo en la vista previa del editor):
 *   «<escena>»                       la sección entera (`data-edit-scene`)
 *   «<escena>/<campo>»                p. ej. «portada/welcomeMessage», «faq-1/title»
 *   «<escena>/<lista>/<id>/<campo>»   p. ej. «faq-1/items/q-2/question»
 * Los ids de escena y de elemento son `[a-z][a-z0-9-]*`: sin «/».
 */
import type { Scene, SceneType, SiteDocument } from "@/lib/site-document";

/** Nombres de las secciones para la pareja (mismos que la IA: nunca «escenas»). */
export const SECTION_NAMES: Record<SceneType, string> = {
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

/**
 * Lo que sugiere el cuadro de «Pedid cambios» en cada sección (backlog
 * 13-oct-2026, textos del punto 3): qué se puede pedir AHÍ, con ejemplos
 * de esa sección. Siempre empieza por «Pedid cambios:» y cabe en las dos
 * líneas del compositor (≈ 80 caracteres).
 */
export const SECTION_CHANGE_PROMPTS: Record<SceneType, string> = {
  cover: "Pedid cambios: un titular vuestro, otra bienvenida, quitar la cuenta atrás…",
  venue: "Pedid cambios: el sitio, la dirección exacta, la hora, dónde aparcar…",
  agenda: "Pedid cambios: añadid las horas más importantes, toda la agenda y el contexto…",
  rsvp: "Pedid cambios: qué preguntar a los invitados (alergias, autobús) y el plazo…",
  story: "Pedid cambios: cómo os conocisteis, la pedida, los momentos que queréis contar…",
  gallery: "Pedid cambios: el título de las fotos, cuáles van primero, menos fotos…",
  details: "Pedid cambios: vestimenta, regalos, niños, cualquier detalle práctico…",
  faq: "Pedid cambios: las preguntas de siempre (aparcamiento, niños) y sus respuestas…",
  transport: "Pedid cambios: las paradas, la hora de salida y la de vuelta del autobús…",
  stay: "Pedid cambios: hoteles cercanos, códigos de descuento, cómo reservar…",
};
/** El diseño (colores y letra), que no es una sección. */
export const DESIGN_CHANGE_PROMPT = "Pedid cambios: colores más cálidos, un verde más suave, otra letra…";

/** Placeholder del compositor con una selección: la sección entera → su sugerencia; un texto → qué cambiar en él. */
export function changePromptFor(target: Pick<EditTarget, "path" | "sceneId" | "sceneType" | "label">): string {
  return target.path === target.sceneId ? SECTION_CHANGE_PROMPTS[target.sceneType] : `Qué queréis cambiar en ${target.label}`;
}

/** Máximo del texto que viaja como `focus` al servidor. */
export const EDIT_FOCUS_MAX = 240;

interface FieldSpec {
  /** Nombre del campo para la pareja. */
  label: string;
  max: number;
  multiline: boolean;
  /** Se puede editar a mano desde el chat (false: nombres, que van en «Los datos»). */
  inline: boolean;
  /** No puede quedar vacío (el contrato lo exige). */
  required?: boolean;
}

/** Campos de texto de cada sección que se pueden señalar. */
const SCENE_FIELDS: Partial<Record<SceneType, Record<string, FieldSpec>>> = {
  cover: {
    names: { label: "Nombres", max: 80, multiline: false, inline: false },
    eyebrow: { label: "Titular pequeño", max: 60, multiline: false, inline: true },
    welcomeMessage: { label: "Bienvenida", max: 400, multiline: true, inline: true },
  },
  venue: {
    venue: { label: "Nombre del lugar", max: 160, multiline: false, inline: true },
    address: { label: "Dirección", max: 240, multiline: false, inline: true },
  },
  agenda: { title: { label: "Título", max: 80, multiline: false, inline: true } },
  rsvp: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    body: { label: "Texto", max: 200, multiline: true, inline: true },
  },
  story: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    intro: { label: "Frase de entrada", max: 200, multiline: true, inline: true },
  },
  gallery: { title: { label: "Título", max: 80, multiline: false, inline: true } },
  details: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    intro: { label: "Frase de entrada", max: 200, multiline: true, inline: true },
  },
  faq: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    contact: { label: "Texto de contacto", max: 160, multiline: true, inline: true },
  },
  transport: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    intro: { label: "Frase de entrada", max: 200, multiline: true, inline: true },
    returnNote: { label: "La vuelta", max: 200, multiline: true, inline: true },
  },
  stay: {
    title: { label: "Título", max: 80, multiline: false, inline: true },
    intro: { label: "Frase de entrada", max: 200, multiline: true, inline: true },
  },
};

/** Campos de los elementos de listas. */
const LIST_FIELDS: Record<string, Record<string, FieldSpec>> = {
  "agenda/items": { title: { label: "Momento", max: 120, multiline: false, inline: true, required: true } },
  "story/chapters": {
    title: { label: "Título del capítulo", max: 80, multiline: false, inline: true },
    body: { label: "Capítulo", max: 600, multiline: true, inline: true },
  },
  "details/cards": {
    title: { label: "Tarjeta", max: 80, multiline: false, inline: true, required: true },
    body: { label: "Texto de la tarjeta", max: 800, multiline: true, inline: true },
  },
  "faq/items": {
    question: { label: "Pregunta", max: 160, multiline: false, inline: true, required: true },
    answer: { label: "Respuesta", max: 800, multiline: true, inline: true },
  },
};

export interface EditTarget {
  path: string;
  sceneId: string;
  sceneType: SceneType;
  /** Lo que se enseña en el chip del compositor: «Portada · Bienvenida», «Preguntas · ¿Hay aparcamiento?». */
  label: string;
  /** Pista para la IA (≤ EDIT_FOCUS_MAX): qué ha seleccionado la pareja y su texto actual. */
  focus: string;
  /** Si es un texto simple, cómo editarlo a mano. */
  field?: { value: string; max: number; multiline: boolean; required: boolean };
}

type Parsed = { sceneId: string; field?: string; list?: string; itemId?: string };

export function parseEditPath(path: string): Parsed | null {
  const parts = path.split("/");
  const valid = (s: string | undefined) => typeof s === "string" && /^[a-z][a-zA-Z0-9-]{0,39}$/.test(s);
  if (parts.length === 1 && valid(parts[0])) return { sceneId: parts[0]! };
  if (parts.length === 2 && valid(parts[0]) && valid(parts[1])) return { sceneId: parts[0]!, field: parts[1]! };
  if (parts.length === 4 && parts.every(valid)) return { sceneId: parts[0]!, list: parts[1]!, itemId: parts[2]!, field: parts[3]! };
  return null;
}

const shorten = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

function listOf(scene: Scene, list: string): Array<{ id: string } & Record<string, unknown>> | null {
  const props = scene.props as Record<string, unknown>;
  const value = props[list];
  return Array.isArray(value) ? (value as Array<{ id: string } & Record<string, unknown>>) : null;
}

/** Texto que identifica un elemento de lista en el chip («¿Hay aparcamiento?», «Cóctel», «Capítulo 2»). */
function itemName(sceneType: SceneType, list: string, item: Record<string, unknown>, index: number): string {
  if (sceneType === "faq") return String(item.question ?? "");
  if (sceneType === "story") return String(item.title ?? "") || `Capítulo ${index + 1}`;
  return String(item.title ?? "");
}

function sceneName(scene: Scene): string {
  return SECTION_NAMES[scene.type];
}

/** Describe lo que la pareja ha tocado. null si la ruta ya no existe en el documento. */
export function describeEditTarget(doc: SiteDocument, path: string): EditTarget | null {
  const parsed = parseEditPath(path);
  if (!parsed) return null;
  const scene = doc.scenes.find((s) => s.id === parsed.sceneId);
  if (!scene) return null;
  const section = sceneName(scene);
  const base = { path, sceneId: scene.id, sceneType: scene.type };

  // La foto y la fecha de la portada llevan su ruta (huecos del creador y
  // edición desde la vista previa), pero se eligen como la sección.
  if (!parsed.field || (scene.type === "cover" && (parsed.field === "image" || parsed.field === "weddingDate") && !parsed.list)) {
    return { ...base, path: scene.id, label: section, focus: clampFocus(`la sección «${section}»`) };
  }

  if (!parsed.list) {
    const spec = SCENE_FIELDS[scene.type]?.[parsed.field];
    if (!spec) return null;
    if (scene.type === "cover" && parsed.field === "names") {
      return { ...base, label: `${section} · ${spec.label}`, focus: clampFocus(`los nombres de la portada (los nombres no se cambian con la IA)`) };
    }
    const value = String((scene.props as Record<string, unknown>)[parsed.field] ?? "");
    return {
      ...base,
      label: `${section} · ${spec.label}`,
      focus: clampFocus(`en la sección «${section}», el campo «${spec.label}»${value ? ` (ahora: «${shorten(value, 120)}»)` : " (ahora vacío)"}`),
      ...(spec.inline ? { field: { value, max: spec.max, multiline: spec.multiline, required: Boolean(spec.required) } } : {}),
    };
  }

  const spec = LIST_FIELDS[`${scene.type}/${parsed.list}`]?.[parsed.field];
  const items = listOf(scene, parsed.list);
  if (!spec || !items) return null;
  const index = items.findIndex((item) => item.id === parsed.itemId);
  if (index < 0) return null;
  const item = items[index]!;
  const name = itemName(scene.type, parsed.list, item, index) || spec.label;
  const value = String(item[parsed.field] ?? "");
  const what = spec.label === name ? `«${shorten(name, 80)}»` : `${spec.label.toLowerCase()} de «${shorten(name, 80)}»`;
  return {
    ...base,
    label: `${section} · ${shorten(name, 48)}`,
    focus: clampFocus(`en la sección «${section}», ${what}${parsed.field !== "title" && parsed.field !== "question" ? (value ? ` (ahora: «${shorten(value, 100)}»)` : " (ahora vacío)") : ""}`),
    ...(spec.inline ? { field: { value, max: spec.max, multiline: spec.multiline, required: Boolean(spec.required) } } : {}),
  };
}

function clampFocus(text: string): string {
  return shorten(text, EDIT_FOCUS_MAX);
}

export type WriteTextResult = { ok: true; document: SiteDocument } | { ok: false; error: string };

/**
 * Edición a mano de un texto señalado (input del chat). Inmutable. No valida
 * el contrato completo: el servidor lo hace al guardar.
 */
export function writeEditText(doc: SiteDocument, path: string, raw: string): WriteTextResult {
  const target = describeEditTarget(doc, path);
  const parsed = parseEditPath(path);
  if (!target?.field || !parsed?.field) return { ok: false, error: "Ese texto ya no está en vuestra web." };
  const value = target.field.multiline ? raw.trim() : raw.replace(/\s+/g, " ").trim();
  if (value.length > target.field.max) return { ok: false, error: `Puede tener hasta ${target.field.max} caracteres.` };
  if (target.field.required && !value) return { ok: false, error: "Este texto no puede quedar vacío." };
  const field = parsed.field;
  const scenes = doc.scenes.map((scene) => {
    if (scene.id !== parsed.sceneId) return scene;
    if (!parsed.list) return { ...scene, props: { ...scene.props, [field]: value } } as Scene;
    const items = listOf(scene, parsed.list) ?? [];
    return { ...scene, props: { ...scene.props, [parsed.list]: items.map((item) => (item.id === parsed.itemId ? { ...item, [field]: value } : item)) } } as Scene;
  });
  return { ok: true, document: { ...doc, scenes } };
}

/**
 * Frase para la IA cuando la pareja ha seleccionado algo. Va DENTRO de la
 * parte de la pareja (contenido, no reglas). Sin saltos de línea ni
 * delimitadores: no puede cerrar el bloque de la petición.
 */
export function focusPromptLine(focus: unknown): string {
  if (typeof focus !== "string") return "";
  const clean = focus.replace(/[<>]{3,}/g, " ").replace(/\s+/g, " ").trim().slice(0, EDIT_FOCUS_MAX);
  if (!clean) return "";
  return `La pareja ha seleccionado: ${clean}; cambia solo eso salvo que pida otra cosa.`;
}

/**
 * Creador (/crear, /onboarding): el borrador local solo conserva algunos
 * textos (`adoptProposal`: titular pequeño, bienvenida, lugar, dirección y
 * los títulos del programa y de la confirmación). El resto se puede
 * seleccionar para centrar la petición, pero no editar a mano allí.
 */
const CREATOR_FIELDS: Partial<Record<SceneType, readonly string[]>> = {
  cover: ["eyebrow", "welcomeMessage"],
  venue: ["venue", "address"],
  agenda: ["title"],
  rsvp: ["title"],
};

export function creatorEditTarget(target: EditTarget | null): EditTarget | null {
  if (!target?.field) return target;
  const parsed = parseEditPath(target.path);
  const allowed = parsed && !parsed.list && parsed.field ? CREATOR_FIELDS[target.sceneType]?.includes(parsed.field) : false;
  return allowed ? target : { ...target, field: undefined };
}
