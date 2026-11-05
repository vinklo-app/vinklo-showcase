"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  MAX_AUTO_ASSIGNMENTS, MAX_SEAT_MOVE, MAX_TABLES, TABLE_NAME_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, TABLE_SEATS_MIN, TABLE_SHAPES, normalizeTableName,
} from "@/lib/crm/seating";
import type { FloorSaveRow, SavedFloorTable } from "@/lib/crm/floor-plan";

/**
 * Plan de mesas (20261013100000). Todas resuelven la boda con la sesión
 * (getCurrentWedding) y nunca aceptan wedding_id del cliente; cada escritura
 * lleva `.eq("wedding_id")` además de RLS y exige filas afectadas. La FK
 * compuesta (table_id, wedding_id) impide sentar a nadie en una mesa ajena.
 */
export type TableActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const MIGRATION_ERROR = "Las mesas requieren aplicar la migración de mesas en Supabase.";
const GONE_TABLE = "Esa mesa ya no existe. Actualizad la página.";

/** Tabla o columna nuevas aún sin aplicar (PostgREST: PGRST205/PGRST204; Postgres: 42P01/42703). */
const missingMigration = (error: { code?: string } | null) =>
  ["PGRST205", "PGRST204", "42P01", "42703"].includes(error?.code ?? "");

const nameSchema = z.string().max(200).transform(normalizeTableName)
  .refine((value): value is string => value !== null, "Poned un nombre a la mesa.")
  .refine((value) => value === null || value.length <= TABLE_NAME_MAX, `El nombre puede tener hasta ${TABLE_NAME_MAX} caracteres.`);
const seatsSchema = z.number().int(`Las plazas son un número entero.`)
  .min(TABLE_SEATS_MIN, `Una mesa tiene al menos ${TABLE_SEATS_MIN} plaza.`)
  .max(TABLE_SEATS_MAX, `Una mesa puede tener hasta ${TABLE_SEATS_MAX} plazas.`);
const idsSchema = z.array(z.uuid()).min(1, "Elegid al menos a un invitado.")
  .max(MAX_SEAT_MOVE, `Podéis mover hasta ${MAX_SEAT_MOVE} invitados a la vez.`);

function refresh() { revalidatePath("/panel/mesas"); revalidatePath("/panel"); }
function firstIssue(error: z.ZodError) { return error.issues[0]?.message ?? GENERIC_ERROR; }

export async function createTable(input: { name?: string; seats?: number }): Promise<TableActionResult<{ id: string }>> {
  const parsed = z.object({ name: nameSchema, seats: seatsSchema.default(TABLE_SEATS_DEFAULT) }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const { data: existing, error: readError } = await supabase.from("wedding_tables")
      .select("position").eq("wedding_id", wedding.id).order("position", { ascending: false }).limit(MAX_TABLES);
    if (missingMigration(readError)) return { ok: false, error: MIGRATION_ERROR };
    if (readError) return { ok: false, error: GENERIC_ERROR };
    const rows = (existing ?? []) as { position: number }[];
    if (rows.length >= MAX_TABLES) return { ok: false, error: `Podéis tener hasta ${MAX_TABLES} mesas.` };
    const position = (rows[0]?.position ?? 0) + 1;
    const { data, error } = await supabase.from("wedding_tables")
      .insert({ wedding_id: wedding.id, name: parsed.data.name, seats: parsed.data.seats, position })
      .select("id").maybeSingle();
    if (error?.code === "23505") return { ok: false, error: "Ya tenéis una mesa con ese nombre." };
    if (missingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error || !data) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true, id: (data as { id: string }).id };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

async function updateTable(tableId: string, values: { name?: string; seats?: number }): Promise<TableActionResult> {
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_tables").update(values)
      .eq("id", tableId).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error?.code === "23505") return { ok: false, error: "Ya tenéis una mesa con ese nombre." };
    if (missingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!data) return { ok: false, error: GONE_TABLE };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function renameTable(tableId: string, name: string): Promise<TableActionResult> {
  const parsed = z.object({ id: z.uuid(), name: nameSchema }).safeParse({ id: tableId, name });
  if (!parsed.success) return { ok: false, error: z.uuid().safeParse(tableId).success ? firstIssue(parsed.error) : GENERIC_ERROR };
  return updateTable(parsed.data.id, { name: parsed.data.name });
}

export async function setTableSeats(tableId: string, seats: number): Promise<TableActionResult> {
  const parsed = z.object({ id: z.uuid(), seats: seatsSchema }).safeParse({ id: tableId, seats });
  if (!parsed.success) return { ok: false, error: z.uuid().safeParse(tableId).success ? firstIssue(parsed.error) : GENERIC_ERROR };
  return updateTable(parsed.data.id, { seats: parsed.data.seats });
}

/** Borra la mesa; sus invitados quedan sin mesa (on delete set null). */
export async function deleteTable(tableId: string): Promise<TableActionResult> {
  if (!z.uuid().safeParse(tableId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_tables").delete()
      .eq("id", tableId).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (missingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!data) return { ok: false, error: GONE_TABLE };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * Sienta a uno o varios invitados en una mesa (tableId) o les quita la mesa
 * (null). Solo invitados de la boda de la sesión: los ajenos o borrados no se
 * tocan y se cuentan en `missing`. No toca updated_at (el «lo último» del
 * resumen sigue siendo de respuestas).
 */
export async function seatGuests(guestIds: string[], tableId: string | null): Promise<TableActionResult<{ moved: number; missing: number }>> {
  const parsed = z.object({ ids: idsSchema, table: z.uuid().nullable() })
    .safeParse({ ids: Array.isArray(guestIds) ? Array.from(new Set(guestIds)) : guestIds, table: tableId });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ table_id: parsed.data.table })
      .in("id", parsed.data.ids).eq("wedding_id", context.wedding.id).select("id");
    // FK compuesta: mesa borrada o de otra boda.
    if (error?.code === "23503") return { ok: false, error: GONE_TABLE };
    if (missingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const moved = Array.isArray(data) ? data.length : 0;
    if (moved === 0) return { ok: false, error: "No se ha movido a nadie: esos invitados ya no están en vuestra lista." };
    refresh();
    return { ok: true, moved, missing: parsed.data.ids.length - moved };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const NEW_KEY = /^new:\d{1,4}$/;
const seatingSchema = z.object({
  newTables: z.array(z.object({ key: z.string().regex(NEW_KEY), name: nameSchema, seats: seatsSchema }))
    .max(MAX_TABLES, `Podéis tener hasta ${MAX_TABLES} mesas.`),
  assignments: z.array(z.union([
    z.strictObject({ guestId: z.uuid(), tableId: z.union([z.uuid(), z.string().regex(NEW_KEY)]).nullable() }),
    // Acompañante sentado aparte (mesa infantil) o de vuelta con su invitado (null). 20261023110000.
    z.strictObject({ companionId: z.uuid(), tableId: z.union([z.uuid(), z.string().regex(NEW_KEY)]).nullable() }),
  ])).max(MAX_AUTO_ASSIGNMENTS, `Podéis sentar hasta ${MAX_AUTO_ASSIGNMENTS} invitados de una vez.`),
}).refine((value) => value.newTables.length + value.assignments.length > 0, "No hay nada que aplicar.");
const appliedSchema = z.object({ created: z.array(z.object({ key: z.string(), id: z.string() })), seated: z.number().int(), companions: z.number().int().default(0) });

export type SeatingAssignment = { guestId: string; tableId: string | null } | { companionId: string; tableId: string | null };

/**
 * «Sentar automáticamente» y «Deshacer la propuesta»: crea las mesas nuevas y
 * sienta (o quita la mesa, tableId null) a todos en UNA transacción (RPC
 * apply_seating, 20261020110000). Todo o nada: si algún invitado o mesa no es
 * de la boda de la sesión, no se aplica nada. Con la migración 20261023110000
 * también sienta acompañantes (`companionId`): sin ella, la RPC los rechaza
 * (no los ignora) y se avisa de que falta.
 */
export async function applySeating(
  newTables: Array<{ key: string; name: string; seats: number }>,
  assignments: SeatingAssignment[],
): Promise<TableActionResult<{ created: Array<{ key: string; id: string }>; seated: number }>> {
  const parsed = seatingSchema.safeParse({ newTables, assignments });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("apply_seating", {
      p_wedding_id: context.wedding.id, p_new_tables: parsed.data.newTables, p_assignments: parsed.data.assignments,
    });
    if (error?.code === "PGRST202" || error?.code === "42883") return { ok: false, error: "Sentar automáticamente requiere aplicar la migración de mesas automáticas en Supabase." };
    // La versión anterior de apply_seating no conoce companionId: forma no válida.
    if (error?.code === "22023" && parsed.data.assignments.some((item) => "companionId" in item)) return { ok: false, error: "La mesa infantil requiere aplicar la migración de acompañantes en Supabase." };
    if (error?.code === "23505") return { ok: false, error: "Ya tenéis una mesa con ese nombre. Actualizad la página y probad de nuevo." };
    if (error?.code === "42501" || error?.code === "23503") return { ok: false, error: "Algún invitado o mesa ya no está en vuestra lista. Actualizad la página y probad de nuevo." };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const result = appliedSchema.safeParse(data);
    if (!result.success) return { ok: false, error: GENERIC_ERROR };
    refresh(); revalidatePath("/panel/invitados");
    return { ok: true, created: result.data.created, seated: result.data.seated };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const floorRowSchema = z.object({
  id: z.uuid().nullable(),
  name: nameSchema,
  seats: seatsSchema,
  shape: z.enum(TABLE_SHAPES).nullable(),
  x: z.number().min(0).max(1).nullable(),
  y: z.number().min(0).max(1).nullable(),
}).refine((row) => (row.x === null) === (row.y === null), "Falta la posición de alguna mesa.");
const floorPlanSchema = z.array(floorRowSchema).min(1, "No hay ninguna mesa que guardar.").max(MAX_TABLES, `Podéis tener hasta ${MAX_TABLES} mesas.`);
const savedFloorSchema = z.object({
  tables: z.array(z.object({
    id: z.string(), name: z.string(), seats: z.number().int(), shape: z.enum(TABLE_SHAPES).nullable(),
    x: z.number().nullable(), y: z.number().nullable(), created: z.boolean(),
  })),
});

/**
 * Plano del salón revisado por la pareja (tras leer la foto con IA o a
 * mano): crea o actualiza nombre, plazas, forma y posición de todas las
 * mesas en UNA transacción (RPC save_floor_plan, 20261028100000). No borra
 * ninguna. La imagen nunca llega aquí.
 */
export async function saveFloorPlan(rows: FloorSaveRow[]): Promise<TableActionResult<{ tables: SavedFloorTable[] }>> {
  const parsed = floorPlanSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("save_floor_plan", { p_wedding_id: context.wedding.id, p_tables: parsed.data });
    if (error?.code === "PGRST202" || error?.code === "42883") return { ok: false, error: "Guardar el plano del salón requiere aplicar la migración del plano en Supabase." };
    if (error?.code === "23505") return { ok: false, error: "Ya tenéis una mesa con ese nombre. Cambiad el nombre y probad de nuevo." };
    if (error?.code === "42501") return { ok: false, error: "Alguna mesa ya no está en vuestra boda. Actualizad la página y probad de nuevo." };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const result = savedFloorSchema.safeParse(data);
    if (!result.success) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true, tables: result.data.tables };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Mesa fija para un grupo» (20261023100000): el grupo que «Sentar
 * automáticamente» sienta en esta mesa; null o vacío = ninguno.
 */
export async function setTablePinnedGroup(tableId: string, group: string | null): Promise<TableActionResult> {
  const parsed = z.object({
    id: z.uuid(),
    group: z.string().max(200).nullable().transform((value) => (value ?? "").replace(/\s+/g, " ").trim() || null)
      .refine((value) => value === null || value.length <= 40, "El grupo puede tener hasta 40 caracteres."),
  }).safeParse({ id: tableId, group });
  if (!parsed.success) return { ok: false, error: z.uuid().safeParse(tableId).success ? firstIssue(parsed.error) : GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_tables").update({ pinned_group: parsed.data.group })
      .eq("id", parsed.data.id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (missingMigration(error) || error?.code === "42501") return { ok: false, error: "La mesa fija requiere aplicar la migración de acompañantes en Supabase." };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!data) return { ok: false, error: GONE_TABLE };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
