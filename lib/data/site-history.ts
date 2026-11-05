/**
 * Historial del borrador (`wedding_site_drafts_history`, migración
 * 20261027100000): las versiones que el chat del editor enseña y restaura.
 *
 * Siempre con el cliente de sesión: RLS (`owns_wedding`) es la frontera; la
 * tabla solo admite insert y select y el trigger recorta a 50 por boda.
 * Sin la migración (tabla ausente) todo degrada en silencio: guardar el
 * borrador sigue funcionando y el chat vive solo en memoria.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSiteDocument, type SiteDocument } from "@/lib/site-document";
import type { SiteVersionRow, VersionKind } from "@/lib/site-chat/thread";

export const SITE_HISTORY_TABLE = "wedding_site_drafts_history";
const KINDS: readonly VersionKind[] = ["ai", "manual", "restore"];
export const HISTORY_PROMPT_MAX = 600;
const SUMMARY_MAX = 1200;
const CHANGES_MAX = 40;
const CHANGE_MAX = 200;

export interface SiteHistoryEntry {
  kind: VersionKind;
  prompt: string;
  summary: string;
  changes: string[];
}

/** Valida lo que manda el cliente (nunca se confía en su forma). null si no vale. */
export function parseHistoryEntry(input: unknown): SiteHistoryEntry | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (!KINDS.includes(raw.kind as VersionKind)) return null;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const changes = Array.isArray(raw.changes)
    ? raw.changes.filter((c): c is string => typeof c === "string" && c.trim() !== "").slice(0, CHANGES_MAX).map((c) => c.trim().slice(0, CHANGE_MAX))
    : [];
  return { kind: raw.kind as VersionKind, prompt: text(raw.prompt, HISTORY_PROMPT_MAX), summary: text(raw.summary, SUMMARY_MAX), changes };
}

/** Tabla aún no creada (migración pendiente) o no expuesta por PostgREST. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST106";
}

/**
 * Apunta una versión. Mejor esfuerzo: nunca rompe el guardado del borrador
 * (que ya se ha hecho). null si no se pudo (sin tabla, sin permiso…).
 */
export async function recordSiteHistory(supabase: SupabaseClient, weddingId: string, draftVersion: number, document: SiteDocument, entry: SiteHistoryEntry): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await supabase
    .from(SITE_HISTORY_TABLE)
    .insert({ wedding_id: weddingId, kind: entry.kind, prompt: entry.prompt, summary: entry.summary, changes: entry.changes, document, draft_version: draftVersion })
    .select("id, created_at")
    .single();
  if (error) {
    if (!isMissingTable(error)) console.error("[site] history insert failed", error.code);
    return null;
  }
  const row = data as { id: string; created_at: string };
  return { id: row.id, createdAt: row.created_at };
}

interface HistoryRow {
  id: string;
  created_at: string;
  author_id: string | null;
  kind: string;
  prompt: string;
  summary: string;
  changes: unknown;
  document: unknown;
  draft_version: number;
}

/**
 * Las 50 últimas versiones de la boda, de la más antigua a la más reciente.
 * `available: false` si la tabla no existe (el editor no enseña historial).
 * Las filas cuyo documento ya no pasa el contrato se omiten.
 */
export async function listSiteHistory(supabase: SupabaseClient, weddingId: string): Promise<{ available: boolean; rows: SiteVersionRow[] }> {
  const { data, error } = await supabase
    .from(SITE_HISTORY_TABLE)
    .select("id, created_at, author_id, kind, prompt, summary, changes, document, draft_version")
    .eq("wedding_id", weddingId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) {
    if (!isMissingTable(error)) console.error("[site] history read failed", error.code);
    return { available: false, rows: [] };
  }
  const rows: SiteVersionRow[] = [];
  for (const row of (data ?? []) as HistoryRow[]) {
    if (!KINDS.includes(row.kind as VersionKind)) continue;
    const parsed = parseSiteDocument(row.document);
    if (!parsed.ok) continue;
    rows.push({
      id: row.id,
      kind: row.kind as VersionKind,
      createdAt: row.created_at,
      prompt: row.prompt ?? "",
      summary: row.summary ?? "",
      changes: Array.isArray(row.changes) ? row.changes.filter((c): c is string => typeof c === "string") : [],
      document: parsed.document,
      draftVersion: row.draft_version,
      authorId: row.author_id,
    });
  }
  return { available: true, rows: rows.reverse() };
}
