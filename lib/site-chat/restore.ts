/**
 * Restaurar una versión y guardar un turno del chat. Puro y client-safe.
 *
 * - `restoredDocument`: el documento de una versión anterior, pero con las
 *   FOTOS actuales. Las fotos privadas que el borrador deja de usar se borran
 *   al guardar (lib/actions/site.ts), así que una versión antigua puede
 *   apuntar a una foto que ya no existe. La IA no toca fotos: restaurar
 *   devuelve textos, colores, secciones y orden; las fotos se quedan como
 *   están ahora.
 * - `saveOutcome`: qué decir en el chat según el resultado de guardar, con el
 *   conflicto (otra pestaña o la otra persona de la pareja guardó antes)
 *   explicado sin jerga.
 */
import { referencesDraftPhoto } from "@/lib/photo-ref";
import { collectImages, findScene, type Scene, type SceneImage, type SiteDocument } from "@/lib/site-document";

export function restoredDocument(target: SiteDocument, current: SiteDocument): SiteDocument {
  const currentUrls = new Set(collectImages(current).map((image) => image.url));
  // Una foto que no está en el borrador actual solo vuelve si es pública
  // (nunca se borra al guardar); las privadas pueden haber desaparecido.
  const survives = (image: SceneImage) => currentUrls.has(image.url) || !referencesDraftPhoto(image.url);
  const currentCover = findScene(current, "cover")?.props.image ?? null;
  const currentScene = (id: string) => current.scenes.find((scene) => scene.id === id);

  return {
    ...target,
    scenes: target.scenes.map((scene): Scene => {
      switch (scene.type) {
        case "cover":
          return { ...scene, props: { ...scene.props, image: currentCover } };
        case "gallery": {
          const now = currentScene(scene.id);
          return { ...scene, props: { ...scene.props, images: now?.type === "gallery" ? now.props.images : scene.props.images.filter(survives) } };
        }
        case "story": {
          const now = currentScene(scene.id);
          const chapters = now?.type === "story" ? now.props.chapters : [];
          return {
            ...scene,
            props: {
              ...scene.props,
              chapters: scene.props.chapters.map((chapter) => {
                const same = chapters.find((c) => c.id === chapter.id);
                return { ...chapter, images: same ? same.images : chapter.images.filter(survives) };
              }),
            },
          };
        }
        default:
          return scene;
      }
    }),
  };
}

/** Lo que devuelve `saveSiteDraft` (sin importar el archivo "use server"). */
export type SaveLike =
  | { ok: true; draftVersion: number; history?: { id: string; createdAt: string } | null }
  | { ok: false; code: "conflict" | "invalid" | "error"; error: string };

export const CONFLICT_MESSAGE = "Mientras lo preparábamos, se guardó otra versión de la web (quizá desde otra pestaña o la otra persona de la pareja). No lo hemos aplicado para no pisar ese cambio. Ya tenéis delante la versión más reciente: pedidlo otra vez si aún hace falta.";
export const SAVE_ERROR_MESSAGE = "No hemos podido guardar el cambio en el borrador. Revisad la conexión y probad de nuevo.";

export type SaveOutcome =
  | { ok: true; draftVersion: number; historyId: string | null; createdAt: string | null }
  | { ok: false; conflict: boolean; error: string; retryable: boolean };

/** Resultado de guardar → qué pasa en el chat. Un fallo de red (throw) también es un error reintentable. */
export async function saveOutcome(save: () => Promise<SaveLike>): Promise<SaveOutcome> {
  let result: SaveLike;
  try {
    result = await save();
  } catch {
    return { ok: false, conflict: false, error: SAVE_ERROR_MESSAGE, retryable: true };
  }
  if (result.ok) return { ok: true, draftVersion: result.draftVersion, historyId: result.history?.id ?? null, createdAt: result.history?.createdAt ?? null };
  if (result.code === "conflict") return { ok: false, conflict: true, error: CONFLICT_MESSAGE, retryable: true };
  if (result.code === "invalid") return { ok: false, conflict: false, error: result.error || SAVE_ERROR_MESSAGE, retryable: false };
  return { ok: false, conflict: false, error: result.error || SAVE_ERROR_MESSAGE, retryable: true };
}
