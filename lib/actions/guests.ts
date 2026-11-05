"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { RSVP_STATUSES, type RsvpStatus } from "@/lib/guests";
import { MAX_IMPORT_ROWS, tooManyRowsMessage, type BulkCreateResult, type BulkCreateRowError } from "@/lib/actions/guest-import";
import { ALL_GROUPS, GROUP_NAME_MAX, MAX_GROUP_MOVE, normalizeGroupName } from "@/lib/crm/groups";
import { GUEST_SIDES, MAX_TAG_MOVE, TAGS_PER_GUEST, TAG_MAX, normalizeTag, normalizeTags, parseTagFilter, type GuestSide } from "@/lib/crm/tags";
import { MAX_GUEST_BULK, giftDeletionImpact, type BulkGuest, type GiftDeletionImpact } from "@/lib/crm/guest-bulk";
import { getAllGuestsForFilter } from "@/lib/data/attendance";
import { listGiftsForGuests } from "@/lib/data/crm";
import { normalizeGuestListFilter } from "@/lib/messages/filters";

export type GuestActionResult = { ok: true } | { ok: false; error: string };
const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const GROUPS_MIGRATION_ERROR = "Los grupos requieren aplicar la migración de grupos en Supabase.";
/** "" o espacios → null (sin grupo). */
function groupSchema() {
  return z.string().max(200).transform(normalizeGroupName)
    .refine((value) => value === null || value.length <= GROUP_NAME_MAX, `El grupo puede tener hasta ${GROUP_NAME_MAX} caracteres.`);
}
const LIMITS_MIGRATION_ERROR = "El tope de acompañantes requiere aplicar su migración en Supabase.";
/** Tope de acompañantes: 0–10 o null (sin límite). */
function maxCompanionsSchema() {
  return z.number().int("El tope de acompañantes es un número entero.").min(0, "El tope de acompañantes va de 0 a 10.").max(10, "El tope de acompañantes va de 0 a 10.").nullable();
}
const TAGS_MIGRATION_ERROR = "Las etiquetas y el lado requieren aplicar la migración de etiquetas en Supabase.";
const TAG_TOO_LONG = `Cada etiqueta puede tener hasta ${TAG_MAX} caracteres.`;
/** Etiquetas: cada una recortada (1–30); la lista sin repetidas y como mucho 8. */
function tagsSchema() {
  return z.array(z.string().max(200)).max(50)
    .refine((list) => list.every((tag) => (normalizeTag(tag) ?? "").length <= TAG_MAX), TAG_TOO_LONG)
    .refine((list) => normalizeTags(list, [], Infinity).length <= TAGS_PER_GUEST, `Cada invitado puede tener hasta ${TAGS_PER_GUEST} etiquetas.`)
    .transform((list) => normalizeTags(list));
}
/** La columna group_name / tags / side aún no existe (PostgREST: PGRST204; Postgres: 42703). */
const missingGroupColumn = (error: { code?: string } | null) => error?.code === "PGRST204" || error?.code === "42703";
/** La RPC aún no existe (PostgREST: PGRST202; Postgres: 42883). */
const missingFunction = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42883";
const schema = z.object({
  name: z.string().trim().min(2, "Escribid el nombre (mínimo 2 letras).").max(120),
  phone: z.string().trim().max(20).refine((value) => value === "" || value.length >= 6, "Revisad el teléfono: mínimo 6 caracteres."),
  status: z.enum(RSVP_STATUSES),
  companions: z.number().int().min(0).max(10),
  notes: z.string().trim().max(500),
  /**
   * Grupo (20261012100000). undefined = no tocarlo (no se pisa el que tenga);
   * "" = quitarlo; texto = ese grupo (espacios colapsados, 1–40 caracteres).
   */
  group: groupSchema().optional(),
  /** Etiquetas (20261020100000). undefined = no tocarlas; [] = quitarlas todas. */
  tags: tagsSchema().optional(),
  /** Lado. undefined = no tocarlo; null = sin indicar. */
  side: z.enum(GUEST_SIDES).nullable().optional(),
  /**
   * Tope de acompañantes (20261021110000). undefined = no tocarlo; null = sin
   * límite (hasta 10); 0 = solo esta persona.
   */
  maxCompanions: maxCompanionsSchema().optional(),
});
export type GuestInput = z.input<typeof schema>;
/** La boda de la sesión: un único sitio (lib/data/current-wedding, R06). */
async function ownWedding() {
  const current = await getCurrentWedding();
  return current ? { supabase: current.supabase, wedding: current.wedding } : null;
}
function refresh() { revalidatePath("/panel/invitados"); revalidatePath("/panel"); }
type ParsedGuest = z.output<typeof schema>;
function fields(input: ParsedGuest) {
  return {
    name: input.name, phone: input.phone || null, rsvp_status: input.status, rsvp_companions: input.status === "si" ? input.companions : 0, rsvp_notes: input.notes || null, updated_at: new Date().toISOString(),
    ...(input.group !== undefined ? { group_name: input.group } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.side !== undefined ? { side: input.side } : {}),
    ...(input.maxCompanions !== undefined ? { max_companions: input.maxCompanions } : {}),
  };
}
type GuestFields = ReturnType<typeof fields>;
/** Sin la migración de grupos, la escritura se repite sin group_name (solo si no se pedía un grupo concreto). */
function withoutGroup<T extends { group_name?: string | null }>(row: T): Omit<T, "group_name"> {
  const copy = { ...row };
  delete copy.group_name;
  return copy;
}
/** Sin la migración de etiquetas, sin tags ni side (solo si no se pedía ninguno). */
function withoutTags<T extends { tags?: string[]; side?: GuestSide | null }>(row: T): Omit<T, "tags" | "side"> {
  const copy = { ...row };
  delete copy.tags;
  delete copy.side;
  return copy;
}
/** Sin la migración del tope, sin max_companions (solo si no se pedía uno concreto). */
function withoutLimit<T extends { max_companions?: number | null }>(row: T): Omit<T, "max_companions"> {
  const copy = { ...row };
  delete copy.max_companions;
  return copy;
}
const wantsLimit = (input: Pick<ParsedGuest, "maxCompanions">) => input.maxCompanions !== undefined && input.maxCompanions !== null;
const wantsTags = (input: Pick<ParsedGuest, "tags" | "side">) => (input.tags?.length ?? 0) > 0 || (input.side ?? null) !== null;
/**
 * Escribe y, si falta una columna nueva, repite sin ella: primero sin el tope
 * de acompañantes (la más reciente), luego sin etiquetas/lado y después sin
 * grupo. Si se pedía un valor concreto de lo que falta, avisa en vez de
 * guardarlo a medias.
 */
async function writeCompatible<R extends { error: { code?: string } | null }>(all: GuestFields, input: ParsedGuest, write: (payload: Partial<GuestFields>) => PromiseLike<R>): Promise<R | { migration: string }> {
  let result = await write(all);
  if (!missingGroupColumn(result.error)) return result;
  if (wantsLimit(input)) return { migration: LIMITS_MIGRATION_ERROR };
  const values = withoutLimit(all);
  if ("max_companions" in all) {
    result = await write(values);
    if (!missingGroupColumn(result.error)) return result;
  }
  if (wantsTags(input)) return { migration: TAGS_MIGRATION_ERROR };
  if ("tags" in values || "side" in values) {
    result = await write(withoutTags(values));
    if (!missingGroupColumn(result.error)) return result;
  }
  if (input.group) return { migration: GROUPS_MIGRATION_ERROR };
  return write(withoutGroup(withoutTags(values)));
}
export async function addGuest(input: GuestInput): Promise<GuestActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const weddingId = context.wedding.id;
    const result = await writeCompatible(fields(parsed.data), parsed.data, (payload) => context.supabase.from("wedding_guests").insert({ wedding_id: weddingId, source: "couple" as const, ...payload }));
    if ("migration" in result) return { ok: false, error: result.migration };
    if (result.error) return { ok: false, error: GENERIC_ERROR };
    refresh(); return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
export async function updateGuest(guestId: string, input: GuestInput): Promise<GuestActionResult> {
  const parsed = schema.safeParse(input);
  if (!z.uuid().safeParse(guestId).success || !parsed.success) return { ok: false, error: parsed.success ? GENERIC_ERROR : parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const result = await writeCompatible(fields(parsed.data), parsed.data, (payload) => context.supabase.from("wedding_guests").update(payload).eq("id", guestId).eq("wedding_id", context.wedding.id).select("id").maybeSingle());
    if ("migration" in result) return { ok: false, error: result.migration };
    if (result.error || !result.data) return { ok: false, error: "No se ha guardado: el invitado ya no está disponible." };
    refresh(); return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
export async function deleteGuest(guestId: string): Promise<GuestActionResult> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: GENERIC_ERROR };
    const { data, error } = await context.supabase.from("wedding_guests").delete().eq("id", guestId).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha eliminado: el invitado ya no está disponible." };
    refresh(); return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
const bulkIdsSchema = z.array(z.uuid()).min(1, "Elegid al menos a un invitado.").max(MAX_GUEST_BULK, `Podéis elegir hasta ${MAX_GUEST_BULK} invitados a la vez.`);
const uniqueIds = (ids: unknown) => (Array.isArray(ids) ? Array.from(new Set(ids)) : ids);

/**
 * «Borrar (n)» de la selección múltiple: UN delete con los ids elegidos de la
 * boda de la sesión (`.eq("wedding_id")` + RLS). Igual que deleteGuest, en
 * SQL se borran en cascada sus enlaces, acompañantes con nombre, «No sentar
 * con…», recordatorios y su parte en los regalos (el regalo que se queda sin
 * nadie se borra; trigger wedding_gift_givers_drop_orphan). Sin inversa: el
 * «Deshacer» de la lista aplaza esta llamada.
 */
export async function deleteGuests(guestIds: string[]): Promise<{ ok: true; deleted: number; missing: number } | { ok: false; error: string }> {
  const parsed = bulkIdsSchema.safeParse(uniqueIds(guestIds));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.from("wedding_guests").delete()
      .in("id", parsed.data).eq("wedding_id", context.wedding.id).select("id");
    if (error) return { ok: false, error: "No se ha borrado a nadie. Comprobad la conexión y probad de nuevo." };
    const deleted = Array.isArray(data) ? data.length : 0;
    if (deleted === 0) return { ok: false, error: "No se ha borrado a nadie: esos invitados ya no están en vuestra lista." };
    refresh(); revalidatePath("/panel/mesas");
    return { ok: true, deleted, missing: parsed.data.length - deleted };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * Antes de «Borrar (n)»: cuántos regalos anotados se borrarían con los
 * elegidos (todos los que lo hicieron están entre ellos) y cuántos se quedan
 * con otras personas. Lectura con la sesión (wedding_gift_list_for).
 */
export async function previewGuestsDeletion(guestIds: string[]): Promise<({ ok: true } & GiftDeletionImpact) | { ok: false; error: string }> {
  const parsed = bulkIdsSchema.safeParse(uniqueIds(guestIds));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const gifts = await listGiftsForGuests(context.supabase, context.wedding.id, parsed.data);
    if (gifts === null) return { ok: false, error: GENERIC_ERROR };
    return { ok: true, ...giftDeletionImpact(gifts, new Set(parsed.data)) };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Marcar asistencia…» de la selección múltiple: lo mismo que cambiar
 * «Asistencia» en la ficha de cada uno (updated_at incluido), en UNA
 * escritura y solo en la boda de la sesión. Sin «Asiste», los acompañantes
 * pasan a 0 (como fields()); con «Asiste» no se tocan: quien ya asistía
 * conserva los suyos y el resto ya tenía 0.
 */
export async function setGuestsStatus(guestIds: string[], status: RsvpStatus): Promise<{ ok: true; changed: number; missing: number } | { ok: false; error: string }> {
  const parsed = z.object({ ids: bulkIdsSchema, status: z.enum(RSVP_STATUSES) }).safeParse({ ids: uniqueIds(guestIds), status });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const values = parsed.data.status === "si"
      ? { rsvp_status: "si" as const, updated_at: new Date().toISOString() }
      : { rsvp_status: parsed.data.status, rsvp_companions: 0, updated_at: new Date().toISOString() };
    const { data, error } = await context.supabase.from("wedding_guests").update(values)
      .in("id", parsed.data.ids).eq("wedding_id", context.wedding.id).select("id");
    if (error) return { ok: false, error: GENERIC_ERROR };
    const changed = Array.isArray(data) ? data.length : 0;
    if (changed === 0) return { ok: false, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
    refresh(); revalidatePath("/panel/mesas");
    return { ok: true, changed, missing: parsed.data.ids.length - changed };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const filterParamsSchema = z.object({
  filter: z.string().max(40),
  query: z.string().max(200),
  group: z.union([
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("named"), name: z.string().max(200) }),
  ]),
  tag: z.string().max(200).nullable(),
  side: z.enum([...GUEST_SIDES, "none"]).nullable(),
});
export type GuestFilterParams = z.input<typeof filterParamsSchema>;

/**
 * «Elegir los N del filtro»: todas las personas del filtro activo (mismo SQL
 * que la lista, guest_page), con lo justo para la barra de selección. Si el
 * filtro tiene más de MAX_GUEST_BULK, no se devuelve nadie: las acciones en
 * bloque no admiten más.
 */
export async function listGuestsInFilter(params: GuestFilterParams): Promise<{ ok: true; guests: BulkGuest[] } | { ok: false; error: string }> {
  const parsed = filterParamsSchema.safeParse(params);
  if (!parsed.success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { filter, query, group, tag, side } = parsed.data;
    const groupFilter = group.kind === "named" ? (normalizeGroupName(group.name) ? { kind: "named" as const, name: normalizeGroupName(group.name)! } : ALL_GROUPS) : group;
    const rows = await getAllGuestsForFilter(context.supabase, context.wedding.id, normalizeGuestListFilter(filter), query.trim().slice(0, 120), groupFilter, { tag: parseTagFilter(tag), side });
    if (rows === null) return { ok: false, error: "No hemos podido leer la lista. Probad de nuevo." };
    if (rows.length > MAX_GUEST_BULK) return { ok: false, error: `Podéis elegir hasta ${MAX_GUEST_BULK} invitados a la vez: afinad el filtro o la búsqueda.` };
    return {
      ok: true,
      guests: rows.map((row) => ({
        id: row.id, name: row.name, rsvp_status: row.rsvp_status,
        invitation_prepared_at: row.invitation_prepared_at, invitation_sent_at: row.invitation_sent_at,
        group_name: row.group_name, tags: row.tags,
      })),
    };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * Importación masiva (pegar lista o selector de contactos), tras la tabla de
 * revisión. Cada fila pasa por el mismo `schema` que «Añadir invitado» (como
 * invitado sin respuesta, sin acompañantes ni notas); las válidas entran en UN
 * insert con el wedding_id de la sesión (RLS `owns_wedding`). Las inválidas se
 * devuelven en `errors` con su número de fila (1 = primera enviada). Si el
 * insert falla no se ha añadido ninguna.
 */
export async function bulkCreateGuests(rows: { name: string; phone?: string }[], group?: string, extra?: { tags?: string[]; side?: GuestSide | null }): Promise<BulkCreateResult> {
  const fail = (error: string, skipped = 0, errors: BulkCreateRowError[] = []): BulkCreateResult => ({ ok: false, error, created: 0, skipped, errors });
  if (!Array.isArray(rows) || rows.length === 0) return fail("No hay ningún invitado que añadir.");
  if (rows.length > MAX_IMPORT_ROWS) return fail(tooManyRowsMessage(rows.length), rows.length);
  // Un grupo para todo el lote («pego la lista de la familia de Elena»). Vacío = sin grupo.
  const groupParsed = groupSchema().optional().safeParse(group);
  if (!groupParsed.success) return fail(groupParsed.error.issues[0]?.message ?? GENERIC_ERROR, rows.length);
  const groupName = groupParsed.data ?? null;
  // Etiquetas y lado para todo el lote (opcionales).
  const extraParsed = z.object({ tags: tagsSchema().optional(), side: z.enum(GUEST_SIDES).nullable().optional() }).safeParse(extra ?? {});
  if (!extraParsed.success) return fail(extraParsed.error.issues[0]?.message ?? GENERIC_ERROR, rows.length);
  const batchTags = extraParsed.data.tags?.length ? extraParsed.data.tags : undefined;
  const batchSide = extraParsed.data.side ?? undefined;
  const errors: BulkCreateRowError[] = [];
  const valid: ReturnType<typeof fields>[] = [];
  rows.forEach((row, index) => {
    const parsed = schema.safeParse({
      name: typeof row?.name === "string" ? row.name : "",
      phone: typeof row?.phone === "string" ? row.phone : "",
      status: "pendiente", companions: 0, notes: "",
      ...(groupName ? { group: groupName } : {}),
      ...(batchTags ? { tags: batchTags } : {}),
      ...(batchSide ? { side: batchSide } : {}),
    });
    if (parsed.success) valid.push(fields(parsed.data));
    else errors.push({ line: index + 1, message: parsed.error.issues[0]?.message ?? GENERIC_ERROR });
  });
  if (valid.length === 0) return fail("Ninguna fila es válida: revisad los nombres y teléfonos.", rows.length, errors);
  try {
    const context = await ownWedding();
    if (!context) return fail("Volved a entrar para gestionar vuestra boda.", rows.length, errors);
    const insert = (list: Array<Partial<ReturnType<typeof fields>>>) => context.supabase.from("wedding_guests")
      .insert(list.map((guest) => ({ wedding_id: context.wedding.id, source: "couple" as const, ...guest })))
      .select("id");
    const { data, error } = await insert(valid);
    if (missingGroupColumn(error) && (batchTags || batchSide)) return fail(TAGS_MIGRATION_ERROR, rows.length, errors);
    if (missingGroupColumn(error) && groupName) return fail(GROUPS_MIGRATION_ERROR, rows.length, errors);
    if (error) return fail("No se ha añadido ningún invitado. Comprobad la conexión y probad de nuevo.", rows.length, errors);
    refresh();
    const created = Array.isArray(data) ? data.length : valid.length;
    return { ok: true, created, skipped: rows.length - created, errors };
  } catch { return fail("No se ha añadido ningún invitado. Comprobad la conexión y probad de nuevo.", rows.length, errors); }
}

/** Nombres y teléfonos de toda la lista, para marcar posibles repetidos al importar. */
export async function listGuestContacts(): Promise<{ ok: true; guests: { name: string; phone: string | null }[] } | { ok: false; error: string }> {
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.from("wedding_guests").select("name, phone").eq("wedding_id", context.wedding.id).limit(5000);
    if (error) return { ok: false, error: GENERIC_ERROR };
    return { ok: true, guests: (data ?? []) as { name: string; phone: string | null }[] };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
type LinkResult = { ok: true; path: string } | { ok: false; error: string };
const MIGRATION_ERROR = "Los enlaces personales requieren aplicar la migración de invitaciones en Supabase.";

/**
 * Emite un token nuevo (256 bits) y guarda solo su hash vía la RPC definer
 * `issue_guest_token`, que comprueba que el invitado es de la boda del usuario.
 * No se exporta: en un archivo "use server" cada export es un endpoint.
 */
async function issueLink(guestId: string, mode: "regenerate" | "reminder" | "invite", notAllowed: string): Promise<LinkResult> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: GENERIC_ERROR };
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const { data, error } = await context.supabase.rpc("issue_guest_token", { p_guest_id: guestId, p_token_hash: hash, p_mode: mode });
    if (error?.code === "PGRST202" || error?.code === "42883") return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (!Array.isArray(data) || data.length !== 1) return { ok: false, error: notAllowed };
    if (mode === "regenerate") refresh();
    return { ok: true, path: `/b/${context.wedding.slug}?invitacion=${token}` };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Crear / Regenerar enlace»: revoca TODOS los enlaces activos de esa persona,
 * crea uno y quita la marca de «enviada» (hay que volver a confirmarlo).
 */
export async function createGuestInvitation(guestId: string): Promise<LinkResult> {
  return issueLink(guestId, "regenerate", GENERIC_ERROR);
}

/**
 * Enlace para el envío en serie (plan maestro §4.1, /panel/invitados/enviar):
 * modo 'invite' (20261022100000). AÑADE un enlace sin revocar ninguno, deja la
 * invitación preparada y no la marca como enviada. Abrir WhatsApp dos veces
 * con la misma persona (p. ej. tras la recarga de iOS al volver) no deja sin
 * acceso el enlace que ya está en el chat, y quien tenía un enlace preparado
 * desde la lista lo conserva. Solo sin el envío confirmado.
 *
 * Sin la migración aplicada, la RPC no emite nada: entonces, y solo si la
 * persona nunca ha tenido enlace (no hay nada que revocar), se usa
 * 'regenerate', como «Crear su enlace» en la lista.
 */
export async function createSeriesInvitation(guestId: string): Promise<LinkResult> {
  const notAllowed = "Ya habéis confirmado el envío a esta persona.";
  const result = await issueLink(guestId, "invite", notAllowed);
  if (result.ok || result.error !== notAllowed) return result;
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: GENERIC_ERROR };
    const { data } = await context.supabase.from("wedding_guests")
      .select("invitation_prepared_at, invitation_sent_at")
      .eq("id", guestId).eq("wedding_id", context.wedding.id).maybeSingle();
    const row = data as { invitation_prepared_at: string | null; invitation_sent_at: string | null } | null;
    if (!row) return { ok: false, error: "Esta persona ya no está en vuestra lista." };
    if (row.invitation_sent_at) return result;
    if (row.invitation_prepared_at === null) return issueLink(guestId, "regenerate", GENERIC_ERROR);
    return { ok: false, error: "Ya tiene un enlace preparado. Abrid su ficha en la lista para mandárselo." };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Sí, enviada» del envío en serie: lo mismo que confirmInvitationSent, pero
 * SIN revalidatePath. Con revalidación, la respuesta de la acción trae la
 * página entera re-renderizada y retrasa el paso a la siguiente persona (su
 * hoja con el mensaje, whatsapp-compose.tsx). La fila vuelve a leerse del
 * servidor al cambiar la URL (página dinámica).
 */
export async function confirmSeriesInvitationSent(guestId: string): Promise<GuestActionResult> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: GENERIC_ERROR };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ invitation_sent_at: new Date().toISOString() })
      .eq("id", guestId).eq("wedding_id", context.wedding.id)
      .not("invitation_prepared_at", "is", null).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha guardado: abrid antes WhatsApp con su enlace." };
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** Declaración de la pareja: WhatsApp no confirma envíos a la web. */
export async function confirmInvitationSent(guestId: string): Promise<GuestActionResult> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: GENERIC_ERROR };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ invitation_sent_at: new Date().toISOString() })
      .eq("id", guestId).eq("wedding_id", context.wedding.id)
      .not("invitation_prepared_at", "is", null).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "Cread primero un enlace personal para este invitado." };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const moveSchema = z.object({
  ids: z.array(z.uuid()).min(1, "Elegid al menos a un invitado.").max(MAX_GROUP_MOVE, `Podéis mover hasta ${MAX_GROUP_MOVE} invitados a la vez.`),
  group: groupSchema(),
});

/**
 * «Mover a grupo…» desde la selección múltiple de la lista. Solo invitados de
 * la boda de la sesión (`.eq("wedding_id")` + RLS): los ids ajenos o borrados
 * no se tocan y se cuentan en `missing`. group "" = quitarles el grupo.
 * No toca updated_at: «lo último» del resumen sigue siendo de respuestas.
 */
export async function setGuestsGroup(guestIds: string[], group: string): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }> {
  const parsed = moveSchema.safeParse({ ids: Array.isArray(guestIds) ? Array.from(new Set(guestIds)) : guestIds, group });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ group_name: parsed.data.group })
      .in("id", parsed.data.ids).eq("wedding_id", context.wedding.id).select("id");
    if (missingGroupColumn(error)) return { ok: false, error: GROUPS_MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const moved = Array.isArray(data) ? data.length : 0;
    if (moved === 0) return { ok: false, error: "No se ha movido a nadie: esos invitados ya no están en vuestra lista." };
    refresh();
    return { ok: true, moved, missing: parsed.data.ids.length - moved };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const tagListSchema = z.array(z.string().max(200)).max(TAGS_PER_GUEST * 2)
  .refine((list) => list.every((tag) => (normalizeTag(tag) ?? "").length <= TAG_MAX), TAG_TOO_LONG)
  .transform((list) => normalizeTags(list));
const tagMoveSchema = z.object({
  ids: z.array(z.uuid()).min(1, "Elegid al menos a un invitado.").max(MAX_TAG_MOVE, `Podéis etiquetar hasta ${MAX_TAG_MOVE} invitados a la vez.`),
  add: tagListSchema,
  remove: tagListSchema,
}).refine((value) => value.add.length + value.remove.length > 0, "Elegid alguna etiqueta que añadir o quitar.");

/**
 * «Etiquetar…» desde la selección múltiple: añade y quita etiquetas a todos
 * los elegidos en UNA escritura (RPC set_guest_tags: owns_wedding + RLS, solo
 * invitados de la boda de la sesión). Lo añadido reutiliza la forma ya usada
 * en la boda; quien llegue a 8 se queda con las que tenía. `changed` = cuántos
 * cambiaron (0 si ya las tenían).
 */
export async function setGuestsTags(guestIds: string[], change: { add?: string[]; remove?: string[] }): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const parsed = tagMoveSchema.safeParse({ ids: Array.isArray(guestIds) ? Array.from(new Set(guestIds)) : guestIds, add: change?.add ?? [], remove: change?.remove ?? [] });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.rpc("set_guest_tags", { p_wedding_id: context.wedding.id, p_ids: parsed.data.ids, p_add: parsed.data.add, p_remove: parsed.data.remove });
    if (missingFunction(error)) return { ok: false, error: TAGS_MIGRATION_ERROR };
    if (error?.code === "22023") return { ok: false, error: TAG_TOO_LONG };
    if (error) return { ok: false, error: GENERIC_ERROR };
    refresh(); revalidatePath("/panel/mesas");
    return { ok: true, changed: typeof data === "number" ? data : 0 };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** «Lado…» desde la selección múltiple. side null = sin indicar. Solo invitados de la boda de la sesión. */
export async function setGuestsSide(guestIds: string[], side: GuestSide | null): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }> {
  const parsed = z.object({
    ids: z.array(z.uuid()).min(1, "Elegid al menos a un invitado.").max(MAX_TAG_MOVE, `Podéis cambiar hasta ${MAX_TAG_MOVE} invitados a la vez.`),
    side: z.enum(GUEST_SIDES).nullable(),
  }).safeParse({ ids: Array.isArray(guestIds) ? Array.from(new Set(guestIds)) : guestIds, side });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ side: parsed.data.side })
      .in("id", parsed.data.ids).eq("wedding_id", context.wedding.id).select("id");
    if (missingGroupColumn(error)) return { ok: false, error: TAGS_MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const moved = Array.isArray(data) ? data.length : 0;
    if (moved === 0) return { ok: false, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
    refresh(); revalidatePath("/panel/mesas");
    return { ok: true, moved, missing: parsed.data.ids.length - moved };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Acompañantes máximos…» desde la selección múltiple. max null = sin límite
 * (hasta 10); 0 = solo esa persona. Solo invitados de la boda de la sesión.
 * No toca la respuesta que ya hayan dado: el tope vale para la próxima.
 */
export async function setGuestsMaxCompanions(guestIds: string[], max: number | null): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }> {
  const parsed = z.object({
    ids: z.array(z.uuid()).min(1, "Elegid al menos a un invitado.").max(MAX_TAG_MOVE, `Podéis cambiar hasta ${MAX_TAG_MOVE} invitados a la vez.`),
    max: maxCompanionsSchema(),
  }).safeParse({ ids: Array.isArray(guestIds) ? Array.from(new Set(guestIds)) : guestIds, max });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ max_companions: parsed.data.max })
      .in("id", parsed.data.ids).eq("wedding_id", context.wedding.id).select("id");
    if (missingGroupColumn(error)) return { ok: false, error: LIMITS_MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const moved = Array.isArray(data) ? data.length : 0;
    if (moved === 0) return { ok: false, error: "No se ha cambiado a nadie: esos invitados ya no están en vuestra lista." };
    refresh();
    return { ok: true, moved, missing: parsed.data.ids.length - moved };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * «Gestionar etiquetas»: renombra una etiqueta en todos los invitados de la
 * boda (sin distinguir mayúsculas; si alguien ya tenía la nueva, se fusionan).
 * to "" = quitarla a todos. RPC rename_guest_tag (owns_wedding + RLS).
 */
export async function renameTag(from: string, to: string): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const parsed = z.object({
    from: z.string().max(200).transform(normalizeTag).refine((value): value is string => value !== null, "Elegid la etiqueta."),
    to: z.string().max(200).transform((value) => normalizeTag(value) ?? "").refine((value) => value.length <= TAG_MAX, TAG_TOO_LONG),
  }).safeParse({ from, to });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
    const { data, error } = await context.supabase.rpc("rename_guest_tag", { p_wedding_id: context.wedding.id, p_from: parsed.data.from, p_to: parsed.data.to });
    if (missingFunction(error)) return { ok: false, error: TAGS_MIGRATION_ERROR };
    if (error?.code === "22023") return { ok: false, error: TAG_TOO_LONG };
    if (error) return { ok: false, error: GENERIC_ERROR };
    refresh(); revalidatePath("/panel/mesas");
    return { ok: true, changed: typeof data === "number" ? data : 0 };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * Enlace para el recordatorio: AÑADE un token activo sin revocar los
 * anteriores (el enlace del mensaje de invitación sigue funcionando) y no toca
 * invitation_prepared_at. Solo para quien ya tiene el envío confirmado o
 * abrió su enlace personal: la RPC acepta la apertura como entrega
 * (20261101120000) sin escribir nada en la ficha.
 */
export async function createReminderLink(guestId: string): Promise<LinkResult> {
  return issueLink(guestId, "reminder", "Confirmad antes el envío de la invitación a esta persona.");
}

/**
 * Buscar personas de la lista por nombre (revisión de código 2026-10-06, R05):
 * el selector «De parte de» de los regalos de grupo pregunta aquí mientras se
 * escribe, en vez de recibir la lista entera en cada carga. Máximo 20, solo
 * de la boda de la sesión (RLS + wedding_id).
 */
export async function searchGuestDirectory(query: unknown): Promise<{ id: string; name: string }[]> {
  const parsed = z.string().trim().min(1).max(80).safeParse(query);
  if (!parsed.success) return [];
  const own = await ownWedding();
  if (!own) return [];
  // Comodines de ILIKE escapados: lo que escribe la pareja se busca tal cual.
  const needle = parsed.data.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await own.supabase.from("wedding_guests").select("id, name")
    .eq("wedding_id", own.wedding.id).ilike("name", `%${needle}%`)
    .order("name", { ascending: true }).order("id", { ascending: true }).limit(20);
  return error || !data ? [] : (data as { id: string; name: string }[]);
}
