/**
 * Prepara la foto de la pareja en el navegador antes de guardarla o subirla.
 *
 * Dos límites distintos (H07, docs/audits/2026-10-04-revision-integral-vinklo.txt):
 *  - Foto ORIGINAL elegida: JPG, PNG o WebP de hasta 25 MB. Una foto normal de
 *    móvil pesa 3–12 MB; se reduce aquí, así que no hace falta rechazarla.
 *  - HEIC (fotos del iPhone): `PHOTO_ACCEPT` NO la incluye a propósito. Con
 *    una lista de tipos sin HEIC, Safari de iOS convierte la foto a JPEG al
 *    elegirla de la Fototeca. Si aun así llega una HEIC (Mac, Android, un
 *    archivo copiado), se intenta abrir (Safari sabe); si el navegador no
 *    puede (Chrome), se explica con `PHOTO_ERRORS.heic`. Nunca viaja HEIC al
 *    servidor: lo que sube es siempre el JPEG del canvas.
 *  - Foto SUBIDA (lo que viaja a `uploadCouplePhoto`): JPEG ≤ 900 KB. La
 *    acción admite hasta 4 MB (`serverActions.bodySizeLimit` 4,25 MB, bajo
 *    el corte de 4,5 MB de Vercel Functions); el margen cubre el multipart.
 *
 *  - La redibuja en un <canvas> con la orientación EXIF aplicada: el canvas
 *    no copia metadatos, así que la ubicación GPS o el modelo de cámara no
 *    salen del móvil en el flujo normal. El servidor vuelve a recodificar y
 *    quitar metadatos (H06): esto es privacidad por defecto, no la frontera.
 *  - La reduce a ≤ 2000 px de lado largo y la codifica en JPEG.
 *
 * Nunca convierte a base64: devuelve un Blob que vive en memoria/IndexedDB.
 */
/** Peso máximo de la foto original antes de reducirla en el navegador. */
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024;
/** Lista del `accept` en creador y panel (sin HEIC: así iOS la entrega en JPEG). */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const PHOTO_TYPES = new Set(PHOTO_ACCEPT.split(","));
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
/** Presupuesto de la subida ya reducida (multipart incluido), muy por debajo del límite de 4 MB de la acción. */
export const PHOTO_UPLOAD_BUDGET = 900 * 1024;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export type PreparePhotoResult = { ok: true; photo: PreparedPhoto } | { ok: false; error: string };

export const PHOTO_ERRORS = {
  type: "Ese archivo no es una foto válida. Usad JPG, PNG o WebP.",
  size: "La foto pesa demasiado: el máximo son 25 MB.",
  /** No se ha podido reducir por debajo del presupuesto de subida. */
  budget: "No hemos podido reducir la foto lo suficiente para subirla. Probad con otra.",
  decode: "No hemos podido abrir esa foto. Probad con otra en JPG, PNG o WebP.",
  heic: "Esta foto está en formato HEIC y este navegador no puede abrirla. Elegidla desde el iPhone (se convierte sola) o guardadla en JPG y probad de nuevo.",
} as const;

/** ¿Es una HEIC/HEIF? Por tipo o, si el navegador no da tipo (Chrome), por extensión. */
export function isHeicFile(file: Pick<File, "type"> & { name?: string }): boolean {
  if (HEIC_TYPES.has(file.type.toLowerCase())) return true;
  return file.type === "" && /\.(heic|heif)$/i.test(file.name ?? "");
}

/**
 * Validación previa (sin decodificar): tipo y peso. Una HEIC pasa: se intenta
 * abrir y, si el navegador no sabe, `preparePhoto` devuelve `PHOTO_ERRORS.heic`.
 */
export function checkPhotoFile(file: Pick<File, "type" | "size"> & { name?: string }): string | null {
  if (!PHOTO_TYPES.has(file.type) && !isHeicFile(file)) return PHOTO_ERRORS.type;
  if (file.size === 0) return PHOTO_ERRORS.decode;
  if (file.size > PHOTO_MAX_BYTES) return PHOTO_ERRORS.size;
  return null;
}

/** Tamaño de salida conservando proporción, con el lado largo ≤ `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const ATTEMPTS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 2000, quality: 0.86 },
  { side: 2000, quality: 0.78 },
  { side: 1600, quality: 0.8 },
  { side: 1280, quality: 0.78 },
];

export async function preparePhoto(file: File): Promise<PreparePhotoResult> {
  const invalid = checkPhotoFile(file);
  if (invalid) return { ok: false, error: invalid };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: isHeicFile(file) ? PHOTO_ERRORS.heic : PHOTO_ERRORS.decode };
  }
  try {
    for (const attempt of ATTEMPTS) {
      const size = fitWithin(bitmap.width, bitmap.height, attempt.side);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return { ok: false, error: PHOTO_ERRORS.decode };
      // Un PNG con transparencia no puede quedar negro al pasar a JPEG.
      context.fillStyle = "white";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", attempt.quality));
      if (blob && blob.size <= PHOTO_UPLOAD_BUDGET) return { ok: true, photo: { blob, width: size.width, height: size.height } };
    }
    return { ok: false, error: PHOTO_ERRORS.budget };
  } finally {
    bitmap.close();
  }
}
