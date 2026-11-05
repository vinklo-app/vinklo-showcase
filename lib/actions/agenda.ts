"use server";

/**
 * Agenda del día de la boda (logística para invitados): la pareja crea
 * los hitos — ceremonia, cóctel, banquete, autobuses. Cliente de sesión (no
 * admin): RLS con owns_wedding es la frontera real de autorización.
 *
 * Fase 1 (S-01): cada escritura reescribe el borrador de la web
 * (`syncDraftFromLegacy`); los invitados ven los cambios cuando la pareja
 * publica. Por eso aquí ya no se revalida /b/[slug]: solo publishSite lo hace.
 * Los límites de caracteres coinciden con los de la escena «agenda» del
 * documento (lib/site-document.ts) para que nada se trunque al publicar.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { syncDraftFromLegacy } from "@/lib/data/site";

export type AgendaActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Probad de nuevo.";

const itemSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Poned un título al momento (p. ej. «Ceremonia»).")
    .max(80, "El título es demasiado largo."),
  timeLabel: z.string().trim().max(20, "La hora es demasiado larga (máximo 20 caracteres).").optional().default(""),
  place: z.string().trim().max(160, "El lugar puede tener hasta 160 caracteres.").optional().default(""),
  address: z.string().trim().max(240, "La dirección puede tener hasta 240 caracteres.").optional().default(""),
  notes: z.string().trim().max(400, "Las notas pueden tener hasta 400 caracteres.").optional().default(""),
});

async function ownWeddingId(): Promise<{
  id: string;
  slug: string;
} | null> {
  // Por membresía: cualquiera de los dos novios (lib/data/current-wedding.ts).
  const current = await getCurrentWedding();
  return current?.wedding ?? null;
}

function nullify(v: string): string | null {
  return v === "" ? null : v;
}

export async function addAgendaItem(input: {
  title: string;
  timeLabel?: string;
  place?: string;
  address?: string;
  notes?: string;
}): Promise<AgendaActionResult> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? GENERIC_ERROR,
    };
  }
  const wedding = await ownWeddingId();
  if (!wedding) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createClient();
  // Al final de la lista: sort = máx + 1.
  const { data: last } = await supabase
    .from("wedding_agenda_items")
    .select("sort")
    .eq("wedding_id", wedding.id)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("wedding_agenda_items").insert({
    wedding_id: wedding.id,
    title: parsed.data.title,
    time_label: nullify(parsed.data.timeLabel),
    place: nullify(parsed.data.place),
    address: nullify(parsed.data.address),
    notes: nullify(parsed.data.notes),
    sort: (last?.sort ?? 0) + 1,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  await syncDraftFromLegacy(supabase, wedding.id);
  revalidatePath("/panel/dia");
  revalidatePath("/panel/ajustes");
  return { ok: true };
}

export async function updateAgendaItem(input: {
  id: string;
  title: string;
  timeLabel?: string;
  place?: string;
  address?: string;
  notes?: string;
}): Promise<AgendaActionResult> {
  if (!z.uuid().safeParse(input.id).success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? GENERIC_ERROR,
    };
  }
  const wedding = await ownWeddingId();
  if (!wedding) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createClient();
  // RLS limita a su boda; además se ata a wedding_id y se exige una fila
  // (si otra pestaña lo borró, no se dice «guardado» ni se toca el borrador).
  const { data: updated, error } = await supabase
    .from("wedding_agenda_items")
    .update({
      title: parsed.data.title,
      time_label: nullify(parsed.data.timeLabel),
      place: nullify(parsed.data.place),
      address: nullify(parsed.data.address),
      notes: nullify(parsed.data.notes),
    })
    .eq("id", input.id)
    .eq("wedding_id", wedding.id)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: GENERIC_ERROR };

  await syncDraftFromLegacy(supabase, wedding.id);
  revalidatePath("/panel/dia");
  revalidatePath("/panel/ajustes");
  return { ok: true };
}

export async function deleteAgendaItem(
  id: string,
): Promise<AgendaActionResult> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const wedding = await ownWeddingId();
  if (!wedding) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("wedding_agenda_items")
    .delete()
    .eq("id", id)
    .eq("wedding_id", wedding.id)
    .select("id")
    .maybeSingle();
  if (error || !deleted) return { ok: false, error: GENERIC_ERROR };

  await syncDraftFromLegacy(supabase, wedding.id);
  revalidatePath("/panel/dia");
  revalidatePath("/panel/ajustes");
  return { ok: true };
}
