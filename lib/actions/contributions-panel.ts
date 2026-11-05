"use server";

import { RSVP_MVP, BACKLOG_MESSAGE } from "@/lib/product-scope";

/**
 * Server actions del panel sobre contribuciones: confirmar Bizums manuales.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface ConfirmBizumResult {
  error?: string;
}

const uuidSchema = z.uuid();

/**
 * Marca como confirmada una aportación Bizum pendiente. Corre con el
 * cliente RLS: solo la pareja dueña de la boda puede actualizarla.
 */
export async function confirmBizum(
  contributionId: string
): Promise<ConfirmBizumResult> {
  if (RSVP_MVP) return { error: BACKLOG_MESSAGE };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  if (!uuidSchema.safeParse(contributionId).success) {
    return { error: "Aportación no válida." };
  }

  const { data, error } = await supabase
    .from("contributions")
    .update({ status: "confirmed" })
    .eq("id", contributionId)
    .eq("method", "bizum_manual")
    .eq("status", "pending")
    .select("id");

  if (error) {
    return { error: "No se ha podido confirmar. Probad de nuevo." };
  }
  if (!data || data.length === 0) {
    return { error: "Esta aportación ya no está pendiente." };
  }

  revalidatePath("/panel");
  revalidatePath("/panel/contribuciones");
  return {};
}
