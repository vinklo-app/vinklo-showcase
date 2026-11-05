import { describe, expect, it } from "vitest";
import { documentFromLegacy, findScene, parseSiteDocument, SITE_MAX_FAQ_ITEMS, SITE_MAX_SCENES, type Scene, type SiteDocument } from "@/lib/site-document";
import { applySitePatch, EMPTY_SITE_PATCH, instructionContains, normalizeForMatch, sitePatchSchema, type SitePatch } from "./site-edit-patch";

const empty = EMPTY_SITE_PATCH;
const doc: SiteDocument = documentFromLegacy({
  partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: "https://cdn.example.com/foto.jpg",
  page_config: { style: "editorial", welcomeMessage: "Os esperamos", venue: "Finca El Olivar", address: "Camino Real 4", time: "17:30" },
  agenda: [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "17:30", place: null, address: null, notes: null }],
});
const apply = (patch: Partial<SitePatch>, instruction = "cambiad cosas") => applySitePatch(doc, { ...empty, ...patch }, instruction);

/** Web con todas las secciones de contenido rellenas. */
function fullDoc(): SiteDocument {
  const extra: Scene[] = [
    { id: "historia", type: "story", enabled: true, props: { title: "Nuestra historia", intro: "", chapters: [{ id: "c-1", title: "Cómo empezó", body: "Nos conocimos en Granada en 2015.", images: [{ url: "https://cdn.example.com/c1.jpg", alt: "" }] }] } },
    { id: "detalles", type: "details", enabled: true, props: { title: "Algunos detalles más", intro: "", cards: [{ id: "d-1", title: "Dress code", teaser: "Cómodos", body: "Venid como queráis.", linkLabel: "" }] } },
    { id: "preguntas", type: "faq", enabled: true, props: { title: "Preguntas y respuestas", contact: "", items: [{ id: "q-1", question: "¿Puedo llevar niños?", answer: "Sí, claro." }] } },
    { id: "autobuses", type: "transport", enabled: true, props: { title: "Autobuses", intro: "", stops: [{ id: "p-1", name: "Plaza de Castilla", time: "16:00", place: "" }], returnNote: "", ask: true } },
    { id: "alojamiento", type: "stay", enabled: true, props: { title: "Dónde alojarse", intro: "", hotels: [{ id: "h-1", name: "Hotel Sol", note: "", code: "BODA27", bookBy: "2027-05-01", link: "https://hotelsol.example.com" }], ask: true } },
  ];
  const parsed = parseSiteDocument({ ...doc, scenes: [...doc.scenes.slice(0, 2), ...extra, ...doc.scenes.slice(2)] });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.document;
}
const full = fullDoc();
const applyFull = (patch: Partial<SitePatch>, instruction = "cambiad cosas") => applySitePatch(full, { ...empty, ...patch }, instruction);

const faq = (items: Array<{ id: string | null; question: string; answer: string }>, extra: Partial<NonNullable<SitePatch["faq"]>> = {}): SitePatch["faq"] => ({ title: null, contact: null, items, ...extra });
const stay = (hotels: NonNullable<NonNullable<SitePatch["stay"]>["hotels"]>): SitePatch["stay"] => ({ title: null, intro: null, hotels });
const transport = (stops: NonNullable<NonNullable<SitePatch["transport"]>["stops"]>, extra: Partial<NonNullable<SitePatch["transport"]>> = {}): SitePatch["transport"] => ({ title: null, intro: null, returnNote: null, stops, ...extra });

describe("normalizeForMatch", () => {
  it("ignora mayúsculas, acentos, espacios y formatos de hora", () => {
    expect(normalizeForMatch("  Jardín   del ÁLAMO a las 18.30 o 9h05 ")).toBe("jardin del alamo a las 18:30 o 09:05");
    expect(instructionContains("Cambiad el lugar a la finca la alameda, por favor", "Finca La Alameda")).toBe(true);
    expect(instructionContains("cambiad el lugar", "Finca La Alameda")).toBe(false);
    expect(instructionContains("algo", "")).toBe(false);
  });
});

describe("sitePatchSchema", () => {
  it("EMPTY_SITE_PATCH cumple el esquema (todas las claves, null = sin cambios)", () => {
    expect(sitePatchSchema.safeParse(EMPTY_SITE_PATCH).success).toBe(true);
    expect(Object.keys(sitePatchSchema.shape).sort()).toEqual(Object.keys(EMPTY_SITE_PATCH).sort());
  });
  it("ninguna descripción del esquema habla de «escenas»", () => {
    // La única mención es la prohibición expresa en `summary`.
    expect(JSON.stringify(sitePatchSchema.toJSONSchema()).replace("Nunca uses la palabra «escena».", "")).not.toMatch(/escena/i);
  });
});

describe("applySitePatch: diseño, portada y lugar", () => {
  it("aplica paleta, estilo y textos permitidos sin tocar nombres, fecha ni foto", () => {
    const result = apply({ palette: "natural", themeId: "clasico", coverWelcomeMessage: "¡Qué ganas de celebrarlo con vosotros!", coverShowCountdown: false, rsvpTitle: "¿Venís?" }, "poned el fondo más verde, estilo clásico, quitad la cuenta atrás y cambiad la bienvenida");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.palette).toBe("natural");
    expect(result.document.themeId).toBe("clasico");
    const cover = findScene(result.document, "cover")!;
    expect(cover.props).toMatchObject({ partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", welcomeMessage: "¡Qué ganas de celebrarlo con vosotros!", showCountdown: false, image: { url: "https://cdn.example.com/foto.jpg" } });
    expect(findScene(result.document, "rsvp")?.props.title).toBe("¿Venís?");
    expect(result.changes).toEqual(["el estilo", "los colores (Natural)", "el mensaje de bienvenida", "la cuenta atrás", "el título de la confirmación"]);
    expect(result.dropped).toEqual([]);
  });

  it("lugar, dirección y hora solo cambian a valores escritos en la petición", () => {
    const invented = apply({ venueName: "Hacienda San Rafael", venueAddress: "Calle Mayor 1", venueTime: "19:00" }, "cambiad el sitio a uno más bonito y más tarde");
    expect(invented).toEqual({ ok: false, reason: "no_changes", dropped: ["el nombre del lugar", "la dirección", "la hora"], blocked: [], refused: [] });

    const literal = apply({ venueName: "Hacienda San Rafael", venueTime: "19.00" }, "El lugar ahora es la hacienda san rafael y empieza a las 19h00");
    expect(literal.ok).toBe(true);
    if (literal.ok) expect(findScene(literal.document, "venue")?.props).toMatchObject({ venue: "Hacienda San Rafael", address: "Camino Real 4", time: "19:00" });
  });

  it("vaciar la dirección no inventa nada y se permite", () => {
    const result = apply({ venueAddress: "" }, "quitad la dirección");
    expect(result.ok && findScene(result.document, "venue")?.props.address).toBe("");
  });

  it("descarta textos libres con fechas, horas o números nuevos, pero acepta los que ya existen", () => {
    const invented = apply({ coverWelcomeMessage: "Os esperamos el 14 de julio a las 20:00", agendaTitle: "Nuestro gran día" }, "haced la bienvenida más emotiva y cambiad el título del programa");
    expect(invented.ok).toBe(true);
    if (!invented.ok) return;
    expect(invented.dropped).toEqual(["el mensaje de bienvenida"]);
    expect(findScene(invented.document, "cover")?.props.welcomeMessage).toBe("Os esperamos");
    expect(findScene(invented.document, "agenda")?.props.title).toBe("Nuestro gran día");

    const known = apply({ coverWelcomeMessage: "Os esperamos el sábado 12 de junio a las 17:30 en Finca El Olivar" }, "poned la fecha y el lugar en la bienvenida");
    expect(known.ok && known.dropped).toEqual([]);

    const fromInstruction = apply({ coverEyebrow: "Nos casamos en 2027" }, "el titular pequeño: «Nos casamos en 2027»");
    expect(fromInstruction.ok).toBe(true);
  });

  it("descarta nombres propios inventados en el texto libre", () => {
    const result = apply({ coverWelcomeMessage: "Os esperamos en el Palacio de Linares" }, "haced la bienvenida más elegante");
    expect(result).toMatchObject({ ok: false, reason: "no_changes", dropped: ["el mensaje de bienvenida"] });
  });

  it("maqueta: solo pasa a «Como una web»; la apertura y «Como una Story» no se cambian (13-oct-2026)", () => {
    const web = apply({ layout: "web", opening: "sobre-liso" }, "como una web y con sobre liso");
    expect(web.ok).toBe(true);
    if (!web.ok) return;
    expect(web.document.layout).toBe("web");
    expect("opening" in web.document).toBe(false);
    expect(web.changes).toEqual(["la maqueta (Como una web)"]);
    expect(web.refused).toEqual(["opening"]);

    // Volver a la Story o quitar el sobre: nada cambia y se dice.
    const back = applySitePatch(web.document, { ...empty, layout: "historia", opening: "ninguno" }, "como una story y sin sobre");
    expect(back).toEqual({ ok: false, reason: "no_changes", dropped: [], blocked: [], refused: ["layout", "opening"] });

    // Con otro cambio, se aplica lo demás y la maqueta se queda como estaba.
    const mixed = applySitePatch(web.document, { ...empty, layout: "historia", palette: "rosa" }, "más rosa y como una story");
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.document.layout).toBe("web");
    expect(mixed.document.palette).toBe("rosa");
    expect(mixed.refused).toEqual(["layout"]);

    // El documento de partida no dice nada = sobre: pedir «sobre» no cambia nada ni se rechaza.
    expect(apply({ layout: "historia", opening: "sobre" })).toEqual({ ok: false, reason: "no_changes", dropped: [], blocked: [], refused: [] });
  });

  it("reordena y oculta secciones; la portada sigue primera y visible; ids desconocidos se ignoran", () => {
    const result = apply({ scenes: [{ id: "programa", enabled: true }, { id: "inventada", enabled: true }, { id: "portada", enabled: false }, { id: "lugar", enabled: false }] }, "poned el programa antes y ocultad el lugar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes.map((s) => [s.id, s.enabled])).toEqual([["portada", true], ["programa", true], ["lugar", false], ["asistencia", true]]);
  });

  it("sin cambios reales devuelve no_changes; textos demasiado largos devuelven invalid", () => {
    expect(apply({ palette: "editorial", coverWelcomeMessage: "Os esperamos" })).toEqual({ ok: false, reason: "no_changes", dropped: [], blocked: [], refused: [] });
    const long = apply({ coverEyebrow: "x".repeat(61) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.reason).toBe("invalid");
  });

  it("no muta el documento de entrada", () => {
    const before = JSON.stringify(full);
    applyFull({ palette: "rosa", coverWelcomeMessage: "Hola", scenes: [{ id: "asistencia", enabled: false }], faq: faq([]), stay: stay([]) });
    expect(JSON.stringify(full)).toBe(before);
  });
});

describe("applySitePatch: preguntas frecuentes", () => {
  it("crea la sección de preguntas si no existe, delante de la asistencia, con ids del servidor", () => {
    const result = apply({ faq: faq([{ id: "inventado!", question: "¿Hay aparcamiento?", answer: "Sí, en la propia finca." }]) }, "añade una pregunta frecuente sobre el aparcamiento: sí, en la propia finca");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.document.scenes.map((s) => s.id);
    expect(ids.indexOf("preguntas")).toBe(ids.indexOf("asistencia") - 1);
    const scene = findScene(result.document, "faq")!;
    expect(scene.enabled).toBe(true);
    expect(scene.props.items).toEqual([{ id: "q-1", question: "¿Hay aparcamiento?", answer: "Sí, en la propia finca." }]);
    expect(result.changes).toEqual(["Preguntas: sección nueva", "Preguntas: + ¿Hay aparcamiento?"]);
    expect(result.followUps).toEqual([]);
  });

  it("una sección nueva queda delante de la asistencia aunque el modelo reordene las demás", () => {
    const result = apply({
      faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "" }]),
      scenes: [{ id: "portada", enabled: true }, { id: "programa", enabled: true }, { id: "lugar", enabled: true }, { id: "asistencia", enabled: true }],
    }, "añade una pregunta sobre el aparcamiento y poned el programa antes del lugar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes.map((s) => s.id)).toEqual(["portada", "programa", "lugar", "preguntas", "asistencia"]);
  });

  it("una pregunta sin respuesta se añade y pide completarla a mano", () => {
    const result = apply({ faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "" }]) }, "añade una pregunta frecuente sobre el aparcamiento");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.followUps).toEqual(["Escribid la respuesta a «¿Hay aparcamiento?» en Vuestro contenido."]);
  });

  it("descarta una respuesta con datos inventados pero conserva la pregunta", () => {
    const result = apply({ faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "Sí, 200 plazas gratis en el Parking Central." }]) }, "añade una pregunta sobre el aparcamiento");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "faq")?.props.items).toEqual([{ id: "q-1", question: "¿Hay aparcamiento?", answer: "" }]);
    expect(result.dropped).toEqual(["la respuesta a «¿Hay aparcamiento?»"]);
  });

  it("no crea una sección vacía (solo título) ni deja cambios colgando", () => {
    expect(apply({ faq: faq([], { title: "Dudas" }) }, "poned un título a las preguntas")).toEqual({ ok: false, reason: "no_changes", dropped: [], blocked: [], refused: [] });
  });

  it("edita, quita y reordena por id y lo describe de forma legible", () => {
    const result = applyFull({ faq: faq([
      { id: null, question: "¿Hay aparcamiento?", answer: "Sí." },
      { id: "q-1", question: "¿Pueden venir niños?", answer: "Sí, claro." },
    ]) }, "añade una pregunta sobre el aparcamiento, que sí hay, y reformula la de niños");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "faq")?.props.items.map((i) => i.id)).toEqual(["q-2", "q-1"]);
    expect(result.changes).toEqual(["Preguntas: + ¿Hay aparcamiento?", "Preguntas: cambia «¿Pueden venir niños?»"]);

    const removed = applyFull({ faq: faq([]) }, "quitad la pregunta de los niños");
    expect(removed.ok && removed.changes).toEqual(["Preguntas: − ¿Puedo llevar niños?"]);
  });

  it("título y texto de contacto de la sección", () => {
    const result = applyFull({ faq: faq([{ id: "q-1", question: "¿Puedo llevar niños?", answer: "Sí, claro." }], { title: "Dudas", contact: "¿Otra duda? Escribidnos." }) }, "cambiad el título de las preguntas a Dudas");
    expect(result.ok && result.changes).toEqual(["Preguntas: título «Dudas»", "Preguntas: texto de contacto «¿Otra duda? Escribidnos.»"]);
  });

  it("enciende una sección oculta cuando se le añade algo", () => {
    const hidden = { ...full, scenes: full.scenes.map((s) => (s.type === "faq" ? { ...s, enabled: false } : s)) };
    const result = applySitePatch(hidden, { ...empty, faq: faq([{ id: "q-1", question: "¿Puedo llevar niños?", answer: "Sí, claro." }, { id: null, question: "¿Hay aparcamiento?", answer: "" }]) }, "añadid la pregunta del aparcamiento");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "faq")?.enabled).toBe(true);
    expect(result.changes).toContain("Preguntas: se muestra");
  });

  it("respeta el máximo de preguntas del contrato", () => {
    const items = Array.from({ length: SITE_MAX_FAQ_ITEMS + 1 }, (_, i) => ({ id: null, question: `¿Pregunta ${i + 1}?`, answer: "" }));
    const instruction = `añadid ${items.map((i) => i.question).join(" ")}`;
    const result = apply({ faq: faq(items) }, instruction);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok && result.reason === "invalid") expect(result.issues[0]?.message).toBe(`Como máximo ${SITE_MAX_FAQ_ITEMS} preguntas.`);
  });

  it("respeta el máximo de secciones al crear una nueva", () => {
    const crowded = parseSiteDocument({ ...doc, scenes: [...doc.scenes, ...Array.from({ length: SITE_MAX_SCENES - doc.scenes.length }, (_, i) => ({ id: `fotos-${i + 1}`, type: "gallery", enabled: true, props: { title: "", images: [] } }))] });
    expect(crowded.ok).toBe(true);
    if (!crowded.ok) return;
    const result = applySitePatch(crowded.document, { ...empty, faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "" }]) }, "añade una pregunta sobre el aparcamiento");
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("applySitePatch: alojamiento (literales: nombre, código, enlace)", () => {
  it("acepta un hotel, código y enlace escritos en la petición", () => {
    const result = apply({ stay: stay([{ id: null, name: "Hotel Miramar", note: "A cinco minutos andando.", code: "AMOR10", link: "https://miramar.example.com/boda" }]) }, "añadid el Hotel Miramar con el código AMOR10 y el enlace https://miramar.example.com/boda; está a cinco minutos andando");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "stay")?.props.hotels).toEqual([{ id: "h-1", name: "Hotel Miramar", note: "A cinco minutos andando.", code: "AMOR10", bookBy: "", link: "https://miramar.example.com/boda" }]);
    expect(result.changes).toEqual(["Alojamiento: sección nueva", "Alojamiento: + Hotel Miramar"]);
  });

  it("rechaza un hotel inventado; con nombre real, descarta código y enlace inventados", () => {
    const invented = apply({ stay: stay([{ id: null, name: "Hotel Miramar", note: "", code: "", link: null }]) }, "añadid un hotel cerca de la finca");
    expect(invented).toEqual({ ok: false, reason: "no_changes", dropped: ["el hotel «Hotel Miramar»"], blocked: [], refused: [] });

    const partial = apply({ stay: stay([{ id: null, name: "Hotel Miramar", note: "", code: "VINKLO", link: "https://miramar.example.com" }]) }, "añadid el hotel miramar");
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(findScene(partial.document, "stay")?.props.hotels[0]).toEqual({ id: "h-1", name: "Hotel Miramar", note: "", code: "", bookBy: "" });
    expect(partial.dropped).toEqual(["el enlace de «Hotel Miramar»", "el código de «Hotel Miramar»"]);
  });

  it("conserva código, enlace y «reservar antes de» de un hotel existente al editar su nota", () => {
    const result = applyFull({ stay: stay([{ id: "h-1", name: "Hotel Sol", note: "El más cercano a la finca.", code: "BODA27", link: null }]) }, "poned en el hotel sol que es el más cercano a la finca");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "stay")?.props.hotels[0]).toEqual({ id: "h-1", name: "Hotel Sol", note: "El más cercano a la finca.", code: "BODA27", bookBy: "2027-05-01", link: "https://hotelsol.example.com" });
    expect(result.changes).toEqual(["Alojamiento: cambia «Hotel Sol»"]);
  });

  it("un enlace solo si es https y literal; \"\" lo quita", () => {
    const http = applyFull({ stay: stay([{ id: "h-1", name: "Hotel Sol", note: "", code: "BODA27", link: "http://hotelsol.example.com" }]) }, "cambiad el enlace a http://hotelsol.example.com");
    expect(http).toMatchObject({ ok: false, dropped: ["el enlace de «Hotel Sol»"] });
    const removed = applyFull({ stay: stay([{ id: "h-1", name: "Hotel Sol", note: "", code: "BODA27", link: "" }]) }, "quitad el enlace del hotel sol");
    expect(removed.ok).toBe(true);
    if (removed.ok) expect("link" in findScene(removed.document, "stay")!.props.hotels[0]!).toBe(false);
  });
});

describe("applySitePatch: autobuses", () => {
  it("parada y hora literales; vuelta en texto libre sin horas nuevas", () => {
    const result = applyFull({ transport: transport([
      { id: "p-1", name: "Plaza de Castilla", time: "16:00", place: "" },
      { id: null, name: "Atocha", time: "16.30", place: "Salida de Cercanías" },
    ], { returnNote: "A la 01:00 desde la finca" }) }, "añadid una parada en Atocha a las 16:30, en la salida de cercanías, y la vuelta a la 01:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const props = findScene(result.document, "transport")!.props;
    expect(props.stops[1]).toEqual({ id: "p-2", name: "Atocha", time: "16:30", place: "Salida de Cercanías" });
    expect(props.returnNote).toBe("A la 01:00 desde la finca");
    expect(result.changes).toEqual(["Autobuses: vuelta «A la 01:00 desde la finca»", "Autobuses: + Atocha (16:30)"]);
  });

  it("descarta paradas, horas y vueltas inventadas", () => {
    const result = applyFull({ transport: transport([
      { id: "p-1", name: "Plaza de Castilla", time: "15:45", place: "" },
      { id: null, name: "Moncloa", time: "16:00", place: "" },
    ], { returnNote: "Vuelta a las 03:00" }) }, "añadid más paradas y la vuelta");
    expect(result).toEqual({ ok: false, reason: "no_changes", dropped: ["la vuelta de Autobuses", "la hora de la parada «Plaza de Castilla»", "la parada «Moncloa»"], blocked: [], refused: [] });
  });
});

describe("applySitePatch: programa, historia y detalles", () => {
  it("añade un momento con hora y sitio literales; conserva dirección y notas de los existentes", () => {
    const agendaId = findScene(doc, "agenda")!.props.items[0]!.id;
    const result = apply({ agendaItems: [
      { id: agendaId, timeLabel: "17:30", title: "Ceremonia civil", place: "" },
      { id: null, timeLabel: "19:00", title: "Cóctel", place: "Jardín de los Olivos" },
    ] }, "la ceremonia es civil y añadid el cóctel a las 19:00 en el jardín de los olivos");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = findScene(result.document, "agenda")!.props.items;
    expect(items[1]).toEqual({ id: "m-2", title: "Cóctel", timeLabel: "19:00", place: "Jardín de los Olivos", address: "", notes: "" });
    expect(result.changes).toEqual(["Programa: cambia «17:30 Ceremonia civil»", "Programa: + 19:00 Cóctel"]);
  });

  it("no inventa la hora ni el sitio de un momento", () => {
    const result = apply({ agendaItems: [{ id: findScene(doc, "agenda")!.props.items[0]!.id, timeLabel: "17:30", title: "Ceremonia", place: "" }, { id: null, timeLabel: "21:00", title: "Cena", place: "Salón Real" }] }, "añadid la cena");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "agenda")!.props.items[1]).toMatchObject({ title: "Cena", timeLabel: "", place: "" });
    expect(result.dropped).toEqual(["la hora de «Cena»", "el sitio de «Cena»"]);
  });

  it("pule un capítulo de la historia sin perder sus fotos ni añadir datos", () => {
    const ok = applyFull({ story: { title: null, intro: "Os contamos cómo empezó todo.", chapters: [{ id: "c-1", title: "Granada", body: "Todo empezó en Granada, en 2015, entre apuntes y cafés." }] } }, "haced la historia más bonita");
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const chapter = findScene(ok.document, "story")!.props.chapters[0]!;
    expect(chapter).toMatchObject({ id: "c-1", title: "Granada", body: "Todo empezó en Granada, en 2015, entre apuntes y cafés.", images: [{ url: "https://cdn.example.com/c1.jpg" }] });

    const invented = applyFull({ story: { title: null, intro: null, chapters: [{ id: "c-1", title: "Cómo empezó", body: "Nos conocimos en Sevilla en 2016." }] } }, "haced la historia más bonita");
    expect(invented).toMatchObject({ ok: false, reason: "no_changes", dropped: ["el texto del capítulo «Cómo empezó»"] });
  });

  it("tarjeta de detalles con enlace literal; sin enlace si no lo escriben", () => {
    const result = applyFull({ details: { title: null, intro: null, cards: [
      { id: "d-1", title: "Dress code", teaser: "Cómodos", body: "Venid como queráis.", link: null, linkLabel: "" },
      { id: null, title: "Regalos", teaser: "Lo que queráis", body: "Vuestra compañía es el mejor regalo.", link: "https://lista.example.com", linkLabel: "Ver la lista" },
    ] } }, "añadid una tarjeta de regalos: vuestra compañía es el mejor regalo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "details")!.props.cards[1]).toEqual({ id: "d-2", title: "Regalos", teaser: "Lo que queráis", body: "Vuestra compañía es el mejor regalo.", linkLabel: "Ver la lista" });
    expect(result.dropped).toEqual(["el enlace de «Regalos»"]);
  });
});

describe("applySitePatch: ámbito «design» (creador)", () => {
  it("no toca el contenido de las secciones y lo devuelve en blocked", () => {
    const result = applySitePatch(doc, { ...empty, palette: "rosa", faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "" }]) }, "más rosa y una pregunta del aparcamiento", { scope: "design" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "faq")).toBeUndefined();
    expect(result.blocked).toEqual(["preguntas"]);
    expect(result.changes).toEqual(["los colores (Rosa empolvado)"]);

    expect(applySitePatch(doc, { ...empty, story: { title: null, intro: "Hola", chapters: null } }, "x", { scope: "design" })).toEqual({ ok: false, reason: "no_changes", dropped: [], blocked: ["vuestra historia"], refused: [] });
  });
});

describe("textos de cambios", () => {
  it("ninguno habla de «escenas»", () => {
    const result = applyFull({
      layout: "web", opening: "sobre", scenes: [{ id: "lugar", enabled: false }],
      faq: faq([{ id: null, question: "¿Hay aparcamiento?", answer: "" }]),
      stay: stay([]),
      transport: transport([], { title: "Buses" }),
    }, "como una web, con sobre, ocultad el lugar, añadid la pregunta del aparcamiento, quitad los hoteles y llamad Buses a los autobuses");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.join(" ")).not.toMatch(/escena/i);
    expect(result.changes.length).toBeGreaterThan(5);
  });
});
