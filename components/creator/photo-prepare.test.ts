import { describe, expect, it } from "vitest";
import { PHOTO_ACCEPT, PHOTO_ERRORS, PHOTO_MAX_BYTES, PHOTO_UPLOAD_BUDGET, checkPhotoFile, fitWithin, isHeicFile } from "./photo-prepare";

const MB = 1024 * 1024;

describe("checkPhotoFile (foto original, antes de reducirla)", () => {
  it("admite fotos normales de móvil de más de 5 MB: se reducen en el navegador", () => {
    expect(checkPhotoFile({ type: "image/jpeg", size: 8 * MB })).toBeNull();
    expect(checkPhotoFile({ type: "image/png", size: PHOTO_MAX_BYTES })).toBeNull();
  });

  it("rechaza tipos fuera del contrato, vacíos y originales de más de 25 MB", () => {
    expect(checkPhotoFile({ type: "image/gif", size: 1000 })).toBe(PHOTO_ERRORS.type);
    expect(checkPhotoFile({ type: "image/jpeg", size: 0 })).toBe(PHOTO_ERRORS.decode);
    expect(checkPhotoFile({ type: "image/webp", size: PHOTO_MAX_BYTES + 1 })).toBe(PHOTO_ERRORS.size);
    expect(PHOTO_ERRORS.size).toContain("25 MB");
  });

  it("el presupuesto de subida cabe con holgura en los 4 MB de uploadCouplePhoto", () => {
    expect(PHOTO_UPLOAD_BUDGET).toBeLessThan(4 * MB - 64 * 1024);
  });
});

describe("HEIC y lista de tipos (creador y panel)", () => {
  it("el accept no incluye HEIC: así Safari de iOS entrega la foto en JPEG", () => {
    expect(PHOTO_ACCEPT.split(",")).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(PHOTO_ACCEPT).not.toMatch(/heic|heif|\*/);
  });

  it("deja pasar una HEIC para intentar abrirla (Safari sabe; si no, error claro al decodificar)", () => {
    expect(checkPhotoFile({ type: "image/heic", size: 3 * MB })).toBeNull();
    expect(checkPhotoFile({ type: "image/heif", size: 3 * MB })).toBeNull();
    expect(checkPhotoFile({ type: "", size: 3 * MB, name: "IMG_0001.HEIC" })).toBeNull();
    expect(checkPhotoFile({ type: "image/heic", size: PHOTO_MAX_BYTES + 1 })).toBe(PHOTO_ERRORS.size);
  });

  it("reconoce HEIC por tipo o, sin tipo, por extensión", () => {
    expect(isHeicFile({ type: "image/heic" })).toBe(true);
    expect(isHeicFile({ type: "IMAGE/HEIF" })).toBe(true);
    expect(isHeicFile({ type: "", name: "boda.heif" })).toBe(true);
    expect(isHeicFile({ type: "", name: "boda.jpg" })).toBe(false);
    expect(isHeicFile({ type: "image/jpeg", name: "raro.heic" })).toBe(false);
  });

  it("sigue rechazando lo que no es foto y los archivos sin tipo que no son HEIC", () => {
    expect(checkPhotoFile({ type: "application/pdf", size: 1000 })).toBe(PHOTO_ERRORS.type);
    expect(checkPhotoFile({ type: "", size: 1000, name: "foto" })).toBe(PHOTO_ERRORS.type);
    expect(checkPhotoFile({ type: "image/svg+xml", size: 1000 })).toBe(PHOTO_ERRORS.type);
  });

  it("el error de HEIC explica qué hacer, en español y sin tecnicismos de más", () => {
    expect(PHOTO_ERRORS.heic).toMatch(/HEIC/);
    expect(PHOTO_ERRORS.heic).toMatch(/JPG/);
  });
});

describe("fitWithin", () => {
  it("conserva la proporción y no amplía", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});
