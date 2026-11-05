import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import { JOIN_COOKIE } from "@/lib/partner/join";

/**
 * Adónde va alguien que acaba de entrar (enlace mágico, contraseña de
 * pruebas o /auth/continuar):
 *  1. /unirse si trae una invitación de pareja pendiente (cookie del flujo
 *     /unirse → /login). Va primero para que también vea los errores
 *     («ya tienes boda», «otro correo») quien ya tenía boda.
 *  2. /panel si gestiona una boda (propia o aceptada).
 *  3. /onboarding si no.
 */
export async function postLoginPath(supabase?: SupabaseClient): Promise<"/unirse" | "/panel" | "/onboarding"> {
  const jar = await cookies();
  if (jar.get(JOIN_COOKIE)?.value) return "/unirse";
  return (await getCurrentWedding(supabase)) ? "/panel" : "/onboarding";
}
