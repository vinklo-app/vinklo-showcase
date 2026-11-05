import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { isValidPlaceId, isValidSessionToken, normalizePlaceQuery, type PlaceDetail, type PlacesResponse } from "@/lib/places/places";
import { googleAutocomplete, googleDetails, PlacesProviderError, photonSearch, placesProvider } from "@/lib/places/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Sugerencias de lugares para el creador (también antes de registrarse) y el
 * panel: `GET /api/lugares?q=…&sesion=…` → `{ provider, suggestions }`;
 * `GET /api/lugares?id=<place_id>&sesion=…` → `{ detail }` (solo Google).
 *
 * Proxy de servidor: la clave de Google no sale de aquí y la CSP no cambia.
 * Límite por IP (lib/rate-limit.ts, fail-closed: sin límite disponible no
 * hay sugerencias, y escribir a mano sigue funcionando). Nunca se registra
 * el texto buscado; los fallos del proveedor van a Sentry sin él.
 */
export const dynamic = "force-dynamic";

/** Un lugar entero tecleado con calma son ~10 peticiones; 90 cada 10 min sobra para una pareja. */
const RATE_MAX = 90;
const RATE_WINDOW_SECS = 600;

/** Tope global diario (todas las IP): el coste de Google no depende de cuántas IP reparta el abuso. */
const GLOBAL_MAX = 3000;
const GLOBAL_WINDOW_SECS = 86_400;

/** Límite por IP y, después, el global. Fail-closed en ambos. */
async function allowed(): Promise<boolean> {
  if (!(await rateLimit("places", await clientIp(), RATE_MAX, RATE_WINDOW_SECS))) return false;
  return rateLimit("places-global-d", "all", GLOBAL_MAX, GLOBAL_WINDOW_SECS);
}

const EMPTY = (provider: PlacesResponse["provider"]): PlacesResponse => ({ provider, suggestions: [] });

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function report(error: unknown) {
  const provider = error instanceof PlacesProviderError ? error.provider : "unknown";
  const status = error instanceof PlacesProviderError ? String(error.status) : "unknown";
  Sentry.captureMessage("places provider failed", { level: "warning", tags: { places_provider: provider, places_status: status } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const provider = placesProvider();
  const session = params.get("sesion");
  const sessionToken = isValidSessionToken(session) ? session : null;
  const id = params.get("id");

  if (id !== null) {
    if (provider !== "google" || !isValidPlaceId(id)) return json({ detail: null });
    if (!(await allowed())) return json({ detail: null }, 429);
    try {
      const detail: PlaceDetail | null = await googleDetails(id, sessionToken, process.env.GOOGLE_MAPS_API_KEY!.trim());
      return json({ detail });
    } catch (error) {
      report(error);
      return json({ detail: null });
    }
  }

  const query = normalizePlaceQuery(params.get("q"));
  if (!query) return json(EMPTY(provider));
  if (!(await allowed())) return json(EMPTY(provider), 429);

  try {
    const suggestions = provider === "google"
      ? await googleAutocomplete(query, sessionToken, process.env.GOOGLE_MAPS_API_KEY!.trim())
      : await photonSearch(query);
    return json({ provider, suggestions } satisfies PlacesResponse);
  } catch (error) {
    report(error);
    return json(EMPTY(provider));
  }
}
