import { describe, expect, it } from "vitest";
import { packPhoto, unpackPhoto } from "./photo-store";

const photo = () => ({ blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }), width: 1200, height: 800 });

describe("photo-store: lo que se guarda en IndexedDB", () => {
  it("guarda bytes (no un Blob): Safari privado rechaza Blobs en IndexedDB", async () => {
    const record = await packPhoto(photo());
    expect(record.bytes).toBeInstanceOf(ArrayBuffer);
    expect(record).not.toHaveProperty("blob");
    expect(record).toMatchObject({ type: "image/jpeg", width: 1200, height: 800 });
  });

  it("recupera la misma foto (bytes, tipo y medidas)", async () => {
    const restored = unpackPhoto(await packPhoto(photo()));
    expect(restored).not.toBeNull();
    expect(restored!.width).toBe(1200);
    expect(restored!.height).toBe(800);
    expect(restored!.blob.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await restored!.blob.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it("sigue leyendo la forma antigua ({ blob }) de quien ya tenía una foto guardada", () => {
    const old = photo();
    expect(unpackPhoto({ blob: old.blob, width: 10, height: 20 })).toEqual({ blob: old.blob, width: 10, height: 20 });
  });

  it("descarta lo que no es una foto", () => {
    expect(unpackPhoto(null)).toBeNull();
    expect(unpackPhoto("x")).toBeNull();
    expect(unpackPhoto({ bytes: new ArrayBuffer(0), width: 1, height: 1 })).toBeNull();
    expect(unpackPhoto({ bytes: new ArrayBuffer(4), width: "1", height: 1 })).toBeNull();
  });
});
