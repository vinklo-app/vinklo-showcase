/**
 * Referencias a la foto de la pareja en Storage (H05, migración 20261007100000).
 *
 * Dos buckets:
 *  - `wedding-photos-drafts` (PRIVADO): lo que sube la pareja mientras edita.
 *    El borrador guarda una referencia ESTABLE (no caduca, no es servible):
 *      https://<proyecto>/storage/v1/object/authenticated/wedding-photos-drafts/<wedding_id>/cover-<32 hex>.jpg
 *    Pasa `sceneImageSchema` (https, ≤ 2048) y, si alguien la pintase tal
 *    cual, Storage respondería 400/401 sin token: falla cerrado. El editor la
 *    enseña con una URL firmada de corta duración (getCouplePhotoPreview).
 *  - `wedding-photos` (PÚBLICO): solo lo publicado. publishSite copia el
 *    objeto privado aquí con otra ruta aleatoria y reescribe la URL.
 *
 * Puro y client-safe: el editor lo usa para saber qué fotos necesitan firma y
 * el servidor para validar pertenencia (el wedding_id de la ruta debe ser el
 * de la sesión ANTES de firmar o copiar con service_role).
 */

export const DRAFT_PHOTOS_BUCKET = "wedding-photos-drafts";
export const PUBLIC_PHOTOS_BUCKET = "wedding-photos";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DRAFT_PATH = new RegExp(`^/storage/v1/object/authenticated/${DRAFT_PHOTOS_BUCKET}/(${UUID})/(cover-[0-9a-f]{32}\\.jpg)$`);
/** Cualquier forma de URL de Storage hacia el bucket privado (igual que site_document_has_private_media en SQL). */
const ANY_DRAFT_REFERENCE = new RegExp(`/storage/v1/(?:object|render/image)/(?:[a-z]+/)?${DRAFT_PHOTOS_BUCKET}/`);

export interface DraftPhotoRef {
  weddingId: string;
  /** Ruta del objeto dentro del bucket privado: `<wedding_id>/cover-<hex>.jpg`. */
  path: string;
}

function supabaseHost(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
}

/** Referencia estable que se guarda en el borrador para un objeto privado. */
export function draftPhotoUrl(path: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  const base = (supabaseUrl ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/authenticated/${DRAFT_PHOTOS_BUCKET}/${path}`;
}

/**
 * true si la URL apunta (de cualquier forma) al bucket privado. Úsese para
 * decidir que una imagen NO puede pintarse tal cual ni publicarse.
 */
export function referencesDraftPhoto(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return ANY_DRAFT_REFERENCE.test(new URL(url).pathname);
  } catch {
    return ANY_DRAFT_REFERENCE.test(url);
  }
}

/**
 * Analiza una referencia de borrador bien formada de NUESTRO proyecto de
 * Supabase. null si no lo es (otro host, otra forma, ruta no canónica).
 */
export function parseDraftPhotoUrl(url: string | null | undefined, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): DraftPhotoRef | null {
  if (!url) return null;
  const host = supabaseHost(supabaseUrl);
  if (!host) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.host !== host || target.search || target.hash || target.username || target.password) return null;
  const match = DRAFT_PATH.exec(target.pathname);
  if (!match) return null;
  return { weddingId: match[1], path: `${match[1]}/${match[2]}` };
}
