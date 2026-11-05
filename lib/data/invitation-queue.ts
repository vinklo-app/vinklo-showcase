import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GUEST_SIDES } from "@/lib/crm/tags";
import { sortInvitationQueue, splitInvitationQueue, type InvitationQueueItem } from "@/lib/messages/invitation-series";

/** Tope de personas que viajan a la fila de envío (una boda grande cabe entera). */
export const INVITATION_QUEUE_LIMIT = 600;

const rowSchema = z.object({
  id: z.string(), name: z.string(), phone: z.string().nullable(),
  rsvp_status: z.enum(["pendiente", "si", "no"]).catch("pendiente"),
  invitation_prepared_at: z.string().nullable(),
  // CRM (20261008100000): null si la columna aún no existe.
  invitation_opened_at: z.string().nullable().default(null),
  // Grupos (20261012100000): null sin la migración.
  group_name: z.string().nullable().default(null),
  // Etiquetas y lado (20261020100000): [] / null sin la migración.
  tags: z.array(z.string()).nullable().default([]).transform((list) => list ?? []),
  side: z.enum(GUEST_SIDES).nullable().catch(null).default(null),
});

export interface InvitationQueue {
  /** Con teléfono válido para WhatsApp, sin el envío confirmado, sin abrir y sin responder, por grupo. */
  items: InvitationQueueItem[];
  /** Sin enviar pero sin un teléfono que sirva para WhatsApp (no entran en la fila). */
  withoutPhone: number;
}

/**
 * Fila «Enviar las invitaciones» (plan maestro §4.1): personas con teléfono,
 * sin `invitation_sent_at`, sin respuesta y sin haber abierto su enlace
 * (abrirlo prueba que ya la recibió: va a recordatorios, no a una invitación
 * nueva; revisión UX P0 #3 y P1 #14). `splitInvitationQueue` repite las dos
 * exclusiones por si la columna de aperturas aún no existe. Cliente de sesión (RLS) y `wedding_id` explícito.
 * Se reconstruye siempre desde el servidor: al volver de WhatsApp, iOS puede
 * recargar la página y la persona en curso sale de la URL, no de memoria.
 * Trae la fila entera (los filtros por grupo, etiqueta y lado se aplican
 * después, para contar cuántas personas hay en cada chip). null = la lectura falló.
 */
export async function getInvitationQueue(supabase: SupabaseClient, weddingId: string): Promise<InvitationQueue | null> {
  const select = (columns: string, withOpened = true) => {
    const query = supabase.from("wedding_guests").select(columns)
      .eq("wedding_id", weddingId).is("invitation_sent_at", null).eq("rsvp_status", "pendiente");
    return (withOpened ? query.is("invitation_opened_at", null) : query)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(INVITATION_QUEUE_LIMIT);
  };
  const missing = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
  const base = "id, name, phone, rsvp_status, invitation_prepared_at";
  let { data, error } = await select(`${base}, invitation_opened_at, group_name, tags, side`);
  // Sin etiquetas/lado o sin grupos (42703 / PGRST204): la fila va sin esas columnas.
  if (missing(error)) ({ data, error } = await select(`${base}, invitation_opened_at, group_name`));
  if (missing(error)) ({ data, error } = await select(`${base}, invitation_opened_at`));
  // Sin la columna de aperturas (anterior a 20261008100000): sin ese filtro.
  if (missing(error)) ({ data, error } = await select(base, false));
  if (error) return null;
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  const { items, withoutPhone } = splitInvitationQueue(parsed.data);
  return { items: sortInvitationQueue(items), withoutPhone };
}
