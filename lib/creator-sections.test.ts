import { describe, expect, it } from "vitest";
import { EMPTY_DAY, EMPTY_DRAFT, adoptChecked, adoptProposal, composeBuilderDocument, creatorSiteDocument, restoreBuilderDraft, type BuilderDraft } from "./wedding-builder";
import { documentFromBuilderDraft, findScene, parseSiteDocument, type SiteDocument } from "./site-document";
import { applySitePatch, EMPTY_SITE_PATCH, type SitePatch } from "./ai/site-edit-patch";
import { notAppliedMessage, unappliedSections } from "./creator-sections";

/**
 * «Pedid cambios» en el creador (13-oct-2026): lo que propone la IA tiene que
 * verse en la vista previa y seguir ahí al recargar. Antes, el programa, la
 * historia, los detalles, las preguntas, los autobuses y los hoteles se
 * perdían al pasar la propuesta por el borrador local.
 */
const filled: BuilderDraft = {
  ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", venue: "Finca Los Olivos", step: 7,
  day: { ...EMPTY_DAY, ceremony: { time: "12:00", place: "Iglesia de San Juan" } },
};
const patch = (p: Partial<SitePatch>): SitePatch => ({ ...EMPTY_SITE_PATCH, ...p });

/** Pide un cambio como el servidor (ámbito del creador) y lo adopta en el borrador. */
function ask(draft: BuilderDraft, p: Partial<SitePatch>, instruction: string): { proposed: SiteDocument; adopted: BuilderDraft } {
  const result = applySitePatch(composeBuilderDocument(draft), patch(p), instruction, { scope: "creator" });
  if (!result.ok) throw new Error(`sin cambios: ${JSON.stringify(result)}`);
  return { proposed: result.document, adopted: adoptProposal(draft, result.document) };
}

/** Lo que se ve tras adoptar es exactamente lo propuesto, y sobrevive a guardar y leer el borrador (localStorage). */
function expectApplied(proposed: SiteDocument, adopted: BuilderDraft) {
  expect(unappliedSections(proposed, composeBuilderDocument(adopted))).toEqual([]);
  const reloaded = restoreBuilderDraft(JSON.stringify(adopted));
  expect(reloaded).toEqual(adopted);
  expect(unappliedSections(proposed, composeBuilderDocument(reloaded!))).toEqual([]);
}

const agendaOf = (doc: SiteDocument) => findScene(doc, "agenda")!.props.items.map((i) => `${i.timeLabel} ${i.title}${i.place ? ` · ${i.place}` : ""}`);

describe("creador: el programa que pide la pareja se aplica y se queda", () => {
  it("añade momentos y cambia la hora de la ceremonia; «Vuestro día» lo refleja", () => {
    const { proposed, adopted } = ask(filled, {
      agendaItems: [
        { id: "m-ceremonia", timeLabel: "12:30", title: "Ceremonia", place: "Iglesia de San Juan" },
        { id: null, timeLabel: "14:00", title: "Cóctel en el jardín", place: "" },
        { id: null, timeLabel: "23:00", title: "Baile", place: "" },
      ],
    }, "la ceremonia a las 12:30, cóctel en el jardín a las 14:00 y baile a las 23:00");
    expect(agendaOf(proposed)).toEqual(["12:30 Ceremonia · Iglesia de San Juan", "14:00 Cóctel en el jardín", "23:00 Baile"]);
    expect(findScene(proposed, "agenda")!.enabled).toBe(true);
    expectApplied(proposed, adopted);
    // La hora de la ceremonia vuelve a su paso: el editor del día enseña lo mismo que la invitación.
    expect(adopted.day?.ceremony).toEqual({ time: "12:30", place: "Iglesia de San Juan" });
  });

  it("si después cambian una hora en su paso, manda lo suyo y los momentos añadidos siguen", () => {
    const { adopted } = ask(filled, { agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia religiosa", place: "Iglesia de San Juan" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }] }, "ceremonia religiosa y baile a las 23:00");
    const edited: BuilderDraft = { ...adopted, day: { ...adopted.day!, ceremony: { time: "13:00", place: "Iglesia de San Juan" }, cocktail: { time: "15:00", place: "Jardín" } } };
    // El título que cambió la IA se conserva; la hora es la del paso; el cóctel nuevo entra por su hora.
    expect(agendaOf(composeBuilderDocument(edited))).toEqual(["13:00 Ceremonia religiosa · Iglesia de San Juan", "15:00 Cóctel · Jardín", "23:00 Baile"]);
    // Vaciar la ceremonia en su paso la quita (no vuelve desde la capa).
    const cleared: BuilderDraft = { ...edited, day: { ...edited.day!, ceremony: { time: "", place: "" } } };
    expect(agendaOf(composeBuilderDocument(cleared))).toEqual(["15:00 Cóctel · Jardín", "23:00 Baile"]);
  });

  it("quitar un momento del día con la IA lo vacía también en su paso", () => {
    const withCocktail: BuilderDraft = { ...filled, day: { ...filled.day!, cocktail: { time: "14:00", place: "Jardín" } } };
    const { proposed, adopted } = ask(withCocktail, { agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }] }, "quitad el cóctel");
    expectApplied(proposed, adopted);
    expect(adopted.day?.cocktail).toEqual({ time: "", place: "" });
  });

  it("adoptar dos veces lo mismo no cambia nada (idempotente)", () => {
    const { adopted } = ask(filled, { agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }] }, "baile a las 23:00");
    const again = adoptProposal(adopted, composeBuilderDocument(adopted));
    expect(composeBuilderDocument(again)).toEqual(composeBuilderDocument(adopted));
  });
});

describe("creador: historia, detalles y preguntas", () => {
  it("la historia reescrita vuelve a sus respuestas; título, entrada y capítulos nuevos se quedan", () => {
    const draft: BuilderDraft = { ...filled, story: { met: "En la universidad", proposal: "", ahead: "" } };
    const { proposed, adopted } = ask(draft, {
      story: { title: "Cómo empezó todo", intro: "Una historia de pasillos", chapters: [{ id: "c-conocimos", title: "cómo nos conocimos", body: "Nos conocimos en la universidad, entre apuntes." }, { id: null, title: "El primer viaje", body: "Nos fuimos a Lisboa." }] },
    }, "contad la historia con más cariño y un capítulo del primer viaje a Lisboa");
    expectApplied(proposed, adopted);
    expect(adopted.story).toEqual({ met: "Nos conocimos en la universidad, entre apuntes.", proposal: "", ahead: "" });
    // Lo que escriban después en su paso manda en el texto del capítulo.
    const edited = composeBuilderDocument({ ...adopted, story: { met: "En la facultad", proposal: "", ahead: "" } });
    const story = findScene(edited, "story")!;
    expect(story.props.title).toBe("Cómo empezó todo");
    expect(story.props.chapters.map((c) => c.body)).toEqual(["En la facultad", "Nos fuimos a Lisboa."]);
  });

  it("preguntas y detalles: lo nuevo y lo cambiado se ve y se guarda", () => {
    const { proposed, adopted } = ask(filled, {
      faq: { title: "Dudas", contact: null, items: [{ id: null, question: "¿Dónde se puede aparcar?", answer: "En la propia finca, gratis." }] },
      details: { title: null, intro: null, cards: [{ id: "d-dress", title: "Dress code", teaser: "Formal", body: "Traje y vestido largo.", link: null, linkLabel: "" }] },
    }, "una pregunta de dónde aparcar: en la propia finca, gratis; y el dress code formal: traje y vestido largo");
    expect(findScene(proposed, "faq")!.props.title).toBe("Dudas");
    expectApplied(proposed, adopted);
    const after = composeBuilderDocument(adopted);
    expect(findScene(after, "faq")!.props.items.map((q) => q.question)).toEqual(["¿Dónde se puede aparcar?"]);
  });

  it("la web que se crea al publicar lleva el contenido pedido (creatorSiteDocument)", () => {
    const { adopted } = ask(filled, { agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }], faq: { title: null, contact: null, items: [{ id: null, question: "¿Hay aparcamiento?", answer: "Sí, en la finca." }] } }, "baile a las 23:00 y aparcamiento: sí, en la finca");
    const site = composeBuilderDocument(adopted);
    const published = creatorSiteDocument(site, documentFromBuilderDraft(adopted));
    expect(published).not.toBeNull();
    expect(agendaOf(published!)).toEqual(["12:00 Ceremonia · Iglesia de San Juan", "23:00 Baile"]);
    expect(findScene(published!, "faq")!.props.items[0]?.answer).toBe("Sí, en la finca.");
  });
});

describe("creador: autobuses y hoteles", () => {
  it("añadirlos con la IA activa su módulo y los deja en su paso; las notas de los hoteles se guardan", () => {
    const { proposed, adopted } = ask(filled, {
      transport: { title: null, intro: null, returnNote: null, stops: [{ id: null, name: "Plaza de Castilla", time: "10:30", place: "Junto a las torres" }] },
      stay: { title: null, intro: null, hotels: [{ id: null, name: "Hotel Sol", note: "A cinco minutos de la finca", code: "BODA27", link: null }] },
    }, "un autobús desde Plaza de Castilla a las 10:30, junto a las torres, y el Hotel Sol con el código BODA27: a cinco minutos de la finca");
    expectApplied(proposed, adopted);
    expect(adopted.modules).toEqual(["bus", "hotels"]);
    expect(adopted.busStops).toEqual([{ name: "Plaza de Castilla", time: "10:30", place: "Junto a las torres" }]);
    expect(adopted.stayHotels).toEqual([{ name: "Hotel Sol", code: "BODA27", link: "" }]);
  });
});

describe("creador: la IA no cambia la apertura ni pasa a «Como una Story» (13-oct-2026)", () => {
  it("pedir la Story o quitar el sobre no cambia la forma ni la apertura (lo rechaza el servidor; la apertura nunca se adopta)", () => {
    const draft: BuilderDraft = { ...filled, layout: "web", opening: "sobre" };
    const result = applySitePatch(composeBuilderDocument(draft), patch({ layout: "historia", opening: "ninguno", palette: "rosa" }), "rosa, como una story y sin sobre", { scope: "creator" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const adopted = adoptProposal(draft, result.document);
    expect(adopted.layout).toBe("web");
    expect(adopted.opening).toBe("sobre");
    // Aunque llegase un documento con otra apertura, el borrador conserva la suya.
    expect(adoptProposal(draft, { ...composeBuilderDocument(draft), opening: "ninguno" }).opening).toBe("sobre");
  });
});

describe("creador: «Deshacer» devuelve también la forma (revisión, hallazgo 1)", () => {
  it("tras «como una web», deshacer vuelve a la Story de un borrador antiguo y se ve", () => {
    const old: BuilderDraft = { ...filled, layout: null };
    const before = composeBuilderDocument(old);
    const { proposed, adopted } = ask(old, { layout: "web" }, "que se vea como una web");
    expect(proposed.layout).toBe("web");
    expect(adopted.layout).toBe("web");
    const undone = adoptChecked(adopted, before);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.draft.layout).toBeNull();
    expect(composeBuilderDocument(undone.draft).layout).toBeUndefined();
    // Un borrador que ya era «historia» explícita la conserva.
    expect(adoptProposal({ ...filled, layout: "historia" }, composeBuilderDocument({ ...filled, layout: "historia" })).layout).toBe("historia");
  });

  it("si la forma no coincide, unappliedSections lo dice", () => {
    const doc = composeBuilderDocument({ ...filled, layout: null });
    expect(unappliedSections({ ...doc, layout: "web" }, doc)).toEqual(["la forma"]);
  });
});

describe("unappliedSections: nunca «Aplicado» sin verse", () => {
  it("detecta lo que el borrador no puede recomponer y lo explica", () => {
    const doc = composeBuilderDocument(filled);
    const agenda = findScene(doc, "agenda")!;
    // Una hora que no es HH:MM en un momento de «Vuestro día» no cabe en su paso.
    const odd: SiteDocument = { ...doc, scenes: doc.scenes.map((s) => (s.id === agenda.id ? { ...agenda, props: { ...agenda.props, items: agenda.props.items.map((i) => ({ ...i, timeLabel: "a mediodía" })) } } : s)) };
    expect(parseSiteDocument(odd).ok).toBe(true);
    const missing = unappliedSections(odd, composeBuilderDocument(adoptProposal(filled, odd)));
    expect(missing).toEqual(["Programa"]);
    expect(notAppliedMessage(missing)).toBe("No hemos podido aplicar este cambio en vuestra invitación (Programa), así que no hemos tocado nada. Probad a pedirlo de otra forma o cambiadlo en su paso.");
  });

  it("adoptChecked (lo que usa el chat del creador): adopta si se ve igual; si no, no toca el borrador y explica", () => {
    const ok = adoptChecked({ ...filled, partnerName1: "Marta " }, composeBuilderDocument(ask(filled, { agendaItems: [{ id: "m-ceremonia", timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }] }, "baile a las 23:00").adopted));
    expect(ok.ok).toBe(true);
    const doc = composeBuilderDocument(filled);
    const agenda = findScene(doc, "agenda")!;
    const odd: SiteDocument = { ...doc, scenes: doc.scenes.map((s) => (s.id === agenda.id ? { ...agenda, props: { ...agenda.props, items: agenda.props.items.map((i) => ({ ...i, timeLabel: "a mediodía" })) } } : s)) };
    expect(adoptChecked(filled, odd)).toEqual({ ok: false, error: expect.stringContaining("(Programa)") });
  });

  it("un borrador con contenido de la IA sigue cabiendo en el contrato y en el almacenamiento del navegador", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: null, question: `¿Pregunta ${i + 1}?`, answer: "Respuesta larga ".repeat(40).trim() }));
    const { adopted } = ask(filled, { faq: { title: null, contact: null, items } }, items.map((i) => `${i.question} ${i.answer}`).join(" "));
    expect(restoreBuilderDraft(JSON.stringify(adopted))).toEqual(adopted);
  });
});
