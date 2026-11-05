import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublishedSiteDocument, getSiteEditorState } from "@/lib/data/site";
import { guestMenuModules, moduleLabelsForAnswers } from "@/lib/module-labels";
import { menuMissingCount, readRsvpAnswers, type AnswerRow, type ModuleLabels, type RsvpAnswers, type RsvpModules } from "@/lib/rsvp-answers";

/**
 * Respuestas de los módulos (wedding_guests.rsvp_answers, 20261018100000)
 * de TODOS los que vienen: también quien no contestó ningún módulo (answers
 * null), que es justo quien falta para «personas sin menú» (P1-6). Cliente de sesión: RLS limita a las bodas de la pareja. `ids` acota a una
 * página de la lista. Sin la migración (columna inexistente) devuelve null y
 * el panel sigue como siempre.
 */
export async function getModuleAnswers(supabase: SupabaseClient, weddingId: string, ids?: string[]): Promise<AnswerRow[] | null> {
  if (ids && ids.length === 0) return [];
  let query = supabase
    .from("wedding_guests")
    .select("id, name, rsvp_companions, rsvp_answers")
    .eq("wedding_id", weddingId)
    .eq("rsvp_status", "si");
  if (ids) query = query.in("id", ids);
  const { data, error } = await query.limit(2000);
  if (error) {
    if (error.code !== "42703" && error.code !== "PGRST204") console.error("[modules] answers read failed", error.code);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    companions: Number(row.rsvp_companions) || 0,
    answers: readRsvpAnswers(row.rsvp_answers),
  }));
}

/**
 * Menús que los invitados pueden elegir (la web publicada; el borrador solo si
 * nunca se publicó) y etiquetas para leer sus respuestas. null = la boda no
 * pregunta menú o la lectura falló.
 */
async function guestMenu(supabase: SupabaseClient, weddingId: string): Promise<{ menu: Pick<RsvpModules, "menu">; labels: ModuleLabels } | null> {
  const site = await getSiteEditorState(supabase, weddingId);
  if (!site) return null;
  const published = await getPublishedSiteDocument(supabase, weddingId, site.publishedRevisionId);
  const menu = guestMenuModules(site.draft, published, site.publishedRevisionId);
  if (!menu || menu.menu.length === 0) return null;
  return { menu, labels: moduleLabelsForAnswers(site.draft, published) };
}

/** «N personas sin menú» para el resumen del panel; null = sin línea. */
export async function getMenuMissing(supabase: SupabaseClient, weddingId: string): Promise<number | null> {
  const menu = await guestMenu(supabase, weddingId);
  if (!menu) return null;
  const rows = await getModuleAnswers(supabase, weddingId);
  return rows ? menuMissingCount(rows, menu.menu) : null;
}

/** Para la columna «Menú» del CSV de invitados; null = el CSV sale sin la columna. */
export async function getMenuForCsv(supabase: SupabaseClient, weddingId: string): Promise<{ labels: ModuleLabels; answers: Map<string, RsvpAnswers | null> } | null> {
  const menu = await guestMenu(supabase, weddingId);
  if (!menu) return null;
  const rows = await getModuleAnswers(supabase, weddingId);
  if (!rows) return null;
  return { labels: menu.labels, answers: new Map(rows.map((row) => [row.id, row.answers])) };
}
