"use server";

/**
 * «Recibir el resumen diario» (Ajustes, plan maestro §2.6). Cada miembro de
 * la boda decide por su correo: wedding_members.digest_opt_out de SU fila.
 *
 * - Leer: cliente de sesión (política wedding_members_select_self).
 * - Escribir: authenticated no tiene UPDATE en wedding_members, así que se
 *   usa service_role acotado a (boda de la sesión, usuario de la sesión);
 *   nunca a un id que venga del cliente.
 * Sin la migración 20261021100000 la tarjeta no aparece.
 *
 * Exports = endpoints: solo lo que llama la UI.
 */
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentWedding, isMissingMembership } from "@/lib/data/current-wedding";
import { createAdminClient } from "@/lib/supabase/admin";

export type DigestPrefState = { available: true; enabled: boolean } | { available: false };
export type DigestPrefResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Probad de nuevo en un momento.";

export async function getDigestPref(): Promise<DigestPrefState> {
  const current = await getCurrentWedding();
  if (!current) return { available: false };
  const { data, error } = await current.supabase
    .from("wedding_members")
    .select("digest_opt_out")
    .eq("wedding_id", current.wedding.id)
    .eq("user_id", current.userId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingMembership(error)) Sentry.captureMessage("digest pref: lectura fallida", { level: "warning", extra: { code: error.code } });
    return { available: false };
  }
  const row = data as { digest_opt_out?: boolean | null };
  return { available: true, enabled: row.digest_opt_out !== true };
}

export async function setDigestEnabled(enabled: unknown): Promise<DigestPrefResult> {
  const parsed = z.boolean().safeParse(enabled);
  if (!parsed.success) return { ok: false, error: GENERIC_ERROR };
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: "Volved a entrar para gestionar vuestra boda." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("wedding_members")
    .update({ digest_opt_out: !parsed.data })
    .eq("wedding_id", current.wedding.id)
    .eq("user_id", current.userId)
    .select("user_id")
    .maybeSingle();
  if (error || !data) {
    if (error) Sentry.captureMessage("digest pref: escritura fallida", { level: "error", extra: { code: error.code } });
    return { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath("/panel/ajustes");
  return { ok: true };
}
