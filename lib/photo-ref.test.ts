import { describe, expect, it } from "vitest";
import { isOptimizableImage } from "@/components/invitation/format";
import { sceneImageSchema } from "@/lib/site-document";
import { draftPhotoUrl, parseDraftPhotoUrl, referencesDraftPhoto } from "./photo-ref";

const base = "https://sb.example.co";
const weddingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const path = `${weddingId}/cover-${"f".repeat(32)}.jpg`;

describe("photo-ref (H05)", () => {
  it("la referencia de borrador es estable, cumple el contrato del documento y se analiza de vuelta", () => {
    const url = draftPhotoUrl(path, base);
    expect(url).toBe(`${base}/storage/v1/object/authenticated/wedding-photos-drafts/${path}`);
    expect(sceneImageSchema.safeParse({ url, alt: "" }).success).toBe(true);
    expect(parseDraftPhotoUrl(url, base)).toEqual({ weddingId, path });
  });

  it("solo acepta la forma canónica de nuestro proyecto", () => {
    const url = draftPhotoUrl(path, base);
    for (const bad of [
      url.replace("https:", "http:"),
      url.replace("sb.example.co", "otro.example.co"),
      url.replace("/authenticated/", "/sign/"),
      `${url}?token=x`,
      url.replace("cover-", "../cover-"),
      url.replace(".jpg", ".png"),
      url.replace(weddingId, "no-es-uuid"),
    ]) {
      expect(parseDraftPhotoUrl(bad, base)).toBeNull();
    }
    expect(parseDraftPhotoUrl(url, undefined)).toBeNull();
  });

  it("detecta cualquier forma de URL hacia el bucket privado, y no las públicas", () => {
    expect(referencesDraftPhoto(draftPhotoUrl(path, base))).toBe(true);
    expect(referencesDraftPhoto(`${base}/storage/v1/object/sign/wedding-photos-drafts/${path}?token=x`)).toBe(true);
    expect(referencesDraftPhoto(`${base}/storage/v1/object/public/wedding-photos-drafts/${path}`)).toBe(true);
    expect(referencesDraftPhoto(`${base}/storage/v1/render/image/sign/wedding-photos-drafts/${path}?token=x`)).toBe(true);
    expect(referencesDraftPhoto(`${base}/storage/v1/object/public/wedding-photos/${path}`)).toBe(false);
    expect(referencesDraftPhoto("blob:http://localhost/x")).toBe(false);
    expect(referencesDraftPhoto(null)).toBe(false);
    // Texto libre que solo nombra el bucket no cuenta (igual que en SQL).
    expect(referencesDraftPhoto("Nuestra carpeta wedding-photos-drafts")).toBe(false);
  });

  it("next/image no optimiza URLs firmadas ni referencias privadas: van sin optimizar", () => {
    expect(isOptimizableImage(`${base}/storage/v1/object/sign/wedding-photos-drafts/${path}?token=x`, base)).toBe(false);
    expect(isOptimizableImage(draftPhotoUrl(path, base), base)).toBe(false);
    expect(isOptimizableImage(`${base}/storage/v1/object/public/wedding-photos/${path}`, base)).toBe(true);
  });
});
