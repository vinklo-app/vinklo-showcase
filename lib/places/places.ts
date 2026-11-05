/**
 * Sugerencias de lugares (8-oct-2026): tipos y funciones puras que comparten
 * el navegador (components/places/place-combobox.tsx) y el servidor
 * (app/api/lugares/route.ts, lib/places/providers.ts).
 *
 * El autocompletado solo SUGIERE: la pareja puede escribir lo que quiera y
 * eso es lo que se guarda. Elegir una sugerencia rellena nombre y dirección
 * y, con Google, guarda el identificador del sitio para que «Ver en el
 * mapa» abra el lugar exacto.
 */

/** Mínimo de caracteres antes de preguntar (menos no da sugerencias útiles y gasta cuota). */
export const PLACES_MIN_QUERY = 3;
/** Tope de la consulta (los campos del documento llegan a 240). */
export const PLACES_MAX_QUERY = 120;
/** Espera tras la última tecla antes de preguntar (Photon pide ≥ 300 ms). */
export const PLACES_DEBOUNCE_MS = 350;
/** Sugerencias que se enseñan como mucho. */
export const PLACES_MAX_RESULTS = 5;

export type PlacesProvider = "google" | "osm";

export interface PlaceSuggestion {
  /** Clave estable dentro de la lista (no se guarda). */
  key: string;
  /** Nombre del sitio («Finca La Alquería»). */
  name: string;
  /** Dirección legible (calle, municipio, provincia). Puede ir vacía. */
  address: string;
  /** Solo Google: identificador del sitio (place_id). */
  placeId?: string;
}

export interface PlacesResponse {
  provider: PlacesProvider;
  suggestions: PlaceSuggestion[];
}

/** Detalle de un sitio de Google (cierra la sesión de autocompletado). */
export interface PlaceDetail {
  placeId: string;
  address: string;
}

/** Texto de atribución que exigen los proveedores al enseñar sugerencias. */
export const PLACES_ATTRIBUTION: Record<PlacesProvider, string> = {
  google: "Sugerencias de Google Maps",
  osm: "Sugerencias de © OpenStreetMap",
};

/**
 * Consulta normalizada (espacios colapsados, recortada) o null si no llega
 * al mínimo. Se usa igual en el navegador y en el servidor.
 */
export function normalizePlaceQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const q = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PLACES_MAX_QUERY).trim();
  return Array.from(q).length >= PLACES_MIN_QUERY ? q : null;
}

/** Identificador de sitio de Google (place_id): base64url, sin espacios ni barras. */
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/;

export function isValidPlaceId(value: unknown): value is string {
  return typeof value === "string" && PLACE_ID_PATTERN.test(value);
}

/** Token de sesión de Google: lo genera el navegador (UUID); Google admite hasta 36 caracteres base64url. */
export function isValidSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,36}$/.test(value);
}

/** Recorta a `max` caracteres (los límites del documento) sin espacios colgando. */
export function clipPlaceText(value: string, max: number): string {
  return Array.from(value.trim()).slice(0, max).join("").trim();
}

/** Lo que llega de una sugerencia elegida (components/places/place-combobox.tsx). */
export interface PickedPlace {
  name: string;
  address: string;
  placeId?: string;
  /** true cuando `address` es la dirección completa del sitio (detalle de Google, llega después). */
  full?: boolean;
}

export interface PickedFields {
  venue?: string;
  address: string;
  placeId?: string;
}

/**
 * Sugerencia elegida en el campo del NOMBRE del lugar: nombre y dirección.
 * Al llegar el detalle de Google (`full`) solo se completa la dirección.
 */
export function pickedIntoVenue(place: PickedPlace): PickedFields {
  return {
    ...(place.full ? {} : { venue: clipPlaceText(place.name, 160) }),
    address: clipPlaceText(place.address, 240),
    placeId: place.placeId,
  };
}

/**
 * Sugerencia elegida en el campo «Dirección». Con el lugar vacío, el nombre
 * va al lugar y la dirección a su campo; si ya hay lugar, la dirección es la
 * sugerencia entera («Calle Mayor 3, Madrid»), o la completa cuando llega el
 * detalle de Google. Respeta los límites del documento.
 */
export function pickedIntoAddress(place: PickedPlace, currentVenue: string): PickedFields {
  const venueEmpty = !currentVenue.trim();
  const joined = [place.name, place.address].filter((part) => part.trim()).join(", ");
  const address = place.full ? place.address : venueEmpty ? place.address || place.name : joined;
  return {
    ...(venueEmpty && !place.full ? { venue: clipPlaceText(place.name, 160) } : {}),
    address: clipPlaceText(address, 240),
    placeId: place.placeId,
  };
}
