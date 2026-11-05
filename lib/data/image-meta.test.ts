import { describe, expect, it } from "vitest";
import { readImageMeta, sniffImageKind } from "./image-meta";

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** PNG mínimo: firma + IHDR con ancho/alto. */
function pngHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

/** JPEG mínimo: SOI + APP0 (relleno) + SOF2 progresivo con alto/ancho. */
function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

/** WebP extendido (VP8X) con lienzo width×height. */
function webpX(width: number, height: number): Uint8Array {
  const out = new Uint8Array(30);
  out.set([...Buffer.from("RIFF"), 22, 0, 0, 0, ...Buffer.from("WEBPVP8X"), 10, 0, 0, 0, 0, 0, 0, 0]);
  const w = width - 1;
  const h = height - 1;
  out.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return out;
}

describe("readImageMeta", () => {
  it("lee PNG", () => {
    expect(readImageMeta(pngHeader(1600, 1067))).toEqual({ kind: "png", width: 1600, height: 1067 });
  });
  it("lee JPEG saltando segmentos hasta el SOF", () => {
    expect(readImageMeta(jpegHeader(4032, 3024))).toEqual({ kind: "jpeg", width: 4032, height: 3024 });
  });
  it("lee WebP con pérdida (VP8), sin pérdida (VP8L) y extendido (VP8X)", () => {
    expect(readImageMeta(b64("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA="))).toEqual({ kind: "webp", width: 1, height: 1 });
    expect(readImageMeta(b64("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="))).toEqual({ kind: "webp", width: 1, height: 1 });
    expect(readImageMeta(webpX(2400, 1600))).toEqual({ kind: "webp", width: 2400, height: 1600 });
  });
  it("rechaza otros formatos, cabeceras truncadas y dimensiones cero", () => {
    expect(sniffImageKind(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(readImageMeta(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(readImageMeta(pngHeader(10, 10).subarray(0, 20))).toBeNull();
    expect(readImageMeta(jpegHeader(10, 10).subarray(0, 10))).toBeNull();
    expect(readImageMeta(pngHeader(0, 10))).toBeNull();
    expect(readImageMeta(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });
});
