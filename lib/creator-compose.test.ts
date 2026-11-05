import { describe, expect, it } from "vitest";
import { CREATOR_FIELD_ORDER, composerRoute, creatorExtras, draftStep, nextCreatorStep, essentialIssue, fieldForEditPath, gapPaths, guestEstimate, guestCountValid, missingEssentials, understoodChips, withIdeaText } from "./creator-compose";
import { DATE_GAP_FIELD as RENDERER_DATE_GAP } from "@/components/invitation/edit-targets";
import { DATE_GAP_FIELD } from "./creator-compose";
import { BUILDER_LAST_STEP, EMPTY_DRAFT, STEP, composeBuilderDocument, hasBuilderProgress, type BuilderDraft } from "./wedding-builder";

const draft = (values: Partial<BuilderDraft> = {}): BuilderDraft => ({ ...EMPTY_DRAFT, ...values });
const complete = draft({ partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-19" });

describe("composerRoute", () => {
  it("lee la idea mientras falten nombres o fecha", () => {
    expect(composerRoute(draft())).toBe("idea");
    expect(composerRoute(draft({ partnerName1: "Lucía", partnerName2: "Juan" }))).toBe("idea");
    expect(composerRoute(draft({ weddingDate: "2027-06-19" }))).toBe("idea");
  });
  it("con nombres y fecha, el mensaje es una petición de cambios", () => {
    expect(composerRoute(complete)).toBe("chat");
  });
  it("un nombre de una letra o una fecha imposible siguen siendo huecos", () => {
    expect(composerRoute(draft({ partnerName1: "L", partnerName2: "Juan", weddingDate: "2027-06-19" }))).toBe("idea");
    expect(composerRoute(draft({ partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-02-30" }))).toBe("idea");
  });
});

describe("withIdeaText", () => {
  it("guarda la idea solo si aún no había", () => {
    expect(withIdeaText(draft(), "  Nos casamos en el campo  ", 600).idea).toBe("Nos casamos en el campo");
    const first = draft({ idea: "Una cena bajo los olivos" });
    expect(withIdeaText(first, "Somos Lucía y Juan", 600)).toBe(first);
  });
  it("recorta al máximo y no cambia nada con texto vacío", () => {
    expect(withIdeaText(draft(), "abcdef", 3).idea).toBe("abc");
    const empty = draft();
    expect(withIdeaText(empty, "   ", 600)).toBe(empty);
  });
});

describe("missingEssentials y gapPaths", () => {
  it("nombres y fecha, en ese orden", () => {
    expect(missingEssentials(draft())).toEqual(["names", "date"]);
    expect(gapPaths(draft())).toEqual(["portada/names", "portada/weddingDate"]);
    expect(gapPaths(draft({ partnerName1: "Lucía", partnerName2: "Juan" }))).toEqual(["portada/weddingDate"]);
    expect(gapPaths(complete)).toEqual([]);
  });
  it("usa el id de la portada que se le pase", () => {
    expect(gapPaths(draft(), "inicio")).toEqual(["inicio/names", "inicio/weddingDate"]);
  });
});

describe("fieldForEditPath", () => {
  it("la ruta del hueco de la fecha es la misma que pinta el renderer", () => {
    expect(DATE_GAP_FIELD).toBe(RENDERER_DATE_GAP);
  });
  it("portada: nombres, fecha y bienvenida", () => {
    expect(fieldForEditPath("portada/names")).toBe("names");
    expect(fieldForEditPath("portada/weddingDate")).toBe("date");
    expect(fieldForEditPath("portada/welcomeMessage")).toBe("welcome");
  });
  it("lugar: nombre y dirección", () => {
    expect(fieldForEditPath("lugar/venue")).toBe("venue");
    expect(fieldForEditPath("lugar/address")).toBe("venue");
  });
  it("lo demás no abre ningún editor", () => {
    expect(fieldForEditPath("portada")).toBeNull();
    expect(fieldForEditPath("portada/eyebrow")).toBeNull();
    expect(fieldForEditPath("preguntas/items/q-1/question")).toBeNull();
    expect(fieldForEditPath("programa/title")).toBeNull();
    expect(fieldForEditPath("../names")).toBeNull();
  });
  it("respeta los ids que se le pasen", () => {
    expect(fieldForEditPath("inicio/names", { cover: "inicio", venue: "sitio" })).toBe("names");
    expect(fieldForEditPath("portada/names", { cover: "inicio", venue: "sitio" })).toBeNull();
  });
});

describe("draftStep", () => {
  it("vacío = 0, así un borrador sin nada no gana a la copia del servidor", () => {
    expect(draftStep(draft())).toBe(0);
    expect(hasBuilderProgress(draft({ step: draftStep(draft()) }))).toBe(false);
  });
  it("apunta al primer imprescindible que falta o al último paso", () => {
    expect(draftStep(draft({ idea: "Una boda en el campo" }))).toBe(STEP.nombres);
    expect(draftStep(draft({ partnerName1: "Lucía", partnerName2: "Juan" }))).toBe(STEP.fecha);
    expect(draftStep(complete)).toBe(BUILDER_LAST_STEP);
  });
});

describe("understoodChips", () => {
  it("solo lo que tiene valor; la bienvenida de partida no cuenta", () => {
    expect(understoodChips(draft())).toEqual([]);
    const chips = understoodChips({ ...complete, venue: "Finca Los Olivos", idea: "En el campo" });
    expect(chips.map((chip) => chip.field)).toEqual(["names", "date", "venue", "design"]);
    expect(chips[0]!.value).toBe("Lucía y Juan");
    expect(chips[1]!.value).toBe("19 de junio de 2027");
  });
  it("una bienvenida propia sí aparece", () => {
    expect(understoodChips(draft({ welcomeMessage: "Qué ganas de veros" })).map((chip) => chip.field)).toEqual(["welcome"]);
  });
});

describe("creatorExtras", () => {
  it("marca lo hecho", () => {
    const extras = creatorExtras(draft({ venue: "Finca", guestCount: "120", photo: "initials" }), false);
    expect(extras.map((extra) => [extra.field, extra.done])).toEqual([["photo", true], ["venue", true], ["day", false], ["story", false], ["welcome", false], ["guests", true]]);
  });
});

describe("invitados y validación", () => {
  it("la estimación es opcional: vacía manda 100", () => {
    expect(guestCountValid("")).toBe(true);
    expect(guestEstimate("")).toBe(100);
    expect(guestEstimate("120")).toBe(120);
    expect(guestCountValid("0")).toBe(false);
    expect(guestCountValid("2001")).toBe(false);
  });
  it("essentialIssue lleva al campo que falta con el mensaje de siempre", () => {
    expect(essentialIssue(draft())).toMatchObject({ field: "names", inputId: "wb-name-1" });
    expect(essentialIssue(draft({ partnerName1: "Lucía" }))).toMatchObject({ field: "names", inputId: "wb-name-2" });
    expect(essentialIssue(draft({ partnerName1: "Lucía", partnerName2: "Juan" }))).toMatchObject({ field: "date", inputId: "wb-date", message: "Elegid una fecha válida para vuestra boda." });
    expect(essentialIssue({ ...complete, guestCount: "0" })).toMatchObject({ field: "guests", inputId: "wb-guests" });
    expect(essentialIssue(complete)).toBeNull();
  });
});

describe("«Siguiente» en los editores del creador (punto 10)", () => {
  it("sigue el orden del asistente: nombres, foto, fecha, lugar, invitados, día, historia, bienvenida", () => {
    expect(CREATOR_FIELD_ORDER).toEqual(["names", "photo", "date", "venue", "guests", "day", "story", "welcome"]);
  });
  it("cada editor lleva al siguiente y el último cierra («Hecho»)", () => {
    expect(nextCreatorStep({ field: "names" })).toEqual({ field: "photo" });
    expect(nextCreatorStep({ field: "date" })).toEqual({ field: "venue" });
    expect(nextCreatorStep({ field: "story" })).toEqual({ field: "welcome" });
    expect(nextCreatorStep({ field: "welcome" })).toBeNull();
  });
  it("en el diseño: de Colores a Letra, y Letra es el último", () => {
    expect(nextCreatorStep({ field: "design", section: "colores" })).toEqual({ field: "design", section: "letra" });
    expect(nextCreatorStep({ field: "design" })).toEqual({ field: "design", section: "letra" });
    expect(nextCreatorStep({ field: "design", section: "letra" })).toBeNull();
  });
});

describe("sin paso de forma ni de sobre (punto 4)", () => {
  it("una invitación nueva es web y abre con el sobre, escrito en el documento", () => {
    const doc = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-19" });
    expect(doc.opening).toBe("sobre");
    expect(doc.layout).toBe("web");
  });
});
