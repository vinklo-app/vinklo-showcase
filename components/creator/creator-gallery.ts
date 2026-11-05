/**
 * «Más fotos» del creador → escena de galería del documento.
 *
 * La galería va JUSTO DETRÁS de la portada: con foto de portada y 4+ fotos,
 * la maqueta «Como una web» abre con el mosaico alrededor de la portada (como
 * /demo; ver `orbitGallery` en components/invitation/renderer.tsx, que exige
 * que la galería sea la primera sección con contenido). Con menos fotos se
 * pinta como galería normal.
 *
 * Se aplica DESPUÉS de `composeBuilderDocument` (lib/wedding-builder.ts no
 * sabe nada de esto): igual que la foto de portada, una URL `blob:` no pasa
 * el contrato, así que la galería entra al final y `saveSiteDraft` vuelve a
 * validar las URLs https al guardar.
 */
import { SITE_MAX_GALLERY_IMAGES, type Scene, type SceneImage, type SiteDocument } from "@/lib/site-document";

/** Fotos extra que se pueden elegir en el creador (además de la portada). */
export const CREATOR_GALLERY_MAX = 6;
/** Fotos de galería a partir de las cuales la portada se abre en mosaico. */
export const CREATOR_MOSAIC_MIN = 4;

const BASE_ID = "fotos";

function freeId(doc: SiteDocument): string {
  const taken = new Set(doc.scenes.map((scene) => scene.id));
  let id = BASE_ID;
  for (let n = 2; taken.has(id); n++) id = `${BASE_ID}-${n}`;
  return id;
}

/**
 * Copia de `doc` con `images` en una galería tras la portada. Si ya hay una
 * galería, se le añaden (hasta el tope) y se sube tras la portada. Puro.
 */
export function withCreatorGallery(doc: SiteDocument, images: readonly SceneImage[]): SiteDocument {
  if (images.length === 0) return doc;
  const existing = doc.scenes.find((scene): scene is Extract<Scene, { type: "gallery" }> => scene.type === "gallery");
  const gallery: Scene = existing
    ? { ...existing, enabled: true, props: { ...existing.props, images: [...existing.props.images, ...images].slice(0, SITE_MAX_GALLERY_IMAGES) } }
    : { id: freeId(doc), type: "gallery", enabled: true, props: { title: "", images: images.slice(0, SITE_MAX_GALLERY_IMAGES) } };
  const rest = doc.scenes.filter((scene) => scene !== existing);
  const coverAt = rest.findIndex((scene) => scene.type === "cover");
  const at = coverAt === -1 ? 0 : coverAt + 1;
  return { ...doc, scenes: [...rest.slice(0, at), gallery, ...rest.slice(at)] };
}
