"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  COMPANIONS_MAX, COMPANION_NAME_MAX, EXCEL_MAX_ROWS, EXTRA_BUDGET_BYTES, EXTRA_KEY_MAX, EXTRA_MAX_KEYS, EXTRA_VALUE_MAX,
  NAME_MAX, NOTES_MAX, PHONE_MAX, type ImportGuest,
} from "@/lib/crm/guest-excel-import";
import { GROUP_NAME_MAX } from "@/lib/crm/groups";
import { GUEST_SIDES, TAGS_PER_GUEST, TAG_MAX, tagKey } from "@/lib/crm/tags";

export type ExcelImportResult =
  | { ok: true; guests: number; people: number; repeated: boolean }
  /** `row`: invitación rechazada (1 = la primera enviada), para señalar su fila del archivo. */
  | { ok: false; error: string; row?: number };

const GENERIC_ERROR = "No se ha importado nadie. Comprobad la conexión y probad de nuevo.";
const MIGRATION_ERROR = "Importar desde Excel requiere aplicar la migración de campos propios en Supabase.";

const trimmed = (max: number, min = 1) => z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().min(min).max(max));

/**
 * Campos propios: mismos topes que el CHECK guest_extra_fields_valid
 * (20261031100000). El tamaño se mide en JSON compacto con margen (5800):
 * Postgres lo mide con espacios tras «:» y «,» y su tope es 6144.
 */
const extraSchema = z.record(z.string(), z.string())
  .refine((value) => Object.keys(value).length <= EXTRA_MAX_KEYS, `Como mucho ${EXTRA_MAX_KEYS} campos propios por invitado.`)
  .refine((value) => Object.entries(value).every(([key, v]) => key === key.trim() && key.length >= 1 && key.length <= EXTRA_KEY_MAX && v.length >= 1 && v.length <= EXTRA_VALUE_MAX), "Algún campo propio es demasiado largo.")
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= EXTRA_BUDGET_BYTES, "Demasiados datos extra en un invitado.");

const guestSchema = z.object({
  name: trimmed(NAME_MAX, 2),
  phone: z.string().trim().min(6).max(PHONE_MAX).nullable(),
  status: z.enum(["pendiente", "si", "no"]),
  companions: z.number().int().min(0).max(COMPANIONS_MAX),
  max_companions: z.number().int().min(0).max(COMPANIONS_MAX).nullable(),
  notes: z.string().trim().max(NOTES_MAX).nullable().transform((v) => v || null),
  group: z.string().nullable().transform((v) => (v ? v.replace(/\s+/g, " ").trim() || null : null)).pipe(z.string().max(GROUP_NAME_MAX).nullable()),
  tags: z.array(trimmed(TAG_MAX)).max(TAGS_PER_GUEST).refine((list) => new Set(list.map(tagKey)).size === list.length, "Etiquetas repetidas."),
  side: z.enum(GUEST_SIDES).nullable(),
  extra: extraSchema,
  companion_names: z.array(trimmed(COMPANION_NAME_MAX)).max(COMPANIONS_MAX),
}).strict();

const payloadSchema = z.object({
  importId: z.uuid(),
  guests: z.array(guestSchema).min(1, "No hay ningún invitado que importar.").max(EXCEL_MAX_ROWS, `Como máximo ${EXCEL_MAX_ROWS.toLocaleString("es-ES")} invitaciones de una vez.`),
});

const summarySchema = z.object({ status: z.enum(["ok", "duplicate"]), guests: z.number().int(), people: z.number().int() });

/**
 * «Importar desde Excel»: todas las invitaciones confirmadas en UNA llamada a
 * la RPC import_wedding_guests (invitados + acompañantes con nombre en una
 * transacción, invoker: RLS owns_wedding y permisos por columna). La boda es
 * siempre la de la sesión. `importId` lo genera el navegador al confirmar: un
 * reintento con el mismo id (doble clic, corte de red) no duplica a nadie y
 * devuelve el mismo resumen (`repeated`).
 */
export async function importGuestsFromExcel(importId: string, guests: ImportGuest[]): Promise<ExcelImportResult> {
  const parsed = payloadSchema.safeParse({ importId, guests });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = typeof issue?.path[1] === "number" ? issue.path[1] + 1 : undefined;
    return { ok: false, error: `${issue?.message ?? "Datos no válidos."}${row ? ` (invitación ${row})` : ""}`, ...(row ? { row } : {}) };
  }
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    // La RPC cuenta los acompañantes como confirmados solo con «si».
    const { data, error } = await context.supabase.rpc("import_wedding_guests", { p_wedding_id: context.wedding.id, p_import_id: parsed.data.importId, p_rows: parsed.data.guests });
    if (error?.code === "PGRST202" || error?.code === "42883") return { ok: false, error: MIGRATION_ERROR };
    if (error?.code === "22023") {
      const line = /fila (\d+)/.exec(error.message ?? "")?.[1];
      return line ? { ok: false, error: `La invitación ${line} no es válida: revisadla en el archivo.`, row: Number(line) } : { ok: false, error: "Alguna fila no es válida: revisad el archivo." };
    }
    if (error?.code === "42501") return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const summary = summarySchema.safeParse(data);
    if (!summary.success) return { ok: false, error: GENERIC_ERROR };
    revalidatePath("/panel/invitados"); revalidatePath("/panel"); revalidatePath("/panel/mesas");
    return { ok: true, guests: summary.data.guests, people: summary.data.people, repeated: summary.data.status === "duplicate" };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
