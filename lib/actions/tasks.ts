"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { isMissingMigration } from "@/lib/planning/errors";
import { isIsoDate } from "@/lib/planning/dates";
import {
  findTaskTemplate, parseTaskRows, taskInputSchema, templateDueOn, TASK_COLUMNS, TASK_TEMPLATES, TASKS_LIMIT, type TaskInput, type WeddingTask,
} from "@/lib/planning/tasks";

/**
 * Lista de tareas (20261014200000). La boda sale SIEMPRE de la sesión
 * (getCurrentWedding), nunca del cliente; cada escritura lleva
 * `.eq("wedding_id")` además de RLS y exige filas afectadas. Las sugerencias
 * llegan como claves: la fecha la calcula el servidor desde wedding_date.
 */
export type TaskActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const MIGRATION_ERROR = "Las tareas todavía no están disponibles en vuestra cuenta. Volved en un rato.";
const GONE = "Esa tarea ya no existe. Actualizad la página.";

function refresh() { revalidatePath("/panel/tareas"); revalidatePath("/panel"); }
function firstIssue(error: z.ZodError) { return error.issues[0]?.message ?? GENERIC_ERROR; }
function columns(values: z.output<typeof taskInputSchema>) {
  return { title: values.title, notes: values.notes || null, due_on: values.dueOn, category: values.category };
}

export async function createTask(input: TaskInput): Promise<TaskActionResult<{ id: string }>> {
  const parsed = taskInputSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { count, error: countError } = await context.supabase.from("wedding_tasks")
      .select("id", { count: "exact", head: true }).eq("wedding_id", context.wedding.id);
    if (isMissingMigration(countError)) return { ok: false, error: MIGRATION_ERROR };
    if (countError) return { ok: false, error: GENERIC_ERROR };
    if ((count ?? 0) >= TASKS_LIMIT) return { ok: false, error: `Podéis tener hasta ${TASKS_LIMIT} tareas.` };
    const { data, error } = await context.supabase.from("wedding_tasks")
      .insert({ wedding_id: context.wedding.id, ...columns(parsed.data) }).select("id").maybeSingle();
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error || !data) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true, id: (data as { id: string }).id };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

async function patchTask(id: string, values: Record<string, unknown>): Promise<TaskActionResult> {
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_tasks").update(values)
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!data) return { ok: false, error: GONE };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** Sustituye título, notas, fecha y categoría (el formulario envía la tarea entera). */
export async function updateTask(id: string, input: TaskInput): Promise<TaskActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  const parsed = taskInputSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return patchTask(id, columns(parsed.data));
}

/** Marcar hecha o deshacer (done_at lo pone el trigger). */
export async function setTaskDone(id: string, done: boolean): Promise<TaskActionResult> {
  if (!z.uuid().safeParse(id).success || typeof done !== "boolean") return { ok: false, error: GENERIC_ERROR };
  return patchTask(id, { done });
}

export async function deleteTask(id: string): Promise<TaskActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_tasks").delete()
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!data) return { ok: false, error: GONE };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const keysSchema = z.array(z.string()).min(1, "Elegid al menos una sugerencia.").max(TASK_TEMPLATES.length)
  .refine((keys) => keys.every((key) => findTaskTemplate(key)), "Esa sugerencia no existe.");

/**
 * Añade las sugerencias elegidas. Fechas calculadas aquí desde la fecha de la
 * boda (sin fecha de boda: sin fecha). Las que ya estaban no se duplican:
 * se leen las claves existentes y solo se insertan las que faltan (además,
 * unique (wedding_id, template_key) en la base).
 */
export async function addSuggestedTasks(keys: string[]): Promise<TaskActionResult<{ added: number; skipped: number; tasks: WeddingTask[] }>> {
  const parsed = keysSchema.safeParse(Array.isArray(keys) ? Array.from(new Set(keys)) : keys);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const [{ data: weddingRow, error: weddingError }, { data: existing, error: readError }] = await Promise.all([
      supabase.from("weddings").select("wedding_date").eq("id", wedding.id).maybeSingle(),
      supabase.from("wedding_tasks").select("template_key").eq("wedding_id", wedding.id).not("template_key", "is", null).limit(TASKS_LIMIT),
    ]);
    if (isMissingMigration(readError)) return { ok: false, error: MIGRATION_ERROR };
    if (weddingError || readError) return { ok: false, error: GENERIC_ERROR };
    const weddingDate = (weddingRow as { wedding_date: string | null } | null)?.wedding_date ?? null;
    const taken = new Set(((existing ?? []) as { template_key: string }[]).map((row) => row.template_key));
    const rows = parsed.data.filter((key) => !taken.has(key)).map((key) => {
      const template = findTaskTemplate(key)!;
      return {
        wedding_id: wedding.id, title: template.title, category: template.category, template_key: template.key,
        due_on: templateDueOn(template, isIsoDate(weddingDate) ? weddingDate : null),
        position: TASK_TEMPLATES.indexOf(template),
      };
    });
    if (rows.length === 0) return { ok: true, added: 0, skipped: parsed.data.length, tasks: [] };
    const { data, error } = await supabase.from("wedding_tasks").insert(rows).select(TASK_COLUMNS);
    // Doble clic o dos pestañas: la clave única ya estaba.
    if (error?.code === "23505") { refresh(); return { ok: true, added: 0, skipped: parsed.data.length, tasks: [] }; }
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const added = Array.isArray(data) ? data.length : 0;
    refresh();
    return { ok: true, added, skipped: parsed.data.length - added, tasks: parseTaskRows(data) ?? [] };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
