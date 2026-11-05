import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getReminderQueue, REMINDER_QUEUE_LIMIT, type ReminderQueueItem } from "@/lib/data/attendance";
import { reminderPeriod, selectReminders, type ReminderPeriod } from "@/lib/messages/reminder-rules";

/** Tope de lectura (el mismo máximo que acepta `reminder_queue`). */
const FETCH_LIMIT = 1000;

/**
 * Una persona de la fila. `invitation_sent_at` es la fecha de ENTREGA:
 * «sent» = envío confirmado por la pareja; «opened» = sin confirmar, pero
 * abrió su enlace (la fila dice «Abrió su invitación el…»). Nada de esto se
 * escribe en la ficha: lo deduce `reminder_queue` (20261101120000).
 */
export type ReminderQueueEntry = ReminderQueueItem;

export interface ReminderQueueResult {
  items: ReminderQueueEntry[];
  /** Cuántas personas están para recordar (puede ser más que `items`). */
  total: number;
  period: ReminderPeriod;
}

const datesSchema = z.object({ wedding_date: z.string().nullable(), rsvp_deadline: z.string().nullable() });

/**
 * Plazo de la boda para los recordatorios. Si la lectura falla, se sigue
 * como «abierto sin fecha límite»: se mantienen los márgenes de 3 días.
 */
export async function getReminderPeriod(supabase: SupabaseClient, weddingId: string, now: Date = new Date()): Promise<ReminderPeriod> {
  const { data, error } = await supabase.from("weddings").select("wedding_date, rsvp_deadline").eq("id", weddingId).maybeSingle();
  const parsed = error ? null : datesSchema.safeParse(data);
  return reminderPeriod({ weddingDate: parsed?.success ? parsed.data.wedding_date : null, rsvpDeadline: parsed?.success ? parsed.data.rsvp_deadline : null }, now);
}

/**
 * Fila «Recordar a quien no ha respondido». La fuente es `reminder_queue`
 * (SQL): desde 20261101120000 ya cuenta la apertura como entrega y aplica el
 * plazo y los márgenes, igual que el chip «Para recordar» y los recuentos.
 * Las reglas de lib/messages/reminder-rules.ts se aplican también aquí, así
 * que con la base anterior a esa migración el resultado tampoco propone a
 * nadie fuera de plazo ni antes de tiempo (solo falta quien abrió sin envío
 * confirmado, que la RPC antigua no devuelve ni acepta).
 * null = la lectura de la RPC falló.
 */
export async function getReminderCandidates(supabase: SupabaseClient, weddingId: string, options: { group?: string | null; tag?: string | null; limit?: number; now?: Date } = {}): Promise<ReminderQueueResult | null> {
  const { group = null, tag = null, limit = REMINDER_QUEUE_LIMIT, now = new Date() } = options;
  const period = await getReminderPeriod(supabase, weddingId, now);
  if (period.status === "closed") return { items: [], total: 0, period };
  const queue = await getReminderQueue(supabase, weddingId, FETCH_LIMIT, group, tag);
  if (!queue) return null;
  const candidates = queue.items.map((item) => ({ ...item, rsvp_status: "pendiente" as const, invitation_opened_at: null }));
  const due = selectReminders(candidates, period, now);
  const items: ReminderQueueEntry[] = due.slice(0, limit).map((item) => ({
    id: item.id, name: item.name, phone: item.phone, invitation_sent_at: item.invitation_sent_at,
    last_reminder_at: item.last_reminder_at, reminder_count: item.reminder_count,
    group_name: item.group_name, tags: item.tags, delivered_by: item.delivered_by,
  }));
  return { items, total: due.length, period };
}
