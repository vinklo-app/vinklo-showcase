import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TABLE_SHAPES, parseSeatingPlan, unseatedAttending, withLayout, type SeatingPlan, type TableLayout } from "@/lib/crm/seating";

/**
 * Lectura del plan de mesas (`wedding_seating`, 20261013100000). Sin la
 * migración aplicada devuelve `missing` (la página lo avisa; el resumen calla).
 */
export type SeatingRead = { status: "ok"; plan: SeatingPlan } | { status: "missing" } | { status: "error" };

export async function getSeatingPlan(supabase: SupabaseClient, weddingId: string, options: { layout?: boolean } = {}): Promise<SeatingRead> {
  const [seating, layout] = await Promise.all([
    supabase.rpc("wedding_seating", { p_wedding_id: weddingId }),
    options.layout ? getTableLayout(supabase, weddingId) : Promise.resolve([]),
  ]);
  const { data, error } = seating;
  if (error) return { status: error.code === "PGRST202" || error.code === "42883" ? "missing" : "error" };
  const plan = parseSeatingPlan(data);
  return plan ? { status: "ok", plan: withLayout(plan, layout) } : { status: "error" };
}

const layoutSchema = z.array(z.object({
  id: z.string(),
  shape: z.enum(TABLE_SHAPES).nullable().catch(null),
  pos_x: z.number().min(0).max(1).nullable().catch(null),
  pos_y: z.number().min(0).max(1).nullable().catch(null),
}));

/**
 * Forma y posición de las mesas en el plano del salón (20261028100000).
 * Lectura aparte (no cambia `wedding_seating`). Sin la migración (columna
 * inexistente) o con cualquier error: [] y el plan se pinta sin plano.
 */
export async function getTableLayout(supabase: SupabaseClient, weddingId: string): Promise<TableLayout[]> {
  try {
    const { data, error } = await supabase.from("wedding_tables").select("id, shape, pos_x, pos_y").eq("wedding_id", weddingId).limit(200);
    if (error) return [];
    const parsed = layoutSchema.safeParse(data ?? []);
    return parsed.success ? parsed.data.map((row) => (row.pos_x === null || row.pos_y === null ? { ...row, pos_x: null, pos_y: null } : row)) : [];
  } catch {
    return [];
  }
}

/** «Lo que toca hoy»: personas que vienen sin mesa, solo si ya hay alguna mesa. null = no aplica o no se pudo leer. */
export async function getUnseatedAttending(supabase: SupabaseClient, weddingId: string): Promise<number | null> {
  const read = await getSeatingPlan(supabase, weddingId);
  if (read.status !== "ok" || read.plan.tables.length === 0) return null;
  return unseatedAttending(read.plan);
}

const excelTableRowsSchema = z.array(z.object({ id: z.string(), mesa: z.string().nullable().catch(null) }));

/**
 * Columna Mesa del Excel (campo propio «Mesa», 20261031100000) de quienes aún
 * no tienen mesa: id → valor. Solo para ofrecer «Crear N mesas y sentar según
 * vuestro Excel». null = la columna no existe o la lectura falló (no se ofrece).
 */
export async function getExcelTables(supabase: SupabaseClient, weddingId: string): Promise<Map<string, string> | null> {
  const map = new Map<string, string>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from("wedding_guests").select("id, mesa:extra_fields->>Mesa")
      .eq("wedding_id", weddingId).is("table_id", null).not("extra_fields->>Mesa", "is", null)
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) return null;
    const parsed = excelTableRowsSchema.safeParse(data ?? []);
    if (!parsed.success) return null;
    for (const row of parsed.data) if (row.mesa?.trim()) map.set(row.id, row.mesa);
    if (parsed.data.length < 1000) break;
  }
  return map;
}
