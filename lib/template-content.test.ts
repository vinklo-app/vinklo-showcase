import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, applyBuilderTemplate, composeBuilderDocument } from "./wedding-builder";
import { findBuilderTemplate } from "./templates";
import { EMPTY_STORY } from "./creator-story";
import { findScene, guestVisibleScene, sceneHasContent } from "./site-document";

const origen = findBuilderTemplate("origen")!;
const withTemplate = (extra = {}) => applyBuilderTemplate({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-09-04", ...extra }, origen);

describe("composeBuilderDocument con plantilla", () => {
  it("usa los detalles y preguntas de la demo, genéricos", () => {
    const doc = composeBuilderDocument(withTemplate());
    const details = findScene(doc, "details")!;
    expect(details.props.title).toBe("Y ahora, algunos detalles más…");
    expect(details.props.cards.map((c) => c.title)).toEqual(["Viaje y alojamiento", "Dress code", "Menú", "Música"]);
    const faq = findScene(doc, "faq")!;
    expect(faq.props.title).toBe("Preguntas y respuestas");
    expect(faq.props.items.map((i) => i.question)).toContain("¿La boda es al aire libre?");
    expect(doc.scenes.map((s) => s.type).slice(0, 3)).toEqual(["cover", "gallery", "story"]);
    const order = doc.scenes.map((s) => s.type);
    expect(order.indexOf("details")).toBeLessThan(order.indexOf("faq"));
    expect(order.indexOf("faq")).toBeLessThan(order.indexOf("rsvp"));
  });

  it("los marcadores no los ve el invitado y la galería queda vacía", () => {
    const doc = composeBuilderDocument(withTemplate());
    expect(sceneHasContent(findScene(doc, "details")!)).toBe(false);
    expect(findScene(doc, "gallery")!.props.images).toEqual([]);
    expect(findScene(doc, "story")!.props.chapters).toEqual([]);
    expect(guestVisibleScene(findScene(doc, "faq")!)).toBeDefined();
  });

  it("los capítulos solo salen de las respuestas, con los títulos de la demo", () => {
    const doc = composeBuilderDocument(withTemplate({ story: { ...EMPTY_STORY, met: "En el tren.", proposal: "En la playa." } }));
    expect(findScene(doc, "story")!.props.chapters.map((c) => [c.title, c.body])).toEqual([["cómo nos conocimos", "En el tren."], ["el siguiente paso", "En la playa."]]);
  });

  it("sin plantilla (o con una inventada) nada cambia", () => {
    const plain = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-09-04" });
    expect(findScene(plain, "details")!.props.title).toBe("Algunos detalles más");
    const fake = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-09-04", template: "nope" });
    expect(findScene(fake, "details")!.props.title).toBe("Algunos detalles más");
  });

  it("no cuela nada específico de la demo", () => {
    const text = JSON.stringify(composeBuilderDocument(withTemplate({ modules: ["menu", "song", "kids", "bus", "hotels"] })).scenes.filter((s) => s.type !== "cover"));
    for (const word of ["Lucía", "Juan", "LUCIAYJUAN", "Plaza de Castilla", "2027", "Madrid", "unsplash"]) expect(text).not.toContain(word);
  });

  it("los módulos activados añaden solo respuestas verdaderas", () => {
    const doc = composeBuilderDocument(withTemplate({ modules: ["menu", "song"] }));
    const cards = findScene(doc, "details")!.props.cards;
    expect(cards.find((c) => c.title === "Menú")!.body).toMatch(/elegir el menú/);
    expect(cards.find((c) => c.title === "Música")!.body).toMatch(/canción/);
  });
});
