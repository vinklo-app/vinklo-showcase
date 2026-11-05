import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * La boda de quien tiene la sesión, en UN solo sitio (2026-10-05).
 *
 * Los módulos del panel resuelven la boda SIEMPRE con esto, nunca con un
 * wedding_id del cliente ni con `weddings.couple_id`.
 *
 * Segunda cuenta de pareja (2026-10-15, migración 20261015100000): la boda
 * se resuelve por membresía (`wedding_members`), así que los dos novios
 * llegan a la misma. Mientras la migración no esté aplicada (tabla o
 * relación ausente en PostgREST), se cae al dueño original (`couple_id`),
 * que era el comportamiento anterior.
 *
 * RLS sigue siendo la frontera: las políticas usan
 * `public.owns_wedding(wedding_id)`, que también es «es miembro».
 */
export type WeddingRole = "owner" | "partner";

export interface CurrentWedding {
  id: string;
  slug: string;
}

export interface WeddingContext {
  supabase: SupabaseClient;
  userId: string;
  /** Email de la sesión (para avisos; nunca para autorizar). */
  userEmail: string | null;
  role: WeddingRole;
  wedding: CurrentWedding;
}

/** Tabla, relación o columna aún sin migrar (PostgREST / Postgres). */
export function isMissingMembership(error: { code?: string } | null | undefined): boolean {
  return ["PGRST200", "PGRST205", "PGRST204", "42P01", "42703"].includes(error?.code ?? "");
}

type MemberRow = { id: string; slug: string; wedding_members?: Array<{ role?: string }> | { role?: string } | null };

function roleOf(row: MemberRow): WeddingRole {
  const members = row.wedding_members;
  const first = Array.isArray(members) ? members[0] : members;
  return first?.role === "partner" ? "partner" : "owner";
}

async function loadCurrentWedding(supabase?: SupabaseClient): Promise<WeddingContext | null> {
  const client = supabase ?? (await createClient());
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const base = { supabase: client, userId: user.id, userEmail: user.email ?? null };

  const { data, error } = await client
    .from("weddings")
    .select("id, slug, wedding_members!inner(role)")
    .eq("wedding_members.user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!error) {
    if (!data) return null;
    const row = data as MemberRow;
    return { ...base, role: roleOf(row), wedding: { id: row.id, slug: row.slug } };
  }
  if (!isMissingMembership(error)) return null;

  // Respaldo sin la migración: solo el dueño original.
  const legacy = await client
    .from("weddings")
    .select("id, slug")
    .eq("couple_id", user.id)
    .limit(1)
    .maybeSingle();
  if (legacy.error || !legacy.data) return null;
  return { ...base, role: "owner", wedding: legacy.data as CurrentWedding };
}

/**
 * Con `cache()`: dentro de una misma petición (una página y sus componentes de
 * servidor) la sesión y la boda se resuelven una vez (revisión 2026-10-06, R06).
 * Cada server action es una petición nueva, así que no se comparte entre ellas.
 */
export const getCurrentWedding = cache(loadCurrentWedding);

/** Sin caché: para volver a mirar tras una escritura en la misma petición. */
export const getCurrentWeddingFresh = loadCurrentWedding;
