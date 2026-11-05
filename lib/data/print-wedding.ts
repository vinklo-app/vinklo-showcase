import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatRsvpDate } from "@/lib/rsvp-window";
import type { PrintWedding } from "@/components/panel/print-views";

/** Cabecera de las hojas para imprimir: «Lucía y Juan · 12 de junio de 2027». */
export async function getPrintWedding(supabase: SupabaseClient, weddingId: string): Promise<PrintWedding> {
  const { data } = await supabase.from("weddings").select("partner_name_1, partner_name_2, wedding_date").eq("id", weddingId).maybeSingle();
  const row = data as { partner_name_1: string | null; partner_name_2: string | null; wedding_date: string | null } | null;
  const names = [row?.partner_name_1, row?.partner_name_2].map((name) => name?.trim()).filter(Boolean).join(" y ");
  // `now` en 1970: formatRsvpDate solo pone el año si no es el actual; en una hoja impresa va siempre.
  return { names, date: row?.wedding_date ? formatRsvpDate(row.wedding_date, new Date(0)) : null };
}
