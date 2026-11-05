import { describe, expect, it } from "vitest";

import { cleanRsvpAnswers, describeAnswers, hasModules, menuMissingCount, NO_MODULES, rowMenuMissing, readRsvpAnswers, rsvpModulesFromDocument, summarizeAnswers, type RsvpModules } from "./rsvp-answers";
import { parseSiteDocument } from "./site-document";

const ALL: RsvpModules = {
  bus: { stops: [{ id: "p-1", name: "Madrid", time: "11:45" }, { id: "p-2", name: "Segovia", time: "12:10" }] },
  lodging: { hotels: [{ id: "h-1", name: "Los Olivos" }, { id: "h-2", name: "El Molino" }] },
  song: true,
  kids: true,
  menu: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }],
};

describe("cleanRsvpAnswers", () => {
  it("guarda lo que corresponde a módulos activos", () => {
    const r = cleanRsvpAnswers(
      { bus: { use: "ambos", stop: "p-2" }, lodging: { where: "hotel", hotel: "h-1" }, song: "  Vivir   la vida ", kids: 1, menu: { "m-1": 2, "m-2": 1 } },
      ALL, "si", 2,
    );
    expect(r).toEqual({ ok: true, answers: { bus: { use: "ambos", stop: "p-2" }, lodging: { where: "hotel", hotel: "h-1" }, song: "Vivir la vida", kids: 1, menu: { "m-1": 2, "m-2": 1 } } });
  });
  it("vegetarianos y veganos (ítem 21): sin módulo, nunca más que las personas que vienen; ceros fuera", () => {
    expect(cleanRsvpAnswers({ diet: { vegetariano: 2, vegano: 0 } }, NO_MODULES, "si", 2)).toEqual({ ok: true, answers: { diet: { vegetariano: 2 } } });
    expect(cleanRsvpAnswers({ diet: { vegetariano: 2, vegano: 2 } }, NO_MODULES, "si", 2)).toMatchObject({ ok: false });
    expect(cleanRsvpAnswers({ diet: { vegano: 0 } }, NO_MODULES, "si", 0)).toEqual({ ok: true, answers: null });
    expect(cleanRsvpAnswers({ diet: { celiaquia: 1 } }, NO_MODULES, "si", 0)).toMatchObject({ ok: false });
    expect(cleanRsvpAnswers({ diet: { vegano: 1 } }, NO_MODULES, "no", 0)).toEqual({ ok: true, answers: null });
    // Lo guardado se lee igual (y lo antiguo, sin diet, también).
    expect(readRsvpAnswers({ menu: { "m-1": 1 }, diet: { vegano: 1 } })).toEqual({ menu: { "m-1": 1 }, diet: { vegano: 1 } });
    expect(readRsvpAnswers({ menu: { "m-1": 1 } })).toEqual({ menu: { "m-1": 1 } });
    // En la ficha del invitado.
    expect(describeAnswers({ diet: { vegetariano: 2 } }, { stops: {}, hotels: {}, menu: {} })).toBe("2 vegetarianos");
  });
  it("con «no» no guarda nada", () => {
    expect(cleanRsvpAnswers({ bus: { use: "ida", stop: "p-1" } }, ALL, "no", 0)).toEqual({ ok: true, answers: null });
  });
  it("descarta respuestas de módulos que la web no tiene", () => {
    expect(cleanRsvpAnswers({ bus: { use: "ida" }, song: "x" }, NO_MODULES, "si", 0)).toEqual({ ok: true, answers: null });
  });
  it("pide la parada si hay varias y rellena la única", () => {
    expect(cleanRsvpAnswers({ bus: { use: "ida" } }, ALL, "si", 0)).toMatchObject({ ok: false });
    expect(cleanRsvpAnswers({ bus: { use: "ida", stop: "p-9" } }, ALL, "si", 0)).toMatchObject({ ok: false });
    const one = { ...ALL, bus: { stops: [ALL.bus!.stops[0]!] } };
    expect(cleanRsvpAnswers({ bus: { use: "ida" } }, one, "si", 0)).toEqual({ ok: true, answers: { bus: { use: "ida", stop: "p-1" } } });
    expect(cleanRsvpAnswers({ bus: { use: "vuelta", stop: "p-1" } }, ALL, "si", 0)).toEqual({ ok: true, answers: { bus: { use: "vuelta" } } });
  });
  it("alojamiento: hotel concreto, otro sitio o ninguno", () => {
    expect(cleanRsvpAnswers({ lodging: { where: "hotel" } }, ALL, "si", 0)).toMatchObject({ ok: false });
    expect(cleanRsvpAnswers({ lodging: { where: "otro", hotel: "h-1" } }, ALL, "si", 0)).toEqual({ ok: true, answers: { lodging: { where: "otro" } } });
    const none = { ...ALL, lodging: { hotels: [] } };
    expect(cleanRsvpAnswers({ lodging: { where: "hotel" } }, none, "si", 0)).toEqual({ ok: true, answers: { lodging: { where: "otro" } } });
  });
  it("niños nunca más que acompañantes; el menú suma las personas", () => {
    expect(cleanRsvpAnswers({ kids: 3 }, ALL, "si", 2)).toMatchObject({ ok: false });
    // Parcial: se acepta (lo que falta sale como «sin menú» en el panel).
    expect(cleanRsvpAnswers({ menu: { "m-1": 1 } }, ALL, "si", 2)).toEqual({ ok: true, answers: { menu: { "m-1": 1 } } });
    // De más: se rechaza, con singular para una sola persona.
    expect(cleanRsvpAnswers({ menu: { "m-1": 2, "m-2": 2 } }, ALL, "si", 2)).toEqual({ ok: false, error: "El menú no puede sumar más de 3 personas (tú y tus acompañantes)." });
    expect(cleanRsvpAnswers({ menu: { "m-1": 2 } }, ALL, "si", 0)).toEqual({ ok: false, error: "El menú no puede sumar más de 1 persona (tú y tus acompañantes)." });
    expect(cleanRsvpAnswers({ menu: { "m-1": 0 } }, ALL, "si", 2)).toEqual({ ok: true, answers: null });
    expect(cleanRsvpAnswers({ menu: { "m-1": 3, "m-9": 4 } }, ALL, "si", 2)).toEqual({ ok: true, answers: { menu: { "m-1": 3 } } });
  });
  it("rechaza formas desconocidas", () => {
    expect(cleanRsvpAnswers({ hack: 1 }, ALL, "si", 0)).toMatchObject({ ok: false });
    expect(cleanRsvpAnswers({ bus: { use: "quizas" } }, ALL, "si", 0)).toMatchObject({ ok: false });
  });
});

describe("rsvpModulesFromDocument", () => {
  const base = {
    schemaVersion: 1, templateId: "papel-calido", templateVersion: 1,
    scenes: [
      { id: "portada", type: "cover", props: {} },
      { id: "autobuses", type: "transport", props: { stops: [{ id: "p-1", name: "Madrid", time: "11:45" }] } },
      { id: "alojamiento", type: "stay", props: { hotels: [{ id: "h-1", name: "Los Olivos", code: "BODA" }], ask: false } },
      { id: "asistencia", type: "rsvp", props: { song: true, menuOptions: [{ id: "m-1", label: "Carne" }] } },
    ],
  };
  it("lee lo activo y respeta «no preguntar»", () => {
    const parsed = parseSiteDocument(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const m = rsvpModulesFromDocument(parsed.document);
    expect(m.bus?.stops.map((s) => s.id)).toEqual(["p-1"]);
    expect(m.lodging).toBeNull();
    expect(m).toMatchObject({ song: true, kids: false, menu: [{ id: "m-1", label: "Carne" }] });
    expect(hasModules(m)).toBe(true);
  });
  it("sin paradas no pregunta por el autobús (8-oct-2026)", () => {
    const empty = { ...base, scenes: base.scenes.map((s) => (s.type === "transport" ? { ...s, props: { stops: [], returnNote: "01:00 desde la finca" } } : s)) };
    const parsed = parseSiteDocument(empty);
    if (!parsed.ok) throw new Error("documento inválido");
    expect(rsvpModulesFromDocument(parsed.document).bus).toBeNull();
  });
  it("una escena oculta no pregunta", () => {
    const hidden = { ...base, scenes: base.scenes.map((s) => (s.type === "transport" ? { ...s, enabled: false } : s)) };
    const parsed = parseSiteDocument(hidden);
    if (!parsed.ok) throw new Error("documento inválido");
    expect(rsvpModulesFromDocument(parsed.document).bus).toBeNull();
  });
});

describe("readRsvpAnswers", () => {
  it("devuelve null si lo guardado no tiene la forma", () => {
    expect(readRsvpAnswers({ bus: { use: "ida" } })).toEqual({ bus: { use: "ida" } });
    expect(readRsvpAnswers("x")).toBeNull();
    expect(readRsvpAnswers(null)).toBeNull();
  });
});

describe("panel: describeAnswers y summarizeAnswers", () => {
  const labels = { stops: { "p-1": "Madrid (11:45)", "p-2": "Segovia (12:10)" }, hotels: { "h-1": "Los Olivos", "h-2": "El Molino" }, menu: { "m-1": "Carne", "m-2": "Pescado" } };
  const rows = [
    { id: "1", name: "Familia de Elena", companions: 3, answers: { bus: { use: "ambos" as const, stop: "p-1" }, lodging: { where: "hotel" as const, hotel: "h-1" }, menu: { "m-1": 3, "m-2": 1 }, kids: 2 } },
    { id: "2", name: "Marta", companions: 1, answers: { bus: { use: "vuelta" as const }, lodging: { where: "otro" as const }, song: "Mediterráneo" } },
    { id: "3", name: "Jorge", companions: 0, answers: { bus: { use: "no" as const }, lodging: { where: "no" as const } } },
    { id: "4", name: "Sin módulos", companions: 5, answers: null },
  ];
  it("resume una respuesta en una línea", () => {
    expect(describeAnswers(rows[0]!.answers, labels)).toBe("Autobús: ida y vuelta desde Madrid (11:45) · Se aloja: Los Olivos · Menú: 3 Carne, 1 Pescado · 2 niños");
    expect(describeAnswers(null, labels)).toBe("");
  });
  it("cuenta personas por parada, hotel (y cuántos van en autobús), menú y niños", () => {
    const t = summarizeAnswers(rows, ALL, labels);
    expect(t.responded).toBe(3);
    expect(t.bus).toEqual({ ida: 4, vuelta: 6, none: 1, byStop: [{ label: "Madrid (11:45)", people: 4 }] });
    expect(t.lodging).toEqual({ byHotel: [{ label: "Los Olivos", people: 4, bus: 4 }], other: 2, otherBus: 2, none: 1 });
    expect(t.menu).toEqual([{ label: "Carne", people: 3 }, { label: "Pescado", people: 1 }]);
    expect(t.kids).toBe(2);
    expect(t.songs).toEqual([{ song: "Mediterráneo", name: "Marta" }]);
  });
  it("personas sin menú = confirmados − menús elegidos, también quien no contestó módulos (P1-6)", () => {
    // Elena 4 con menú; Marta 2, Jorge 1 y «Sin módulos» 6 sin elegir.
    expect(summarizeAnswers(rows, ALL, labels).menuMissing).toBe(9);
    expect(menuMissingCount(rows, ALL)).toBe(9);
    // Sin menú en la web: no hay nadie «sin menú».
    expect(summarizeAnswers(rows, { ...ALL, menu: [] }, labels).menuMissing).toBe(0);
    expect(menuMissingCount(rows, { menu: [] })).toBe(0);
  });
  it("por fila: lo elegido de más en una no tapa lo que falta en otra; nunca negativo", () => {
    expect(rowMenuMissing({ companions: 2, answers: { menu: { "m-1": 1 } } })).toBe(2);
    expect(rowMenuMissing({ companions: 0, answers: { menu: { "m-1": 3 } } })).toBe(0);
    expect(menuMissingCount([{ companions: 0, answers: { menu: { "m-1": 3 } } }, { companions: 1, answers: null }], ALL)).toBe(2);
    expect(menuMissingCount([], ALL)).toBe(0);
  });
});
