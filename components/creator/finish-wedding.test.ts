import { describe, expect, it, vi } from "vitest";
import { EMPTY_DRAFT, type BuilderDraft } from "@/lib/wedding-builder";
import { findScene, sceneHasContent, siteDocumentSchema, type SiteDocument } from "@/lib/site-document";
import { finishCreatedWedding, finishNotice, photoFailureCode, type FinishDeps } from "./finish-wedding";

// layout: null = borrador anterior a «Como una web» por defecto (sin maqueta elegida).
const draft: BuilderDraft = { ...EMPTY_DRAFT, layout: null, opening: null, partnerName1: " Marta ", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", step: 7, photo: "photo", palette: "mar" };
const photo = { blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), width: 1600, height: 2000 };
const URL_OK = "https://x.supabase.co/storage/v1/object/public/wedding-photos/w/cover-1.jpg";

function deps(overrides: Partial<FinishDeps> = {}): FinishDeps {
  return {
    upload: vi.fn(async () => ({ ok: true as const, url: URL_OK, width: 1600, height: 2000 })),
    save: vi.fn(async () => ({ ok: true as const, draftVersion: 2 })),
    publish: vi.fn(async () => ({ ok: true as const, revisionId: "r", publishedAt: "2026-10-03" })),
    ...overrides,
  };
}

describe("tras crear la boda", () => {
  it("reports each stage in order so the button can say what is happening", async () => {
    const stages: string[] = [];
    await finishCreatedWedding(draft, photo, deps({ onStage: (stage) => stages.push(stage) }));
    expect(stages).toEqual(["photo", "save", "publish"]);
    // Sin fotos y con el borrador del creador ya listo: no hay nada que guardar, solo se publica.
    const none: string[] = [];
    await finishCreatedWedding({ ...draft, photo: "initials", palette: null }, null, deps({ onStage: (stage) => none.push(stage) }), "creator");
    expect(none).toEqual(["publish"]);
  });

  it("uploads the photo, saves the full document over version 1 and publishes it", async () => {
    const d = deps();
    const result = await finishCreatedWedding(draft, photo, d);
    expect(result).toEqual({ photo: "ok", site: "ok" });
    const form = (d.upload as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: Parameters<typeof findScene>[0]; baseVersion: number };
    expect(saved.baseVersion).toBe(1);
    expect(saved.document.palette).toBe("mar");
    expect(findScene(saved.document, "cover")?.props.image).toEqual({ url: URL_OK, alt: "Foto de Marta y Jaime", width: 1600, height: 2000 });
    expect(d.publish).toHaveBeenCalledWith({ baseVersion: 2 });
    expect(finishNotice(result)).toBe("/onboarding/listo");
  });

  it("keeps the wedding and reports a precise code when the upload fails", async () => {
    const d = deps({ upload: vi.fn(async () => ({ ok: false as const, error: "La foto pesa demasiado: el máximo son 5 MB." })) });
    const result = await finishCreatedWedding(draft, photo, d);
    expect(result).toEqual({ photo: "size", site: "ok" });
    // La paleta se guarda igualmente, sin foto.
    const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: Parameters<typeof findScene>[0] };
    expect(findScene(saved.document, "cover")?.props.image).toBeNull();
    expect(finishNotice(result)).toBe("/onboarding/listo?foto=size");
  });

  it("treats a rejected upload (network, 413, timeout) as a generic photo failure", async () => {
    const result = await finishCreatedWedding({ ...draft, palette: null }, photo, deps({ upload: vi.fn(async () => { throw new Error("413"); }) }), "creator");
    // Se publica el borrador v1 sin foto (sin guardar nada más).
    expect(result).toEqual({ photo: "generic", site: "ok" });
  });

  it("saves and publishes when the only choice is the web layout", async () => {
    const d = deps();
    const result = await finishCreatedWedding({ ...draft, palette: null, photo: "initials", layout: "web" }, null, d);
    expect(result.site).toBe("ok");
    const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: { layout?: string } };
    expect(saved.document.layout).toBe("web");
  });

  it("with the creator document already saved as draft v1 and no photo, only publishes it (once, over version 1)", async () => {
    const d = deps();
    const result = await finishCreatedWedding({ ...draft, photo: "initials" }, null, d, "creator");
    expect(result).toEqual({ photo: "none", site: "ok" });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.publish).toHaveBeenCalledWith({ baseVersion: 1 });
  });

  it("publishes exactly once, after every upload and the save have finished (a guest never sees a half state)", async () => {
    const order: string[] = [];
    const extras = [photo, photo];
    const d = deps({
      upload: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); order.push("upload"); return { ok: true as const, url: URL_OK, width: 1, height: 1 }; }),
      save: vi.fn(async () => { order.push("save"); return { ok: true as const, draftVersion: 2 }; }),
      publish: vi.fn(async () => { order.push("publish"); return { ok: true as const, revisionId: "r", publishedAt: "x" }; }),
    });
    await finishCreatedWedding(draft, photo, d, "creator", extras);
    expect(order).toEqual(["upload", "upload", "upload", "save", "publish"]);
    expect(d.publish).toHaveBeenCalledTimes(1);
  });

  it("if every photo fails it still publishes the site without them, and flags the failure for the panel", async () => {
    const d = deps({ upload: vi.fn(async () => ({ ok: false as const, error: "x" })) });
    const result = await finishCreatedWedding(draft, photo, d, "creator", [photo]);
    expect(result).toEqual({ photo: "generic", site: "ok", gallery: { ok: 0, failed: 1 } });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(finishNotice(result)).toBe("/onboarding/listo?foto=generic&fotos=1");
  });

  it("if the single publish fails, the site stays a saved draft and the notice asks to publish from the panel", async () => {
    const d = deps({ publish: vi.fn(async () => { throw new Error("504"); }) });
    const result = await finishCreatedWedding(draft, photo, d);
    expect(result).toEqual({ photo: "ok", site: "draft" });
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(finishNotice(result)).toBe("/onboarding/listo?web=draft");
  });

  it("if the final document cannot be saved, publishes the base draft once and does not claim the photos made it", async () => {
    const d = deps({ save: vi.fn(async () => ({ ok: false as const, code: "error" as const, error: "x" })) });
    const result = await finishCreatedWedding(draft, photo, d, "creator", [photo]);
    expect(result).toEqual({ photo: "generic", site: "failed", gallery: { ok: 0, failed: 1 } });
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.publish).toHaveBeenCalledWith({ baseVersion: 1 });
    expect(finishNotice(result)).toBe("/onboarding/listo?foto=generic&fotos=1&web=failed");
  });

  it("a rejected save (network, 504) publishes the base draft once: failed means published with the base style", async () => {
    const d = deps({ save: vi.fn(async () => { throw new Error("504"); }) });
    const result = await finishCreatedWedding(draft, photo, d, "creator");
    expect(result).toEqual({ photo: "generic", site: "failed" });
    expect(d.publish).toHaveBeenCalledTimes(1);
    const dead = deps({ save: vi.fn(async () => { throw new Error("504"); }), publish: vi.fn(async () => { throw new Error("504"); }) });
    expect((await finishCreatedWedding(draft, photo, dead, "creator")).site).toBe("draft");
  });

  it("a conflict with another version (3) publishes nothing and leaves a draft for the panel", async () => {
    const d = deps({ save: vi.fn(async () => ({ ok: false as const, code: "conflict" as const, draftVersion: 3, error: "x" })) });
    const result = await finishCreatedWedding(draft, photo, d, "creator");
    expect(result.site).toBe("draft");
    expect(d.publish).not.toHaveBeenCalled();
  });

  it("if neither the save nor the fallback publish works, reports a draft (nothing is claimed as published)", async () => {
    const d = deps({
      save: vi.fn(async () => ({ ok: false as const, code: "error" as const, error: "x" })),
      publish: vi.fn(async () => ({ ok: false as const, code: "error" as const, error: "x" })),
    });
    const result = await finishCreatedWedding(draft, null, d, "legacy");
    expect(result.site).toBe("draft");
  });

  it("when the server could not even create the draft row, saves over version 0 and publishes once", async () => {
    const d = deps({ save: vi.fn(async () => ({ ok: true as const, draftVersion: 1 })) });
    const result = await finishCreatedWedding({ ...draft, photo: "initials" }, null, d, "failed");
    expect(result).toEqual({ photo: "none", site: "ok" });
    expect((d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].baseVersion).toBe(0);
    expect(d.publish).toHaveBeenCalledTimes(1);
  });

  it("if the server could only publish the adapter, saves and publishes the full document with the envelope (regresión 8-oct-2026)", async () => {
    for (const initial of ["legacy", "failed"] as const) {
      const d = deps();
      // Un borrador de antes del sobre (sin `opening`) y sin nada más que el adaptador no conozca.
      const old: BuilderDraft = { ...draft, palette: null, layout: null, photo: "initials" };
      delete old.opening;
      const result = await finishCreatedWedding(old, null, d, initial);
      expect(result.site).toBe("ok");
      const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: { opening?: string } };
      expect(saved.document.opening).toBe("sobre");
    }
  });

  it("creates the row only when it does not exist, never overwrites another version", async () => {
    const missing = deps({ save: vi.fn().mockResolvedValueOnce({ ok: false, code: "conflict", draftVersion: 0, error: "x" }).mockResolvedValueOnce({ ok: true, draftVersion: 1 }) });
    expect(await finishCreatedWedding(draft, null, missing)).toEqual({ photo: "none", site: "ok" });
    expect((missing.save as ReturnType<typeof vi.fn>).mock.calls[1]![0].baseVersion).toBe(0);

    const other = deps({ save: vi.fn(async () => ({ ok: false as const, code: "conflict" as const, draftVersion: 5, error: "x" })) });
    expect(await finishCreatedWedding(draft, null, other)).toEqual({ photo: "none", site: "draft" });
    expect(other.save).toHaveBeenCalledTimes(1);
    expect(other.publish).not.toHaveBeenCalled();
  });

  it("reports a saved-but-unpublished site", async () => {
    const result = await finishCreatedWedding(draft, null, deps({ publish: vi.fn(async () => ({ ok: false as const, code: "error" as const, error: "x" })) }));
    expect(result.site).toBe("draft");
    expect(finishNotice(result)).toBe("/onboarding/listo?web=draft");
  });

  it("uploads «Más fotos» two at a time and writes them, in order, as the gallery right after the cover", async () => {
    const extras = Array.from({ length: 5 }, (_, i) => ({ ...photo, width: 1000 + i }));
    let running = 0;
    let peak = 0;
    let call = 0;
    const upload = vi.fn(async (form: FormData) => {
      const n = call++;
      running++;
      peak = Math.max(peak, running);
      // La foto de portada es la llamada 0; las de la galería terminan desordenadas.
      await new Promise((resolve) => setTimeout(resolve, n === 0 ? 0 : [0, 20, 5, 15, 0, 10][n]));
      running--;
      const name = (form.get("file") as File).name;
      return { ok: true as const, url: `https://x.supabase.co/storage/v1/object/public/wedding-photos/w/${name}`, width: 800, height: 1000 };
    });
    const stages: string[] = [];
    const d = deps({ upload, onStage: (stage) => stages.push(stage) });
    const result = await finishCreatedWedding(draft, photo, d, "legacy", extras);
    expect(result).toEqual({ photo: "ok", site: "ok", gallery: { ok: 5, failed: 0 } });
    expect(stages).toEqual(["photo", "gallery", "save", "publish"]);
    expect(upload).toHaveBeenCalledTimes(6);
    expect(peak).toBeLessThanOrEqual(2);
    const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: SiteDocument };
    expect(siteDocumentSchema.safeParse(saved.document).success).toBe(true);
    const scenes = saved.document.scenes;
    expect(scenes[0]!.type).toBe("cover");
    expect(scenes[1]!.type).toBe("gallery");
    const gallery = findScene(saved.document, "gallery")!;
    expect(gallery.props.images.map((img) => img.url.split("/").pop())).toEqual(["foto-1.jpg", "foto-2.jpg", "foto-3.jpg", "foto-4.jpg", "foto-5.jpg"]);
    expect(gallery.props.images[0]).toEqual({ url: expect.stringContaining("foto-1.jpg"), alt: "Foto 1 de Marta y Jaime", width: 800, height: 1000 });
    // Condiciones del mosaico de la portada (renderer.tsx, orbitGallery): foto de portada y galería de 4+ como primera sección con contenido.
    expect(findScene(saved.document, "cover")?.props.image).not.toBeNull();
    expect(scenes.find((s) => s.type !== "cover" && sceneHasContent(s))?.type).toBe("gallery");
    expect(finishNotice(result)).toBe("/onboarding/listo");
  });

  it("keeps the gallery photos that uploaded when others fail, and says how many failed", async () => {
    let call = 0;
    const upload = vi.fn(async () => {
      const n = call++;
      if (n === 2) return { ok: false as const, error: "Habéis subido muchas fotos seguidas." };
      if (n === 3) throw new Error("413");
      return { ok: true as const, url: `${URL_OK}?n=${n}`, width: 800, height: 1000 };
    });
    const d = deps({ upload });
    const result = await finishCreatedWedding(draft, photo, d, "legacy", [photo, photo, photo, photo]);
    expect(result.gallery).toEqual({ ok: 2, failed: 2 });
    expect(result.photo).toBe("ok");
    const saved = (d.save as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { document: SiteDocument };
    expect(findScene(saved.document, "gallery")!.props.images.map((img) => img.url)).toEqual([`${URL_OK}?n=1`, `${URL_OK}?n=4`]);
    expect(finishNotice(result)).toBe("/onboarding/listo?fotos=2");
  });

  it("saves the gallery even when there is nothing else to write, and caps it at 6", async () => {
    const d = deps();
    const result = await finishCreatedWedding({ ...draft, palette: null, photo: "initials" }, null, d, "legacy", Array.from({ length: 8 }, () => photo));
    expect(d.upload).toHaveBeenCalledTimes(6);
    expect(result).toEqual({ photo: "none", site: "ok", gallery: { ok: 6, failed: 0 } });
    expect(d.save).toHaveBeenCalledTimes(1);
  });

  it("saves nothing extra when every gallery upload fails and the creator draft v1 is already complete", async () => {
    const d = deps({ upload: vi.fn(async () => ({ ok: false as const, error: "x" })) });
    const result = await finishCreatedWedding({ ...draft, palette: null, photo: "initials" }, null, d, "creator", [photo]);
    expect(result).toEqual({ photo: "none", site: "ok", gallery: { ok: 0, failed: 1 } });
    expect(d.save).not.toHaveBeenCalled();
    expect(finishNotice(result)).toBe("/onboarding/listo?fotos=1");
  });

  it("maps the action's error messages to stable codes", () => {
    expect(photoFailureCode("Ese archivo no es una foto válida. Usad JPG, PNG o WebP.")).toBe("type");
    expect(photoFailureCode("La foto es demasiado grande: como máximo 10 000 píxeles por lado.")).toBe("dimensions");
    expect(photoFailureCode("Habéis subido muchas fotos seguidas. Esperad un momento y probad de nuevo.")).toBe("rate");
    expect(photoFailureCode("La sesión ha caducado. Volved a entrar.")).toBe("session");
    expect(photoFailureCode("otra cosa")).toBe("generic");
  });
});
