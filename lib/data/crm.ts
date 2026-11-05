import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  GIFT_KINDS, type CrmFunnelSummary, type CrmGiftSummary, type Gift, type GiftKind,
} from "@/lib/crm/contract";

/*
 * Lecturas del CRM (CrmReads de lib/crm/contract.ts). Todo se agrega en
 * Postgres (crm_funnel_summary, crm_gift_summary, wedding_gift_list): invoker
 * + couple_id, así que una boda ajena devuelve 0 filas. Cliente de sesión,
 * nunca service role. Las variantes *For(supabase, weddingId) sirven a páginas
 * que ya tienen cliente y boda (como lib/data/attendance.ts).
 */

const count = z.coerce.number().int().nonnegative();

const funnelSchema = z.object({
  added: count, prepared: count, sent: count, opened: count, responded: count,
  yes: count, no: count, attendees: count,
  not_sent: count, sent_unopened: count, opened_unanswered: count, to_remind: count,
});

const kindTotalsSchema = z.object({ count, totalCents: count });
const giftSummarySchema = z.object({
  gift_count: count, total_cents: count, with_amount: count, unthanked: count,
  by_kind: z.partialRecord(z.enum(GIFT_KINDS), kindTotalsSchema),
  guests_yes: count, guests_no: count, guests_unknown: count,
});

const giftRowSchema = z.object({
  id: z.string(),
  kind: z.enum(GIFT_KINDS),
  amount_cents: count.nullable(),
  description: z.string().nullable(),
  note: z.string().nullable(),
  received_on: z.string().nullable(),
  thanked_at: z.string().nullable(),
  created_at: z.string(),
  // Sin .min(1): tras la retención (20261026100000) un regalo se queda sin
  // regalantes y debe seguir saliendo en la lista y en el CSV.
  givers: z.array(z.object({ guestId: z.string(), name: z.string() })),
});

/** Boda de la sesión (por membresía: cualquiera de los dos novios). */
async function sessionWedding(): Promise<{ supabase: SupabaseClient; weddingId: string } | null> {
  const current = await getCurrentWedding();
  return current ? { supabase: current.supabase, weddingId: current.wedding.id } : null;
}

export function mapFunnel(row: z.infer<typeof funnelSchema>): CrmFunnelSummary {
  return {
    reached: { added: row.added, prepared: row.prepared, sent: row.sent, opened: row.opened, responded: row.responded },
    responses: { yes: row.yes, no: row.no },
    attendees: row.attendees,
    pending: { not_sent: row.not_sent, sent_unopened: row.sent_unopened, opened_unanswered: row.opened_unanswered },
    toRemind: row.to_remind,
  };
}

export function mapGiftSummary(row: z.infer<typeof giftSummarySchema>): CrmGiftSummary {
  const byKind = Object.fromEntries(GIFT_KINDS.map((kind) => [kind, row.by_kind[kind] ?? { count: 0, totalCents: 0 }])) as Record<GiftKind, { count: number; totalCents: number }>;
  return {
    count: row.gift_count,
    totalCents: row.total_cents,
    withAmount: row.with_amount,
    byKind,
    unthanked: row.unthanked,
    guests: { yes: row.guests_yes, no: row.guests_no, unknown: row.guests_unknown },
  };
}

export async function getCrmFunnelFor(supabase: SupabaseClient, weddingId: string): Promise<CrmFunnelSummary | null> {
  const { data, error } = await supabase.rpc("crm_funnel_summary", { p_wedding_id: weddingId }).maybeSingle();
  if (error || !data) return null;
  const parsed = funnelSchema.safeParse(data);
  return parsed.success ? mapFunnel(parsed.data) : null;
}

export async function getGiftSummaryFor(supabase: SupabaseClient, weddingId: string): Promise<CrmGiftSummary | null> {
  const { data, error } = await supabase.rpc("crm_gift_summary", { p_wedding_id: weddingId }).maybeSingle();
  if (error || !data) return null;
  const parsed = giftSummarySchema.safeParse(data);
  return parsed.success ? mapGiftSummary(parsed.data) : null;
}

/** null = error de lectura (para distinguirlo de «sin regalos»). */
export async function listGiftsFor(supabase: SupabaseClient, weddingId: string): Promise<Gift[] | null> {
  const { data, error } = await supabase.rpc("wedding_gift_list", { p_wedding_id: weddingId });
  if (error) return null;
  const parsed = z.array(giftRowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    description: row.description,
    note: row.note,
    receivedOn: row.received_on,
    thankedAt: row.thanked_at,
    givers: row.givers,
    createdAt: row.created_at,
  }));
}

/**
 * Regalos de una página de invitados (R05, 20261022110000): los regalos en
 * los que participa alguno de `guestIds`, con todos sus regalantes. Sin la
 * migración, cae a la lista completa filtrada aquí (mismo resultado, más
 * lectura). null = la lectura falló.
 */
export async function listGiftsForGuests(supabase: SupabaseClient, weddingId: string, guestIds: string[]): Promise<Gift[] | null> {
  if (guestIds.length === 0) return [];
  const { data, error } = await supabase.rpc("wedding_gift_list_for", { p_wedding_id: weddingId, p_guest_ids: guestIds });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") return null;
    const all = await listGiftsFor(supabase, weddingId);
    const ids = new Set(guestIds);
    return all === null ? null : all.filter((gift) => gift.givers.some((giver) => ids.has(giver.guestId)));
  }
  const parsed = z.array(giftRowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    description: row.description,
    note: row.note,
    receivedOn: row.received_on,
    thankedAt: row.thanked_at,
    givers: row.givers,
    createdAt: row.created_at,
  }));
}

/** Embudo de invitados. null = sin sesión, error o migración sin aplicar. */
export async function getCrmFunnel(): Promise<CrmFunnelSummary | null> {
  try {
    const context = await sessionWedding();
    return context ? await getCrmFunnelFor(context.supabase, context.weddingId) : null;
  } catch { return null; }
}

/** Resumen de regalos. null = sin sesión, error o migración sin aplicar. */
export async function getGiftSummary(): Promise<CrmGiftSummary | null> {
  try {
    const context = await sessionWedding();
    return context ? await getGiftSummaryFor(context.supabase, context.weddingId) : null;
  } catch { return null; }
}

/** Regalos con sus invitados, más recientes primero. [] también si falla (contrato); usad listGiftsFor para distinguirlo. */
export async function listGifts(): Promise<Gift[]> {
  try {
    const context = await sessionWedding();
    if (!context) return [];
    return (await listGiftsFor(context.supabase, context.weddingId)) ?? [];
  } catch { return []; }
}
