"use server";

/**
 * Copia en servidor del borrador del creador mientras la pareja confirma su
 * correo. El borrador de /crear vive en localStorage; el enlace del correo se
 * abre a menudo en otro navegador (el de la app de correo, otro dispositivo)
 * y sin esta copia la pareja empezaba de cero.
 *
 * La tabla `builder_draft_stash` no tiene grants para anon/authenticated:
 * todo entra por aquí con el cliente admin (RPC builder_draft_stash_put, que
 * nunca pisa una copia más reciente). Se guarda por correo y solo lo
 * lee la sesión que ha demostrado ser dueña de ese correo al abrir el enlace.
 * La foto no viaja (sigue en el IndexedDB del navegador donde se eligió).
 *
 * Nada de esto puede romper el acceso: cualquier fallo se traga y el
 * borrador sigue, como antes, en el navegador.
 */

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseBuilderDraft, type BuilderDraft } from "@/lib/wedding-builder";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const TABLE = "builder_draft_stash";
/**
 * Corto a propósito. La copia va ligada a un correo que aún nadie ha
 * confirmado, así que hay dos riesgos asumidos y acotados, no eliminables sin
 * teclear el código en la pestaña original:
 *  - alguien puede dejar un borrador para un correo ajeno → el creador lo
 *    anuncia con sus nombres y deja descartarlo, nunca lo adopta en silencio;
 *  - quien escribe mal su correo deja nombres, fecha y lugar a la vista de
 *    quien reciba ese enlace y entre → solo texto del borrador, sin foto ni
 *    invitados, y caduca pronto.
 */
const STASH_DAYS = 7;

/** Guarda el borrador para `email` antes de enviar el enlace. Anónima: valida y limita por IP. */
export async function stashBuilderDraft(input: { email: unknown; draft: unknown }): Promise<{ ok: boolean }> {
  const email = emailSchema.safeParse(input.email);
  // Migra a la forma actual (v3) antes de guardar: lo que se guarda siempre es v3.
  const draft = parseBuilderDraft(input.draft);
  if (!email.success || !draft) return { ok: false };
  if (!(await rateLimit("builder-stash", await clientIp(), 10, 3600))) return { ok: false };
  try {
    const admin = createAdminClient();
    const now = new Date();
    // Purga de caducadas solo de vez en cuando (revisión 2026-10-06, R15):
    // no hace falta en cada petición anónima y la lectura ya filtra por caducidad.
    if (Math.random() < 0.05) await admin.from(TABLE).delete().lt("expires_at", now.toISOString());
    // Escritura condicional en una sola sentencia (P2-4): si ya hay una copia
    // vigente editada después (otro navegador), se conserva esa. Sin fecha
    // (borrador de antes de `updatedAt`) cuenta como ahora, como hasta hoy.
    const put = (value: BuilderDraft) => admin.rpc("builder_draft_stash_put", {
      p_email: email.data,
      p_draft: value,
      p_updated_at: draft.updatedAt ?? now.toISOString(),
      p_expires_at: new Date(now.getTime() + STASH_DAYS * 24 * 3600 * 1000).toISOString(),
    });
    let { error } = await put(draft);
    // Demasiado grande para la columna (23514: el contenido que añadió la IA,
    // sin la migración 20261031120000): mejor la copia sin ese contenido que
    // ninguna. En este navegador el borrador sigue entero.
    if (error?.code === "23514" && (draft.sections || draft.dayMoments || draft.dayCards || draft.dayQuestions)) {
      // Sin las filas del día ni `dayKnown` el borrador sigue siendo válido.
      const { sections: _s, dayMoments: _m, dayCards: _c, dayQuestions: _q, dayKnown: _k, ...lean } = draft;
      void [_s, _m, _c, _q, _k];
      ({ error } = await put(lean));
    }
    if (error) { console.warn("[builder-stash] save failed", error.code); return { ok: false }; }
    // Escrita o no, en el servidor queda la copia más reciente: el creador la anuncia.
    return { ok: true };
  } catch {
    console.warn("[builder-stash] save failed");
    return { ok: false };
  }
}

async function sessionEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = emailSchema.safeParse(user?.email);
  return email.success ? email.data : null;
}

/** Borrador guardado para el correo de la sesión actual (o null). Nunca lanza. */
export async function loadStashedDraft(): Promise<BuilderDraft | null> {
  try {
    const email = await sessionEmail();
    if (!email) return null;
    const { data, error } = await createAdminClient().from(TABLE).select("draft").eq("email", email).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) return null;
    // Copias guardadas antes de la v3 (sin maqueta) se migran al leer.
    return parseBuilderDraft((data as { draft: unknown }).draft);
  } catch {
    return null;
  }
}

/** Borra la copia del correo de la sesión actual (la boda ya existe). Nunca lanza. */
export async function clearStashedDraft(): Promise<void> {
  try {
    const email = await sessionEmail();
    if (email) await createAdminClient().from(TABLE).delete().eq("email", email);
  } catch { /* La copia caduca sola. */ }
}
