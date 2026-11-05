"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { getAllGuestsForFilter, getGuestCompanionLimits, getGuestExtraFields, getGuestLogisticNotes } from "@/lib/data/attendance";
import { parseGroupFilter, type GroupFilter } from "@/lib/crm/groups";
import { SIDE_LABELS, parseSideFilter, parseTagFilter, type SideFilter } from "@/lib/crm/tags";
import { normalizeGuestListFilter } from "@/lib/messages/filters";
import { buildGuestCsv } from "@/lib/messages/guest-csv";
import { getMenuForCsv, getModuleAnswers } from "@/lib/data/module-answers";
import {
  coupleNames, defaultTemplate, formatWeddingDate, isTemplateKind, MESSAGE_KINDS, validateTemplate,
  type MessageContext, type MessageKind, type TemplateKind,
} from "@/lib/messages/templates";
import { THANKS_TEMPLATE_KIND } from "@/lib/crm/contract";

/*
 * Plantillas, recordatorios confirmados por la pareja y exportación CSV.
 * Nada aquí envía mensajes: la pareja los envía desde su WhatsApp y nos dice
 * que lo ha hecho. Ningún estado significa «entregado» ni «leído».
 */

export type MessageActionResult = { ok: true } | { ok: false; error: string };
export type MessageTemplateState = { body: string; isDefault: boolean; updatedAt: string | null };
export type MessageTemplatesResult =
  | {
    ok: true;
    templates: Record<MessageKind, MessageTemplateState>;
    /** Agradecimiento por un regalo (kind «thanks»): aparte para no ampliar el Record anterior. */
    thanks: MessageTemplateState;
    context: MessageContext;
  }
  | { ok: false; error: string };
export type ConfirmReminderResult = { ok: true; lastReminderAt: string; reminderCount: number } | { ok: false; error: string };
export type GuestCsvResult = { ok: true; csv: string; filename: string; rows: number } | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";

/** No se exporta: en un archivo "use server" cada export es un endpoint. */
async function ownWedding() {
  const current = await getCurrentWedding();
  if (!current) return null;
  const { supabase } = current;
  const { data, error } = await supabase.from("weddings")
    .select("id, partner_name_1, partner_name_2, wedding_date")
    .eq("id", current.wedding.id).maybeSingle();
  return error || !data ? null : { supabase, wedding: data as { id: string; partner_name_1: string; partner_name_2: string; wedding_date: string | null } };
}
function refreshGuests() { revalidatePath("/panel/invitados"); revalidatePath("/panel"); }

/** Las plantillas (guardada o la de Vinklo), incluido el agradecimiento, + datos para la vista previa. */
export async function getMessageTemplates(): Promise<MessageTemplatesResult> {
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_message_templates")
      .select("kind, body, updated_at").eq("wedding_id", context.wedding.id);
    if (error) return { ok: false, error: "No hemos podido cargar los mensajes. Probad de nuevo." };
    const saved = new Map((data ?? []).map((row: { kind: string; body: string; updated_at: string }) => [row.kind, row]));
    const state = (kind: TemplateKind): MessageTemplateState => {
      const row = saved.get(kind);
      return row && validateTemplate(row.body, kind).ok
        ? { body: row.body, isDefault: false, updatedAt: row.updated_at }
        : { body: defaultTemplate(kind), isDefault: true, updatedAt: null };
    };
    const templates = Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, state(kind)])) as Record<MessageKind, MessageTemplateState>;
    return {
      ok: true,
      templates,
      thanks: state(THANKS_TEMPLATE_KIND),
      context: {
        novios: coupleNames(context.wedding.partner_name_1, context.wedding.partner_name_2),
        fecha: formatWeddingDate(context.wedding.wedding_date),
      },
    };
  } catch { return { ok: false, error: "No hemos podido cargar los mensajes. Probad de nuevo." }; }
}

export async function saveMessageTemplate(kind: TemplateKind, body: string): Promise<MessageActionResult> {
  if (!isTemplateKind(kind)) return { ok: false, error: GENERIC_ERROR };
  const valid = validateTemplate(body, kind);
  if (!valid.ok) return valid;
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    // Update y, si no hay fila, insert: un upsert de PostgREST pediría grant de
    // update sobre wedding_id/kind, que no se concede.
    const table = () => context.supabase.from("wedding_message_templates");
    const update = () => table().update({ body: valid.body, updated_at: new Date().toISOString() })
      .eq("wedding_id", context.wedding.id).eq("kind", kind).select("kind").maybeSingle();
    const updated = await update();
    if (updated.error) return { ok: false, error: GENERIC_ERROR };
    if (!updated.data) {
      const inserted = await table().insert({ wedding_id: context.wedding.id, kind, body: valid.body });
      // 23505: otra pestaña la creó a la vez; se reintenta como update.
      if (inserted.error?.code === "23505") {
        const retry = await update();
        if (retry.error || !retry.data) return { ok: false, error: GENERIC_ERROR };
      } else if (inserted.error) return { ok: false, error: GENERIC_ERROR };
    }
    revalidatePath("/panel/ajustes"); refreshGuests();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** «Volver al texto de Vinklo»: borrar la fila = usar el texto por defecto. */
export async function resetMessageTemplate(kind: TemplateKind): Promise<MessageActionResult> {
  if (!isTemplateKind(kind)) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { error } = await context.supabase.from("wedding_message_templates")
      .delete().eq("wedding_id", context.wedding.id).eq("kind", kind);
    if (error) return { ok: false, error: GENERIC_ERROR };
    revalidatePath("/panel/ajustes"); refreshGuests();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/**
 * La pareja dice que ha enviado el recordatorio desde su WhatsApp. Atómico en
 * SQL (`confirm_guest_reminder`): fija last_reminder_at, suma 1 y no vuelve a
 * sumar si se pulsa otra vez en 60 s. Exige invitación entregada (envío
 * confirmado o, desde 20261101120000, apertura del enlace; no escribe el
 * envío) y pertenencia.
 */
export async function confirmReminderSent(guestId: string): Promise<ConfirmReminderResult> {
  if (!z.uuid().safeParse(guestId).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.rpc("confirm_guest_reminder", { p_guest_id: guestId }).maybeSingle();
    const row = data as { last_reminder_at: string; reminder_count: number } | null;
    if (error || !row) return { ok: false, error: "No se ha guardado: confirmad antes el envío de la invitación a esta persona." };
    refreshGuests();
    return { ok: true, lastReminderAt: row.last_reminder_at, reminderCount: row.reminder_count };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** «No enviarle recordatorios»: la saca de la fila y del filtro «Para recordar». */
export async function setRemindersOptOut(guestId: string, optOut: boolean): Promise<MessageActionResult> {
  if (!z.uuid().safeParse(guestId).success || typeof optOut !== "boolean") return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_guests")
      .update({ reminders_opt_out: optOut })
      .eq("id", guestId).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha guardado: el invitado ya no está disponible." };
    refreshGuests();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** CSV del filtro activo (+ búsqueda), mismo predicado SQL que la lista. */
export async function exportGuestsCsv(filter: string, search = "", group?: GroupFilter, extra?: { tag?: string | null; side?: SideFilter }): Promise<GuestCsvResult> {
  const key = normalizeGuestListFilter(filter);
  const query = typeof search === "string" ? search.trim().slice(0, 120) : "";
  // El grupo llega del cliente: se reconstruye (nunca se usa el objeto tal cual).
  const groupFilter = parseGroupFilter(group?.kind === "none" ? { singrupo: "1" } : { grupo: group?.kind === "named" ? group.name : undefined });
  // Igual con la etiqueta y el lado (20261020100000).
  const tag = parseTagFilter(extra?.tag);
  const side = parseSideFilter(extra?.side === "none" ? "sin" : extra?.side);
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const rows = await getAllGuestsForFilter(context.supabase, context.wedding.id, key, query, groupFilter, { tag, side });
    if (!rows) return { ok: false, error: "No hemos podido preparar el archivo. Probad de nuevo." };
    // Tope de acompañantes (20261021110000): lectura aparte; sin la migración, la celda va vacía.
    // Nota logística (20261030100000), igual: sin la migración, la celda va vacía.
    // Menú (P1-6): solo si la boda lo pregunta; si no, el CSV sale sin esa columna.
    // Campos propios del Excel (20261031100000), igual: sin la migración, sin esas columnas.
    // Vegetarianos/veganos (ítem 21) viven en las respuestas: se leen aunque la boda no pregunte menú.
    const [limits, logistic, menu, extras] = await Promise.all([
      getGuestCompanionLimits(context.supabase, context.wedding.id),
      getGuestLogisticNotes(context.supabase, context.wedding.id),
      getMenuForCsv(context.supabase, context.wedding.id),
      getGuestExtraFields(context.supabase, context.wedding.id),
    ]);
    // Con menú ya vienen; sin menú, una lectura más (solo quien viene).
    const answerRows = menu ? null : await getModuleAnswers(context.supabase, context.wedding.id);
    const answers = menu?.answers ?? (answerRows ? new Map(answerRows.map((row) => [row.id, row.answers])) : null);
    const withLimits = rows.map((row) => ({
      ...row,
      ...(limits ? { max_companions: limits.get(row.id) ?? null } : {}),
      ...(logistic ? { rsvp_logistic_notes: logistic.get(row.id) ?? null } : {}),
      ...(answers ? { rsvp_answers: answers.get(row.id) ?? null } : {}),
      ...(extras?.get(row.id) ? { extra_fields: extras.get(row.id) } : {}),
    }));
    const labels = SIDE_LABELS(context.wedding.partner_name_1, context.wedding.partner_name_2);
    const scoped = groupFilter.kind !== "all" ? "-grupo" : tag ? "-etiqueta" : side ? "-lado" : "";
    return { ok: true, csv: buildGuestCsv(withLimits, labels, menu?.labels ?? null), filename: `invitados-${key.replace(/_/g, "-")}${scoped}-vinklo.csv`, rows: rows.length };
  } catch { return { ok: false, error: "No hemos podido preparar el archivo. Probad de nuevo." }; }
}
