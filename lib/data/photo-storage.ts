/**
 * Operaciones de Storage sobre la foto de la pareja con service_role (H05).
 *
 * Vive fuera de los archivos "use server" para no convertirse en server
 * actions invocables. Quien llama YA ha comprobado la sesión y que el
 * wedding_id de la ruta es el de su boda (RLS de `weddings`): aquí no se
 * vuelve a autorizar, solo se opera sobre rutas ya validadas.
 *
 *  - Borradores: bucket privado `wedding-photos-drafts`, URLs firmadas de 1 h.
 *  - Publicado: bucket público `wedding-photos`, caché de 1 h (como desde
 *    20261006200000), ruta aleatoria NUEVA (no se deduce la del borrador).
 *  - Nunca se borra nada del bucket público: puede estar en revisiones
 *    publicadas (actuales o anteriores) o en la OG image. Excepciones:
 *    discardUnpublishedCopy (abajo) y el borrado de la boda entera
 *    (lib/data/account-deletion.ts, plan maestro §5.10).
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRAFT_PHOTOS_BUCKET, PUBLIC_PHOTOS_BUCKET, draftPhotoUrl } from "@/lib/photo-ref";

/** Duración de las URLs firmadas del preview del editor. */
export const DRAFT_PREVIEW_TTL_SECONDS = 3600;
const CACHE_CONTROL = "3600";

export function newCoverPath(weddingId: string): string {
  return `${weddingId}/cover-${randomBytes(16).toString("hex")}.jpg`;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const e = error as { statusCode?: string | number; status?: string | number; name?: string };
  return String(e.statusCode ?? e.status ?? e.name ?? "unknown");
}

/** Sube bytes ya procesados (sharp) al bucket privado. Devuelve la ruta. */
export async function storeDraftPhoto(weddingId: string, bytes: Buffer): Promise<{ ok: true; path: string; url: string } | { ok: false }> {
  const path = newCoverPath(weddingId);
  const { error } = await createAdminClient().storage.from(DRAFT_PHOTOS_BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    cacheControl: CACHE_CONTROL,
    upsert: false,
  });
  if (error) {
    console.error("[photo] draft upload failed", errorCode(error));
    return { ok: false };
  }
  return { ok: true, path, url: draftPhotoUrl(path) };
}

/** URL firmada de corta duración para enseñar un borrador en el editor. */
export async function signDraftPhoto(path: string): Promise<{ url: string; expiresAt: number } | null> {
  const { data, error } = await createAdminClient().storage.from(DRAFT_PHOTOS_BUCKET).createSignedUrl(path, DRAFT_PREVIEW_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    if (error) console.error("[photo] sign failed", errorCode(error));
    return null;
  }
  return { url: data.signedUrl, expiresAt: Date.now() + DRAFT_PREVIEW_TTL_SECONDS * 1000 };
}

export type PromoteResult = { ok: true; path: string; url: string } | { ok: false; reason: "missing" | "error" };

/**
 * Copia un borrador privado al bucket público con una ruta aleatoria nueva.
 * Descargar + subir (no `copy`) para fijar tipo y caché explícitamente y no
 * depender de la copia entre buckets. `missing`: no se pudo leer el borrador
 * (p. ej. se sustituyó en otra pestaña y se borró): hay que volver a subirla.
 */
export async function promoteDraftPhoto(weddingId: string, draftPath: string): Promise<PromoteResult> {
  const storage = createAdminClient().storage;
  const { data: blob, error: downloadError } = await storage.from(DRAFT_PHOTOS_BUCKET).download(draftPath);
  if (downloadError || !blob) {
    // Storage no distingue con fiabilidad «no existe» de otros fallos de
    // descarga (400/404 según versión): el mensaje al usuario cubre ambos.
    console.error("[photo] promote download failed", errorCode(downloadError));
    return { ok: false, reason: "missing" };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const path = newCoverPath(weddingId);
  const bucket = storage.from(PUBLIC_PHOTOS_BUCKET);
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: "image/jpeg", cacheControl: CACHE_CONTROL, upsert: false });
  if (uploadError) {
    console.error("[photo] promote upload failed", errorCode(uploadError));
    return { ok: false, reason: "error" };
  }
  const { data } = bucket.getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, reason: "error" };
  return { ok: true, path, url: data.publicUrl };
}

/** Borra objetos del bucket PRIVADO (mejor esfuerzo: nunca lanza). */
export async function removeDraftPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await createAdminClient().storage.from(DRAFT_PHOTOS_BUCKET).remove(paths);
    if (error) console.error("[photo] draft remove failed", errorCode(error));
  } catch (cause) {
    console.error("[photo] draft remove threw", cause instanceof Error ? cause.message.slice(0, 200) : "unknown");
  }
}

/**
 * Deshace una copia pública recién hecha que NO llegó a publicarse (la
 * publicación falló y el borrador volvió a la referencia privada). Única
 * excepción a «nunca se borra del bucket público»: el objeto se creó en esta
 * misma petición y ninguna revisión lo referencia.
 */
export async function discardUnpublishedCopy(path: string): Promise<void> {
  try {
    const { error } = await createAdminClient().storage.from(PUBLIC_PHOTOS_BUCKET).remove([path]);
    if (error) console.error("[photo] discard copy failed", errorCode(error));
  } catch (cause) {
    console.error("[photo] discard copy threw", cause instanceof Error ? cause.message.slice(0, 200) : "unknown");
  }
}
