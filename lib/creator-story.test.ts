import { describe, expect, it } from "vitest";
import { storyChaptersFromAnswers } from "./creator-story";
import { EMPTY_DRAFT, STEP, composeBuilderDocument, restoreBuilderDraft } from "./wedding-builder";
import { findScene, parseSiteDocument, sceneHasContent } from "./site-document";

describe("«Vuestra historia» → capítulos (8-oct-2026)", () => {
  it("cada respuesta escrita es un capítulo, con el texto tal cual (solo espacios recortados)", () => {
    const chapters = storyChaptersFromAnswers({ met: "  Nos conocimos en   Erasmus,\n\n\n\nen Lisboa. ", proposal: "", ahead: "Veros a todos." });
    expect(chapters).toEqual([
      { id: "c-conocimos", title: "cómo nos conocimos", body: "Nos conocimos en Erasmus,\n\nen Lisboa.", images: [] },
      { id: "c-ilusion", title: "lo que viene", body: "Veros a todos.", images: [] },
    ]);
  });
  it("sin respuestas no hay capítulos (y la historia no se enseña)", () => {
    expect(storyChaptersFromAnswers(undefined)).toEqual([]);
    expect(storyChaptersFromAnswers({ met: "   ", proposal: "", ahead: "" })).toEqual([]);
    const doc = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12" });
    expect(sceneHasContent(findScene(doc, "story")!)).toBe(false);
  });
  it("llega a la escena «historia» del documento, que sigue cumpliendo el contrato", () => {
    const doc = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", story: { met: "En una boda.", proposal: "En la playa, al atardecer.", ahead: "" } });
    expect(parseSiteDocument(doc).ok).toBe(true);
    expect(findScene(doc, "story")!.props.chapters.map((chapter) => chapter.title)).toEqual(["cómo nos conocimos", "la pedida"]);
  });
  it("el paso va detrás de «Vuestro día» y un borrador v3 en la bienvenida sigue en la bienvenida", () => {
    expect(STEP.historia).toBe(STEP.dia + 1);
    expect(restoreBuilderDraft(JSON.stringify({ ...EMPTY_DRAFT, version: 3, step: 6 }))?.step).toBe(STEP.bienvenida);
  });
});
