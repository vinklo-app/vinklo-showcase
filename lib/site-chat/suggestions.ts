/**
 * Siguientes peticiones sugeridas tras cada respuesta del chat del editor
 * (chips): deterministas, a partir de lo que le falta a la web. Sin llamada
 * extra al modelo. Puro y client-safe.
 *
 * Los chips rellenan la caja (no envían solos): la pareja puede completar
 * los datos que la IA no puede inventar (horas, sitios).
 */
import { findScene, resolveLayout, resolvePalette, type SiteDocument } from "@/lib/site-document";

export type SuggestionScope = "all" | "design";

interface Rule {
  text: string;
  when: (doc: SiteDocument) => boolean;
}

const has = (doc: SiteDocument, type: "story" | "details" | "faq" | "transport" | "stay") => {
  const scene = findScene(doc, type);
  if (!scene || !scene.enabled) return false;
  switch (scene.type) {
    case "story": return scene.props.chapters.some((c) => c.title || c.body);
    case "details": return scene.props.cards.length > 0;
    case "faq": return scene.props.items.length > 0;
    case "transport": return scene.props.stops.length > 0;
    case "stay": return scene.props.hotels.length > 0;
    default: return false;
  }
};

const welcome = (doc: SiteDocument) => findScene(doc, "cover")?.props.welcomeMessage.trim() ?? "";

/** Contenido que falta, por orden de importancia para el invitado. */
const CONTENT_RULES: Rule[] = [
  { text: "Añadid el programa del día", when: (doc) => (findScene(doc, "agenda")?.props.items.length ?? 0) === 0 },
  { text: "Añadid preguntas frecuentes: aparcamiento y niños", when: (doc) => !has(doc, "faq") },
  { text: "Escribid una bienvenida cercana", when: (doc) => welcome(doc) === "" },
  { text: "Añadid una tarjeta con el código de vestimenta", when: (doc) => !has(doc, "details") },
  { text: "Contad cómo os conocisteis en Vuestra historia", when: (doc) => !has(doc, "story") },
];

/** Diseño: siempre hay algo que probar. */
const DESIGN_RULES: Rule[] = [
  { text: "Una bienvenida más cercana", when: (doc) => welcome(doc) !== "" },
  { text: "Escribid una bienvenida cercana", when: (doc) => welcome(doc) === "" },
  { text: "Colores más suaves", when: (doc) => !["rosa", "lavanda"].includes(resolvePalette(doc).id) },
  { text: "Colores en verde natural", when: (doc) => resolvePalette(doc).id !== "natural" },
  { text: "Que se vea como una web", when: (doc) => resolveLayout(doc) === "historia" },
  // «Como una Story» ya no se pide al chat (13-oct-2026): se elige a mano.
  { text: "Una letra más clásica para los nombres", when: (doc) => doc.themeId !== "clasico" },
  { text: "Sin cuenta atrás", when: (doc) => findScene(doc, "cover")?.props.showCountdown === true },
];

const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * 2 o 3 sugerencias. `exclude`: peticiones ya hechas (no se repiten).
 * En el creador (`design`) solo diseño: el contenido se añade después.
 */
export function suggestNextPrompts(doc: SiteDocument, options: { scope?: SuggestionScope; exclude?: readonly string[]; max?: number } = {}): string[] {
  const { scope = "all", exclude = [], max = 3 } = options;
  const done = new Set(exclude.map(norm));
  const rules = scope === "design" ? DESIGN_RULES : [...CONTENT_RULES, ...DESIGN_RULES];
  const out: string[] = [];
  for (const rule of rules) {
    if (out.length >= max) break;
    if (done.has(norm(rule.text)) || out.includes(rule.text)) continue;
    // Dos bienvenidas distintas a la vez no tienen sentido.
    if (/bienvenida/.test(rule.text) && out.some((t) => /bienvenida/.test(t))) continue;
    if (rule.when(doc)) out.push(rule.text);
  }
  return out;
}
