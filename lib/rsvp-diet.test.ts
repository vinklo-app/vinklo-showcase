import { describe, expect, it } from "vitest";

import {
  cleanDietOther,
  composeHealthNote,
  dietPersonLabel,
  dietPreferenceCounts,
  dietSummaryText,
  emptyPersonDiet,
  guestDietSummary,
  hasHealthData,
  healthTagsFromNote,
  menuCountsFromPeople,
  peopleFromAnswers,
  resizePeople,
  summarizeDiet,
  toggleDietTag,
  type PersonDiet,
} from "./rsvp-diet";

const person = (patch: Partial<PersonDiet> = {}): PersonDiet => ({ ...emptyPersonDiet(), ...patch });
const MENU = [{ id: "m-1" }, { id: "m-2" }];

describe("rsvp-diet: lo que marca cada persona (ítem 21)", () => {
  it("vegetariano y vegano se excluyen; las de salud se suman", () => {
    let p = toggleDietTag(person(), "vegetariano");
    p = toggleDietTag(p, "vegano");
    expect(p.tags).toEqual(["vegano"]);
    p = toggleDietTag(toggleDietTag(p, "celiaquia"), "lactosa");
    expect(p.tags).toEqual(["vegano", "celiaquia", "lactosa"]);
    expect(toggleDietTag(p, "celiaquia").tags).toEqual(["vegano", "lactosa"]);
  });
  it("nombres en la nota: «Tú», el del acompañante (sin separadores) o «Acompañante N»", () => {
    expect(dietPersonLabel(0, "Pablo")).toBe("Tú");
    expect(dietPersonLabel(1, "  Pablo ")).toBe("Pablo");
    expect(dietPersonLabel(2, "Leo: el peque; ")).toBe("Leo el peque");
    expect(dietPersonLabel(3, "")).toBe("Acompañante 3");
  });
  it("«Otra» sin saltos ni «;» y acotada", () => {
    expect(cleanDietOther(" marisco;\nkiwi ")).toBe("marisco, kiwi");
    expect(cleanDietOther("x".repeat(200))).toHaveLength(80);
  });
  it("nota de salud: una persona por tramo, solo quien tiene algo de salud; vegetariano no va", () => {
    const note = composeHealthNote([
      { label: "Tú", diet: person({ tags: ["vegetariano", "celiaquia"] }) },
      { label: "Pablo", diet: person({ tags: ["vegano"] }) },
      { label: "Leo", diet: person({ tags: ["frutos-secos"], otherOn: true, other: "marisco" }) },
      { label: "Ana", diet: person({ otherOn: true, other: "  " }) },
    ]);
    expect(note).toBe("Tú: celiaquía; Leo: alergia a los frutos secos, marisco");
    expect(composeHealthNote([{ label: "Tú", diet: person({ tags: ["vegano"] }) }])).toBe("");
    expect(hasHealthData([person({ tags: ["vegano"] })])).toBe(false);
    expect(hasHealthData([person({ tags: ["embarazada"] })])).toBe(true);
    expect(hasHealthData([person({ otherOn: true, other: "kiwi" })])).toBe(true);
  });
  it("menú y preferencias → el contrato de siempre (personas por opción)", () => {
    const people = [person({ menu: "m-1", tags: ["vegetariano"] }), person({ menu: "m-1" }), person({ menu: "m-2", tags: ["vegano"] }), person()];
    expect(menuCountsFromPeople(people, MENU)).toEqual({ "m-1": 2, "m-2": 1 });
    expect(menuCountsFromPeople([person({ menu: "borrado" })], MENU)).toBeNull();
    expect(dietPreferenceCounts(people)).toEqual({ vegetariano: 1, vegano: 1 });
    expect(dietPreferenceCounts([person()])).toBeNull();
  });
  it("al reabrir: el reparto guardado vuelve por orden (respuestas antiguas sin diet también)", () => {
    const people = peopleFromAnswers(3, { "m-2": 1, "m-1": 1 }, { vegano: 1 }, MENU);
    expect(people.map((p) => p.menu)).toEqual(["m-1", "m-2", null]);
    expect(people.map((p) => p.tags)).toEqual([["vegano"], [], []]);
    expect(peopleFromAnswers(2, undefined, undefined, MENU)).toEqual([emptyPersonDiet(), emptyPersonDiet()]);
    // Más menús guardados que personas (tope nuevo): se recortan.
    expect(peopleFromAnswers(1, { "m-1": 3 }, undefined, MENU).map((p) => p.menu)).toEqual(["m-1"]);
  });
  it("cambiar el número no pierde lo marcado de quien vuelve", () => {
    const people = [person({ menu: "m-1" }), person({ menu: "m-2" })];
    const grown = resizePeople(people, 3);
    expect(grown).toHaveLength(3);
    expect(grown[1]!.menu).toBe("m-2");
    expect(resizePeople(people, 1)).toHaveLength(2); // se conserva; quien manda es el slice del formulario
  });
});

describe("rsvp-diet: resumen para el catering", () => {
  it("lee solo notas con la forma del formulario; lo demás avisa de que hay que leerla", () => {
    expect(healthTagsFromNote("Tú: celiaquía, intolerancia a la lactosa; Pablo: celiaquía")).toEqual({ counts: { celiaquia: 2, lactosa: 1, "frutos-secos": 0, embarazada: 0 }, details: false });
    expect(healthTagsFromNote("Tú: celiaquía; Leo: alergia a los frutos secos, marisco").details).toBe(true);
    // Notas de antes (texto libre) o apuntes de la pareja: no se adivina nada.
    expect(healthTagsFromNote("Soy celíaca")).toEqual({ counts: { celiaquia: 0, lactosa: 0, "frutos-secos": 0, embarazada: 0 }, details: true });
    expect(healthTagsFromNote("Mi hijo: celíaco").details).toBe(true);
    expect(healthTagsFromNote(null)).toEqual({ counts: { celiaquia: 0, lactosa: 0, "frutos-secos": 0, embarazada: 0 }, details: false });
  });
  it("totales de quien viene y texto «3 sin gluten · 2 vegetarianos»", () => {
    const summary = summarizeDiet([
      { notes: "Tú: celiaquía; Acompañante 1: celiaquía", answers: { diet: { vegetariano: 2 } } },
      { notes: "Tú: celiaquía, embarazada", answers: null },
      { notes: "Alergia al marisco", answers: { diet: { vegano: 1 } } },
      { notes: null, answers: {} },
    ]);
    expect(summary.withDetails).toBe(1);
    expect(dietSummaryText(summary.counts)).toBe("3 sin gluten · 2 vegetarianos · 1 vegano · 1 embarazada");
    expect(dietSummaryText({})).toBe("");
    expect(dietSummaryText({ vegetariano: 1, embarazada: 2, lactosa: 1, "frutos-secos": 1 })).toBe("1 sin lactosa · 1 sin frutos secos · 1 vegetariano · 2 embarazadas");
  });
  it("por invitación (celda del CSV)", () => {
    expect(guestDietSummary("Tú: intolerancia a la lactosa", { diet: { vegano: 1 } })).toBe("1 sin lactosa · 1 vegano");
    expect(guestDietSummary(null, null)).toBe("");
  });
});
