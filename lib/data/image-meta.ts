/**
 * Detección de tipo y dimensiones de imagen a partir de los bytes de
 * cabecera (sin dependencias). Solo JPEG, PNG y WebP: el resto se rechaza.
 * Puro: sin "server-only" para poder probarlo y reutilizarlo en el cliente.
 */

export type ImageKind = "jpeg" | "png" | "webp";

export const IMAGE_MIME: Record<ImageKind, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const IMAGE_EXT: Record<ImageKind, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export interface ImageMeta {
  kind: ImageKind;
  width: number;
  height: number;
}

/** Tipo real por magic bytes (ignora el nombre y el Content-Type declarados). */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Tipo + dimensiones, o null si la cabecera no es válida o está truncada. */
export function readImageMeta(bytes: Uint8Array): ImageMeta | null {
  const kind = sniffImageKind(bytes);
  if (!kind) return null;
  const size = kind === "png" ? pngSize(bytes) : kind === "jpeg" ? jpegSize(bytes) : webpSize(bytes);
  if (!size || size.width < 1 || size.height < 1) return null;
  return { kind, ...size };
}

type Size = { width: number; height: number };

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);
}
function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}

function pngSize(b: Uint8Array): Size | null {
  // Firma (8) + longitud (4) + "IHDR" (4) + ancho (4) + alto (4).
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Recorre los segmentos hasta el primer SOF (C0–C3, C5–C7, C9–CB, CD–CF). */
function jpegSize(b: Uint8Array): Size | null {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    let marker = b[o + 1]!;
    // Relleno 0xFF entre segmentos.
    while (marker === 0xff && o + 2 < b.length) {
      o += 1;
      marker = b[o + 1]!;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fin o datos sin SOF previo
    const length = u16be(b, o + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > b.length) return null;
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): Size | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // Frame con pérdida: firma 9D 01 2A en el byte 23; 14 bits de ancho/alto.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}
