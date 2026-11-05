/**
 * «Plantillas fieles» (task 6, 13-oct-2026): en el móvil del creador, una
 * pareja que eligió una plantilla ve su ESTRUCTURA completa —portada con
 * foto, mosaico de fotos, historia por capítulos, detalles y preguntas—
 * aunque aún no tenga ese contenido. Lo que falta se pinta como hueco: fotos
 * de relleno en los tonos de su paleta (sin personas ni fotos ajenas) y
 * textos que dicen qué va ahí, marcados como huecos que se tocan.
 *
 * Solo para el documento EN MEMORIA del móvil del creador: nunca se guarda,
 * se envía ni se publica (lo que se crea es `composeBuilderDocument`, sin
 * esto; y las URL `data:` no pasan el contrato). «Ampliar» y la web pública
 * enseñan solo lo que la pareja ha puesto. Puro.
 */
import { STORY_QUESTIONS } from "./creator-story";
import { detailCardHasContent, faqItemHasAnswer, resolvePalette, sceneHasContent, type DetailCard, type Scene, type SceneImage, type SiteDocument, type SitePalette } from "./site-document";
import { findBuilderTemplate } from "./templates";

/** Ruta de hueco de la foto de portada (`data-edit-path` de la foto en la portada web). */
export const COVER_IMAGE_GAP_FIELD = "image";

export interface TemplatePreviewInput {
  /** Id de la plantilla del borrador (`draft.template`). */
  template: string | undefined;
  /** "pending" = aún sin decidir la foto; "initials" = eligieron seguir sin foto. */
  photo: "pending" | "photo" | "initials";
}

export interface TemplatePreview {
  document: SiteDocument;
  /** Huecos de plantilla marcados en el móvil (rutas de useGapTargets). */
  gaps: TemplateGap[];
}

export type TemplateGapKind = "photo" | "gallery" | "story" | "details" | "faq";
export interface TemplateGap { path: string; kind: TemplateGapKind }

/** Proporciones de las fotos de la demo (portada, mosaico y polaroids), para que el hueco tenga su forma. */
const GALLERY_SHAPES: ReadonlyArray<[number, number]> = [[1100, 733], [1100, 641], [1400, 933], [1100, 1650], [1100, 733]];
const CHAPTER_SHAPES: ReadonlyArray<ReadonlyArray<[number, number]>> = [[[1100, 733], [1100, 1650]], [[1100, 733], [1000, 667]], [[1000, 667], [1000, 667]]];

/** Pista de cada tarjeta de detalles de la plantilla (a la pareja, en «vosotros»). */
const DETAIL_HINTS: Record<string, string> = {
  "d-viaje": "Contad cómo llegar y dónde dormir.",
  "d-vestimenta": "Contad qué se pone vuestra gente.",
  "d-menu": "Contad qué vais a servir.",
  "d-musica": "Contad qué sonará en la fiesta.",
};
const DETAIL_HINT = "Contad aquí lo que conviene saber.";
const FAQ_HINT = "Escribid aquí la respuesta.";

/** Mezcla dos colores #rrggbb (t = peso del segundo); si no son hex, el primero. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Foto de relleno en los tonos de la paleta: un marco con un paisaje
 * dibujado a trazo. `dark` para la portada a sangre (los nombres van en
 * papel encima); claro para el resto.
 */
export function placeholderImage(palette: SitePalette, width: number, height: number, dark = false, alt = "Aquí irá vuestra foto"): SceneImage {
  // Claro: el tono de superficie con un punto de acento, para que el marco (arco, mosaico) se lea sobre el papel.
  const fill = dark ? palette.ink : mixHex(palette.surface, palette.accent, 0.14);
  const stroke = dark ? palette.paper : palette.accent;
  const s = Math.round(Math.min(width, height) * 0.16);
  const x = Math.round(width / 2 - s / 2);
  // A sangre, los nombres ocupan la mitad de abajo: el dibujo va arriba.
  const y = Math.round(dark ? height * 0.3 - s * 0.4 : height / 2 - s * 0.4);
  const h = Math.round(s * 0.8);
  const w2 = Math.max(1, Math.round(s * 0.045));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${dark ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.accent}"/><stop offset="1" stop-color="${fill}"/></linearGradient></defs>` : ""}<rect width="100%" height="100%" fill="${dark ? "url(#g)" : fill}"/><g fill="none" stroke="${stroke}" stroke-opacity="${dark ? 0.45 : 0.6}" stroke-width="${w2}" stroke-linejoin="round" stroke-linecap="round"><rect x="${x}" y="${y}" width="${s}" height="${h}" rx="${Math.round(s * 0.08)}"/><path d="M${x + s * 0.1} ${y + h * 0.82} L${x + s * 0.38} ${y + h * 0.5} L${x + s * 0.56} ${y + h * 0.68} L${x + s * 0.7} ${y + h * 0.56} L${x + s * 0.9} ${y + h * 0.82}"/><circle cx="${x + s * 0.7}" cy="${y + h * 0.3}" r="${s * 0.08}"/></g></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt, width, height };
}

/**
 * El documento del móvil con la estructura de la plantilla rellenada con
 * huecos. Sin plantilla, el documento tal cual. Lo que la pareja ya puso
 * nunca se toca: solo se rellena lo vacío.
 */
export function withTemplatePreview(document: SiteDocument, input: TemplatePreviewInput): TemplatePreview {
  if (!findBuilderTemplate(input.template)) return { document, gaps: [] };
  const palette = resolvePalette(document);
  const gaps: TemplateGap[] = [];
  // Sin foto decidida: el hueco de la foto (la portada de la plantilla es una foto).
  // Si eligieron seguir sin foto, la portada de papel es la suya y no hay mosaico.
  const photoOpen = input.photo !== "initials";
  const scenes = document.scenes.map((scene): Scene => {
    switch (scene.type) {
      case "cover": {
        if (scene.props.image || input.photo !== "pending") return scene;
        gaps.push({ path: `${scene.id}/${COVER_IMAGE_GAP_FIELD}`, kind: "photo" });
        // Con la proporción de su marco (el arco de Hora dorada es vertical): el dibujo queda centrado.
        const [w, h] = document.themeId === "clasico" ? [1000, 1500] : [1600, 2400];
        return { ...scene, props: { ...scene.props, image: placeholderImage(palette, w, h, document.themeId !== "clasico") } };
      }
      case "gallery": {
        if (!photoOpen || !scene.enabled || scene.props.images.length > 0) return scene;
        gaps.push({ path: `scene:${scene.id}`, kind: "gallery" });
        return { ...scene, props: { ...scene.props, images: GALLERY_SHAPES.map(([w, h]) => placeholderImage(palette, w, h)) } };
      }
      case "story": {
        if (!scene.enabled || sceneHasContent(scene)) return scene;
        gaps.push({ path: `${scene.id}/title`, kind: "story" });
        const titles: Record<string, string> = { met: "cómo nos conocimos", proposal: "el siguiente paso" };
        const chapters = STORY_QUESTIONS.map((q, i) => ({
          id: `hueco-${q.id}`,
          title: titles[q.id] ?? q.chapter,
          body: `${q.question} ${q.placeholder}`,
          images: photoOpen ? (CHAPTER_SHAPES[i] ?? []).map(([w, h]) => placeholderImage(palette, w, h)) : [],
        }));
        return { ...scene, props: { ...scene.props, chapters } };
      }
      case "details": {
        if (!scene.enabled || scene.props.cards.every(detailCardHasContent)) return scene;
        gaps.push({ path: `${scene.id}/title`, kind: "details" });
        const cards = scene.props.cards.map((card): DetailCard => (detailCardHasContent(card) ? card : { ...card, teaser: DETAIL_HINTS[card.id] ?? DETAIL_HINT }));
        return { ...scene, props: { ...scene.props, cards } };
      }
      case "faq": {
        if (!scene.enabled || scene.props.items.every(faqItemHasAnswer)) return scene;
        gaps.push({ path: `${scene.id}/title`, kind: "faq" });
        const items = scene.props.items.map((item) => (faqItemHasAnswer(item) ? item : { ...item, answer: FAQ_HINT }));
        return { ...scene, props: { ...scene.props, items } };
      }
      default:
        return scene;
    }
  });
  return { document: { ...document, scenes }, gaps };
}
