"use server";

/**
 * Subida de la foto de la pareja (portada de la web).
 *
 * Contrato (docs/handoffs/2026-10-03-v2/datos-ia.md, revisado por H05–H07 de
 * docs/audits/2026-10-04-revision-integral-vinklo.txt):
 *  - Solo con sesión y boda propia: la boda se resuelve con el cliente de
 *    sesión (RLS de `weddings`), nunca a partir de datos del formulario.
 *  - ≤ 4 MiB por archivo. Vercel corta el cuerpo de una función a 4,5 MB
 *    (413 FUNCTION_PAYLOAD_TOO_LARGE) y `serverActions.bodySizeLimit` está en
 *    4,25 MiB (next.config.ts) para que el multipart quepa antes del corte.
 *    Los clientes reducen la foto en el navegador antes de llamar aquí.
 *  - Contenido, no extensión: magic bytes JPEG/PNG/WebP como filtro barato y
 *    después decodificación completa con sharp (formato, ≤ 10 000 px por lado,
 *    ≤ 40 Mpx en total). Lo que sharp no decodifica se rechaza.
 *  - H06: el servidor SIEMPRE recodifica a JPEG (orientación aplicada, lado
 *    largo ≤ 2400 px, fondo blanco) sin metadatos: EXIF/GPS, XMP, IPTC y
 *    perfil ICC no llegan a Storage aunque el cliente no los quite.
 *  - Solo el servidor escribe (service_role, tras comprobar la boda con la
 *    sesión): la migración 20261006200000 retiró el insert/update directo de
 *    `authenticated`, así ningún byte sin recodificar llega a Storage.
 *  - H05 (cerrado, migración 20261007100000): la subida va al bucket PRIVADO
 *    `wedding-photos-drafts`, ruta `<wedding_id>/cover-<128 bits>.jpg`, sin
 *    sobrescribir. Una foto de borrador no es descargable por URL pública:
 *    solo la pareja la ve en el editor con una URL firmada de 1 h. Al
 *    publicar, `publishSite` la copia al bucket público `wedding-photos`.
 *  - NO toca el borrador: devuelve la referencia estable (`url`, lo que se
 *    guarda en `cover.props.image`, ver lib/photo-ref.ts), una URL firmada
 *    para enseñarla ya (`previewUrl`) y las dimensiones FINALES.
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { rateLimit } from "@/lib/rate-limit";
import { sniffImageKind } from "@/lib/data/image-meta";
import { signDraftPhoto, storeDraftPhoto } from "@/lib/data/photo-storage";
import { parseDraftPhotoUrl } from "@/lib/photo-ref";

/** Mismo valor que `file_size_limit` del bucket (migración 20261006200000). */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 10_000;
const MAX_PIXELS = 40_000_000;
/** Lado largo de la versión servida (igual que la preparación del editor). */
const OUTPUT_SIDE = 2400;
const OUTPUT_QUALITY = 84;
const DECODABLE = new Set(["jpeg", "png", "webp"]);

export type UploadCouplePhotoResult =
  | {
      ok: true;
      /** Referencia estable del borrador (bucket privado): lo que se guarda en el documento. */
      url: string;
      /** URL firmada de corta duración para el preview; null si no se pudo firmar (se reintenta con getCouplePhotoPreview). */
      previewUrl?: string | null;
      /** Caducidad de `previewUrl` (ms desde epoch). */
      previewExpiresAt?: number | null;
      width: number;
      height: number;
    }
  | { ok: false; error: string };

export type CouplePhotoPreviewResult = { ok: true; url: string; expiresAt: number } | { ok: false };

const ERRORS = {
  session: "La sesión ha caducado. Volved a entrar.",
  wedding: "No hemos encontrado vuestra boda. Cread la web primero.",
  missing: "Elegid una foto para subir.",
  size: "La foto pesa demasiado para subirla: el máximo son 4 MB. Probad con otra o reducidla antes.",
  type: "Ese archivo no es una foto válida. Usad JPG, PNG o WebP.",
  dimensions: "La foto es demasiado grande: como máximo 10 000 píxeles por lado y 40 megapíxeles.",
  rate: "Habéis subido muchas fotos seguidas. Esperad un momento y probad de nuevo.",
  generic: "No hemos podido subir la foto. Probad de nuevo.",
} as const;

type Processed = { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; error: string };

/**
 * Decodifica y recodifica la foto sin metadatos. No se exporta: en un módulo
 * "use server" cada export async sería una server action invocable.
 */
async function processPhoto(input: Uint8Array): Promise<Processed> {
  // Import dinámico: sharp es nativo y pesado. Si su binario no carga en el
  // runtime, solo falla esta subida (error controlado), no las demás server
  // actions que comparten módulo con la página (p. ej. guardar ajustes).
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    console.error("[photo] sharp no disponible", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return { ok: false, error: ERRORS.generic };
  }
  // `failOn: "error"` tolera avisos benignos de cámaras reales pero rechaza lo
  // que no se puede decodificar; `limitInputPixels` corta bombas de descompresión.
  const options = { failOn: "error", limitInputPixels: MAX_PIXELS } as const;
  let format: string | undefined;
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(input, options).metadata();
    format = meta.format;
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch (error) {
    // sharp lanza el mismo tipo de error para «demasiados píxeles» y «basura».
    if (error instanceof Error && /pixel limit/i.test(error.message)) return { ok: false, error: ERRORS.dimensions };
    return { ok: false, error: ERRORS.type };
  }
  // Solo los formatos del contrato, aunque sharp sepa leer GIF, SVG, TIFF…
  if (!format || !DECODABLE.has(format) || width <= 0 || height <= 0) return { ok: false, error: ERRORS.type };
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return { ok: false, error: ERRORS.dimensions };
  try {
    const { data, info } = await sharp(input, options)
      .rotate() // aplica la orientación EXIF antes de perderla
      .resize({ width: OUTPUT_SIDE, height: OUTPUT_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // PNG/WebP con transparencia
      .jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true })
      // Sin keepMetadata/withMetadata: sharp no copia EXIF, XMP, IPTC ni ICC.
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength > MAX_BYTES) return { ok: false, error: ERRORS.size };
    return { ok: true, bytes: data, width: info.width, height: info.height };
  } catch {
    return { ok: false, error: ERRORS.type };
  }
}

export async function uploadCouplePhoto(formData: FormData): Promise<UploadCouplePhotoResult> {
  const file = formData instanceof FormData ? formData.get("file") : null;
  if (!file || typeof file === "string" || file.size === 0) return { ok: false, error: ERRORS.missing };
  if (file.size > MAX_BYTES) return { ok: false, error: ERRORS.size };

  // Sesión y boda (por membresía: cualquiera de los dos novios).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERRORS.session };
  const current = await getCurrentWedding(supabase);
  if (!current) return { ok: false, error: ERRORS.wedding };
  const weddingId = current.wedding.id;

  const input = new Uint8Array(await file.arrayBuffer());
  if (input.byteLength > MAX_BYTES) return { ok: false, error: ERRORS.size };
  // Filtro barato antes de gastar CPU decodificando.
  if (!sniffImageKind(input)) return { ok: false, error: ERRORS.type };

  // 30 subidas por hora y usuario (fail-closed, como el resto de límites),
  // antes de decodificar: sharp es la parte cara.
  // Historia y galería suben varias fotos seguidas (hasta 12 + 6×4): tope holgado por hora.
  if (!(await rateLimit("photo", user.id, 80, 3600))) return { ok: false, error: ERRORS.rate };

  const processed = await processPhoto(input);
  if (!processed.ok) return processed;

  // service_role justificado: ningún bucket de fotos admite escrituras de la
  // sesión (solo así todo lo almacenado ha pasado por processPhoto). La
  // pertenencia se comprobó arriba con RLS y la ruta empieza por ese wedding_id.
  const stored = await storeDraftPhoto(weddingId, processed.bytes);
  if (!stored.ok) return { ok: false, error: ERRORS.generic };
  const preview = await signDraftPhoto(stored.path);
  return { ok: true, url: stored.url, previewUrl: preview?.url ?? null, previewExpiresAt: preview?.expiresAt ?? null, width: processed.width, height: processed.height };
}

/**
 * URL firmada (1 h) de una foto de BORRADOR para el editor. Solo con sesión y
 * solo para referencias canónicas del bucket privado cuya carpeta es la boda
 * de la sesión: firmar con service_role la foto de otra boda sería una fuga
 * entre parejas.
 */
export async function getCouplePhotoPreview(url: string): Promise<CouplePhotoPreviewResult> {
  if (typeof url !== "string" || url.length > 2048) return { ok: false };
  const ref = parseDraftPhotoUrl(url);
  if (!ref) return { ok: false };

  const current = await getCurrentWedding();
  if (!current || current.wedding.id !== ref.weddingId) return { ok: false };

  const signed = await signDraftPhoto(ref.path);
  return signed ? { ok: true, url: signed.url, expiresAt: signed.expiresAt } : { ok: false };
}
