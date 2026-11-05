import { describe, expect, it } from "vitest";
import { EMPTY_DAY, EMPTY_DRAFT, adoptChecked, materializeDay, builderAgendaItems, composeBuilderDocument, creatorSiteDocument, dayRoom, parseBuilderDraft, restoreBuilderDraft, type BuilderDraft } from "./wedding-builder";
import { dayMinutes, handAgendaItems, handDetailCards, moveRow, nextHandId, placeMoments, type BuilderDayMoment } from "./creator-day";
import { SITE_MAX_AGENDA_ITEMS, SITE_MAX_DETAIL_CARDS, SITE_MAX_FAQ_ITEMS, documentFromBuilderDraft, findScene, parseSiteDocument, type AgendaItem, type SiteDocument } from "./site-document";
import { applySitePatch, EMPTY_SITE_PATCH, type SitePatch } from "./ai/site-edit-patch";
import { unappliedSections } from "./creator-sections";

/**
 * «Más secciones en El día» (13-oct-2026, punto 9): la pareja añade en su
 * paso más momentos, detalles y preguntas; se ven en la invitación (mismo
 * documento), respetan los topes del contrato y sobreviven a «Pedid cambios».
 */
const filled: BuilderDraft = {
  ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", venue: "Finca Los Olivos", step: 7,
  day: { ...EMPTY_DAY, ceremony: { time: "12:00", place: "Iglesia de San Juan" }, banquet: { time: "15:00", place: "Finca Los Olivos" } },
};
const moment = (id: string, title: string, timeLabel = "", extra: Partial<BuilderDayMoment> = {}): BuilderDayMoment => ({ id, title, timeLabel, place: "", address: "", notes: "", ...extra });
const agendaOf = (doc: SiteDocument) => findScene(doc, "agenda")!.props.items.map((i) => `${i.timeLabel} ${i.title}`.trim());
const item = (id: string, timeLabel: string): AgendaItem => ({ id, title: id, timeLabel, place: "", address: "", notes: "" });

/** El documento compuesto cumple el contrato (no ha vuelto al adaptador v1, que no tiene detalles). */
function expectFullDocument(doc: SiteDocument) {
  expect(parseSiteDocument(doc).ok).toBe(true);
  expect(findScene(doc, "details")).toBeDefined();
}

describe("filas a mano: qué llega a la web", () => {
  it("solo los momentos con título, recortados", () => {
    expect(handAgendaItems([moment("m-p1", "  Fiesta  ", "01:00", { notes: " Hasta que el cuerpo aguante " }), moment("m-p2", "   ", "02:00")])).toEqual([
      { id: "m-p1", title: "Fiesta", timeLabel: "01:00", place: "", address: "", notes: "Hasta que el cuerpo aguante" },
    ]);
  });

  it("una tarjeta con un enlace que no es https se queda, sin el enlace", () => {
    const cards = handDetailCards([{ id: "d-p1", title: "Regalos", teaser: "", body: "Lo que queráis", link: "http://inseguro.es", linkLabel: "" }, { id: "d-p2", title: "", teaser: "", body: "sin título", linkLabel: "" }]);
    expect(cards).toEqual([{ id: "d-p1", title: "Regalos", teaser: "", body: "Lo que queráis", linkLabel: "" }]);
  });

  it("el programa es cronológico; la madrugada va después de la cena y lo que no tiene hora, antes de la vuelta", () => {
    expect(dayMinutes("01:30")).toBeGreaterThan(dayMinutes("23:00")!);
    expect(dayMinutes("Al anochecer")).toBeNull();
    const fixed = [item("m-ceremonia", "12:00"), item("m-banquete", "15:00"), item("m-vuelta", "03:00")];
    const placed = placeMoments(fixed, [item("fiesta", "01:00"), item("llegada", "11:30"), item("recena", ""), item("baile", "18:00")]);
    expect(placed.map((i) => i.id)).toEqual(["llegada", "m-ceremonia", "m-banquete", "baile", "fiesta", "recena", "m-vuelta"]);
  });

  it("ids nuevos: nunca uno ya usado; mover filas no se sale de la lista", () => {
    expect(nextHandId("m", ["m-p1", "m-p3"])).toBe("m-p2");
    expect(moveRow(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("«Vuestro día» con más momentos, detalles y preguntas", () => {
  const draft: BuilderDraft = {
    ...filled,
    dayMoments: [moment("m-p1", "Fiesta", "23:30", { place: "La carpa", notes: "Con DJ" }), moment("m-p2", "", "10:00"), moment("m-p3", "Llegada de invitados", "11:30")],
    dayCards: [{ id: "d-p1", title: "Regalos", teaser: "", body: "Vuestra presencia es lo mejor.", linkLabel: "" }, { id: "d-p2", title: "", teaser: "", body: "", linkLabel: "" }],
    dayQuestions: [{ id: "q-p1", question: "¿Hay ludoteca?", answer: "Sí, con monitores." }],
  };

  it("se ven en la invitación, en su sitio, y el documento sigue siendo válido", () => {
    const doc = composeBuilderDocument(draft);
    expectFullDocument(doc);
    expect(agendaOf(doc)).toEqual(["11:30 Llegada de invitados", "12:00 Ceremonia", "15:00 Banquete", "23:30 Fiesta"]);
    expect(findScene(doc, "agenda")!.props.items.at(-1)).toMatchObject({ place: "La carpa", notes: "Con DJ" });
    expect(findScene(doc, "details")!.props.cards.map((c) => c.title)).toContain("Regalos");
    expect(findScene(doc, "faq")!.props.items.at(-1)).toEqual({ id: "q-p1", question: "¿Hay ludoteca?", answer: "Sí, con monitores." });
  });

  it("un momento a mano basta para que haya programa", () => {
    const doc = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", dayMoments: [moment("m-p1", "Preboda", "20:00")] });
    expect(findScene(doc, "agenda")!.enabled).toBe(true);
    expect(builderAgendaItems({ dayMoments: [moment("m-p1", "Preboda")] })).toHaveLength(1);
  });

  it("el borrador se guarda y se lee con filas a medio escribir; los antiguos siguen valiendo", () => {
    const reloaded = restoreBuilderDraft(JSON.stringify(draft));
    expect(reloaded).toEqual(draft);
    expect(parseBuilderDraft({ ...filled })).not.toBeNull();
    // Un id fuera del patrón del contrato no entra.
    expect(parseBuilderDraft({ ...draft, dayMoments: [moment("Mal id", "x")] })).toBeNull();
  });

  it("los topes del contrato: nunca más momentos, tarjetas ni preguntas de las que caben", () => {
    const many = Array.from({ length: SITE_MAX_AGENDA_ITEMS }, (_, i) => moment(`m-p${i + 1}`, `Momento ${i + 1}`, ""));
    const full: BuilderDraft = {
      ...filled,
      dayMoments: many,
      dayCards: Array.from({ length: SITE_MAX_DETAIL_CARDS }, (_, i) => ({ id: `d-p${i + 1}`, title: `Tarjeta ${i + 1}`, teaser: "", body: "x", linkLabel: "" })),
      dayQuestions: Array.from({ length: SITE_MAX_FAQ_ITEMS }, (_, i) => ({ id: `q-p${i + 1}`, question: `¿Pregunta ${i + 1}?`, answer: "Sí" })),
    };
    const doc = composeBuilderDocument(full);
    expectFullDocument(doc);
    expect(findScene(doc, "agenda")!.props.items).toHaveLength(SITE_MAX_AGENDA_ITEMS);
    expect(findScene(doc, "details")!.props.cards).toHaveLength(SITE_MAX_DETAIL_CARDS);
    expect(findScene(doc, "faq")!.props.items).toHaveLength(SITE_MAX_FAQ_ITEMS);
    const room = dayRoom(full);
    expect([room.moments.room, room.cards.room, room.questions.room]).toEqual([0, 0, 0]);
  });

  it("las filas guardadas también cuentan: nunca se pasa del tope del borrador (revisión T7, hallazgo 1)", () => {
    const rows = Array.from({ length: SITE_MAX_FAQ_ITEMS }, (_, i) => ({ id: `q-p${i + 1}`, question: `¿Pregunta ${i + 1}?`, answer: "Sí", ...(i === 0 ? { auto: true as const } : {}) }));
    expect(dayRoom({ ...draft, dayQuestions: rows }).questions.room).toBe(0);
  });

  it("un borrador con más filas que el tope se recorta al leerlo en vez de perderse", () => {
    const over = { ...draft, dayQuestions: Array.from({ length: SITE_MAX_FAQ_ITEMS + 1 }, (_, i) => ({ id: `q-p${i + 1}`, question: `¿P${i}?`, answer: "" })) };
    const read = parseBuilderDraft(JSON.parse(JSON.stringify(over)));
    expect(read).not.toBeNull();
    expect(read!.dayQuestions).toHaveLength(SITE_MAX_FAQ_ITEMS);
  });

  it("lo que cabe cuenta lo que ya se ve y las filas a medio escribir", () => {
    const room = dayRoom(draft);
    // Ceremonia, banquete, Fiesta y Llegada se ven; m-p2 está a medias.
    expect(room.moments.room).toBe(SITE_MAX_AGENDA_ITEMS - 4 - 1);
    expect(room.moments.taken).toEqual(expect.arrayContaining(["m-ceremonia", "m-p1", "m-p2", "m-p3"]));
    const cards = findScene(composeBuilderDocument(draft), "details")!.props.cards.length;
    expect(room.cards.room).toBe(SITE_MAX_DETAIL_CARDS - cards - 1);
  });

  it("la web que se crea al publicar lleva lo añadido (creatorSiteDocument)", () => {
    const published = creatorSiteDocument(composeBuilderDocument(draft), documentFromBuilderDraft(draft));
    expect(published).not.toBeNull();
    expect(agendaOf(published!)).toContain("23:30 Fiesta");
  });
});

describe("filas a mano y «Pedid cambios»", () => {
  const patch = (p: Partial<SitePatch>): SitePatch => ({ ...EMPTY_SITE_PATCH, ...p });
  function ask(draft: BuilderDraft, p: Partial<SitePatch>, instruction: string): { proposed: SiteDocument; adopted: BuilderDraft } {
    const result = applySitePatch(composeBuilderDocument(draft), patch(p), instruction, { scope: "creator" });
    if (!result.ok) throw new Error(`sin cambios: ${JSON.stringify(result)}`);
    const checked = adoptChecked(draft, result.document);
    if (!checked.ok) throw new Error(checked.error);
    expect(unappliedSections(result.document, composeBuilderDocument(checked.draft))).toEqual([]);
    expect(restoreBuilderDraft(JSON.stringify(checked.draft))).toEqual(checked.draft);
    return { proposed: result.document, adopted: checked.draft };
  }
  const withParty: BuilderDraft = { ...filled, dayMoments: [moment("m-p1", "Fiesta", "23:30", { notes: "Con DJ" }), moment("m-p2", "", "")] };

  it("la IA cambia la hora y el título de un momento a mano: se aplica y vuelve a su fila", () => {
    const { adopted } = ask(withParty, {
      agendaItems: [
        { id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" },
        { id: "m-banquete", timeLabel: "15:00", title: "Banquete", place: "Finca Los Olivos" },
        { id: "m-p1", timeLabel: "23:45", title: "Fiesta con DJ", place: "" },
      ],
    }, "la fiesta con DJ a las 23:45");
    expect(adopted.dayMoments?.[0]).toEqual(moment("m-p1", "Fiesta con DJ", "23:45", { notes: "Con DJ" }));
    // La fila a medio escribir se conserva.
    expect(adopted.dayMoments?.[1]).toEqual(moment("m-p2", "", ""));
    // Y lo que cambien después en su paso manda.
    const edited = composeBuilderDocument({ ...adopted, dayMoments: [{ ...adopted.dayMoments![0]!, timeLabel: "00:30" }] });
    expect(agendaOf(edited).at(-1)).toBe("00:30 Fiesta con DJ");
  });

  it("un momento nuevo de la IA se puede seguir editando en «Vuestro día»", () => {
    const { adopted } = ask(filled, {
      agendaItems: [
        { id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" },
        { id: "m-banquete", timeLabel: "15:00", title: "Banquete", place: "Finca Los Olivos" },
        { id: null, timeLabel: "23:00", title: "Baile", place: "" },
      ],
    }, "baile a las 23:00");
    const added = adopted.dayMoments ?? [];
    expect(added.map((row) => `${row.timeLabel} ${row.title}`)).toEqual(["23:00 Baile"]);
    const renamed = composeBuilderDocument({ ...adopted, dayMoments: [{ ...added[0]!, title: "Primer baile" }] });
    expect(agendaOf(renamed).at(-1)).toBe("23:00 Primer baile");
  });

  it("la IA quita un momento a mano: desaparece de su fila; quitarlo a mano después de la IA no lo resucita", () => {
    const { adopted } = ask(withParty, {
      agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: "m-banquete", timeLabel: "15:00", title: "Banquete", place: "Finca Los Olivos" }],
    }, "quitad la fiesta");
    expect(adopted.dayMoments?.map((row) => row.id)).toEqual(["m-p2"]);

    // Un cambio de la IA en el programa deja una capa que recuerda la fiesta (`known`).
    const renamed = ask(withParty, {
      agendaItems: [
        { id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia religiosa", place: "Iglesia de San Juan" },
        { id: "m-banquete", timeLabel: "15:00", title: "Banquete", place: "Finca Los Olivos" },
        { id: "m-p1", timeLabel: "23:30", title: "Fiesta", place: "" },
      ],
    }, "la ceremonia religiosa").adopted;
    expect(renamed.sections?.agenda?.known).toContain("m-p1");
    const removed = composeBuilderDocument({ ...renamed, dayMoments: [] });
    expect(agendaOf(removed)).toEqual(["12:00 Ceremonia religiosa", "15:00 Banquete"]);
    // Con la capa ya creada, un momento nuevo de madrugada va al final, no delante de la ceremonia.
    const late = composeBuilderDocument({ ...renamed, dayMoments: [...(renamed.dayMoments ?? []), moment("m-p9", "Recena", "02:00")] });
    expect(agendaOf(late)).toEqual(["12:00 Ceremonia religiosa", "15:00 Banquete", "23:30 Fiesta", "02:00 Recena"]);
    // Un id nuevo nunca coincide con uno que la capa recuerda.
    expect(dayRoom({ ...renamed, dayMoments: [] }).moments.taken).toContain("m-p1");
  });

  it("detalles y preguntas a mano: la IA responde una pregunta y la respuesta vuelve a su fila", () => {
    const draft: BuilderDraft = { ...filled, dayQuestions: [{ id: "q-p1", question: "¿Hay ludoteca?", answer: "" }] };
    const faq = findScene(composeBuilderDocument(draft), "faq")!.props.items;
    const { adopted } = ask(draft, {
      faq: { title: null, contact: null, items: faq.map((q) => ({ id: q.id, question: q.question, answer: q.id === "q-p1" ? "Sí, con monitores toda la tarde." : q.answer })) },
    }, "a la pregunta de la ludoteca: sí, con monitores toda la tarde");
    expect(adopted.dayQuestions?.at(-1)).toEqual({ id: "q-p1", question: "¿Hay ludoteca?", answer: "Sí, con monitores toda la tarde." });
    // Las de plantilla también pasan a filas, «auto» (siguen la plantilla) mientras nadie las toque.
    expect(adopted.dayQuestions?.filter((q) => q.auto).map((q) => q.id)).toEqual(faq.filter((q) => q.id !== "q-p1").map((q) => q.id));
  });

  it("una tarjeta nueva de la IA va a las filas de detalles, detrás de las de plantilla", () => {
    const cards = findScene(composeBuilderDocument(filled), "details")!.props.cards;
    const { adopted } = ask(filled, {
      details: { title: null, intro: null, cards: [...cards.map((c) => ({ ...c, link: null })), { id: null, title: "Regalos", teaser: "", body: "Vuestra presencia es el mejor regalo.", link: null, linkLabel: "" }] },
    }, "una tarjeta de regalos: vuestra presencia es el mejor regalo");
    expect(adopted.dayCards?.map((c) => `${c.title}${c.auto ? " (auto)" : ""}`)).toEqual([...cards.map((c) => `${c.title} (auto)`), "Regalos"]);
  });
});

describe("«Vuestro día» al abrirse: lo de plantilla y lo antiguo de la IA, en filas (materializeDay)", () => {
  const plain: BuilderDraft = { ...filled, modules: ["kids"] };
  const listOf = (doc: SiteDocument) => ({ cards: findScene(doc, "details")!.props.cards.map((c) => c.id), faq: findScene(doc, "faq")!.props.items.map((q) => q.id) });

  it("las tarjetas y preguntas de plantilla pasan a filas sin cambiar nada en la invitación; una sola vez", () => {
    const before = composeBuilderDocument(plain);
    const opened = materializeDay(plain);
    expect(opened).not.toBe(plain);
    expect(composeBuilderDocument(opened)).toEqual(before);
    expect(opened.dayCards?.map((c) => c.id)).toEqual(listOf(before).cards);
    expect(opened.dayQuestions?.every((q) => q.auto)).toBe(true);
    expect(materializeDay(opened)).toBe(opened);
    expect(restoreBuilderDraft(JSON.stringify(opened))).toEqual(opened);
  });

  it("se pueden quitar (ya no comen el tope) y rellenar; lo quitado no vuelve", () => {
    const opened = materializeDay(plain);
    const roomBefore = dayRoom(opened).questions.room;
    const without = { ...opened, dayQuestions: opened.dayQuestions!.filter((q) => q.id !== "q-aparcamiento").map((q) => (q.id === "q-vestimenta" ? { id: q.id, question: q.question, answer: "Formal." } : q)) };
    const doc = composeBuilderDocument(without);
    expect(listOf(doc).faq).not.toContain("q-aparcamiento");
    expect(findScene(doc, "faq")!.props.items.find((q) => q.id === "q-vestimenta")?.answer).toBe("Formal.");
    expect(dayRoom(without).questions.room).toBe(roomBefore + 1);
  });

  it("una fila de plantilla sin tocar sigue a la plantilla; lo nuevo de la plantilla entra al final", () => {
    const opened = materializeDay(plain);
    const ninos = (d: BuilderDraft) => findScene(composeBuilderDocument(d), "faq")!.props.items.find((q) => q.id === "q-ninos");
    expect(ninos(opened)?.answer).toMatch(/niños/);
    // Sin la pregunta de niños, la respuesta «Sí, dinos cuántos niños…» ya no sería verdad: se vacía (y no se ve).
    expect(ninos({ ...opened, modules: [] })?.answer).toBe("");
    // Activar autobuses con una parada añade «¿Hay autobús?» al final.
    const bus = composeBuilderDocument({ ...opened, modules: ["kids", "bus"], busStops: [{ name: "Madrid", time: "10:00", place: "" }] });
    expect(listOf(bus).faq.at(-1)).toBe("q-autobus");
  });

  it("una de plantilla oculta ahora (autobuses apagados) sobrevive a «Pedid cambios» y vuelve al encenderlos", () => {
    const withBus: BuilderDraft = { ...plain, modules: ["kids", "bus"], busStops: [{ name: "Madrid", time: "10:00", place: "" }] };
    const opened = { ...materializeDay(withBus), modules: ["kids" as const] };
    expect(listOf(composeBuilderDocument(opened)).faq).not.toContain("q-autobus");
    const result = applySitePatch(composeBuilderDocument(opened), { ...EMPTY_SITE_PATCH, agendaTitle: "Nuestro día" }, "el programa se llama Nuestro día", { scope: "creator" });
    if (!result.ok) throw new Error("sin cambios");
    const checked = adoptChecked(opened, result.document);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.draft.dayQuestions?.some((q) => q.id === "q-autobus" && q.auto)).toBe(true);
    expect(listOf(composeBuilderDocument({ ...checked.draft, modules: ["kids", "bus"] })).faq).toContain("q-autobus");
  });

  it("borradores antiguos: lo que añadió la IA (en la capa) pasa a filas y se ve igual", () => {
    const patch = (p: Partial<SitePatch>): SitePatch => ({ ...EMPTY_SITE_PATCH, ...p });
    const doc = composeBuilderDocument(filled);
    const result = applySitePatch(doc, patch({
      agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: "m-banquete", timeLabel: "15:00", title: "Banquete", place: "Finca Los Olivos" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }],
      faq: { title: "Dudas", contact: null, items: [{ id: null, question: "¿Dónde se puede aparcar?", answer: "En la finca." }] },
    }), "baile a las 23:00; dudas: dónde se puede aparcar: en la finca", { scope: "creator" });
    if (!result.ok) throw new Error("sin cambios");
    // Así guardaba el borrador estas propuestas antes de las filas (solo capa).
    const proposed = result.document;
    const legacy: BuilderDraft = {
      ...filled,
      sections: {
        agenda: { order: findScene(proposed, "agenda")!.props.items.map((i) => i.id), known: ["m-ceremonia", "m-banquete"], items: findScene(proposed, "agenda")!.props.items.filter((i) => i.title === "Baile"), text: [] },
        faq: { order: findScene(proposed, "faq")!.props.items.map((i) => i.id), known: findScene(doc, "faq")!.props.items.map((i) => i.id), items: findScene(proposed, "faq")!.props.items, text: [{ key: "title", value: "Dudas", basis: "Preguntas y respuestas" }] },
      },
    };
    const before = composeBuilderDocument(legacy);
    expect(agendaOf(before)).toContain("23:00 Baile");
    const opened = materializeDay(legacy);
    expect(composeBuilderDocument(opened)).toEqual(before);
    expect(opened.dayMoments?.map((m) => m.title)).toEqual(["Baile"]);
    expect(opened.dayQuestions?.map((q) => q.question)).toEqual(["¿Dónde se puede aparcar?"]);
    expect(opened.sections?.faq).toEqual({ order: [], known: [], items: [], text: [{ key: "title", value: "Dudas", basis: "Preguntas y respuestas" }] });
    expect(opened.sections?.agenda?.items).toEqual([]);
  });
});
