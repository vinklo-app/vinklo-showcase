import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applySitePatch, EMPTY_SITE_PATCH } from "@/lib/ai/site-edit-patch";
import { documentFromLegacy, findScene, legacyConfigFromDocument, mergeLegacyIntoDocument, parseSiteDocument } from "@/lib/site-document";
import { adoptProposal, builderAgendaItems, composeBuilderDocument, EMPTY_DRAFT, parseBuilderDraft } from "@/lib/wedding-builder";
import { pageConfigSchema } from "@/lib/wedding-settings";

import { isValidPlaceId, isValidSessionToken, normalizePlaceQuery, pickedIntoAddress, pickedIntoVenue } from "./places";
import { clearPhotonCache, googleAutocomplete, googleDetails, parseGoogleAutocomplete, parseGoogleDetails, parsePhoton, photonAddress, photonSearch, PlacesProviderError, placesProvider, PLACES_USER_AGENT } from "./providers";

const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("consulta y validación", () => {
  it("normaliza la consulta y exige 3 caracteres", () => {
    expect(normalizePlaceQuery("  finca \n  los   olivos ")).toBe("finca los olivos");
    expect(normalizePlaceQuery("ab")).toBeNull();
    expect(normalizePlaceQuery("  a  b ")).toBe("a b");
    expect(normalizePlaceQuery(null)).toBeNull();
    expect(normalizePlaceQuery("x".repeat(500))).toHaveLength(120);
  });
  it("place_id y token de sesión: solo caracteres base64url", () => {
    expect(isValidPlaceId(PLACE)).toBe(true);
    expect(isValidPlaceId("../etc/passwd")).toBe(false);
    expect(isValidPlaceId("corto")).toBe(false);
    expect(isValidSessionToken("3f0b5a5e-8c1e-4b0f-9a55-1b2c3d4e5f60")).toBe(true);
    expect(isValidSessionToken("a b")).toBe(false);
    expect(isValidSessionToken("x".repeat(37))).toBe(false);
  });
  it("proveedor: Google solo con clave; si no, OpenStreetMap", () => {
    expect(placesProvider({ GOOGLE_MAPS_API_KEY: "k" })).toBe("google");
    expect(placesProvider({ GOOGLE_MAPS_API_KEY: "  " })).toBe("osm");
    expect(placesProvider({})).toBe("osm");
  });
});

describe("elegir una sugerencia", () => {
  it("en el nombre: rellena lugar y dirección; con el detalle, solo la dirección", () => {
    expect(pickedIntoVenue({ name: "Finca La Alquería", address: "Toledo, España", placeId: PLACE })).toEqual({ venue: "Finca La Alquería", address: "Toledo, España", placeId: PLACE });
    expect(pickedIntoVenue({ name: "Finca La Alquería", address: "Camino X, 45002 Toledo, España", placeId: PLACE, full: true })).toEqual({ address: "Camino X, 45002 Toledo, España", placeId: PLACE });
  });
  it("en la dirección: con lugar escrito no lo toca y la dirección es la sugerencia entera", () => {
    expect(pickedIntoAddress({ name: "Calle Mayor 3", address: "Madrid, España" }, "Casa de mis padres")).toEqual({ address: "Calle Mayor 3, Madrid, España", placeId: undefined });
    expect(pickedIntoAddress({ name: "Finca La Alquería", address: "Toledo", placeId: PLACE }, "")).toEqual({ venue: "Finca La Alquería", address: "Toledo", placeId: PLACE });
    expect(pickedIntoAddress({ name: "Finca", address: "Camino X, Toledo", placeId: PLACE, full: true }, "")).toEqual({ address: "Camino X, Toledo", placeId: PLACE });
  });
});

describe("Google Places (New)", () => {
  const response = {
    suggestions: [
      { placePrediction: { placeId: PLACE, text: { text: "Finca La Alquería, Toledo, España" }, structuredFormat: { mainText: { text: "Finca La Alquería" }, secondaryText: { text: "Toledo, España" } } } },
      { queryPrediction: { text: { text: "fincas en toledo" } } },
      { placePrediction: { placeId: "mal id", structuredFormat: { mainText: { text: "X" } } } },
    ],
  };
  it("lee las sugerencias de sitio e ignora el resto", () => {
    expect(parseGoogleAutocomplete(response)).toEqual([{ key: PLACE, name: "Finca La Alquería", address: "Toledo, España", placeId: PLACE }]);
    expect(parseGoogleAutocomplete({})).toEqual([]);
    expect(parseGoogleDetails({ id: PLACE, formattedAddress: "Camino X, 45002 Toledo, España" })).toEqual({ placeId: PLACE, address: "Camino X, 45002 Toledo, España" });
    expect(parseGoogleDetails({ id: "../x" })).toBeNull();
  });
  it("pide en español, solo España, con token de sesión; el detalle solo con campos Essentials", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    await googleAutocomplete("finca alq", "tok-12345678", "KEY", fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(JSON.parse(String(init.body))).toEqual({ input: "finca alq", sessionToken: "tok-12345678", languageCode: "es", regionCode: "es", includedRegionCodes: ["es"] });
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");

    const details = vi.fn(async () => new Response(JSON.stringify({ id: PLACE, formattedAddress: "Toledo" }), { status: 200 }));
    await googleDetails(PLACE, "tok-12345678", "KEY", details as unknown as typeof fetch);
    const [durl, dinit] = details.mock.calls[0] as unknown as [string, RequestInit];
    expect(durl).toBe(`https://places.googleapis.com/v1/places/${PLACE}?languageCode=es&regionCode=es&sessionToken=tok-12345678`);
    expect((dinit.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("id,formattedAddress");
  });
  it("un fallo del proveedor lanza un error sin el texto buscado", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 403 }));
    const error = await googleAutocomplete("calle secreta 7", null, "KEY", fetcher as unknown as typeof fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlacesProviderError);
    expect(String((error as Error).message)).not.toContain("secreta");
  });
});

describe("Photon (OpenStreetMap)", () => {
  afterEach(() => clearPhotonCache());
  const features = {
    features: [
      { properties: { osm_type: "W", osm_id: 1, countrycode: "ES", name: "Finca La Alquería", street: "Camino de la Dehesa", housenumber: "14", postcode: "45002", city: "Toledo", state: "Castilla-La Mancha" } },
      { properties: { osm_type: "N", osm_id: 2, countrycode: "PT", name: "Quinta do Lago", city: "Faro" } },
      { properties: { osm_type: "W", osm_id: 3, countrycode: "ES", street: "Calle Mayor", housenumber: "3", postcode: "28013", city: "Madrid", state: "Comunidad de Madrid" } },
      { properties: { osm_type: "W", osm_id: 1, countrycode: "ES", name: "Finca La Alquería" } },
    ],
  };
  it("solo España, sin repetidos, con dirección legible", () => {
    expect(parsePhoton(features)).toEqual([
      { key: "W1", name: "Finca La Alquería", address: "Camino de la Dehesa 14, 45002 Toledo, Castilla-La Mancha" },
      { key: "W3", name: "Calle Mayor 3", address: "28013 Madrid, Comunidad de Madrid" },
    ]);
    expect(photonAddress({ city: "Madrid", state: "Madrid" })).toBe("Madrid");
  });
  it("User-Agent propio, caja de España y caché por consulta", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(features), { status: 200 }));
    await photonSearch("Finca alq", fetcher as unknown as typeof fetch, 1000);
    await photonSearch("finca ALQ", fetcher as unknown as typeof fetch, 2000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?q=Finca\+alq&limit=10&bbox=/);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(PLACES_USER_AGENT);
    expect(PLACES_USER_AGENT).toContain("vinklo.es");
    // Caducada la caché, vuelve a preguntar.
    await photonSearch("finca alq", fetcher as unknown as typeof fetch, 1000 + 11 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("place_id en el documento", () => {
  const legacy = (placeId?: string) => documentFromLegacy({
    partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null,
    page_config: { style: "editorial", welcomeMessage: "", venue: "Finca La Alquería", address: "Toledo", time: "17:30", ...(placeId ? { placeId } : {}) },
  });

  it("sin place_id el JSON no cambia (las webs guardadas siguen igual)", () => {
    expect(findScene(legacy(), "venue")?.props).toEqual({ venue: "Finca La Alquería", address: "Toledo", time: "17:30" });
    expect("placeId" in pageConfigSchema.parse({})).toBe(false);
  });
  it("de los ajustes al documento y de vuelta, y sobrevive a la sincronización", () => {
    const doc = legacy(PLACE);
    expect(findScene(doc, "venue")?.props.placeId).toBe(PLACE);
    expect(legacyConfigFromDocument(doc).placeId).toBe(PLACE);
    expect(findScene(mergeLegacyIntoDocument(legacy(), doc), "venue")?.props.placeId).toBe(PLACE);
    // Quitado en los ajustes (escribieron otro lugar): se va del documento.
    expect(findScene(mergeLegacyIntoDocument(doc, legacy()), "venue")?.props.placeId).toBeUndefined();
  });
  it("un place_id raro en los ajustes se descarta sin perder el resto", () => {
    const config = pageConfigSchema.parse({ venue: "Finca", placeId: "../../x" });
    expect(config.venue).toBe("Finca");
    expect(config.placeId).toBeUndefined();
    expect(parseSiteDocument({ ...legacy(), scenes: legacy().scenes.map((s) => (s.type === "venue" ? { ...s, props: { ...s.props, placeId: "a b" } } : s)) }).ok).toBe(false);
  });
  it("la IA que cambia el lugar o la dirección quita el sitio exacto; si cambia la hora, se queda", () => {
    const doc = legacy(PLACE);
    const moved = applySitePatch(doc, { ...EMPTY_SITE_PATCH, venueName: "Hacienda San Rafael" }, "el lugar ahora es la hacienda san rafael");
    expect(moved.ok && findScene(moved.document, "venue")?.props.placeId).toBeUndefined();
    const later = applySitePatch(doc, { ...EMPTY_SITE_PATCH, venueTime: "19:00" }, "empieza a las 19:00");
    expect(later.ok && findScene(later.document, "venue")?.props.placeId).toBe(PLACE);
  });
});

describe("place_id en el creador", () => {
  const draft = { ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", venue: "Finca La Alquería", address: "Toledo", venuePlaceId: PLACE };
  it("llega a la escena del lugar y el borrador se guarda y se lee", () => {
    expect(findScene(composeBuilderDocument(draft), "venue")?.props.placeId).toBe(PLACE);
    expect(parseBuilderDraft(JSON.parse(JSON.stringify(draft)))?.venuePlaceId).toBe(PLACE);
    expect(parseBuilderDraft({ ...draft, venuePlaceId: "a b" })).toBeNull();
  });
  it("si la IA cambia el lugar, el place_id se va; si no lo toca, se queda", () => {
    const base = composeBuilderDocument(draft);
    expect(adoptProposal(draft, base).venuePlaceId).toBe(PLACE);
    const moved = { ...base, scenes: base.scenes.map((s) => (s.type === "venue" ? { ...s, props: { ...s.props, venue: "Otra finca" } } : s)) };
    expect(adoptProposal(draft, moved).venuePlaceId).toBeUndefined();
  });
  it("«Vuestro día»: la dirección sugerida acompaña al sitio en el programa", () => {
    const items = builderAgendaItems({ day: { ceremony: { time: "12:00", place: "Iglesia de San Nicolás", address: "Calle Mayor 3, Madrid" }, cocktail: { time: "", place: "" }, banquet: { time: "14:00", place: "", address: "Huérfana" } } });
    expect(items.map((i) => [i.place, i.address])).toEqual([["Iglesia de San Nicolás", "Calle Mayor 3, Madrid"], ["", ""]]);
  });
});
