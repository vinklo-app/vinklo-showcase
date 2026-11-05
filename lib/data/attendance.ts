import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeGuestListFilter, type GuestListFilter } from "@/lib/messages/filters";
import { groupRpcParam, type GroupFilter, type GuestGroupSummary } from "@/lib/crm/groups";
import { GUEST_SIDES, sideRpcParam, type GuestTagSummary, type SideFilter } from "@/lib/crm/tags";

const count = z.coerce.number().int().nonnegative();
const summarySchema = z.object({
  total: count, pending: count, confirmed: count, declined: count,
  companions: count, attendees: count, prepared: count, sent: count,
});
export type AttendanceSummary = z.infer<typeof summarySchema>;

/** Cliente de sesión, nunca service role: el SQL también verifica couple_id y RLS. */
export async function getAttendanceSummary(supabase: SupabaseClient, weddingId: string): Promise<AttendanceSummary | null> {
  const { data, error } = await supabase.rpc("attendance_summary", { p_wedding_id: weddingId }).maybeSingle();
  if (error || !data) return null;
  const parsed = summarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export const GUEST_PAGE_SIZE = 100;

const guestRowSchema = z.object({
  id: z.string(), name: z.string(), phone: z.string().nullable(),
  rsvp_status: z.enum(["pendiente", "si", "no"]), rsvp_companions: count, rsvp_notes: z.string().nullable(),
  source: z.string(), invitation_prepared_at: z.string().nullable(), invitation_sent_at: z.string().nullable(),
  last_reminder_at: z.string().nullable(), reminder_count: count, reminders_opt_out: z.boolean(),
  created_at: z.string(),
  // CRM (20261008100000). Con valores por defecto: si el código llega antes que
  // la migración, la lista sigue funcionando (sin datos del CRM). gift_total_cents
  // suma el importe completo de cada regalo en el que participa (un regalo
  // compartido cuenta entero para cada uno).
  invitation_opened_at: z.string().nullable().default(null), gift_none: z.boolean().default(false),
  gift_count: count.default(0), gift_unthanked: z.boolean().default(false), gift_total_cents: count.default(0),
  // Grupos (20261012100000): null si la migración aún no está aplicada.
  group_name: z.string().nullable().default(null),
  // Etiquetas y lado (20261020100000): vacías / null si la migración aún no está aplicada.
  tags: z.array(z.string()).default([]),
  side: z.enum(GUEST_SIDES).nullable().default(null),
  total_count: count,
});
export type GuestPageRow = Omit<z.infer<typeof guestRowSchema>, "total_count">;
export type GuestPageResult = { data: GuestPageRow[] | null; error: { message: string } | null; count: number | null };

/** Quita la columna de total (window count) de cada fila. */
function withoutTotal<T extends { total_count: number }>(row: T): Omit<T, "total_count"> {
  const copy: Partial<T> = { ...row };
  delete copy.total_count;
  return copy as Omit<T, "total_count">;
}

function parseRows(data: unknown): { rows: GuestPageRow[]; total: number } | null {
  const parsed = z.array(guestRowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  return {
    rows: parsed.data.map(withoutTotal),
    total: parsed.data[0]?.total_count ?? 0,
  };
}

/** La función/columna aún no existe (migración sin aplicar). */
export const isMissingSchema = (error: { code?: string } | null | undefined) =>
  error?.code === "PGRST202" || error?.code === "42883" || error?.code === "PGRST204" || error?.code === "42703";

/** Filtros de etiqueta y lado (20261020100000). */
export interface GuestTagFilters { tag?: string | null; side?: SideFilter }

/** Argumentos opcionales de `guest_page`: solo los que filtran (así la llamada vale sin las migraciones). */
function optionalArgs(group: GroupFilter | undefined, extra: GuestTagFilters | undefined) {
  const groupParam = groupRpcParam(group);
  const sideParam = sideRpcParam(extra?.side);
  const withGroup = groupParam === undefined ? {} : { p_group: groupParam };
  const withTags = {
    ...(extra?.tag ? { p_tag: extra.tag } : {}),
    ...(sideParam === undefined ? {} : { p_side: sideParam }),
  };
  return { withGroup, withTags, hasTags: Object.keys(withTags).length > 0 };
}

/**
 * Página de la lista por filtro de tarea + búsqueda por nombre + grupo +
 * etiqueta + lado. Todo en SQL (`guest_page` → `guest_in_filter`): misma
 * condición que los recuentos. `filter` acepta las claves nuevas (también las
 * del CRM) y los valores antiguos `pendiente|si|no`.
 * `p_group`, `p_tag` y `p_side` solo se envían si filtran: así la llamada sigue
 * valiendo antes de aplicar 20261012100000 / 20261020100000 (sin la migración,
 * ese filtro se ignora). Devuelve la forma `{ data, error, count }` de siempre.
 */
export async function getGuestPage(supabase: SupabaseClient, weddingId: string, page: number, search: string, filter: string, group?: GroupFilter, extra?: GuestTagFilters): Promise<GuestPageResult> {
  const offset = (Math.max(1, Math.trunc(page) || 1) - 1) * GUEST_PAGE_SIZE;
  const base = { p_wedding_id: weddingId, p_filter: normalizeGuestListFilter(filter), p_search: search.trim().slice(0, 120) };
  const { withGroup, withTags, hasTags } = optionalArgs(group, extra);
  const call = async (limit: number, from: number) => {
    const args = { ...base, p_limit: limit, p_offset: from };
    const hasGroup = Object.keys(withGroup).length > 0;
    if (!hasGroup && !hasTags) return supabase.rpc("guest_page", args);
    const full = await supabase.rpc("guest_page", { ...args, ...withGroup, ...withTags });
    if (!isMissingSchema(full.error)) return full;
    // Sin 20261020100000: se repite solo con el grupo; sin grupos tampoco, sin nada.
    if (hasTags && hasGroup) {
      const grouped = await supabase.rpc("guest_page", { ...args, ...withGroup });
      if (!isMissingSchema(grouped.error)) return grouped;
    }
    return supabase.rpc("guest_page", args);
  };
  const { data, error } = await call(GUEST_PAGE_SIZE, offset);
  if (error) return { data: null, error: { message: error.message }, count: null };
  const parsed = parseRows(data);
  if (!parsed) return { data: null, error: { message: "invalid guest_page shape" }, count: null };
  // Fuera de rango no hay filas que lleven el total: se pide sin offset.
  if (parsed.rows.length === 0 && offset > 0) {
    const head = await call(1, 0);
    const total = head.error ? null : parseRows(head.data)?.total ?? null;
    return { data: [], error: null, count: total };
  }
  return { data: parsed.rows, error: null, count: parsed.total };
}

/** Todas las filas de un filtro (para el CSV), en bloques de 1000 con orden estable. */
export async function getAllGuestsForFilter(supabase: SupabaseClient, weddingId: string, filter: GuestListFilter, search: string, group?: GroupFilter, extra?: GuestTagFilters): Promise<GuestPageRow[] | null> {
  const rows: GuestPageRow[] = [];
  const { withGroup, withTags } = optionalArgs(group, extra);
  for (let offset = 0; offset < 20000; offset += 1000) {
    const args = { p_wedding_id: weddingId, p_filter: filter, p_search: search.trim().slice(0, 120), p_limit: 1000, p_offset: offset };
    // Con grupo/etiqueta/lado y sin la migración no se puede filtrar: mejor fallar que exportar a toda la lista.
    const { data, error } = await supabase.rpc("guest_page", { ...args, ...withGroup, ...withTags });
    if (error) return null;
    const parsed = parseRows(data);
    if (!parsed) return null;
    rows.push(...parsed.rows);
    if (parsed.rows.length < 1000) return rows;
  }
  return rows;
}

const tagSummarySchema = z.array(z.object({ tag: z.string(), guests: count, confirmed: count, attendees: count }));

/**
 * Invitados por etiqueta (`guest_tag_summary`, invoker + owns_wedding). null =
 * error o migración sin aplicar: el panel funciona igual, sin etiquetas.
 */
export async function getGuestTags(supabase: SupabaseClient, weddingId: string): Promise<GuestTagSummary[] | null> {
  const { data, error } = await supabase.rpc("guest_tag_summary", { p_wedding_id: weddingId });
  if (error) return null;
  const parsed = tagSummarySchema.safeParse(data ?? []);
  return parsed.success ? parsed.data : null;
}

const groupSummarySchema = z.array(z.object({
  group_name: z.string().nullable(), guests: count, confirmed: count, declined: count, pending: count, attendees: count,
}));

/**
 * Invitados por grupo (`guest_group_summary`, invoker + RLS). null = error o
 * migración sin aplicar: el panel funciona igual, sin grupos.
 */
export async function getGuestGroups(supabase: SupabaseClient, weddingId: string): Promise<GuestGroupSummary[] | null> {
  const { data, error } = await supabase.rpc("guest_group_summary", { p_wedding_id: weddingId });
  if (error) return null;
  const parsed = groupSummarySchema.safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map(({ group_name, ...rest }) => ({ name: group_name, ...rest }));
}

const countsSchema = z.object({
  todos: count, sin_enviar: count, esperando: count, para_recordar: count, vienen: count,
  no_vienen: count, sin_telefono: count, con_notas: count, sin_respuesta: count,
  // CRM (20261008100000): 0 si la migración aún no está aplicada.
  enviada_sin_abrir: count.default(0), abierta_sin_responder: count.default(0), con_regalo: count.default(0),
  sin_regalo: count.default(0), regalo_sin_indicar: count.default(0), sin_agradecer: count.default(0),
});
export type GuestFilterCounts = z.infer<typeof countsSchema>;

/** Recuentos de los chips en un único agregado SQL. null = error o boda ajena. */
export async function getGuestFilterCounts(supabase: SupabaseClient, weddingId: string): Promise<GuestFilterCounts | null> {
  const { data, error } = await supabase.rpc("guest_filter_counts", { p_wedding_id: weddingId }).maybeSingle();
  if (error || !data) return null;
  const parsed = countsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const queueSchema = z.array(z.object({
  id: z.string(), name: z.string(), phone: z.string().nullable(), invitation_sent_at: z.string(),
  last_reminder_at: z.string().nullable(), reminder_count: count, total_count: count,
  // 20261012200000: grupo de cada persona (null sin la migración).
  group_name: z.string().nullable().default(null),
  // 20261020100000: etiquetas de cada persona ([] sin la migración).
  tags: z.array(z.string()).default([]),
  // 20261101120000: invitation_sent_at es la ENTREGA (envío confirmado o, si
  // no, apertura del enlace) y esto dice cuál. Sin la migración, siempre envío.
  delivered_by: z.enum(["sent", "opened"]).default("sent").catch("sent"),
}));
export type ReminderQueueItem = Omit<z.infer<typeof queueSchema>[number], "total_count">;
export const REMINDER_QUEUE_LIMIT = 200;

/**
 * Fila «Recordar a quien no ha respondido»: invitación enviada, sin respuesta,
 * teléfono válido para WhatsApp, sin «no recordar» y sin recordatorio en los
 * últimos 3 días. Orden estable: quien menos recientemente se contactó primero.
 * Se reconstruye siempre desde el servidor (volver de WhatsApp puede recargar).
 */
export async function getReminderQueue(supabase: SupabaseClient, weddingId: string, limit = REMINDER_QUEUE_LIMIT, group: string | null = null, tag: string | null = null): Promise<{ items: ReminderQueueItem[]; total: number } | null> {
  // `p_group` / `p_tag` solo si filtran: sin ellos la llamada vale con o sin 20261012200000 / 20261020100000.
  const { data, error } = await supabase.rpc("reminder_queue", {
    p_wedding_id: weddingId, p_limit: limit,
    ...(group ? { p_group: group } : {}),
    ...(tag ? { p_tag: tag } : {}),
  });
  if (error) return null;
  const parsed = queueSchema.safeParse(data ?? []);
  if (!parsed.success) return null;
  return { items: parsed.data.map(withoutTotal), total: parsed.data[0]?.total_count ?? 0 };
}

const limitRowsSchema = z.array(z.object({ id: z.string(), max_companions: z.number().int().min(0).max(10).nullable().catch(null).default(null) }));

/**
 * Tope de acompañantes (20261021110000), aparte de `guest_page` (que no lo
 * devuelve). Con `ids`, solo esas personas (la página de la lista, R05); sin
 * ellos, solo quienes tienen tope (para el CSV). Devuelve id → tope; quien no
 * aparece no tiene límite. null = la columna aún no existe o la lectura
 * falló: la pareja no ve el campo y el CSV va con la celda vacía.
 */
export async function getGuestCompanionLimits(supabase: SupabaseClient, weddingId: string, ids?: readonly string[]): Promise<Map<string, number> | null> {
  if (ids && ids.length === 0) return new Map();
  const base = supabase.from("wedding_guests").select("id, max_companions").eq("wedding_id", weddingId);
  const { data, error } = await (ids ? base.in("id", [...ids]) : base.not("max_companions", "is", null).limit(20000));
  if (error) return null;
  const parsed = limitRowsSchema.safeParse(data ?? []);
  if (!parsed.success) return null;
  const map = new Map<string, number>();
  for (const row of parsed.data) if (row.max_companions !== null) map.set(row.id, row.max_companions);
  return map;
}

const logisticRowsSchema = z.array(z.object({ id: z.string(), rsvp_logistic_notes: z.string().nullable().catch(null).default(null) }));

/**
 * «Algo más que debamos saber» (20261030100000), aparte de `guest_page` (que
 * no la devuelve), igual que el tope de acompañantes. Con `ids`, solo esas
 * personas; sin ellos, solo quienes la escribieron (CSV). null = la columna
 * aún no existe o la lectura falló: la ficha y el CSV salen sin ella.
 */
export async function getGuestLogisticNotes(supabase: SupabaseClient, weddingId: string, ids?: readonly string[]): Promise<Map<string, string> | null> {
  if (ids && ids.length === 0) return new Map();
  const base = supabase.from("wedding_guests").select("id, rsvp_logistic_notes").eq("wedding_id", weddingId);
  const { data, error } = await (ids ? base.in("id", [...ids]) : base.not("rsvp_logistic_notes", "is", null).limit(20000));
  if (error) return null;
  const parsed = logisticRowsSchema.safeParse(data ?? []);
  if (!parsed.success) return null;
  const map = new Map<string, string>();
  for (const row of parsed.data) if (row.rsvp_logistic_notes?.trim()) map.set(row.id, row.rsvp_logistic_notes.trim());
  return map;
}

const extraRowsSchema = z.array(z.object({ id: z.string(), extra_fields: z.record(z.string(), z.unknown()).nullable().catch(null).default(null) }));

/** Solo pares texto → texto (el CHECK ya lo garantiza; aquí no se confía en la forma). */
function cleanExtra(value: Record<string, unknown> | null): Record<string, string> | null {
  if (!value) return null;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "");
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * Campos propios del invitado (20261031100000: columnas del Excel que no son
 * campos del CRM), aparte de `guest_page` como la nota logística. Con `ids`,
 * solo esas personas; sin ellos, toda la boda paginada (CSV y tabla; los
 * vacíos se descartan aquí, sin filtrar jsonb en PostgREST).
 * null = la columna aún no existe o la lectura falló: ficha, tabla y CSV
 * salen sin ellos.
 */
export async function getGuestExtraFields(supabase: SupabaseClient, weddingId: string, ids?: readonly string[]): Promise<Map<string, Record<string, string>> | null> {
  if (ids && ids.length === 0) return new Map();
  const map = new Map<string, Record<string, string>>();
  const add = (data: unknown): number | null => {
    const parsed = extraRowsSchema.safeParse(data ?? []);
    if (!parsed.success) return null;
    for (const row of parsed.data) {
      const extra = cleanExtra(row.extra_fields);
      if (extra) map.set(row.id, extra);
    }
    return parsed.data.length;
  };
  const base = () => supabase.from("wedding_guests").select("id, extra_fields").eq("wedding_id", weddingId);
  if (ids) {
    const { data, error } = await base().in("id", [...ids]);
    return error || add(data) === null ? null : map;
  }
  // Toda la boda en bloques de 1000 (PostgREST corta en max_rows = 1000 sin avisar), orden estable.
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await base().order("id", { ascending: true }).range(from, from + 999);
    if (error) return null;
    const read = add(data);
    if (read === null) return null;
    if (read < 1000) break;
  }
  return map;
}

