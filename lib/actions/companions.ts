"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { COMPANIONS_MAX, COMPANION_NAME_MAX, normalizeCompanionName } from "@/lib/rsvp-companions";

/**
 * Ficha del invitado (§4.3 y §3.5): acompañantes con nombre y «No sentar
 * con…». Todas resuelven la boda con la sesión (getCurrentWedding), nunca
 * aceptan wedding_id del cliente y van con RLS (owns_wedding). Sin la
 * migración 20261023100000 devuelven `missing` y la ficha no muestra nada.
 * Solo exporta funciones async (Turbopack rechaza otra cosa en "use server").
 */
export interface GuestCompanion { id: string; name: string; isKid: boolean; byGuest: boolean; tableId: string | null }
export interface GuestApart { id: string; name: string }
export type ExtrasResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; missing?: boolean };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const MIGRATION_ERROR = "Los nombres de acompañantes requieren aplicar la migración de acompañantes en Supabase.";
const GONE_GUEST = "Ese invitado ya no está en vuestra lista. Actualizad la página.";
/** Tope de «No sentar con…» por invitado (la ficha no es una matriz). */
const APART_MAX = 20;

const missing = (error: { code?: string } | null) => ["PGRST205", "PGRST202", "PGRST204", "42P01", "42883", "42703"].includes(error?.code ?? "");

function refresh() { revalidatePath("/panel/mesas"); revalidatePath("/panel/invitados"); revalidatePath("/panel/dia"); }

const companionRow = z.object({ id: z.string(), name: z.string(), is_kid: z.boolean(), by_guest: z.boolean().catch(false), table_id: z.string().nullable() });
const toCompanion = (row: z.infer<typeof companionRow>): GuestCompanion => ({ id: row.id, name: row.name, isKid: row.is_kid, byGuest: row.by_guest, tableId: row.table_id });

/** Acompañantes con nombre y «No sentar con…» de un invitado. */
export async function getGuestExtras(guestId: string): Promise<ExtrasResult<{ companions: GuestCompanion[]; apart: GuestApart[] }>> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const [companions, pairs] = await Promise.all([
      supabase.from("wedding_guest_companions").select("id, name, is_kid, by_guest, table_id")
        .eq("wedding_id", wedding.id).eq("guest_id", guestId).order("position", { ascending: true }).order("id", { ascending: true }),
      supabase.from("wedding_guest_apart").select("guest_a, guest_b")
        .eq("wedding_id", wedding.id).or(`guest_a.eq.${guestId},guest_b.eq.${guestId}`).limit(200),
    ]);
    if (missing(companions.error) || missing(pairs.error)) return { ok: false, error: MIGRATION_ERROR, missing: true };
    if (companions.error || pairs.error) return { ok: false, error: GENERIC_ERROR };
    const others = ((pairs.data ?? []) as Array<{ guest_a: string; guest_b: string }>).map((pair) => (pair.guest_a === guestId ? pair.guest_b : pair.guest_a));
    let apart: GuestApart[] = [];
    if (others.length > 0) {
      const { data, error } = await supabase.from("wedding_guests").select("id, name").eq("wedding_id", wedding.id).in("id", others);
      if (error) return { ok: false, error: GENERIC_ERROR };
      apart = ((data ?? []) as GuestApart[]).sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    const rows = z.array(companionRow).safeParse(companions.data ?? []);
    if (!rows.success) return { ok: false, error: GENERIC_ERROR };
    return { ok: true, companions: rows.data.map(toCompanion), apart };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const listSchema = z.array(z.object({
  id: z.uuid().optional(),
  name: z.string().max(200).transform(normalizeCompanionName)
    .refine((value): value is string => value !== null, "Escribid el nombre de cada acompañante o quitad la fila."),
  kid: z.boolean(),
})).max(COMPANIONS_MAX, `Una invitación puede tener hasta ${COMPANIONS_MAX} acompañantes.`)
  .refine((list) => new Set(list.map((item) => (item.name ?? "").toLocaleLowerCase("es"))).size === list.length, "Hay dos acompañantes con el mismo nombre.")
  .refine((list) => list.every((item) => (item.name ?? "").length <= COMPANION_NAME_MAX), `Cada nombre puede tener hasta ${COMPANION_NAME_MAX} caracteres.`);

/**
 * Guarda la lista entera de acompañantes con nombre de una invitación (RPC
 * set_guest_companions: borra los que faltan, actualiza por id conservando su
 * mesa y crea los nuevos, en una transacción). Lo que guarda la pareja deja
 * de enseñarse al invitado al volver a su enlace.
 */
export async function saveGuestCompanions(guestId: string, list: Array<{ id?: string; name: string; kid: boolean }>): Promise<ExtrasResult<{ companions: GuestCompanion[] }>> {
  const parsed = z.object({ guestId: z.uuid(), list: listSchema }).safeParse({ guestId, list });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("set_guest_companions", {
      p_wedding_id: context.wedding.id,
      p_guest_id: parsed.data.guestId,
      p_list: parsed.data.list.map((item) => (item.id ? { id: item.id, name: item.name, kid: item.kid } : { name: item.name, kid: item.kid })),
    });
    if (missing(error)) return { ok: false, error: MIGRATION_ERROR, missing: true };
    if (error?.code === "42501") return { ok: false, error: GONE_GUEST };
    if (error) return { ok: false, error: GENERIC_ERROR };
    const rows = z.array(companionRow).safeParse(data ?? []);
    if (!rows.success) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true, companions: rows.data.map(toCompanion) };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

const pairSchema = z.object({ a: z.uuid(), b: z.uuid() }).refine((pair) => pair.a !== pair.b, "Elegid a otra persona.");
/** El par se guarda una vez, con el id menor primero (CHECK guest_a < guest_b). */
const ordered = (a: string, b: string) => (a < b ? { guest_a: a, guest_b: b } : { guest_a: b, guest_b: a });

/** «No sentar con…»: las mesas automáticas no sentarán juntos a estos dos. */
export async function addGuestApart(guestId: string, otherId: string): Promise<ExtrasResult> {
  const parsed = pairSchema.safeParse({ a: guestId, b: otherId });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { supabase, wedding } = context;
    const { count, error: countError } = await supabase.from("wedding_guest_apart").select("guest_a", { count: "exact", head: true })
      .eq("wedding_id", wedding.id).or(`guest_a.eq.${parsed.data.a},guest_b.eq.${parsed.data.a}`);
    if (missing(countError)) return { ok: false, error: MIGRATION_ERROR, missing: true };
    if (countError) return { ok: false, error: GENERIC_ERROR };
    if ((count ?? 0) >= APART_MAX) return { ok: false, error: `Podéis indicar hasta ${APART_MAX} personas por invitado.` };
    const { error } = await supabase.from("wedding_guest_apart").insert({ wedding_id: wedding.id, ...ordered(parsed.data.a, parsed.data.b) });
    // Ya estaba: no es un error para la pareja.
    if (error?.code === "23505") return { ok: true };
    if (error?.code === "23503") return { ok: false, error: GONE_GUEST };
    if (missing(error)) return { ok: false, error: MIGRATION_ERROR, missing: true };
    if (error) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function removeGuestApart(guestId: string, otherId: string): Promise<ExtrasResult> {
  const parsed = pairSchema.safeParse({ a: guestId, b: otherId });
  if (!parsed.success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await getCurrentWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const pair = ordered(parsed.data.a, parsed.data.b);
    const { error } = await context.supabase.from("wedding_guest_apart").delete()
      .eq("wedding_id", context.wedding.id).eq("guest_a", pair.guest_a).eq("guest_b", pair.guest_b);
    if (missing(error)) return { ok: false, error: MIGRATION_ERROR, missing: true };
    if (error) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
