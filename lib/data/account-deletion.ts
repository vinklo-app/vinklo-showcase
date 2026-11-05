import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { DRAFT_PHOTOS_BUCKET, PUBLIC_PHOTOS_BUCKET } from "@/lib/photo-ref";

/**
 * Borrado de boda y de cuenta (plan maestro §5.10, S2; dos fases desde la
 * revisión Fable 2026-10-11, P2-5), con service_role.
 *
 * Fuera de los archivos "use server" para no ser endpoints: quien llama YA
 * ha comprobado la sesión, el rol de dueño y la confirmación escrita.
 *
 * Fase 1 — markWeddingDeleted (RPC wedding_mark_deleted con la sesión del
 * dueño, una transacción): weddings.deleted_at, purga apuntada en
 * pending_deletions con sus proveedores, enlaces de invitado revocados y
 * membresías fuera. Desde ahí nadie ve la boda.
 * Fase 2 — runPendingDeletion: borra la fila (cascada) y vacía Storage; para
 * una cuenta, borra el usuario de Auth. Se intenta en el momento y, si algo
 * falla, el cron diario lo reintenta (runPendingDeletions). Todo idempotente:
 * fila ya borrada, carpeta vacía o usuario inexistente cuentan como hecho.
 *
 * Storage: las tablas caen en cascada al borrar `weddings`, pero los objetos
 * de Storage no (y no se deben borrar por SQL en storage.objects: quedarían
 * huérfanos en el almacenamiento). Se listan y borran por la API:
 *   - wedding-photos         (público)  <wedding_id>/cover-*.jpg
 *   - wedding-photos-drafts  (privado)  <wedding_id>/cover-*.jpg
 *   - invoices               (privado, portal de proveedores heredado)  <vendor_id>/*
 * Es la otra excepción a «nunca se borra del bucket público»
 * (lib/data/photo-storage.ts): la boda deja de existir.
 */

const PAGE = 1000;
/** Tope de vueltas por carpeta: 20 000 objetos (una boda tiene unos pocos). */
const MAX_ROUNDS = 20;
const QUEUE = "pending_deletions";

type Admin = SupabaseClient;

/** Vacía una carpeta de un bucket. false si algo falló (no se sigue con el borrado). */
async function emptyFolder(admin: Admin, bucket: string, folder: string): Promise<boolean> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: PAGE, offset: 0 });
    if (error) return false;
    const names = (data ?? []).filter((item) => item.id !== null && item.name).map((item) => `${folder}/${item.name}`);
    if (names.length === 0) return true;
    const { error: removeError } = await admin.storage.from(bucket).remove(names);
    if (removeError) return false;
    if ((data ?? []).length < PAGE) return true;
  }
  return false;
}

export type StoragePurge = { ok: true } | { ok: false; phase: string };

/** Carpetas de Storage de una boda: fotos (dos buckets) y facturas de sus proveedores. */
export function weddingStorageFolders(weddingId: string, vendorIds: readonly string[]): Array<{ bucket: string; folder: string }> {
  return [
    { bucket: PUBLIC_PHOTOS_BUCKET, folder: weddingId },
    { bucket: DRAFT_PHOTOS_BUCKET, folder: weddingId },
    ...vendorIds.map((id) => ({ bucket: "invoices", folder: id })),
  ];
}

/** Borra todos los objetos de Storage de una boda (fotos y facturas). Corta en el primer fallo. */
export async function purgeWeddingStorage(weddingId: string, vendorIds: readonly string[], admin: Admin = createAdminClient()): Promise<StoragePurge> {
  for (const { bucket, folder } of weddingStorageFolders(weddingId, vendorIds)) {
    if (!(await emptyFolder(admin, bucket, folder))) return { ok: false, phase: bucket };
  }
  return { ok: true };
}

export type MarkResult = "ok" | "forbidden" | "not_found" | "unauthenticated" | "error";

/** Fase 1 con el cliente de SESIÓN (la RPC comprueba que es el dueño). Nunca lanza. */
export async function markWeddingDeleted(session: SupabaseClient, weddingId: string): Promise<MarkResult> {
  try {
    const { data, error } = await session.rpc("wedding_mark_deleted", { p_wedding_id: weddingId });
    if (error) return "error";
    return data === "ok" || data === "forbidden" || data === "not_found" || data === "unauthenticated" ? data : "error";
  } catch {
    return "error";
  }
}

/** Apunta el borrado de un usuario de Auth para que el cron lo reintente. true si quedó apuntado. */
export async function queueUserDeletion(userId: string, admin: Admin = createAdminClient()): Promise<boolean> {
  try {
    const { error } = await admin.from(QUEUE).upsert({ kind: "user", target_id: userId }, { onConflict: "kind,target_id", ignoreDuplicates: true });
    return !error;
  } catch {
    return false;
  }
}

export type PendingDeletion = {
  /** null: no llegó a apuntarse (se intenta igual, sin dejar rastro). */
  id: string | null;
  kind: "wedding" | "user";
  target_id: string;
  vendor_ids: string[];
  attempts: number;
};
export type DeletionStep = { ok: true } | { ok: false; phase: string; code?: string };

function isMissingUser(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === "user_not_found";
}

async function runStep(entry: PendingDeletion, admin: Admin): Promise<DeletionStep> {
  if (entry.kind === "wedding") {
    // Solo una boda marcada: nunca una viva aunque la cola se corrompa.
    const { error } = await admin.from("weddings").delete().eq("id", entry.target_id).not("deleted_at", "is", null);
    if (error) return { ok: false, phase: "weddings", code: error.code };
    // Si la fila sigue (sin marca), sus fotos no se tocan.
    const { data: alive, error: aliveError } = await admin.from("weddings").select("id").eq("id", entry.target_id).maybeSingle();
    if (aliveError || alive) return { ok: false, phase: alive ? "alive" : "weddings", code: aliveError?.code };
    const storage = await purgeWeddingStorage(entry.target_id, entry.vendor_ids, admin);
    return storage.ok ? storage : { ok: false, phase: storage.phase };
  }
  const { error } = await admin.auth.admin.deleteUser(entry.target_id);
  if (error && !isMissingUser(error)) return { ok: false, phase: "auth", code: error.code ?? String(error.status ?? "") };
  return { ok: true };
}

/**
 * Fase 2 de una entrada (idempotente). Hecha: sale de la cola. Fallida:
 * suma un intento con la fase y el código (sin datos personales). Nunca lanza.
 */
export async function runPendingDeletion(entry: PendingDeletion, admin: Admin = createAdminClient()): Promise<DeletionStep> {
  let result: DeletionStep;
  try {
    result = await runStep(entry, admin);
  } catch {
    result = { ok: false, phase: entry.kind === "user" ? "auth" : "storage" };
  }
  if (!entry.id) return result;
  try {
    if (result.ok) await admin.from(QUEUE).delete().eq("id", entry.id);
    else {
      await admin.from(QUEUE).update({
        attempts: entry.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: `${result.phase}:${result.code ?? "?"}`.slice(0, 200),
      }).eq("id", entry.id);
    }
  } catch {
    // La cola se revisa mañana igual: la purga es idempotente.
  }
  return result;
}

const ENTRY_COLUMNS = "id, kind, target_id, vendor_ids, attempts";

/** Fase 2 inmediata de lo apuntado para (kind, id). Sin entrada en la cola se intenta igual. */
export async function finishPendingDeletion(kind: PendingDeletion["kind"], targetId: string, admin: Admin = createAdminClient()): Promise<DeletionStep> {
  let entry: PendingDeletion = { id: null, kind, target_id: targetId, vendor_ids: [], attempts: 0 };
  try {
    const { data } = await admin.from(QUEUE).select(ENTRY_COLUMNS).eq("kind", kind).eq("target_id", targetId).maybeSingle();
    if (data) entry = data as PendingDeletion;
    // Una boda sin su entrada no se toca aquí: sin la lista de proveedores
    // quedarían facturas sueltas; la marca la apuntó y el cron la verá.
    else if (kind === "wedding") return { ok: false, phase: "queue" };
  } catch {
    if (kind === "wedding") return { ok: false, phase: "queue" };
  }
  return runPendingDeletion(entry, admin);
}

/**
 * Intentos fallidos (contando el inmediato de la acción) a partir de los que
 * una entrada se da por atascada: el cron lo sube a error en Sentry.
 */
export const STUCK_ATTEMPTS = 5;

/** Lote del cron: pocas filas y con reloj (Hobby: 60 s para todo el cron). */
export const PURGE_BATCH = 10;
export const PURGE_BUDGET_MS = 20_000;

/**
 * Cron diario: reintenta lo pendiente, primero lo nunca intentado y luego lo
 * que lleva más tiempo sin intentarse (un fallo persistente no bloquea al
 * resto). Para al agotar el lote o el tiempo. Nunca lanza. `stuck`: fallidas
 * que ya suman STUCK_ATTEMPTS intentos (solo si hay alguna).
 */
export async function runPendingDeletions(
  admin: Admin,
  { limit = PURGE_BATCH, budgetMs = PURGE_BUDGET_MS, now = () => Date.now() }: { limit?: number; budgetMs?: number; now?: () => number } = {},
): Promise<{ done: number; failed: number; stuck?: number; error?: string }> {
  const startedAt = now();
  const { data, error } = await admin
    .from(QUEUE)
    .select(ENTRY_COLUMNS)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (error) return { done: 0, failed: 0, error: error.code ?? "?" };
  let done = 0;
  let failed = 0;
  let stuck = 0;
  for (const entry of (data ?? []) as PendingDeletion[]) {
    if (now() - startedAt > budgetMs) break;
    const result = await runPendingDeletion(entry, admin);
    if (result.ok) done += 1;
    else {
      failed += 1;
      // runPendingDeletion acaba de sumar este intento a la fila.
      if ((entry.attempts ?? 0) + 1 >= STUCK_ATTEMPTS) stuck += 1;
    }
  }
  return stuck > 0 ? { done, failed, stuck } : { done, failed };
}

export type AccountPlan =
  | { kind: "none" }
  | { kind: "partner"; weddingId: string }
  | { kind: "owner-with-partner"; weddingId: string; partnerId: string }
  | { kind: "owner-alone"; weddingId: string };

/**
 * Qué pasa con la boda si este usuario borra su cuenta:
 *  - sin boda: nada.
 *  - pareja secundaria: solo sale (su fila cae con el perfil).
 *  - dueño con pareja: la boda pasa a la pareja (cambio de couple_id; el
 *    trigger wedding_members_sync_owner le da el rol de dueño).
 *  - dueño sin pareja: se borra la boda entera.
 * Lanza si no se pudo leer.
 */
export async function planAccountDeletion(userId: string, admin: Admin = createAdminClient()): Promise<AccountPlan> {
  // Una boda ya marcada (fase 1 hecha) no cuenta: la cola la termina.
  const { data: own, error: ownError } = await admin.from("weddings").select("id").eq("couple_id", userId).is("deleted_at", null).limit(1).maybeSingle();
  if (ownError) throw new Error(`weddings:${ownError.code ?? "?"}`);
  if (own) {
    const weddingId = (own as { id: string }).id;
    const { data: others, error } = await admin.from("wedding_members").select("user_id").eq("wedding_id", weddingId).neq("user_id", userId).limit(1);
    if (error && !["PGRST205", "42P01"].includes(error.code ?? "")) throw new Error(`wedding_members:${error.code ?? "?"}`);
    const partner = (others ?? [])[0] as { user_id: string } | undefined;
    return partner ? { kind: "owner-with-partner", weddingId, partnerId: partner.user_id } : { kind: "owner-alone", weddingId };
  }
  const { data: member, error: memberError } = await admin.from("wedding_members").select("wedding_id").eq("user_id", userId).limit(1).maybeSingle();
  if (memberError && !["PGRST205", "42P01"].includes(memberError.code ?? "")) throw new Error(`wedding_members:${memberError.code ?? "?"}`);
  if (member) return { kind: "partner", weddingId: (member as { wedding_id: string }).wedding_id };
  return { kind: "none" };
}

/** Pasa la boda a la pareja. true si se cambió el dueño. */
export async function transferWedding(weddingId: string, fromUserId: string, toUserId: string, admin: Admin = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin
    .from("weddings")
    .update({ couple_id: toUserId })
    .eq("id", weddingId)
    .eq("couple_id", fromUserId)
    .select("id");
  return !error && (data ?? []).length === 1;
}

/**
 * Restos ligados al correo, no al usuario: borrador del creador guardado en
 * servidor e invitaciones de pareja pendientes dirigidas a ese correo y su alta en la
 * lista de espera (se guarda en minúsculas). Mejor
 * esfuerzo (tablas que pueden no existir aún).
 */
export async function purgeEmailLeftovers(email: string | null, admin: Admin = createAdminClient()): Promise<void> {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  try {
    await admin.from("builder_draft_stash").delete().eq("email", normalized);
  } catch {
    // Tabla ausente: nada que borrar.
  }
  try {
    await admin.from("wedding_member_invites").delete().eq("email", normalized).is("accepted_at", null);
  } catch {
    // Tabla ausente: nada que borrar.
  }
  try {
    await admin.from("waitlist").delete().eq("email", normalized);
  } catch {
    // Tabla ausente: nada que borrar.
  }
}
