import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT } from "@/lib/wedding-builder";
import { documentFromBuilderDraft, findScene, siteDocumentSchema, type SceneImage, type SiteDocument } from "@/lib/site-document";
import { CREATOR_GALLERY_MAX, withCreatorGallery } from "./creator-gallery";

const base = documentFromBuilderDraft({ ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", venue: "Finca Los Olivos" });
const img = (n: number): SceneImage => ({ url: `https://x.supabase.co/storage/v1/object/public/wedding-photos/w/${n}.jpg`, alt: `Foto ${n}`, width: 800, height: 1000 });

describe("withCreatorGallery", () => {
  it("leaves the document untouched without photos", () => {
    expect(withCreatorGallery(base, [])).toBe(base);
  });

  it("adds a valid gallery right after the cover, before the venue", () => {
    const doc = withCreatorGallery(base, [img(1), img(2), img(3), img(4)]);
    expect(doc.scenes.map((s) => s.type).slice(0, 3)).toEqual(["cover", "gallery", "venue"]);
    expect(findScene(doc, "gallery")).toMatchObject({ id: "fotos", enabled: true, props: { title: "", images: [img(1), img(2), img(3), img(4)] } });
    expect(siteDocumentSchema.safeParse(doc).success).toBe(true);
    // Puro: el original no cambia.
    expect(base.scenes.some((s) => s.type === "gallery")).toBe(false);
  });

  it("appends to an existing gallery (up to 12) and moves it behind the cover", () => {
    const existing: SiteDocument = { ...base, scenes: [...base.scenes, { id: "fotos", type: "gallery", enabled: false, props: { title: "Nosotros", images: Array.from({ length: 10 }, (_, i) => img(i)) } }] };
    const doc = withCreatorGallery(existing, [img(20), img(21), img(22)]);
    const gallery = findScene(doc, "gallery")!;
    expect(doc.scenes[1]).toBe(gallery);
    expect(gallery.enabled).toBe(true);
    expect(gallery.props.title).toBe("Nosotros");
    expect(gallery.props.images).toHaveLength(12);
    expect(gallery.props.images.at(-1)).toEqual(img(21));
    expect(doc.scenes.filter((s) => s.type === "gallery")).toHaveLength(1);
  });

  it("the creator offers at most 6 extra photos", () => {
    expect(CREATOR_GALLERY_MAX).toBe(6);
  });
});

describe("mismo accept de fotos en creador y panel", () => {
  const files = ["components/panel/site-editor.tsx", "components/panel/content-editor.tsx", "components/creator/photo-step.tsx", "components/creator/gallery-picker.tsx"];
  it.each(files)("%s usa PHOTO_ACCEPT y nunca pide HEIC", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/accept=\{PHOTO_ACCEPT\}/);
    expect(source).not.toMatch(/image\/heic/);
  });

  it("los selectores de varias fotos no fuerzan la cámara (iOS enseña Fototeca / Hacer foto / Elegir archivo)", () => {
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/\bcapture=/);
  });
});
