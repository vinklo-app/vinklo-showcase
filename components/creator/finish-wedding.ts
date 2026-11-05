/**
 * Lo que pasa justo DESPUÉS de que `createWeddingFromCreator` crea la boda (ya
 * hay sesión y boda; la fila de la web nace como BORRADOR v1, sin publicar,
 * con el documento del creador sin foto —`initial: "creator"`— o, si ese no
 * valió, con el adaptador):
 *
 *  1. Si la pareja eligió foto, se sube con `uploadCouplePhoto` al bucket
 *     PRIVADO de borradores (H05); el documento guarda su referencia estable
 *     (`uploaded.url`). El creador la previsualiza con el `blob:` local.
 *  1b. Las «Más fotos» (hasta 6) suben igual, de dos en dos y en el orden
 *     elegido, y forman la galería tras la portada (`withCreatorGallery`).
 *     Una que falle no frena a las demás; se cuenta para avisar.
 *  2. Con las fotos ya procesadas se guarda el documento completo con
 *     `saveSiteDraft` (si hay algo que añadir al borrador v1) y se publica UNA
 *     sola vez con `publishSite`, que copia las fotos al bucket público antes
 *     de publicar. Así ningún invitado ve una portada sin foto que luego
 *     cambia. Si una foto falla, se publica igualmente sin ella (la pareja
 *     conserva una web que funciona) y se avisa para que la reintente. Si la
 *     publicación falla (`site: "draft"`), la web queda en borrador y el panel
 *     ofrece «Publicar nuestra web».
 *
 * Un fallo nunca deshace la boda: se devuelve qué falló para explicarlo con
 * precisión (`/onboarding/listo`, que con todo bien lo celebra). Las acciones llegan inyectadas para poder
 * probar el recorrido sin Supabase.
 */
import type { UploadCouplePhotoResult } from "@/lib/actions/photo";
import type { PublishResult, SaveDraftResult } from "@/lib/actions/site";
import type { InitialSite } from "@/lib/actions/wedding";
import { composeBuilderDocument, type BuilderDraft } from "@/lib/wedding-builder";
import type { SceneImage } from "@/lib/site-document";
import { PHOTO_UPLOAD_CONCURRENCY, mapWithConcurrency } from "@/lib/photo-batch";
import type { PreparedPhoto } from "./photo-prepare";
import { CREATOR_GALLERY_MAX, withCreatorGallery } from "./creator-gallery";

export interface FinishDeps {
  upload: (formData: FormData) => Promise<UploadCouplePhotoResult>;
  save: (input: { document: unknown; baseVersion: number }) => Promise<SaveDraftResult>;
  publish: (input: { baseVersion: number }) => Promise<PublishResult>;
  /** Opcional: qué está pasando ahora, para que el botón lo diga con verdad. */
  onStage?: (stage: FinishStage) => void;
}

export type FinishStage = "photo" | "gallery" | "save" | "publish";

/** Códigos estables (nunca texto libre en la URL de `/onboarding/listo`). */
export type PhotoFailure = "size" | "type" | "dimensions" | "rate" | "session" | "generic";
export type FinishResult = {
  photo: "none" | "ok" | PhotoFailure;
  /** ok = publicada una vez con todo; draft = creada y guardada pero sin publicar; failed = no se pudo guardar el diseño final (publicada con el estilo base si fue posible). */
  site: "ok" | "draft" | "failed";
  /** Solo si eligieron «Más fotos»: cuántas subieron y cuántas no. */
  gallery?: { ok: number; failed: number };
};

const PHOTO_CODES: ReadonlyArray<[RegExp, PhotoFailure]> = [
  [/pesa demasiado/, "size"],
  [/no es una foto/, "type"],
  [/10\s?000/, "dimensions"],
  [/muchas fotos/, "rate"],
  [/sesión/, "session"],
];

export function photoFailureCode(error: string): PhotoFailure {
  return PHOTO_CODES.find(([pattern]) => pattern.test(error))?.[1] ?? "generic";
}

/** Versión del borrador que deja `createWeddingFromCreator` (fila creada con draft_version 1). */
const INITIAL_DRAFT_VERSION = 1;

function photoForm(photo: PreparedPhoto, name: string): FormData {
  const formData = new FormData();
  formData.append("file", new File([photo.blob], name, { type: photo.blob.type || "image/jpeg" }));
  return formData;
}

export async function finishCreatedWedding(draft: BuilderDraft, photo: PreparedPhoto | null, deps: FinishDeps, initial: InitialSite = "legacy", gallery: readonly PreparedPhoto[] = []): Promise<FinishResult> {
  const result: FinishResult = { photo: "none", site: "draft" };
  const name1 = draft.partnerName1.trim();
  const name2 = draft.partnerName2.trim();

  let image = null;
  if (photo) {
    deps.onStage?.("photo");
    try {
      const uploaded = await deps.upload(photoForm(photo, "foto-pareja.jpg"));
      if (uploaded.ok) {
        image = { url: uploaded.url, alt: `Foto de ${name1} y ${name2}`.slice(0, 160), width: uploaded.width, height: uploaded.height };
        result.photo = "ok";
      } else {
        result.photo = photoFailureCode(uploaded.error);
      }
    } catch {
      // Rechazo de la acción (red, 413 por tamaño, 504): la boda sigue creada.
      result.photo = "generic";
    }
  }

  const extras = gallery.slice(0, CREATOR_GALLERY_MAX);
  const galleryImages: SceneImage[] = [];
  if (extras.length > 0) {
    deps.onStage?.("gallery");
    const settled = await mapWithConcurrency(extras, PHOTO_UPLOAD_CONCURRENCY, async (extra, index) => {
      const uploaded = await deps.upload(photoForm(extra, `foto-${index + 1}.jpg`));
      if (!uploaded.ok) throw new Error(uploaded.error);
      return { url: uploaded.url, alt: `Foto ${index + 1} de ${name1} y ${name2}`.slice(0, 160), width: uploaded.width, height: uploaded.height };
    });
    // En el orden en que las eligieron, aunque terminen desordenadas.
    for (const item of settled) if (item.ok) galleryImages.push(item.value);
    result.gallery = { ok: galleryImages.length, failed: extras.length - galleryImages.length };
  }

  // Sin fotos subidas y con el documento del creador ya como borrador v1, ese
  // borrador es exactamente lo que vieron: solo se publica. Si el borrador v1
  // es el adaptador (o no existe), se guarda antes el documento completo: el
  // adaptador no lleva sobre, colores, maqueta ni escenas.
  const needsSave = image !== null || galleryImages.length > 0 || initial !== "creator";
  let baseVersion = initial === "failed" ? 0 : INITIAL_DRAFT_VERSION;
  try {
    if (needsSave) {
      const document = withCreatorGallery(composeBuilderDocument({ ...draft, partnerName1: name1, partnerName2: name2 }, image), galleryImages);
      deps.onStage?.("save");
      let saved: SaveDraftResult;
      try {
        saved = await deps.save({ document, baseVersion });
        // Solo si la fila no existe (el borrador inicial falló) se crea; un
        // conflicto con otra versión significa que no es la web recién creada:
        // nunca se pisa.
        if (!saved.ok && saved.code === "conflict" && saved.draftVersion === 0 && baseVersion !== 0) saved = await deps.save({ document, baseVersion: 0 });
      } catch {
        // Acción rechazada (red, 504): se publica el borrador base.
        return await publishFallback(result, baseVersion, deps);
      }
      if (saved.ok) baseVersion = saved.draftVersion;
      // Otra versión en la fila: no es la web recién creada, no se toca ni se
      // publica; queda en borrador para publicarla desde el panel.
      else if (saved.code === "conflict" && saved.draftVersion !== 0) return { ...result, site: "draft" };
      else return await publishFallback(result, baseVersion, deps);
    }
    return await publishOnce(result, baseVersion, deps, "draft");
  } catch {
    // Nada se ha publicado: borrador.
    return { ...result, site: "draft" };
  }
}

/** La única publicación. `onFail` = lo que se informa si no sale. */
async function publishOnce(result: FinishResult, baseVersion: number, deps: FinishDeps, onFail: FinishResult["site"]): Promise<FinishResult> {
  deps.onStage?.("publish");
  try {
    const published = await deps.publish({ baseVersion });
    return { ...result, site: published.ok ? "ok" : onFail };
  } catch {
    return { ...result, site: onFail };
  }
}

/**
 * No se pudo guardar el documento final: se publica el borrador que ya hay
 * (con el estilo base, sin las fotos que no llegaron a guardarse) para que la
 * pareja no se quede sin web. `failed` = publicada con el estilo base; si ni
 * eso sale, `draft`: creada y sin publicar.
 */
async function publishFallback(result: FinishResult, baseVersion: number, deps: FinishDeps): Promise<FinishResult> {
  // Las fotos subidas no están en el borrador: que no se anuncien como hechas.
  const unsaved: FinishResult = {
    ...result,
    ...(result.photo === "ok" ? { photo: "generic" as const } : {}),
    ...(result.gallery && result.gallery.ok > 0 ? { gallery: { ok: 0, failed: result.gallery.ok + result.gallery.failed } } : {}),
  };
  const published = await publishOnce(unsaved, baseVersion, deps, "draft");
  return published.site === "ok" ? { ...published, site: "failed" } : published;
}

/**
 * Destino tras crear la boda: siempre `/onboarding/listo` (revisión UX, ítem 8).
 * Sin query, todo salió y se celebra; con query, qué no salió (códigos fijos).
 */
export function finishNotice(result: FinishResult): string {
  const params = new URLSearchParams();
  if (result.photo !== "none" && result.photo !== "ok") params.set("foto", result.photo);
  if (result.gallery && result.gallery.failed > 0) params.set("fotos", String(result.gallery.failed));
  if (result.site === "draft" || result.site === "failed") params.set("web", result.site);
  const query = params.toString();
  return query ? `/onboarding/listo?${query}` : "/onboarding/listo";
}
