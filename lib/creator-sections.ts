/**
 * Contenido de secciones que la IA (o la pareja, a mano desde «Seleccionar»)
 * cambia en el creador y que el borrador local no sabe guardar en sus campos
 * (13-oct-2026, «Pedid cambios» que funciona).
 *
 * Antes, `adoptProposal` solo devolvía al borrador diseño, portada y lugar:
 * el programa, la historia, los detalles, las preguntas, los autobuses y el
 * alojamiento que proponía la IA se perdían al recomponer el documento.
 *
 * Cada sección guarda una CAPA sobre lo que el borrador genera por sí solo:
 *  - `order`: los ids en el orden final; `known`: los ids que el borrador
 *    generaba al aplicarla (lo que no esté en `order` lo quitó la IA);
 *  - `items`: solo los elementos que difieren de lo generado (o nuevos);
 *  - `text`: títulos y frases cambiados, con el valor de partida (`basis`):
 *    si la pareja cambia después ese dato en su paso, manda lo suyo.
 * Lo que la pareja edita en los pasos del creador (horas y sitios del día,
 * respuestas de la historia, paradas y hoteles) sigue saliendo SIEMPRE de sus
 * campos (`LIVE_FIELDS`): la capa nunca tapa una edición a mano posterior.
 *
 * Puro y determinista. Lo usan `composeBuilderDocument` y `adoptProposal`.
 */
import { z } from "zod";
import { dayMinutes } from "./creator-day";
import { agendaItemSchema, busStopSchema, detailCardSchema, faqItemSchema, hotelSchema, storyChapterSchema, type Scene, type SceneType, type SiteDocument } from "./site-document";

export const OVERLAY_TYPES = ["agenda", "story", "details", "faq", "transport", "stay"] as const;
export type OverlayType = (typeof OVERLAY_TYPES)[number];

const MAX_ITEMS = 40;
const idList = z.array(z.string().min(1).max(40)).max(MAX_ITEMS);
const textEntry = z.strictObject({ key: z.string().max(20), value: z.union([z.string().max(800), z.boolean()]), basis: z.union([z.string().max(800), z.boolean()]) });
const overlay = <T extends z.ZodType>(item: T) => z.strictObject({
  order: idList,
  known: idList,
  items: z.array(item).max(MAX_ITEMS),
  text: z.array(textEntry).max(4),
});

export const builderSectionsSchema = z.strictObject({
  agenda: overlay(agendaItemSchema).optional(),
  story: overlay(storyChapterSchema).optional(),
  details: overlay(detailCardSchema).optional(),
  faq: overlay(faqItemSchema).optional(),
  transport: overlay(busStopSchema).optional(),
  stay: overlay(hotelSchema).optional(),
});
export type BuilderSections = z.infer<typeof builderSectionsSchema>;
type Overlay = NonNullable<BuilderSections[OverlayType]>;
type Item = { id: string } & Record<string, unknown>;

/** Lista de cada sección. */
const LIST_KEY: Record<OverlayType, string> = { agenda: "items", story: "chapters", details: "cards", faq: "items", transport: "stops", stay: "hotels" };
/**
 * Campos que salen siempre de los pasos del creador (la pareja los edita a
 * mano allí). Detalles y preguntas no tienen paso: la capa manda entera.
 */
const LIVE_FIELDS: Record<OverlayType, readonly string[]> = {
  agenda: ["timeLabel", "place", "address"],
  story: ["body"],
  details: [],
  faq: [],
  transport: ["name", "time", "place"],
  stay: ["name", "code", "link"],
};
/** El título del programa va por `design.agendaTitle` (como antes). */
const SKIP_TEXT: Partial<Record<OverlayType, readonly string[]>> = { agenda: ["title"] };

/** Nombre visible de cada sección (igual que en «Vuestro contenido»). */
export const SECTION_NAMES: Record<SceneType, string> = {
  cover: "Portada", venue: "Lugar", agenda: "Programa", rsvp: "Confirmación", story: "Vuestra historia",
  gallery: "Fotos", details: "Detalles", faq: "Preguntas", transport: "Autobuses", stay: "Alojamiento",
};

/** JSON con las claves ordenadas: igualdad sin depender del orden de las claves. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v));
}

const isOverlayType = (type: SceneType): type is OverlayType => (OVERLAY_TYPES as readonly string[]).includes(type);
const listOf = (scene: Scene, type: OverlayType) => ((scene.props as unknown as Record<string, unknown>)[LIST_KEY[type]] ?? []) as Item[];

/** Los campos vivos de `derived` sobre el elemento de la capa (un campo ausente, p. ej. sin enlace, se quita). */
function withLive(item: Item, derived: Item, type: OverlayType): Item {
  const next: Item = { ...item };
  for (const key of LIVE_FIELDS[type]) {
    if (key in derived) next[key] = derived[key];
    else delete next[key];
  }
  return next;
}

/**
 * «18:30» → minutos del día de la boda; sin hora, null. Lo de antes de las
 * 06:00 es la madrugada siguiente: el mismo criterio que «Vuestro día»
 * (lib/creator-day.ts), para que un momento nuevo no salte delante de la ceremonia.
 */
function minutes(item: Item): number | null {
  return dayMinutes(typeof item.timeLabel === "string" ? item.timeLabel : "");
}

/** Aplica la capa a una lista generada por el borrador. */
function applyList(type: OverlayType, derived: Item[], layer: Overlay): Item[] {
  const byId = new Map(derived.map((item) => [item.id, item]));
  const overrides = new Map((layer.items as Item[]).map((item) => [item.id, item]));
  const known = new Set(layer.known);
  const out: Item[] = [];
  for (const id of layer.order) {
    const d = byId.get(id);
    const o = overrides.get(id);
    if (d && o) out.push(withLive(o, d, type));
    else if (d) out.push(d);
    // Un elemento que el borrador generaba y ya no (la pareja lo vació en su paso) no vuelve.
    else if (o && !known.has(id)) out.push(o);
  }
  // Lo que el borrador genera DESPUÉS de aplicar la capa (otro momento del día,
  // un módulo nuevo…) entra en su sitio: por hora en el programa; si no, tras
  // su vecino anterior.
  const placed = new Set(out.map((item) => item.id));
  derived.forEach((item, index) => {
    if (placed.has(item.id) || known.has(item.id) || layer.order.includes(item.id)) return;
    let at = -1;
    const time = type === "agenda" ? minutes(item) : null;
    if (time !== null) at = out.findIndex((other) => { const t = minutes(other); return t !== null && t > time; });
    if (at === -1) {
      const before = derived.slice(0, index).reverse().find((other) => placed.has(other.id));
      at = before ? out.findIndex((other) => other.id === before.id) + 1 : (time !== null ? out.length : 0);
    }
    out.splice(at, 0, item);
    placed.add(item.id);
  });
  return out;
}

/** Aplica las capas a las escenas que genera el borrador (`composeBuilderDocument`). */
export function applySectionOverlays(scenes: Scene[], sections: BuilderSections | undefined): Scene[] {
  if (!sections) return scenes;
  return scenes.map((scene): Scene => {
    if (!isOverlayType(scene.type)) return scene;
    const layer = sections[scene.type];
    if (!layer) return scene;
    const props: Record<string, unknown> = { ...(scene.props as unknown as Record<string, unknown>) };
    for (const entry of layer.text) {
      // Si la pareja cambió después el dato de partida en su paso, manda lo suyo.
      if (entry.key in props && canonical(props[entry.key]) === canonical(entry.basis)) props[entry.key] = entry.value;
    }
    props[LIST_KEY[scene.type]] = applyList(scene.type, listOf(scene, scene.type), layer);
    const next = { ...scene, props } as unknown as Scene;
    // El programa se ve si tiene momentos (como al generarlo desde «Vuestro día»).
    return next.type === "agenda" ? { ...next, enabled: next.props.items.length > 0 } : next;
  });
}

/**
 * Capas que convierten lo que genera el borrador (`derived`, sin capas) en lo
 * propuesto. `byPosition`: secciones cuyos ids genera el borrador por
 * posición (paradas y hoteles, ya devueltos a sus campos): se emparejan por
 * orden. undefined si no hace falta ninguna.
 */
export function sectionOverlays(derived: SiteDocument, proposed: SiteDocument, byPosition: ReadonlySet<OverlayType> = new Set()): BuilderSections | undefined {
  const sections: BuilderSections = {};
  for (const type of OVERLAY_TYPES) {
    const want = proposed.scenes.find((s) => s.type === type);
    const have = derived.scenes.find((s) => s.type === type);
    if (!want || !have) continue;
    const base = listOf(have, type);
    let list = listOf(want, type);
    if (byPosition.has(type) && list.length === base.length) list = list.map((item, i) => ({ ...item, id: base[i]!.id }));
    const byId = new Map(base.map((item) => [item.id, item]));
    const items = list.filter((item) => { const d = byId.get(item.id); return !d || canonical(item) !== canonical(d); });
    const wantProps = want.props as unknown as Record<string, unknown>;
    const haveProps = have.props as unknown as Record<string, unknown>;
    const text = Object.keys(wantProps)
      .filter((key) => key !== LIST_KEY[type] && !(SKIP_TEXT[type] ?? []).includes(key))
      .filter((key) => (typeof wantProps[key] === "string" || typeof wantProps[key] === "boolean") && key in haveProps && wantProps[key] !== haveProps[key])
      .map((key) => ({ key, value: wantProps[key] as string | boolean, basis: haveProps[key] as string | boolean }));
    const order = list.map((item) => item.id);
    const known = base.map((item) => item.id);
    if (items.length === 0 && text.length === 0 && order.join("\n") === known.join("\n")) continue;
    (sections as Record<OverlayType, Overlay>)[type] = { order, known, items, text } as Overlay;
  }
  return Object.keys(sections).length > 0 ? sections : undefined;
}

/**
 * Secciones de `proposed` que no se ven igual en `adopted` (lo que el
 * borrador recompone). Sin fotos: en el creador viven aparte. Vacío = todo
 * aplicado. Sirve para no decir «Aplicado» cuando algo no se ha podido guardar.
 */
export function unappliedSections(proposed: SiteDocument, adopted: SiteDocument): string[] {
  const strip = (scene: Scene) => canonical({ ...scene, props: { ...scene.props, ...("image" in scene.props ? { image: null } : {}), ...("images" in scene.props ? { images: [] } : {}), ...(scene.type === "story" ? { chapters: scene.props.chapters.map((c) => ({ ...c, images: [] })) } : {}) } });
  const missing: string[] = [];
  for (const scene of proposed.scenes) {
    const now = adopted.scenes.find((s) => s.id === scene.id);
    if (!now || strip(now) !== strip(scene)) missing.push(SECTION_NAMES[scene.type]);
  }
  const order = (doc: SiteDocument) => doc.scenes.map((s) => `${s.id}:${s.enabled}`).join();
  if (missing.length === 0 && order(proposed) !== order(adopted)) missing.push("el orden de las secciones");
  if (proposed.themeId !== adopted.themeId || (proposed.palette ?? null) !== (adopted.palette ?? null)) missing.push("el diseño");
  if ((proposed.layout ?? "historia") !== (adopted.layout ?? "historia")) missing.push("la forma");
  return [...new Set(missing)];
}

/** Error del chat cuando una propuesta no se puede guardar en el borrador. */
export function notAppliedMessage(missing: string[]): string {
  const names = missing.length <= 1 ? missing[0] ?? "" : `${missing.slice(0, -1).join(", ")} y ${missing[missing.length - 1]}`;
  return `No hemos podido aplicar este cambio en vuestra invitación (${names}), así que no hemos tocado nada. Probad a pedirlo de otra forma o cambiadlo en su paso.`;
}
