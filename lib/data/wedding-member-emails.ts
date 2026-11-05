import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingMembership } from "@/lib/data/current-wedding";

/**
 * Correos de TODOS los que gestionan una boda (plan maestro §5.11, S8).
 *
 * Misma consulta que el resumen diario de respuestas del cron
 * (wedding_members por boda, correo vía auth.users porque profiles no lo
 * guarda), pero sin `digest_opt_out` salvo que se pida: darse de baja del
 * resumen no apaga los avisos de servicio (vencimientos, proveedores,
 * retención de datos).
 *
 * Respaldo: si la tabla aún no existe (migración 20261015100000 sin aplicar)
 * o la boda no tiene filas, se usa el dueño original (`weddings.couple_id`).
 *
 * Lanza si no se pudo leer (consulta fallida o ningún usuario legible): así
 * «lista vacía» significa de verdad «nadie a quien escribir» y el llamador
 * no marca como avisado algo que no se envió.
 *
 * Solo servidor y con service_role: devuelve correos de terceros.
 */
export async function weddingMemberEmails(
  admin: SupabaseClient,
  weddingId: string,
  options: { respectDigestOptOut?: boolean } = {},
): Promise<string[]> {
  let query = admin.from("wedding_members").select("user_id").eq("wedding_id", weddingId);
  if (options.respectDigestOptOut) query = query.eq("digest_opt_out", false);
  const { data, error } = await query;
  if (error && !isMissingMembership(error)) throw new Error(`wedding_members:${error.code ?? "?"}`);

  let userIds = error ? [] : (data ?? []).map((row: { user_id: string }) => row.user_id);
  if (userIds.length === 0 && (error || !options.respectDigestOptOut)) {
    const { data: wedding, error: weddingError } = await admin.from("weddings").select("couple_id").eq("id", weddingId).is("deleted_at", null).maybeSingle();
    if (weddingError) throw new Error(`weddings:${weddingError.code ?? "?"}`);
    const owner = (wedding as { couple_id?: string | null } | null)?.couple_id;
    if (owner) userIds = [owner];
  }

  const emails = new Set<string>();
  let unreadable = 0;
  for (const userId of new Set(userIds)) {
    try {
      const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError) {
        unreadable += 1;
        continue;
      }
      const email = user.user?.email?.trim();
      if (email) emails.add(email);
    } catch {
      unreadable += 1;
    }
  }
  if (emails.size === 0 && unreadable > 0) throw new Error("auth_users_unreadable");
  return [...emails];
}
