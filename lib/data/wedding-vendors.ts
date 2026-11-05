import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const count = z.coerce.number().int().nonnegative();
const summarySchema = z.object({
  total: count, por_contactar: count, contactado: count, en_conversacion: count, contratado: count, descartado: count,
});
/** Recuentos por estado (claves = VENDOR_STATUSES) + total. Sin importes. */
export type VendorSummary = z.infer<typeof summarySchema>;

/**
 * Resumen de proveedores para el panel en un único agregado SQL
 * (`wedding_vendor_summary`). Cliente de sesión, nunca service role: el SQL
 * comprueba couple_id. null = error, sin sesión o boda ajena.
 */
export async function getVendorSummary(supabase: SupabaseClient, weddingId: string): Promise<VendorSummary | null> {
  const { data, error } = await supabase.rpc("wedding_vendor_summary", { p_wedding_id: weddingId }).maybeSingle();
  if (error || !data) return null;
  const parsed = summarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
