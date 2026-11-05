import { describe, expect, it } from "vitest";
import { BUILDER_STEPS, EMPTY_DRAFT, STEP, adoptProposal, parseBuilderDraft, builderAgendaItems, composeBuilderDocument, hasBuilderProgress, pickBuilderDraft, prefillBuilderIdea, restoreBuilderDraft, selectedPalette, suggestWeddingStyle, type BuilderDraft } from "./wedding-builder";
import { enabledScenes, findScene, guestVisibleScene, parseSiteDocument, resolvePalette, sceneHasContent } from "./site-document";
import { applySitePatch, EMPTY_SITE_PATCH } from "./ai/site-edit-patch";

const filled: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", venue: "Finca Los Olivos", step: 7 };

describe("borrador del creador", () => {
  it("recovers a valid draft across the login step", () => {
    const draft = { ...EMPTY_DRAFT, step: 7, partnerName1: "Marta", venue: "Los olivos", style: "natural" as const, palette: "rosa" as const, photo: "photo" as const };
    expect(restoreBuilderDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("ignores corrupt, unknown-version or unbounded drafts", () => {
    for (const raw of [null, "bad json", JSON.stringify({ ...EMPTY_DRAFT, version: 5 }), JSON.stringify({ ...EMPTY_DRAFT, layout: "scroll" }), JSON.stringify({ ...EMPTY_DRAFT, step: 999 }), JSON.stringify({ ...EMPTY_DRAFT, idea: "x".repeat(601) }), JSON.stringify({ ...EMPTY_DRAFT, palette: "neon" })]) expect(restoreBuilderDraft(raw)).toBeNull();
  });
  it("never accepts a photo inside the draft", () => {
    expect(restoreBuilderDraft(JSON.stringify({ ...EMPTY_DRAFT, photo: "data:image/jpeg;base64,AAAA" }))).toBeNull();
  });
  it("migrates a v1 draft, inserting the photo step after the names", () => {
    const v1 = { version: 1, idea: "Campo", partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "80", style: "natural", venue: "", address: "", time: "", welcomeMessage: "Hola", step: 2 };
    expect(restoreBuilderDraft(JSON.stringify(v1))).toEqual({ ...v1, version: 4, step: STEP.fecha, palette: null, photo: "pending", design: null, layout: null, opening: "sobre" });
    expect(restoreBuilderDraft(JSON.stringify({ ...v1, step: 1 }))?.step).toBe(STEP.nombres);
    expect(restoreBuilderDraft(JSON.stringify({ ...v1, step: 6 }))?.step).toBe(STEP.web);
  });
  it("migrates a saved v2 draft (before the layout choice) to the current version with the Story layout", () => {
    const v2: Record<string, unknown> = { ...EMPTY_DRAFT, step: 5, partnerName1: "Marta", palette: "mar", version: 2 };
    delete v2.layout;
    delete v2.opening;
    expect(restoreBuilderDraft(JSON.stringify(v2))).toEqual({ ...v2, version: 4, step: STEP.gente, layout: null, opening: "sobre" });
    // Un v2 con un campo `layout` colado no lo adopta (v2 no lo conocía).
    expect(restoreBuilderDraft(JSON.stringify({ ...v2, layout: "web" }))?.layout).toBeNull();
  });
  it("restores the envelope explicitly: absent (drafts before 7-oct) → sobre, legacy null «Sin sobre» → ninguno (regresión 8-oct-2026)", () => {
    const before: Record<string, unknown> = { ...EMPTY_DRAFT, step: 7 };
    delete before.opening;
    expect(restoreBuilderDraft(JSON.stringify(before))?.opening).toBe("sobre");
    expect(restoreBuilderDraft(JSON.stringify({ ...EMPTY_DRAFT, opening: null }))?.opening).toBe("ninguno");
    expect(restoreBuilderDraft(JSON.stringify({ ...EMPTY_DRAFT, opening: "sobre-liso" }))?.opening).toBe("sobre-liso");
    expect(composeBuilderDocument({ ...EMPTY_DRAFT, opening: undefined }).opening).toBe("sobre");
    expect(composeBuilderDocument({ ...EMPTY_DRAFT, opening: null }).opening).toBe("ninguno");
  });
  it("v4 inserts «Vuestro día» after «Vuestra gente»: a v3 draft reopens on the same question", () => {
    const v3 = { ...EMPTY_DRAFT, version: 3 };
    expect(restoreBuilderDraft(JSON.stringify({ ...v3, step: 5 }))?.step).toBe(STEP.gente);
    expect(restoreBuilderDraft(JSON.stringify({ ...v3, step: 6 }))?.step).toBe(STEP.bienvenida);
    expect(restoreBuilderDraft(JSON.stringify({ ...v3, step: 7 }))?.step).toBe(STEP.web);
    expect(restoreBuilderDraft(JSON.stringify({ ...v3, step: 8 }))).toBeNull();
    expect(BUILDER_STEPS[STEP.dia]).toBe("dia");
  });
  it("keeps the layout choice across the login step", () => {
    const draft = { ...EMPTY_DRAFT, step: 7, layout: "web" as const };
    expect(restoreBuilderDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("suggests only supported styles without inventing details", () => {
    expect(suggestWeddingStyle("En un jardín, entre olivos")).toBe("natural");
    expect(suggestWeddingStyle("Clásica y romántica")).toBe("clasico");
    expect(suggestWeddingStyle("Una cena en nuestra ciudad")).toBe("editorial");
  });
});

describe("borrador al volver del correo en otro navegador", () => {
  it("conserva la fecha de la última edición (P2-4) y no admite una que no sea fecha", () => {
    const at = "2026-10-11T08:00:00.000Z";
    expect(parseBuilderDraft({ ...EMPTY_DRAFT, updatedAt: at })?.updatedAt).toBe(at);
    expect(parseBuilderDraft({ ...EMPTY_DRAFT })).not.toHaveProperty("updatedAt");
    expect(parseBuilderDraft({ ...EMPTY_DRAFT, updatedAt: "ayer" })?.updatedAt).toBeUndefined();
  });
  const stashed: BuilderDraft = { ...EMPTY_DRAFT, step: 5, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12" };
  it("sin borrador en este navegador, abre la copia del servidor en su paso", () => {
    expect(pickBuilderDraft(null, stashed)).toEqual(stashed);
    expect(pickBuilderDraft({ ...EMPTY_DRAFT, idea: "En el campo" }, stashed)).toEqual(stashed);
  });
  it("el borrador de este navegador manda si tiene avance", () => {
    const local: BuilderDraft = { ...stashed, step: 7, venue: "Los olivos" };
    expect(pickBuilderDraft(local, stashed)).toBe(local);
  });
  it("sin copia, o con una copia vacía, deja lo que hubiera", () => {
    const blank: BuilderDraft = { ...EMPTY_DRAFT, idea: "En el campo" };
    expect(pickBuilderDraft(null, null)).toBeNull();
    expect(pickBuilderDraft(blank, undefined)).toBe(blank);
    expect(pickBuilderDraft(blank, EMPTY_DRAFT)).toBe(blank);
  });
  it("cuenta como avance un paso superado o un dato de la boda, no la idea sola", () => {
    expect(hasBuilderProgress(null)).toBe(false);
    expect(hasBuilderProgress({ ...EMPTY_DRAFT, idea: "En el campo" })).toBe(false);
    expect(hasBuilderProgress({ ...EMPTY_DRAFT, step: 1 })).toBe(true);
    expect(hasBuilderProgress({ ...EMPTY_DRAFT, partnerName1: "Marta" })).toBe(true);
  });
});

describe("?idea= desde la landing", () => {
  it("starts a fresh draft at step 0 with the idea and its suggested style", () => {
    expect(prefillBuilderIdea(null, "  una boda en el campo ")).toEqual({ ...EMPTY_DRAFT, idea: "una boda en el campo", style: "natural", step: 0 });
  });
  it("leaves the saved draft untouched when the idea is empty or missing", () => {
    const saved = { ...EMPTY_DRAFT, step: 3, partnerName1: "Marta", partnerName2: "Jaime" };
    expect(prefillBuilderIdea(saved, undefined)).toBe(saved);
    expect(prefillBuilderIdea(saved, "   ")).toBe(saved);
    expect(prefillBuilderIdea(null, null)).toBe(EMPTY_DRAFT);
  });
  it("never overwrites an idea the couple already wrote, nor their step", () => {
    const saved = { ...EMPTY_DRAFT, idea: "Clásica y romántica", style: "clasico" as const, step: 4 };
    expect(prefillBuilderIdea(saved, "una boda en el campo")).toBe(saved);
  });
  it("adds the idea to a saved draft without an idea, keeping its progress", () => {
    const saved = { ...EMPTY_DRAFT, step: 2, partnerName1: "Marta", partnerName2: "Jaime" };
    expect(prefillBuilderIdea(saved, "entre olivos")).toEqual({ ...saved, idea: "entre olivos", style: "natural" });
  });
  it("respects a style the couple picked by hand", () => {
    const saved = { ...EMPTY_DRAFT, step: 1, style: "clasico" as const };
    expect(prefillBuilderIdea(saved, "entre olivos").style).toBe("clasico");
  });
  it("trims the idea to the schema limit so the draft stays restorable", () => {
    const draft = prefillBuilderIdea(null, "x".repeat(700));
    expect(draft.idea).toHaveLength(600);
    expect(restoreBuilderDraft(JSON.stringify(draft))).toEqual(draft);
  });
});

describe("documento del creador (paleta, foto y diseño)", () => {
  it("uses the style palette until the couple picks one", () => {
    expect(resolvePalette(composeBuilderDocument(filled)).id).toBe("editorial");
    expect(selectedPalette(filled)).toBe("editorial");
    const pink = composeBuilderDocument({ ...filled, palette: "rosa" });
    expect(pink.palette).toBe("rosa");
    expect(parseSiteDocument(pink).ok).toBe(true);
  });
  it("carries the layout into the document only when the couple chose one", () => {
    // Los borradores nuevos nacen «Como una web» (6-oct-2026); null = sin elegir.
    expect(EMPTY_DRAFT.layout).toBe("web");
    expect("layout" in composeBuilderDocument({ ...filled, layout: null })).toBe(false);
    const web = composeBuilderDocument({ ...filled, layout: "web" });
    expect(web.layout).toBe("web");
    expect(parseSiteDocument(web).ok).toBe(true);
    expect(adoptProposal({ ...filled, layout: "web" }, web).layout).toBe("web");
  });
  it("puts a hosted photo on the cover and keeps the document valid", () => {
    const image = { url: "https://x.supabase.co/storage/v1/object/public/wedding-photos/w/cover-a.jpg", alt: "Foto de Marta y Jaime", width: 1600, height: 2000 };
    const doc = composeBuilderDocument({ ...filled, palette: "mar" }, image);
    expect(findScene(doc, "cover")?.props.image).toEqual(image);
    expect(doc.palette).toBe("mar");
    expect(parseSiteDocument(doc).ok).toBe(true);
  });
  it("keeps the design when the preview carries a local blob: photo (never validated)", () => {
    const doc = composeBuilderDocument({ ...filled, palette: "lavanda", design: { eyebrow: "Por fin", showCountdown: null, agendaTitle: null, rsvpTitle: null, scenes: null } }, { url: "blob:http://localhost/abc", alt: "" });
    expect(doc.palette).toBe("lavanda");
    expect(findScene(doc, "cover")?.props.eyebrow).toBe("Por fin");
    expect(findScene(doc, "cover")?.props.image?.url).toBe("blob:http://localhost/abc");
  });
  it("adopts an AI proposal into the draft fields and the design overlay", () => {
    const before = composeBuilderDocument(filled);
    const cover = findScene(before, "cover")!;
    const rsvp = findScene(before, "rsvp")!;
    const proposed = {
      ...before,
      palette: "natural" as const,
      scenes: [
        { ...cover, props: { ...cover.props, eyebrow: "Os esperamos", welcomeMessage: "Qué ganas de veros." } },
        { ...rsvp, props: { ...rsvp.props, title: "¿Nos acompañas?" } },
        ...before.scenes.filter((scene) => scene.type !== "cover" && scene.type !== "rsvp"),
      ],
    };
    const adopted = adoptProposal(filled, proposed);
    expect(adopted.palette).toBe("natural");
    expect(adopted.welcomeMessage).toBe("Qué ganas de veros.");
    expect(adopted.partnerName1).toBe("Marta");
    expect(adopted.design?.eyebrow).toBe("Os esperamos");
    expect(adopted.design?.rsvpTitle).toBe("¿Nos acompañas?");
    expect(adopted.design?.scenes?.[1]?.id).toBe("asistencia");
    const after = composeBuilderDocument(adopted);
    expect(findScene(after, "cover")?.props.eyebrow).toBe("Os esperamos");
    expect(after.scenes.map((scene) => scene.id)).toEqual(proposed.scenes.map((scene) => scene.id));
    expect(restoreBuilderDraft(JSON.stringify(adopted))).toEqual(adopted);
  });
  it("adopting an unchanged document leaves no design overlay", () => {
    expect(adoptProposal(filled, composeBuilderDocument(filled)).design).toBeNull();
  });
  it("names and date keep winning over a stale design", () => {
    const adopted = adoptProposal(filled, { ...composeBuilderDocument(filled), palette: "oro" });
    const renamed = composeBuilderDocument({ ...adopted, partnerName1: "Lucía" });
    expect(findScene(renamed, "cover")?.props.partnerName1).toBe("Lucía");
    expect(renamed.palette).toBe("oro");
  });
});

describe("módulos del creador (8-oct-2026)", () => {
  it("añade autobuses y alojamiento antes de la asistencia, con los nombres que dio la pareja, y las preguntas", () => {
    const doc = composeBuilderDocument({ ...EMPTY_DRAFT, partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-12", modules: ["bus", "hotels", "menu", "kids", "song"], moduleHints: { stops: ["Madrid"], hotels: ["Hotel Los Arcos"] } });
    const types = doc.scenes.map((s) => s.type);
    expect(types.indexOf("transport")).toBeLessThan(types.indexOf("rsvp"));
    expect(types.indexOf("stay")).toBeLessThan(types.indexOf("rsvp"));
    const transport = doc.scenes.find((s) => s.type === "transport");
    const stay = doc.scenes.find((s) => s.type === "stay");
    const rsvp = doc.scenes.find((s) => s.type === "rsvp");
    expect(transport?.type === "transport" && transport.props.stops.map((s) => s.name)).toEqual(["Madrid"]);
    expect(stay?.type === "stay" && stay.props.hotels.map((h) => h.name)).toEqual(["Hotel Los Arcos"]);
    expect(rsvp?.type === "rsvp" && rsvp.props).toMatchObject({ song: true, kids: true, menuOptions: [{ label: "Carne" }, { label: "Pescado" }, { label: "Vegetariano" }] });
  });
  it("sin módulos el documento es el de siempre", () => {
    const draft = { ...EMPTY_DRAFT, partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-12" };
    expect(composeBuilderDocument({ ...draft, modules: [] })).toEqual(composeBuilderDocument(draft));
  });
});

describe("adoptProposal: maqueta y apertura", () => {
  it("ya no vuelve a la Story ni quita el sobre aunque la IA lo pida (13-oct-2026)", () => {
    const draft: BuilderDraft = { ...filled, layout: "web", opening: "sobre" };
    const result = applySitePatch(composeBuilderDocument(draft), { ...EMPTY_SITE_PATCH, layout: "historia", opening: "ninguno", palette: "rosa" }, "más rosa, como una story y sin sobre", { scope: "creator" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refused).toEqual(["layout", "opening"]);
    const adopted = adoptProposal(draft, result.document);
    expect(adopted.layout).toBe("web");
    expect(adopted.opening).toBe("sobre");
    expect(adopted.palette).toBe("rosa");
  });

  it("sin cambios de maqueta ni apertura, el borrador se queda igual", () => {
    const draft: BuilderDraft = { ...filled, layout: "web", opening: "sobre-liso" };
    const adopted = adoptProposal(draft, composeBuilderDocument(draft));
    expect(adopted.layout).toBe("web");
    expect(adopted.opening).toBe("sobre-liso");
  });
});

describe("documento completo del creador (como /demo, 8-oct-2026)", () => {
  const base: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", venue: "Finca Los Olivos", step: 7 };
  const visible = (doc: ReturnType<typeof composeBuilderDocument>) => enabledScenes(doc).filter((scene) => sceneHasContent(scene)).map((scene) => scene.type);

  it("crea todas las escenas de la demo en su orden, con el programa antes de la asistencia", () => {
    const doc = composeBuilderDocument(base);
    expect(parseSiteDocument(doc).ok).toBe(true);
    expect(doc.scenes.map((scene) => scene.type)).toEqual(["cover", "gallery", "story", "venue", "agenda", "details", "faq", "rsvp"]);
    expect(doc.scenes.map((scene) => scene.id)).toEqual(["portada", "fotos", "historia", "lugar", "programa", "detalles", "preguntas", "asistencia"]);
  });

  it("no inventa: las plantillas sin respuesta existen para el panel pero el invitado no las ve", () => {
    const doc = composeBuilderDocument(base);
    const faq = findScene(doc, "faq")!;
    expect(faq.props.items.map((item) => item.question)).toEqual(expect.arrayContaining(["¿Puedo ir con niños?", "¿Hay aparcamiento?", "¿Hasta cuándo puedo confirmar?", "¿Hay código de vestimenta?"]));
    // Solo se ve lo que la configuración ya responde (el formulario pide alergias).
    expect(guestVisibleScene(faq).props.items.map((item) => item.id)).toEqual(["q-alergias"]);
    // Ninguna respuesta lleva horas, fechas ni códigos.
    for (const item of faq.props.items) expect(item.answer).not.toMatch(/\d/);
    const details = findScene(doc, "details")!;
    expect(details.props.cards.map((card) => card.title)).toEqual(["Dress code", "Cómo llegar", "Menú"]);
    expect(sceneHasContent(details)).toBe(false);
    // Lo que el invitado ve: portada, lugar, preguntas y asistencia (sin historia, fotos, programa ni detalles vacíos).
    expect(visible(doc)).toEqual(["cover", "venue", "faq", "rsvp"]);
  });

  it("los módulos activados responden sus preguntas y dejan su tarjeta", () => {
    const doc = composeBuilderDocument({ ...base, modules: ["kids", "menu", "song"] });
    const answered = guestVisibleScene(findScene(doc, "faq")!).props.items.map((item) => item.id);
    expect(answered).toEqual(["q-ninos", "q-alergias", "q-cancion"]);
    expect(guestVisibleScene(findScene(doc, "details")!).props.cards.map((card) => card.id)).toEqual(["d-menu"]);
    expect(visible(doc)).toEqual(["cover", "venue", "details", "faq", "rsvp"]);
  });

  it("autobuses y alojamiento van detrás del programa; lo que la IA ocultó o movió se conserva (6b)", () => {
    const withModules: BuilderDraft = { ...base, modules: ["bus", "hotels"], moduleHints: { stops: ["Madrid"], hotels: ["Hotel Sol"] } };
    const doc = composeBuilderDocument(withModules);
    expect(doc.scenes.map((scene) => scene.type)).toEqual(["cover", "gallery", "story", "venue", "agenda", "transport", "stay", "details", "faq", "rsvp"]);
    const scenes = [{ id: "alojamiento", enabled: true }, { id: "autobuses", enabled: false }];
    const designed = composeBuilderDocument({ ...withModules, design: { eyebrow: null, showCountdown: null, agendaTitle: null, rsvpTitle: null, scenes } });
    expect(designed.scenes.map((scene) => scene.id).slice(0, 3)).toEqual(["portada", "alojamiento", "autobuses"]);
    expect(findScene(designed, "transport")?.enabled).toBe(false);
  });
});

describe("autobuses y hoteles con sus datos (paso «Vuestra gente», 8-oct-2026)", () => {
  const base: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", step: 7 };

  it("las paradas llevan hora y punto, la vuelta va en texto y el formulario pregunta", () => {
    const doc = composeBuilderDocument({ ...base, modules: ["bus"], busStops: [{ name: "Plaza de Castilla", time: "11:45", place: "Boca de metro" }, { name: "", time: "12:00", place: "" }], busReturn: { time: "01:00", place: "la puerta de la finca" } });
    expect(parseSiteDocument(doc).ok).toBe(true);
    const transport = findScene(doc, "transport")!;
    expect(transport.props.stops).toEqual([{ id: "p-1", name: "Plaza de Castilla", time: "11:45", place: "Boca de metro" }]);
    expect(transport.props.returnNote).toBe("01:00 desde la puerta de la finca");
    expect(transport.props.ask).toBe(true);
    expect(sceneHasContent(transport)).toBe(true);
    expect(guestVisibleScene(findScene(doc, "faq")!).props.items.map((item) => item.id)).toContain("q-autobus");
  });

  it("sin paradas la escena no se ve y el formulario no pregunta por el autobús", () => {
    const doc = composeBuilderDocument({ ...base, modules: ["bus"] });
    const transport = findScene(doc, "transport")!;
    expect(transport.props.stops).toEqual([]);
    expect(transport.props.ask).toBe(false);
    expect(sceneHasContent(transport)).toBe(false);
    expect(guestVisibleScene(findScene(doc, "faq")!).props.items.map((item) => item.id)).not.toContain("q-autobus");
  });

  it("hoteles con código y enlace https; un enlace no seguro no entra", () => {
    const doc = composeBuilderDocument({ ...base, modules: ["hotels"], stayHotels: [{ name: "Hotel Sol", code: "BODA27", link: "hotelsol.es/reserva" }, { name: "Hostal Luna", code: "", link: "http://luna.es" }, { name: "  ", code: "X", link: "" }] });
    expect(parseSiteDocument(doc).ok).toBe(true);
    expect(findScene(doc, "stay")!.props.hotels).toEqual([
      { id: "h-1", name: "Hotel Sol", note: "", code: "BODA27", bookBy: "", link: "https://hotelsol.es/reserva" },
      { id: "h-2", name: "Hostal Luna", note: "", code: "", bookBy: "" },
    ]);
  });

  it("sin datos escritos usa los nombres que dio la idea, sin inventar horas", () => {
    const doc = composeBuilderDocument({ ...base, modules: ["bus", "hotels"], moduleHints: { stops: ["Madrid"], hotels: ["Hotel Sol"] } });
    expect(findScene(doc, "transport")!.props.stops).toEqual([{ id: "p-1", name: "Madrid", time: "", place: "" }]);
    expect(findScene(doc, "stay")!.props.hotels.map((hotel) => hotel.name)).toEqual(["Hotel Sol"]);
  });
});

describe("«Vuestro día» llena el programa (8-oct-2026)", () => {
  const base: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "120", step: STEP.dia };
  const day = { ceremony: { time: "12:30", place: "Iglesia de San Pedro" }, cocktail: { time: "", place: "" }, banquet: { time: "15:00", place: "Finca Los Olivos" } };

  it("solo los momentos con hora o sitio, en orden y en sitios distintos", () => {
    const doc = composeBuilderDocument({ ...base, day });
    const agenda = findScene(doc, "agenda")!;
    expect(agenda.enabled).toBe(true);
    expect(agenda.props.items.map((item) => [item.title, item.timeLabel, item.place])).toEqual([["Ceremonia", "12:30", "Iglesia de San Pedro"], ["Banquete", "15:00", "Finca Los Olivos"]]);
    expect(sceneHasContent(agenda)).toBe(true);
  });

  it("con autobuses: la salida (primera parada con hora) y la vuelta entran en el programa", () => {
    const items = builderAgendaItems({ ...base, day, modules: ["bus"], busStops: [{ name: "Plaza de Castilla", time: "11:00", place: "" }], busReturn: { time: "01:00", place: "la finca" } });
    expect(items.map((item) => [item.title, item.timeLabel, item.place])).toEqual([["Salida de los autobuses", "11:00", "Plaza de Castilla"], ["Ceremonia", "12:30", "Iglesia de San Pedro"], ["Banquete", "15:00", "Finca Los Olivos"], ["Vuelta en autobús", "01:00", "la finca"]]);
  });

  it("sin datos no hay programa (y el invitado no lo ve)", () => {
    const agenda = findScene(composeBuilderDocument(base), "agenda")!;
    expect(agenda.props.items).toEqual([]);
    expect(agenda.enabled).toBe(false);
  });
});

describe("plantillas de la landing (/crear?plantilla=…)", () => {
  it("fija el diseño de la demo y conserva lo escrito", async () => {
    const { applyBuilderTemplate, composeBuilderDocument, EMPTY_DRAFT, builderDraftSchema } = await import("./wedding-builder");
    const draft = applyBuilderTemplate({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Leo", style: "natural", layout: null, opening: "ninguno" }, { id: "hora-dorada", themeId: "clasico", palette: "rosa" });
    expect(draft).toMatchObject({ template: "hora-dorada", style: "clasico", palette: "rosa", layout: "web", opening: "sobre", partnerName1: "Ana", partnerName2: "Leo" });
    expect(builderDraftSchema.safeParse(draft).success).toBe(true);
    const doc = composeBuilderDocument(draft);
    expect(doc).toMatchObject({ themeId: "clasico", palette: "rosa", layout: "web", opening: "sobre" });
  });
});
