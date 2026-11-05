"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  GIFT_DESCRIPTION_MAX, GIFT_KINDS, GIFT_MAX_AMOUNT_CENTS, GIFT_NOTE_MAX, MONETARY_GIFT_KINDS,
  type ActionResult, type GiftInput,
} from "@/lib/crm/contract";
import { listGiftsFor } from "@/lib/data/crm";
import { buildGiftCsv, GIFT_CSV_FILENAME, type GiftCsvResult } from "@/lib/messages/gift-csv";

/*
 * Regalos que la pareja ANOTA a mano (CrmActions de lib/crm/contract.ts).
 * No es un cobro: nada aquí toca pagos ni avisa al invitado. Cliente de
 * sesión siempre (RLS owns_wedding + couple_id); el wedding_id sale de la
 * sesión, nunca del cliente. Crear/editar regalo + invitados es UNA llamada
 * SQL (create_wedding_gift / update_wedding_gift): nunca queda un regalo sin
 * invitados.
 */

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const MIGRATION_ERROR = "Los regalos requieren aplicar la migración del CRM en Supabase.";
const GONE_ERROR = "Este regalo ya no está disponible. Recargad la página.";

const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).nullish().transform((value) => (value ? value : null));

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Revisad la fecha.").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= "2000-01-01" && value <= "2100-12-31";
}, "Revisad la fecha.");

const giftSchema = z.object({
  guestIds: z.array(z.uuid("Algún invitado no es válido. Recargad la página."), "Elegid quién os lo ha regalado.")
    .min(1, "Elegid al menos un invitado.")
    .max(50, "Como máximo 50 invitados por regalo.")
    .refine((ids) => new Set(ids).size === ids.length, "Hay un invitado repetido."),
  kind: z.enum(GIFT_KINDS, "Elegid un tipo de regalo."),
  amountCents: z.number("Revisad el importe.").int("Revisad el importe.")
    .min(0, "El importe no puede ser negativo.")
    .max(GIFT_MAX_AMOUNT_CENTS, "El importe máximo es 100.000 €.")
    .nullish(),
  description: optionalText(GIFT_DESCRIPTION_MAX, `La descripción puede tener como máximo ${GIFT_DESCRIPTION_MAX} caracteres.`),
  note: optionalText(GIFT_NOTE_MAX, `La nota puede tener como máximo ${GIFT_NOTE_MAX} caracteres.`),
  receivedOn: isoDay.nullish(),
}).transform((gift) => ({
  ...gift,
  // Importe solo en transferencia, Bizum o efectivo (también lo exige un CHECK en SQL).
  amountCents: MONETARY_GIFT_KINDS.includes(gift.kind) ? gift.amountCents ?? null : null,
  receivedOn: gift.receivedOn ?? null,
}));

type ParsedGift = z.output<typeof giftSchema>;

function parseGift(input: GiftInput): { ok: true; gift: ParsedGift } | { ok: false; error: string } {
  const parsed = giftSchema.safeParse(input);
  return parsed.success ? { ok: true, gift: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
}

function rpcArgs(gift: ParsedGift) {
  return {
    p_guest_ids: gift.guestIds, p_kind: gift.kind, p_amount_cents: gift.amountCents,
    p_description: gift.description, p_note: gift.note, p_received_on: gift.receivedOn,
  };
}

const isMissingMigration = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42883" || error?.code === "42P01";

/** No se exporta: en un archivo "use server" cada export es un endpoint. */
/** La boda de la sesión: un único sitio (lib/data/current-wedding, R06). */
async function ownWedding() {
  const current = await getCurrentWedding();
  return current ? { supabase: current.supabase, weddingId: current.wedding.id } : null;
}
function refresh() { revalidatePath("/panel"); revalidatePath("/panel/invitados"); }

export async function createGift(input: GiftInput): Promise<ActionResult<{ id: string }>> {
  const parsed = parseGift(input);
  if (!parsed.ok) return parsed;
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("create_wedding_gift", { p_wedding_id: context.weddingId, ...rpcArgs(parsed.gift) });
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (typeof data !== "string") return { ok: false, error: "Algún invitado ya no está en vuestra lista. Recargad la página." };
    refresh();
    return { ok: true, data: { id: data } };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function updateGift(id: string, input: GiftInput): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GONE_ERROR };
  const parsed = parseGift(input);
  if (!parsed.ok) return parsed;
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("update_wedding_gift", { p_gift_id: id, ...rpcArgs(parsed.gift) });
    if (isMissingMigration(error)) return { ok: false, error: MIGRATION_ERROR };
    if (error) return { ok: false, error: GENERIC_ERROR };
    if (data !== true) return { ok: false, error: "No se ha guardado: el regalo o algún invitado ya no está disponible. Recargad la página." };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function deleteGift(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GONE_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_gifts").delete()
      .eq("id", id).eq("wedding_id", context.weddingId).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha eliminado: el regalo ya no está disponible." };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** Marca (o desmarca) el regalo como agradecido. El mensaje lo envía la pareja desde su WhatsApp. */
export async function setGiftThanked(id: string, thanked: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success || typeof thanked !== "boolean") return { ok: false, error: GONE_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_gifts")
      .update({ thanked_at: thanked ? new Date().toISOString() : null })
      .eq("id", id).eq("wedding_id", context.weddingId).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: GONE_ERROR };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** «Sin regalo» explícito. Solo para invitados sin regalos anotados (si tiene, manda el regalo). */
export async function setGuestNoGift(guestId: string, noGift: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(guestId).success || typeof noGift !== "boolean") return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    if (noGift) {
      const gifts = await context.supabase.from("wedding_gift_givers").select("gift_id")
        .eq("guest_id", guestId).eq("wedding_id", context.weddingId).limit(1);
      if (isMissingMigration(gifts.error)) return { ok: false, error: MIGRATION_ERROR };
      if (gifts.error) return { ok: false, error: GENERIC_ERROR };
      if (Array.isArray(gifts.data) && gifts.data.length > 0) {
        return { ok: false, error: "Este invitado ya tiene un regalo anotado. Borrad el regalo antes de marcarlo «sin regalo»." };
      }
    }
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ gift_none: noGift })
      .eq("id", guestId).eq("wedding_id", context.weddingId).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha guardado: el invitado ya no está disponible." };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * CSV de regalos y agradecimientos de la boda de la sesión (dueño o pareja,
 * por getCurrentWedding + RLS owns_wedding). Lo que la pareja se lleva antes
 * de la retención de 12 meses (20261026100000). Solo lectura.
 */
export async function exportGiftsCsv(): Promise<GiftCsvResult> {
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const gifts = await listGiftsFor(context.supabase, context.weddingId);
    if (!gifts) return { ok: false, error: "No hemos podido preparar el archivo. Probad de nuevo." };
    return { ok: true, csv: buildGiftCsv(gifts), filename: GIFT_CSV_FILENAME, rows: gifts.length };
  } catch { return { ok: false, error: "No hemos podido preparar el archivo. Probad de nuevo." }; }
}
