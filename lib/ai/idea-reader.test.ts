import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => true }));

import { EMPTY_DRAFT, type BuilderDraft } from "@/lib/wedding-builder";
import { heuristicIdeaReading, isGenericPlace, mergeIdeaSuggestion, vetIdeaReading, type IdeaReading } from "./idea-reader";

const base: IdeaReading = { partnerName1: null, partnerName2: null, weddingDate: null, guestCount: null, venue: null, address: null, time: null, style: "natural", palette: null, welcomeMessage: null, bus: false, hotels: false, menu: false, kids: false, song: false, busStops: null, hotelNames: null };

describe("vetIdeaReading: nada que no esté en el texto", () => {
  const idea = "Somos Elena y Marcos, nos casamos el 10 de julio de 2027 en la Playa de los Alemanes, unos 90 invitados, a las 19:30, en Tarifa.";

  it("acepta lo que aparece literalmente", () => {
    const { suggestion, taken } = vetIdeaReading({ ...base, partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-07-10", guestCount: 90, venue: "Playa de los Alemanes", address: "Tarifa", time: "19:30", palette: "mar", welcomeMessage: "Queremos celebrarlo contigo junto al mar, sin prisas." }, idea);
    expect(suggestion).toMatchObject({ partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-07-10", guestCount: "90", venue: "Playa de los Alemanes", address: "Tarifa", time: "19:30", palette: "mar", style: "natural" });
    expect(taken.length).toBe(5);
  });

  it("descarta la bienvenida si introduce datos que la idea no dice", () => {
    expect(vetIdeaReading({ ...base, welcomeMessage: "Os esperamos el 12 de junio a las 18:00 en la Finca Lola." }, idea).suggestion.welcomeMessage).toBeUndefined();
    expect(vetIdeaReading({ ...base, welcomeMessage: "Queremos celebrarlo contigo junto al mar, sin prisas." }, idea).suggestion.welcomeMessage).toBeDefined();
  });

  it("descarta nombres, fecha, número, lugar y hora inventados", () => {
    const { suggestion } = vetIdeaReading({ ...base, partnerName1: "Lucía", partnerName2: "Juan", weddingDate: "2027-06-12", guestCount: 120, venue: "Finca La Alquería", time: "13:00" }, idea);
    expect(suggestion).toEqual({ style: "natural" });
  });

  it("solo acepta la fecha si el texto da día, mes y año", () => {
    expect(vetIdeaReading({ ...base, weddingDate: "2027-07-01" }, "En julio de 2027").suggestion.weddingDate).toBeUndefined();
    expect(vetIdeaReading({ ...base, weddingDate: "2027-07-10" }, "el 10/07/2027").suggestion.weddingDate).toBe("2027-07-10");
    expect(vetIdeaReading({ ...base, weddingDate: "2027-02-30" }, "30 de febrero de 2027").suggestion.weddingDate).toBeUndefined();
  });

  it("ignora tildes y mayúsculas al comprobar", () => {
    expect(vetIdeaReading({ ...base, partnerName1: "Sofía", partnerName2: "Íñigo" }, "sofia e iñigo en el campo").suggestion.partnerName1).toBe("Sofía");
  });
});

describe("mergeIdeaSuggestion: nunca pisa lo escrito", () => {
  it("rellena solo campos vacíos", () => {
    const draft: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Ana", venue: "" };
    const next = mergeIdeaSuggestion(draft, { partnerName1: "Elena", partnerName2: "Marcos", venue: "Tarifa", guestCount: "90" });
    expect(next.partnerName1).toBe("Ana");
    expect(next.partnerName2).toBe("");
    expect(next.venue).toBe("Tarifa");
    expect(next.guestCount).toBe("90");
  });
  it("la bienvenida solo sustituye a la de partida; la paleta solo si no hay", () => {
    const custom: BuilderDraft = { ...EMPTY_DRAFT, welcomeMessage: "La nuestra", palette: "rosa" };
    const next = mergeIdeaSuggestion(custom, { welcomeMessage: "Otra", palette: "mar" });
    expect(next).toBe(custom);
    expect(mergeIdeaSuggestion(EMPTY_DRAFT, { welcomeMessage: "Otra bienvenida", palette: "mar" })).toMatchObject({ welcomeMessage: "Otra bienvenida", palette: "mar" });
  });
});

describe("heuristicIdeaReading: la idea cuenta aunque no haya IA", () => {
  it("saca nombres, fecha, invitados, lugar, hora, estilo y paleta", () => {
    const idea = "Somos Elena y Marcos. Nos casamos el 10 de julio de 2027 en la Playa de los Alemanes, en Tarifa, a las 19:30, unas 90 personas, con colores del mar.";
    const reading = heuristicIdeaReading(idea);
    expect(reading).toMatchObject({ partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-07-10", guestCount: 90, venue: "Playa de los Alemanes", time: "19:30", style: "natural", palette: "mar" });
    expect(vetIdeaReading(reading, idea).taken.length).toBe(5);
  });
  it("no se inventa nada con una idea vaga", () => {
    const reading = heuristicIdeaReading("Una cena bajo los olivos, en junio");
    expect(reading).toMatchObject({ partnerName1: null, weddingDate: null, guestCount: null, venue: null, time: null, style: "natural" });
  });
  it("entiende fechas con barras y finca", () => {
    expect(heuristicIdeaReading("Ana e Iván, 05/09/2027, en Finca El Olivar, 120 invitados")).toMatchObject({ partnerName1: "Ana", partnerName2: "Iván", weddingDate: "2027-09-05", venue: "Finca El Olivar", guestCount: 120 });
  });
});

describe("módulos en la idea (8-oct-2026)", () => {
  const idea = "Somos Lucía y Juan. Boda en la Finca El Olivar, pondremos autobuses desde Madrid y Segovia, y hemos hablado con el Hotel Los Arcos para que tengáis descuento. Habrá niños y menú vegetariano.";
  it("los patrones detectan autobuses, hoteles, menú y niños con sus nombres", () => {
    const { suggestion } = vetIdeaReading(heuristicIdeaReading(idea), idea);
    expect(suggestion.modules).toEqual(["bus", "hotels", "menu", "kids"]);
    expect(suggestion.moduleHints).toEqual({ stops: ["Madrid", "Segovia"], hotels: ["Hotel Los Arcos"] });
  });
  it("la IA no puede activar un módulo que el texto no menciona ni inventar nombres", () => {
    const { suggestion } = vetIdeaReading({ ...base, bus: true, song: true, busStops: ["Toledo"], hotelNames: ["Hotel Inventado"] }, "Somos Ana y Luis y nos casamos en Madrid con autobuses.");
    expect(suggestion.modules).toEqual(["bus"]);
    expect(suggestion.moduleHints).toBeUndefined();
  });
  it("el hotel donde se celebra la boda no activa «hoteles»", () => {
    const text = "Nos casamos en el Hotel Ritz de Madrid.";
    const { suggestion } = vetIdeaReading({ ...base, venue: "Hotel Ritz", hotels: true }, text);
    expect(suggestion.modules).toBeUndefined();
  });
  it("mergeIdeaSuggestion no pisa los módulos que la pareja ya tocó", () => {
    expect(mergeIdeaSuggestion(EMPTY_DRAFT, { modules: ["bus"] }).modules).toEqual(["bus"]);
    const touched: BuilderDraft = { ...EMPTY_DRAFT, modules: [] };
    expect(mergeIdeaSuggestion(touched, { modules: ["bus"] }).modules).toEqual([]);
  });
});

describe("«Vuestro día» en la idea (8-oct-2026)", () => {
  const idea = "Somos Ana y Luis. La ceremonia será en la Iglesia de San Pedro a las 12:30 y la cena en la Finca El Olivar a las 21:00.";
  it("los patrones sacan hora y sitio de cada momento escrito", () => {
    const reading = heuristicIdeaReading(idea);
    expect(reading).toMatchObject({ ceremonyTime: "12:30", ceremonyPlace: "Iglesia de San Pedro", banquetTime: "21:00", banquetPlace: "Finca El Olivar", cocktailTime: null, cocktailPlace: null });
    expect(vetIdeaReading(reading, idea).suggestion.day).toEqual({ ceremony: { time: "12:30", place: "Iglesia de San Pedro" }, banquet: { time: "21:00", place: "Finca El Olivar" } });
  });
  it("la IA no puede inventar horas ni sitios, ni dar una palabra genérica como sitio", () => {
    const { suggestion } = vetIdeaReading({ ...base, ceremonyTime: "13:00", ceremonyPlace: "Catedral de Burgos", cocktailTime: "14:00", cocktailPlace: "el jardín", banquetPlace: "finca" }, "Ceremonia a las 12 en el jardín y luego cena en la finca");
    expect(suggestion.day).toBeUndefined();
  });
  it("una hora suelta no se atribuye a otro momento", () => {
    expect(vetIdeaReading({ ...base, banquetTime: "12:30" }, idea).suggestion.day).toBeUndefined();
  });
  it("mergeIdeaSuggestion rellena solo los huecos del día", () => {
    const draft: BuilderDraft = { ...EMPTY_DRAFT, day: { ceremony: { time: "", place: "Juzgado de Toledo" }, cocktail: { time: "", place: "" }, banquet: { time: "", place: "" } } };
    const merged = mergeIdeaSuggestion(draft, { day: { ceremony: { time: "12:30", place: "Iglesia de San Pedro" }, banquet: { place: "Finca El Olivar" } } });
    expect(merged.day).toEqual({ ceremony: { time: "12:30", place: "Juzgado de Toledo" }, cocktail: { time: "", place: "" }, banquet: { time: "", place: "Finca El Olivar" } });
  });
});

describe("lugar genérico (8-oct-2026)", () => {
  it("«finca», «la playa» o «un restaurante» no son un lugar: se deja vacío", () => {
    expect(vetIdeaReading({ ...base, venue: "finca" }, "Una boda en una finca con 100 personas").suggestion.venue).toBeUndefined();
    expect(vetIdeaReading({ ...base, venue: "la playa" }, "Queremos casarnos en la playa").suggestion.venue).toBeUndefined();
    expect(vetIdeaReading({ ...base, venue: "un restaurante" }, "Cena en un restaurante").suggestion.venue).toBeUndefined();
    expect(vetIdeaReading(heuristicIdeaReading("Una boda en la finca, sin prisas"), "Una boda en la finca, sin prisas").suggestion.venue).toBeUndefined();
  });
  it("un nombre propio sí lo es", () => {
    expect(vetIdeaReading({ ...base, venue: "Finca El Olivar" }, "En Finca El Olivar").suggestion.venue).toBe("Finca El Olivar");
    expect(isGenericPlace("Playa de los Alemanes")).toBe(false);
    expect(isGenericPlace("masía")).toBe(true);
  });
  it("la bienvenida de partida antigua («Os invitamos…») también se puede sustituir por la propuesta", () => {
    const old = { ...EMPTY_DRAFT, welcomeMessage: "Os invitamos a formar parte de la historia que estamos construyendo juntos." };
    expect(mergeIdeaSuggestion(old, { welcomeMessage: "Queremos celebrarlo contigo." }).welcomeMessage).toBe("Queremos celebrarlo contigo.");
    expect(EMPTY_DRAFT.welcomeMessage).toBe("Te invitamos a formar parte de la historia que estamos construyendo juntos.");
  });
});

describe("readBuilderIdeaCore: bolsa global anónima", () => {
  it("usa una clave global propia con un tercio del tope", async () => {
    vi.resetModules();
    const rateLimit = vi.fn(async () => true);
    vi.doMock("@/lib/rate-limit", () => ({ rateLimit }));
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const { readBuilderIdeaCore } = await import("./idea-reader");
    await readBuilderIdeaCore("Somos Elena y Marcos, nos casamos en Tarifa con unos 90 invitados.", { allow: async () => true, gatewayUser: "h" });
    expect(rateLimit).toHaveBeenCalledWith("ai-idea-global-d:anon", "all", 200, 86_400);
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/rate-limit");
  });
});

describe("hora: solo si está escrita COMO hora (revisión del bloque 1, F2)", () => {
  const idea = (text: string) => `Somos Ana y Luis. ${text}`;
  it.each([
    ["Nos casamos el 19 de junio de 2027 en la Finca X", "19:00", false],
    ["La boda es a las 19:00 en la Finca X", "19:00", true],
    ["Empezamos a las 19h en la Finca X", "19:00", true],
    ["Nos vemos a las 19 en la Finca X", "19:00", true],
    ["Os esperamos a las 7 de la tarde", "19:00", true],
    ["Arrancamos a las 19.30 en la Finca X", "19:30", true],
    ["Seremos el 12 30 invitados", "12:30", false],
    ["Seremos 19 amigos", "19:00", false],
    ["A las 19 de junio no hay hora", "19:00", false],
    ["Empezamos a las 19:00h", "19:00", true],
    ["Empezamos a las 19:30 h", "19:30", true],
    ["Empezamos 19 h 30", "19:30", true],
  ])("«%s» con %s → %s", (text, time, ok) => {
    expect(vetIdeaReading({ ...base, time }, idea(text)).suggestion.time).toBe(ok ? time : undefined);
  });
  it.each([
    ["La ceremonia el 19 de junio de 2027 en la iglesia", "19:00", false],
    ["La ceremonia será a las 19:00 en la iglesia", "19:00", true],
    ["Ceremonia a las 7 de la tarde", "19:00", true],
    ["La cena a las 21 h en la finca", "21:00", true],
  ])("ceremonyTime: «%s» con %s → %s", (text, time, ok) => {
    const moment = /cena/.test(text) ? "banquet" : "ceremony";
    const day = vetIdeaReading({ ...base, [`${moment}Time`]: time }, idea(text)).suggestion.day;
    expect(day?.[moment]?.time).toBe(ok ? time : undefined);
  });
});
