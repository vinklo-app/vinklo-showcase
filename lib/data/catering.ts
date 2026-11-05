import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readRsvpAnswers, type RsvpAnswers } from "@/lib/rsvp-answers";

export interface AttendingGuest { id: string; name: string; companions: number; notes: string | null; answers: RsvpAnswers | null }

/**
 * Quien viene (rsvp «si») con sus notas/alergias y respuestas de módulos,
 * para la hoja del catering (/panel/dia/imprimir). Cliente de sesión (RLS) y
 * `wedding_id` explícito. Sin la columna de respuestas (20261018100000) va
 * sin menús. null = la lectura falló.
 */
export async function getAttendingGuests(supabase: SupabaseClient, weddingId: string): Promise<AttendingGuest[] | null> {
  const read = (columns: string) => supabase.from("wedding_guests").select(columns)
    .eq("wedding_id", weddingId).eq("rsvp_status", "si")
    .order("name", { ascending: true }).order("id", { ascending: true }).limit(2000);
  let { data, error } = await read("id, name, rsvp_companions, rsvp_notes, rsvp_answers");
  if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await read("id, name, rsvp_companions, rsvp_notes"));
  if (error) return null;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    companions: Number(row.rsvp_companions) || 0,
    notes: typeof row.rsvp_notes === "string" ? row.rsvp_notes : null,
    answers: readRsvpAnswers(row.rsvp_answers),
  }));
}
