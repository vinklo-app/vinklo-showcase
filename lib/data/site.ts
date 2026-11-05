/**
 * Estado del editor de la web de la pareja (zona privada, cliente de sesión)
 * y persistencia del borrador.
 *
 * Siempre se consulta con el cliente de sesión: RLS sobre `weddings`,
 * `wedding_agenda_items`, `wedding_sites` y `wedding_site_revisions` es la
 * frontera de autorización. Mientras no exista fila en `wedding_sites`, el
 * borrador es el adaptador v1 de la boda (`documentFromLegacy`) con
 * `draftVersion: 0`, que `saveSiteDraft`/`publishSite` interpretan como
 * "crear la fila".
 *
 * `persistDraft` y `syncDraftFromLegacy` viven aquí (no en el archivo
 * "use server") para que ajustes y agenda puedan llamarlos sin convertirlos
 * en endpoints públicos de server action.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SaveDraftResult, SiteEditorState } from "@/lib/actions/site";
import { documentFromLegacy, mergeLegacyIntoDocument, parseSiteDocument, type SiteDocument } from "@/lib/site-document";

interface WeddingRow {
  id: string;
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  cover_image_url: string | null;
  page_config: unknown;
}

interface AgendaRow {
  id: string;
  title: string;
  time_label: string | null;
  place: string | null;
  address: string | null;
  notes: string | null;
}

interface SiteRow {
  draft_document: unknown;
  draft_version: number;
  published_revision_id: string | null;
  published_at: string | null;
}

/** Columnas de `weddings` que alimentan el adaptador v1 (sin datos de pago). */
export const WEDDING_LEGACY_COLUMNS = "id, slug, partner_name_1, partner_name_2, wedding_date, cover_image_url, page_config";
export const AGENDA_COLUMNS = "id, title, time_label, place, address, notes, sort";

export const DRAFT_GENERIC_ERROR = "No hemos podido guardar los cambios. Probad de nuevo.";
export const DRAFT_CONFLICT_ERROR = "Otra pestaña o dispositivo ha guardado la web antes que esta. Recargad para ver la última versión antes de seguir editando.";

/**
 * Documento equivalente a lo que la web pública mostraba antes de la fase 1:
 * columnas de la boda + `page_config` + agenda de la pareja. Devuelve null si
 * la boda no es visible para la sesión (RLS) o no existe.
 */
export async function getLegacyDraft(supabase: SupabaseClient, weddingId: string): Promise<{ wedding: WeddingRow; draft: SiteDocument } | null> {
  const { data: wedding, error } = await supabase.from("weddings").select(WEDDING_LEGACY_COLUMNS).eq("id", weddingId).maybeSingle();
  if (error || !wedding) return null;
  const row = wedding as unknown as WeddingRow;
  const { data: agenda } = await supabase.from("wedding_agenda_items").select(AGENDA_COLUMNS).eq("wedding_id", weddingId).order("sort", { ascending: true });
  const draft = documentFromLegacy({
    partner_name_1: row.partner_name_1 ?? "",
    partner_name_2: row.partner_name_2 ?? "",
    wedding_date: row.wedding_date,
    cover_image_url: row.cover_image_url,
    page_config: (row.page_config ?? null) as Parameters<typeof documentFromLegacy>[0]["page_config"],
    agenda: ((agenda ?? []) as unknown as AgendaRow[]),
  });
  return { wedding: row, draft };
}

/** Comparación canónica: ambos documentos pasan por Zod (orden de claves y defaults estables). */
export function sameDocument(a: SiteDocument, b: SiteDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function currentVersion(supabase: SupabaseClient, weddingId: string): Promise<number> {
  const { data } = await supabase.from("wedding_sites").select("draft_version").eq("wedding_id", weddingId).maybeSingle();
  return (data as { draft_version?: number } | null)?.draft_version ?? 0;
}

/**
 * Persiste el borrador con bloqueo optimista. baseVersion 0 crea la fila;
 * >= 1 actualiza solo si la versión en BD coincide. Nunca toca `weddings` ni
 * revalida rutas. `document` debe venir ya validado por `parseSiteDocument`.
 */
export async function persistDraft(supabase: SupabaseClient, weddingId: string, document: SiteDocument, baseVersion: number): Promise<SaveDraftResult> {
  if (baseVersion === 0) {
    const { data, error } = await supabase
      .from("wedding_sites")
      .insert({ wedding_id: weddingId, draft_document: document, draft_version: 1 })
      .select("draft_version")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, code: "conflict", draftVersion: await currentVersion(supabase, weddingId), error: DRAFT_CONFLICT_ERROR };
      console.error("[site] draft insert failed", error.code);
      return { ok: false, code: "error", error: DRAFT_GENERIC_ERROR };
    }
    return { ok: true, draftVersion: (data as { draft_version: number }).draft_version };
  }

  const { data, error } = await supabase
    .from("wedding_sites")
    .update({ draft_document: document, draft_version: baseVersion + 1 })
    .eq("wedding_id", weddingId)
    .eq("draft_version", baseVersion)
    .select("draft_version")
    .maybeSingle();
  if (error) {
    console.error("[site] draft update failed", error.code);
    return { ok: false, code: "error", error: DRAFT_GENERIC_ERROR };
  }
  if (!data) return { ok: false, code: "conflict", draftVersion: await currentVersion(supabase, weddingId), error: DRAFT_CONFLICT_ERROR };
  return { ok: true, draftVersion: (data as { draft_version: number }).draft_version };
}

export type SyncDraftResult =
  | { ok: true; draftVersion: number; changed: boolean }
  | { ok: false; code: "conflict" | "error" | "not_found" };

/**
 * Tras guardar ajustes o agenda en el modelo antiguo, reescribe el borrador
 * de `wedding_sites` con `documentFromLegacy` sobre el estado recién
 * guardado, conservando lo que el modelo antiguo no conoce
 * (`mergeLegacyIntoDocument`). Bajo el mismo bloqueo optimista que el editor:
 * en conflicto reintenta una vez; si vuelve a fallar, registra y devuelve
 * `ok: false` sin lanzar (el guardado de ajustes/agenda nunca se rompe por
 * esto). Sin fila aún → la crea (versión 1). Si el borrador coincide con lo
 * fusionado no escribe nada (no sube la versión en balde).
 */
export async function syncDraftFromLegacy(supabase: SupabaseClient, weddingId: string): Promise<SyncDraftResult> {
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { data: siteRow, error: siteError } = await supabase
        .from("wedding_sites")
        .select("draft_version, draft_document")
        .eq("wedding_id", weddingId)
        .maybeSingle();
      if (siteError) {
        console.error("[site] sync: wedding_sites read failed", siteError.code);
        return { ok: false, code: "error" };
      }
      const legacy = await getLegacyDraft(supabase, weddingId);
      if (!legacy) return { ok: false, code: "not_found" };

      const site = (siteRow ?? null) as Pick<SiteRow, "draft_version" | "draft_document"> | null;
      const parsedCurrent = site ? parseSiteDocument(site.draft_document) : null;
      // Un borrador corrupto en BD se repara con el adaptador.
      const current = parsedCurrent?.ok ? parsedCurrent.document : null;
      const merged = mergeLegacyIntoDocument(current, legacy.draft);
      if (site && current && sameDocument(current, merged)) return { ok: true, draftVersion: site.draft_version, changed: false };

      const result = await persistDraft(supabase, weddingId, merged, site?.draft_version ?? 0);
      if (result.ok) return { ok: true, draftVersion: result.draftVersion, changed: true };
      if (result.code !== "conflict") return { ok: false, code: "error" };
      if (attempt === 2) {
        console.error("[site] sync: draft conflict twice for wedding", weddingId);
        return { ok: false, code: "conflict" };
      }
    }
    return { ok: false, code: "error" };
  } catch (cause) {
    console.error("[site] sync threw", cause instanceof Error ? cause.message : "unknown");
    return { ok: false, code: "error" };
  }
}

/**
 * Documento de la revisión publicada (RLS + wedding_id). null si no hay
 * revisión, falla la lectura o no pasa el contrato. No va en
 * `SiteEditorState`: ese estado viaja a componentes de cliente.
 */
export async function getPublishedSiteDocument(supabase: SupabaseClient, weddingId: string, revisionId: string | null): Promise<SiteDocument | null> {
  if (!revisionId) return null;
  const { data: revision } = await supabase
    .from("wedding_site_revisions")
    .select("document")
    .eq("id", revisionId)
    .eq("wedding_id", weddingId)
    .maybeSingle();
  const published = revision ? parseSiteDocument((revision as { document: unknown }).document) : null;
  return published?.ok ? published.document : null;
}

export async function getSiteEditorState(supabase: SupabaseClient, weddingId: string): Promise<SiteEditorState | null> {
  const legacy = await getLegacyDraft(supabase, weddingId);
  if (!legacy) return null;
  const { wedding, draft: legacyDraft } = legacy;

  const { data: siteRow, error: siteError } = await supabase
    .from("wedding_sites")
    .select("draft_document, draft_version, published_revision_id, published_at")
    .eq("wedding_id", weddingId)
    .maybeSingle();
  if (siteError) {
    // Sin la tabla (migración pendiente) o fallo transitorio: el editor sigue
    // funcionando sobre el adaptador; guardar creará la fila cuando pueda.
    console.error("[site] wedding_sites read failed", siteError.code);
  }
  const site = (siteRow ?? null) as SiteRow | null;

  if (!site) {
    return {
      weddingId: wedding.id,
      slug: wedding.slug,
      draft: legacyDraft,
      draftVersion: 0,
      publishedRevisionId: null,
      publishedAt: null,
      hasUnpublishedChanges: true,
    };
  }

  const parsedDraft = parseSiteDocument(site.draft_document);
  const draftCorrupt = !parsedDraft.ok;
  const draft = parsedDraft.ok ? parsedDraft.document : legacyDraft;
  if (draftCorrupt) console.error("[site] draft_document inválido en BD para la boda", wedding.id);

  let hasUnpublishedChanges = true;
  if (site.published_revision_id) {
    const published = await getPublishedSiteDocument(supabase, weddingId, site.published_revision_id);
    if (published) hasUnpublishedChanges = !sameDocument(draft, published);
  }

  return {
    weddingId: wedding.id,
    slug: wedding.slug,
    draft,
    draftVersion: site.draft_version,
    publishedRevisionId: site.published_revision_id,
    publishedAt: site.published_at,
    hasUnpublishedChanges,
    ...(draftCorrupt ? { draftCorrupt: true } : {}),
  };
}
