/**
 * Proveedores de sugerencias de lugares (solo servidor: la clave de Google
 * nunca llega al navegador y la CSP no necesita hosts nuevos).
 *
 *  - Con `GOOGLE_MAPS_API_KEY`: Google Places API (New), Autocomplete con
 *    token de sesión + Place Details solo con `id,formattedAddress` (SKU
 *    Essentials) al elegir, que cierra la sesión: las peticiones de
 *    autocompletado de esa sesión no se cobran por separado. Restringido a
 *    España y en español. Sus respuestas no se guardan en caché (condiciones
 *    de Google; solo el place_id puede guardarse).
 *  - Sin clave: Photon (photon.komoot.io, datos de OpenStreetMap), sin
 *    clave y con uso razonable: User-Agent descriptivo, caché en memoria y el
 *    navegador espera ≥ 300 ms y 3 caracteres. Nunca Nominatim (su política
 *    prohíbe el autocompletado).
 *
 * Las funciones de lectura de respuestas son puras y se prueban con
 * ejemplos (providers.test.ts). Nada aquí registra el texto buscado.
 */
import "server-only";

import { BRAND_CONTACT_EMAIL } from "@/lib/brand";
import { clipPlaceText, isValidPlaceId, PLACES_MAX_RESULTS, type PlaceDetail, type PlaceSuggestion, type PlacesProvider } from "./places";

type Fetcher = typeof fetch;

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
export const GOOGLE_DETAILS_URL = "https://places.googleapis.com/v1/places/";
export const PLACES_USER_AGENT = `vinklo.es/1.0 (sugerencias de lugares para invitaciones de boda; ${BRAND_CONTACT_EMAIL})`;
const TIMEOUT_MS = 4000;

/** Error de proveedor sin datos del usuario (solo proveedor y estado HTTP). */
export class PlacesProviderError extends Error {
  constructor(readonly provider: PlacesProvider, readonly status: number | "network" | "parse") {
    super(`places provider ${provider} failed (${status})`);
  }
}

export function placesProvider(env: Record<string, string | undefined> = process.env): PlacesProvider {
  return env.GOOGLE_MAPS_API_KEY?.trim() ? "google" : "osm";
}

// ---------------------------------------------------------------------------
// Google Places API (New)
// ---------------------------------------------------------------------------

interface GoogleText { text?: unknown }
interface GooglePrediction {
  placeId?: unknown;
  text?: GoogleText;
  structuredFormat?: { mainText?: GoogleText; secondaryText?: GoogleText };
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** `suggestions[].placePrediction` → sugerencias. Ignora lo que no sea un sitio. */
export function parseGoogleAutocomplete(json: unknown): PlaceSuggestion[] {
  const list = (json as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: PlaceSuggestion[] = [];
  for (const entry of list) {
    const p = (entry as { placePrediction?: GooglePrediction })?.placePrediction;
    const placeId = str(p?.placeId);
    if (!p || !isValidPlaceId(placeId)) continue;
    const main = str(p.structuredFormat?.mainText?.text) || str(p.text?.text);
    if (!main.trim()) continue;
    const secondary = str(p.structuredFormat?.secondaryText?.text);
    out.push({ key: placeId, name: clipPlaceText(main, 160), address: clipPlaceText(secondary, 240), placeId });
    if (out.length >= PLACES_MAX_RESULTS) break;
  }
  return out;
}

export function parseGoogleDetails(json: unknown): PlaceDetail | null {
  const id = str((json as { id?: unknown })?.id);
  const address = str((json as { formattedAddress?: unknown })?.formattedAddress);
  if (!isValidPlaceId(id)) return null;
  return { placeId: id, address: clipPlaceText(address, 240) };
}

export async function googleAutocomplete(query: string, sessionToken: string | null, key: string, fetcher: Fetcher = fetch): Promise<PlaceSuggestion[]> {
  let res: Response;
  try {
    res = await fetcher(GOOGLE_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: query,
        ...(sessionToken ? { sessionToken } : {}),
        languageCode: "es",
        regionCode: "es",
        includedRegionCodes: ["es"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlacesProviderError("google", "network");
  }
  if (!res.ok) throw new PlacesProviderError("google", res.status);
  try {
    return parseGoogleAutocomplete(await res.json());
  } catch {
    throw new PlacesProviderError("google", "parse");
  }
}

export async function googleDetails(placeId: string, sessionToken: string | null, key: string, fetcher: Fetcher = fetch): Promise<PlaceDetail | null> {
  const params = new URLSearchParams({ languageCode: "es", regionCode: "es" });
  if (sessionToken) params.set("sessionToken", sessionToken);
  let res: Response;
  try {
    res = await fetcher(`${GOOGLE_DETAILS_URL}${encodeURIComponent(placeId)}?${params.toString()}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,formattedAddress" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlacesProviderError("google", "network");
  }
  if (!res.ok) throw new PlacesProviderError("google", res.status);
  try {
    return parseGoogleDetails(await res.json());
  } catch {
    throw new PlacesProviderError("google", "parse");
  }
}

// ---------------------------------------------------------------------------
// Photon (OpenStreetMap)
// ---------------------------------------------------------------------------

/** España con Baleares, Canarias, Ceuta y Melilla (se filtra además por countrycode). */
const SPAIN_BBOX = "-18.5,27.4,4.6,44.0";

interface PhotonProps {
  osm_type?: unknown;
  osm_id?: unknown;
  countrycode?: unknown;
  name?: unknown;
  street?: unknown;
  housenumber?: unknown;
  postcode?: unknown;
  city?: unknown;
  district?: unknown;
  locality?: unknown;
  county?: unknown;
  state?: unknown;
}

/** «Calle Mayor 3, 28013 Madrid, Comunidad de Madrid» sin repetir partes. */
export function photonAddress(p: PhotonProps): string {
  const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(" ");
  const town = str(p.city) || str(p.locality) || str(p.district) || str(p.county);
  const parts = [street, [str(p.postcode), town].filter(Boolean).join(" "), str(p.state)];
  const seen = new Set<string>();
  return parts.filter((part) => {
    const k = part.trim().toLocaleLowerCase("es");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(", ");
}

export function parsePhoton(json: unknown): PlaceSuggestion[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceSuggestion[] = [];
  const keys = new Set<string>();
  for (const feature of features) {
    const p = (feature as { properties?: PhotonProps })?.properties;
    if (!p || str(p.countrycode).toUpperCase() !== "ES") continue;
    const address = photonAddress(p);
    const name = str(p.name) || [str(p.street), str(p.housenumber)].filter(Boolean).join(" ");
    if (!name.trim()) continue;
    const key = `${str(p.osm_type)}${typeof p.osm_id === "number" || typeof p.osm_id === "string" ? String(p.osm_id) : out.length}`;
    if (keys.has(key)) continue;
    keys.add(key);
    // Si el nombre ya es la calle, la dirección no la repite.
    const cleanAddress = address.toLocaleLowerCase("es").startsWith(name.toLocaleLowerCase("es")) ? address.slice(name.length).replace(/^,\s*/, "") : address;
    out.push({ key, name: clipPlaceText(name, 160), address: clipPlaceText(cleanAddress, 240) });
    if (out.length >= PLACES_MAX_RESULTS) break;
  }
  return out;
}

/** Caché en memoria por instancia (Photon pide no repetir consultas). */
const PHOTON_CACHE_TTL_MS = 10 * 60 * 1000;
const PHOTON_CACHE_MAX = 500;
const photonCache = new Map<string, { at: number; value: PlaceSuggestion[] }>();

export function clearPhotonCache(): void {
  photonCache.clear();
}

export async function photonSearch(query: string, fetcher: Fetcher = fetch, now: number = Date.now()): Promise<PlaceSuggestion[]> {
  const cacheKey = query.toLocaleLowerCase("es");
  const hit = photonCache.get(cacheKey);
  if (hit && now - hit.at < PHOTON_CACHE_TTL_MS) return hit.value;

  // Prioridad al centro de la Península; el bbox y el filtro dejan solo España.
  const params = new URLSearchParams({ q: query, limit: "10", bbox: SPAIN_BBOX, lat: "40.4168", lon: "-3.7038" });
  let res: Response;
  try {
    res = await fetcher(`${PHOTON_URL}?${params.toString()}`, {
      headers: { "User-Agent": PLACES_USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlacesProviderError("osm", "network");
  }
  if (!res.ok) throw new PlacesProviderError("osm", res.status);
  let value: PlaceSuggestion[];
  try {
    value = parsePhoton(await res.json());
  } catch {
    throw new PlacesProviderError("osm", "parse");
  }
  if (photonCache.size >= PHOTON_CACHE_MAX) {
    const oldest = photonCache.keys().next().value;
    if (oldest !== undefined) photonCache.delete(oldest);
  }
  photonCache.set(cacheKey, { at: now, value });
  return value;
}
