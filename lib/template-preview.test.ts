import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// El formulario real arrastra la server action de RSVP (como en renderer.test.tsx).
vi.mock("@/components/guest/rsvp-form", () => ({ RsvpForm: () => null }));

import { InvitationRenderer } from "@/components/invitation/renderer";
import { demoWeddingDocument } from "@/components/landing/demo-wedding";
import { describeEditTarget } from "./site-chat/edit-focus";
import { documentFromLegacy, findScene, parseSiteDocument, sceneHasContent, type SiteDocument } from "./site-document";
import { BUILDER_TEMPLATES } from "./templates";
import { mixHex, placeholderImage, withTemplatePreview } from "./template-preview";
import { EMPTY_DRAFT, applyBuilderTemplate, composeBuilderDocument, creatorSiteDocument, type BuilderDraft } from "./wedding-builder";

const COUPLE: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Pablo", weddingDate: "2027-06-12", venue: "Finca El Olivar", time: "18:00", day: { ceremony: { time: "18:00", place: "Finca El Olivar" }, cocktail: { time: "", place: "" }, banquet: { time: "", place: "" } } };
const typesOf = (doc: SiteDocument) => doc.scenes.filter((s) => s.enabled).map((s) => s.type);

describe("plantillas fieles: lo que crea el creador = la demo de la plantilla", () => {
  for (const template of BUILDER_TEMPLATES) {
    it(`${template.id}: mismo estilo, paleta, maqueta, sobre y secciones en el mismo orden`, () => {
      const created = composeBuilderDocument(applyBuilderTemplate(COUPLE, template));
      const demo = demoWeddingDocument(template.id);
      expect({ themeId: created.themeId, palette: created.palette, layout: created.layout, opening: created.opening }).toEqual({ themeId: demo.themeId, palette: demo.palette, layout: demo.layout, opening: demo.opening });
      expect(typesOf(created)).toEqual(typesOf(demo));
      // Títulos de sección de la demo (los textos de su pareja no se copian).
      for (const type of ["story", "details", "faq"] as const) {
        expect((findScene(created, type)?.props as { title: string }).title).toBe((findScene(demo, type)?.props as { title: string }).title);
      }
    });
  }

  it("las preguntas llevan la línea de contacto de la demo con los nombres de la pareja", () => {
    const created = composeBuilderDocument(applyBuilderTemplate(COUPLE, BUILDER_TEMPLATES[0]!));
    expect(findScene(created, "faq")?.props.contact).toBe("¿No encuentras la respuesta? Escribe a Ana o a Pablo.");
    // Sin plantilla, como antes.
    expect(findScene(composeBuilderDocument(COUPLE), "faq")?.props.contact).toBe("");
  });

  it("con nombres muy largos, sin línea de contacto (nunca un documento que no valga)", () => {
    const long = { ...COUPLE, partnerName1: "A".repeat(80), partnerName2: "B".repeat(80) };
    const created = composeBuilderDocument(applyBuilderTemplate(long, BUILDER_TEMPLATES[0]!));
    expect(findScene(created, "faq")?.props.contact).toBe("");
    expect(created.palette).toBe(BUILDER_TEMPLATES[0]!.palette);
  });
});

describe("withTemplatePreview (móvil del creador)", () => {
  const draft = applyBuilderTemplate({ ...COUPLE, photo: "pending" }, BUILDER_TEMPLATES[1]!);
  const base = composeBuilderDocument(draft);
  const preview = withTemplatePreview(base, { template: draft.template, photo: "pending" });

  it("sin plantilla no cambia nada", () => {
    const plain = composeBuilderDocument(COUPLE);
    expect(withTemplatePreview(plain, { template: undefined, photo: "pending" })).toEqual({ document: plain, gaps: [] });
  });

  it("enseña la estructura entera de la plantilla, con huecos marcados", () => {
    for (const type of ["gallery", "story", "details", "faq"] as const) {
      expect(sceneHasContent(findScene(base, type)!)).toBe(type === "faq"); // la de alergias ya es verdad
      expect(sceneHasContent(findScene(preview.document, type)!)).toBe(true);
    }
    expect(findScene(preview.document, "cover")?.props.image?.url).toMatch(/^data:image\/svg\+xml/);
    expect(preview.gaps.map((g) => g.kind).sort()).toEqual(["details", "faq", "gallery", "photo", "story"]);
    expect(preview.gaps.find((g) => g.kind === "photo")?.path).toBe("portada/image");
    expect(preview.gaps.find((g) => g.kind === "gallery")?.path).toBe("scene:fotos");
  });

  it("nunca toca lo que la pareja ya puso y respeta «seguir sin foto»", () => {
    const withStory = composeBuilderDocument({ ...draft, story: { met: "En Lisboa.", proposal: "", ahead: "" } });
    const shown = withTemplatePreview(withStory, { template: draft.template, photo: "initials" });
    expect(findScene(shown.document, "story")?.props.chapters.map((c) => c.body)).toEqual(["En Lisboa."]);
    expect(findScene(shown.document, "cover")?.props.image).toBeNull();
    expect(findScene(shown.document, "gallery")?.props.images).toEqual([]);
    expect(shown.gaps.map((g) => g.kind)).not.toContain("photo");
  });

  it("los huecos no se pueden publicar: el saneado del servidor los quita o rechaza", () => {
    const legacy = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Pablo", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: draft.style }, agenda: [] });
    const sanitized = creatorSiteDocument(preview.document, legacy);
    // O no vale (data: no es https) o, si valiera, sin fotos.
    if (sanitized) expect(JSON.stringify(sanitized)).not.toContain("data:image");
    expect(parseSiteDocument(preview.document).ok).toBe(false);
  });

  it("la web pública solo pinta lo de la pareja; la foto de relleno no es suya", () => {
    const html = renderToStaticMarkup(createElement(InvitationRenderer, { document: { ...base, opening: "ninguno" }, mode: "public", plan: "free" }));
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("¿Cómo os conocisteis?");
    expect(html).not.toContain("data-edit-path");
  });

  it("la foto de relleno usa los colores de la paleta", () => {
    const img = placeholderImage({ id: "rosa", label: "Rosa", paper: "#fff", ink: "#111111", accent: "#aa3355", surface: "#eeeeee" }, 100, 100);
    expect(decodeURIComponent(img.url)).toContain(mixHex("#eeeeee", "#aa3355", 0.14));
    expect(decodeURIComponent(img.url)).toContain("#aa3355");
  });
});

describe("mixHex", () => {
  it("mezcla hex y deja tal cual lo que no lo es", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("oklch(1 0 0)", "#ffffff", 0.5)).toBe("oklch(1 0 0)");
  });
});

describe("«Seleccionar» con la ruta de la foto de portada", () => {
  it("elige la sección Portada (la ruta de la foto es solo un hueco del creador)", () => {
    const doc = composeBuilderDocument(COUPLE);
    const target = describeEditTarget(doc, "portada/image");
    expect(target?.label).toBe("Portada");
    expect(target?.path).toBe("portada");
  });
});
