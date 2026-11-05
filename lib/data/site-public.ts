/**
 * Lectura pública del documento de una boda para /b/[slug].
 *
 * Fase 1 (tras seguridad, S-02): la vista `wedding_sites_public` tiene una
 * fila por cada sitio que se ha publicado alguna vez (left join con la
 * revisión apuntada) y legible solo con service_role, igual que
 * `weddings_public`.
 *  - Fila con `is_published = false` → la pareja retiró la web → null (404).
 *  - Fila publicada con documento válido → esa instantánea inmutable.
 *  - Sin fila, SIN error de lectura (boda anterior al motor o nunca
 *    publicada) → adaptador v1 a partir de `weddings_public` + agenda.
 *  - Fila corrupta, fila publicada sin documento, o documento publicado que
 *    no valida → null (404), NUNCA el adaptador.
 *  - Fallo de lectura → tampoco el adaptador ni nada de la boda (un fallo
 *    transitorio no debe resucitar una boda retirada ni mostrar ajustes
 *    legados distintos de lo publicado, auditoría H01, 2026-10-04), pero
 *    getPublicSiteResult lo distingue ("unavailable") para que la página no
 *    diga «boda no encontrada»; se reporta a Sentry y no se cachea.
 * Nunca lanza. Solo contenido público: la vista no expone invitados, tokens
 * ni pagos, y este módulo no los pide.
 */
import "server-only";
import * as Sentry from "@sentry/nextjs";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { publicSiteTag } from "./site-cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWeddingAgenda, getWeddingPublic } from "@/app/b/[slug]/wedding-public";
import { documentFromLegacy, parseSiteDocument, type SiteDocument } from "@/lib/site-document";

export interface PublicSite {
  slug: string;
  document: SiteDocument;
  /** "published": revisión inmutable; "legacy": adaptador v1 sobre page_config. */
  source: "published" | "legacy";
  publishedAt: string | null;
  plan: "free" | "premium";
  /** Id de la revisión publicada (clave de caché/ETag); null en legacy. */
  revisionId?: string | null;
}

const SLUG_RE = /^[a-z0-9-]{3,60}$/;

const publishedRowSchema = z.object({
  slug: z.string(),
  plan: z.enum(["free", "premium"]).catch("free"),
  is_published: z.boolean().nullable().default(false),
  document: z.unknown().nullable().optional(),
  published_at: z.string().nullable().optional(),
  unpublished_at: z.string().nullable().optional(),
  schema_version: z.number().int().nullable().optional(),
  revision_id: z.string().nullable().optional(),
});

/** La pareja retiró la web: el enlace no debe mostrar nada, ni siquiera el adaptador. */
const WITHDRAWN = Symbol("withdrawn");


/** Fallo de lectura: se lanza dentro de la caché para que NO se guarde. Lleva solo el código de PostgREST. */
class TransientReadError extends Error {
  constructor(readonly code: string | null) {
    super("site-public transient read");
  }
}

type CachedRead = { kind: "published"; site: PublicSite } | { kind: "withdrawn" } | { kind: "none" };

/**
 * Lectura de la instantánea publicada, cacheada por slug (revisión de código
 * 2026-10-06, R01): el documento publicado es inmutable por revisión y es lo
 * único que se cachea (no el plazo, ni tokens, ni respuestas). Se invalida
 * con `revalidateTag(publicSiteTag(slug))` al publicar y al retirar; 10 min
 * de tope como red. Los fallos de lectura no se cachean (se relanzan) y
 * siguen fallando cerrado.
 */
const readPublishedCached = (slug: string) =>
  unstable_cache(
    async (): Promise<CachedRead> => {
      // Un fallo de lectura lanza TransientReadError (no se guarda en caché).
      const result = await readPublishedSite(slug);
      if (result === WITHDRAWN) return { kind: "withdrawn" };
      return result ? { kind: "published", site: result } : { kind: "none" };
    },
    ["public-site", slug],
    { tags: [publicSiteTag(slug)], revalidate: 600 },
  )();

async function getPublishedSite(slug: string): Promise<PublicSite | typeof WITHDRAWN | typeof TRANSIENT | null> {
  try {
    const read = await readPublishedCached(slug);
    if (read.kind === "withdrawn") return WITHDRAWN;
    return read.kind === "published" ? read.site : null;
  } catch (error) {
    // Fallo de lectura (o de la caché): sigue fallando cerrado (nada de la
    // boda, nunca el adaptador), pero ya no se presenta como «boda no
    // encontrada»: la página dice que lo intente de nuevo (revisión perf P1-3).
    // Un solo aviso por fallo, aquí (aunque la caché envolviera el error):
    // sin slug ni datos, solo el código; la huella fija agrupa la ráfaga de
    // un mismo corte en una sola incidencia.
    Sentry.captureMessage("site-public: lectura de la invitación fallida", {
      level: "error",
      extra: { code: error instanceof TransientReadError ? error.code : "unexpected" },
      fingerprint: ["site-public-transient"],
    });
    return TRANSIENT;
  }
}

const TRANSIENT = Symbol("transient");

async function readPublishedSite(slug: string): Promise<PublicSite | typeof WITHDRAWN | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("wedding_sites_public")
    .select("slug, plan, is_published, document, published_at, unpublished_at, schema_version, revision_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    // Fallo transitorio de lectura: NO es lo mismo que "sin fila" (boda
    // legada). Caer al adaptador aquí podría resucitar una boda retirada o
    // mostrar un ajuste legado distinto de lo realmente publicado. Fallar
    // cerrado (auditoría H01, 2026-10-04).
    console.error("[site-public] wedding_sites_public read failed", error.code);
    // Se lanza (no se devuelve) para que unstable_cache no lo guarde; Sentry, en getPublishedSite.
    throw new TransientReadError(error.code ?? null);
  }
  if (!data) return null;
  const row = publishedRowSchema.safeParse(data);
  if (!row.success) {
    console.error("[site-public] wedding_sites_public row malformed", { slug });
    return WITHDRAWN;
  }
  if (!row.data.is_published) return WITHDRAWN;
  if (row.data.document == null) {
    // Fila publicada sin documento: estado inconsistente, no "sin fila".
    console.error("[site-public] published row without document", { slug });
    return WITHDRAWN;
  }
  const parsed = parseSiteDocument(row.data.document);
  if (!parsed.ok) {
    // No se vuelca el documento: puede ser grande y es contenido de la pareja.
    // Documento publicado inválido: tampoco es "sin fila" — no caer a legacy.
    console.error("[site-public] published document invalid", { slug, schemaVersion: row.data.schema_version ?? null, issues: parsed.issues.length });
    return WITHDRAWN;
  }
  return {
    slug: row.data.slug,
    document: parsed.document,
    source: "published",
    publishedAt: row.data.published_at ?? null,
    plan: row.data.plan,
    revisionId: row.data.revision_id ?? null,
  };
}

async function getLegacySite(slug: string): Promise<PublicSite | null> {
  const wedding = await getWeddingPublic(slug);
  if (!wedding) return null;
  const agenda = await getWeddingAgenda(slug);
  try {
    return {
      slug: wedding.slug,
      document: documentFromLegacy({ ...wedding, agenda }),
      source: "legacy",
      publishedAt: null,
      plan: wedding.plan,
      revisionId: null,
    };
  } catch (cause) {
    // Red de seguridad: datos legados fuera de contrato no deben dar un 500.
    console.error("[site-public] legacy adapter failed", { slug, reason: cause instanceof Error ? cause.message.slice(0, 200) : "unknown" });
    return null;
  }
}

/**
 * Resultado con el motivo, para la página del invitado:
 *  - "ok": la invitación que se pinta.
 *  - "not_found": no existe, retirada o inválida → 404 «No encontramos esta boda».
 *  - "unavailable": fallo de lectura → «No hemos podido cargar la invitación»
 *    con «Reintentar». Nunca se cachea (se relanza fuera de unstable_cache y
 *    /b/* es `private, no-store`).
 */
export type PublicSiteResult = { status: "ok"; site: PublicSite } | { status: "not_found" } | { status: "unavailable" };

export const getPublicSiteResult = cache(async (slug: string): Promise<PublicSiteResult> => {
  if (!SLUG_RE.test(slug)) return { status: "not_found" };
  const published = await getPublishedSite(slug);
  if (published === TRANSIENT) return { status: "unavailable" };
  if (published === WITHDRAWN) return { status: "not_found" };
  const site = published ?? (await getLegacySite(slug));
  return site ? { status: "ok", site } : { status: "not_found" };
});

/** null si no hay invitación que mostrar (no encontrada o fallo de lectura). */
export const getPublicSite = cache(async (slug: string): Promise<PublicSite | null> => {
  const result = await getPublicSiteResult(slug);
  return result.status === "ok" ? result.site : null;
});
