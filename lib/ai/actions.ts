"use server";

/**
 * Server actions de la edición con IA. Ninguna guarda nada: devuelven el
 * documento cambiado y el chat del editor lo guarda al momento en el
 * borrador con `saveSiteDraft` (panel) o lo adopta en el borrador local
 * (/crear). Los invitados no ven nada hasta publicar.
 *
 *  - `proposeSiteEdit`: pareja con sesión (panel/editor). Límite por usuario.
 *  - `proposeDraftSiteEdit`: creador anónimo de /crear, antes de tener
 *    cuenta. Trabaja sobre el documento que envía el cliente, límite por IP,
 *    nunca persiste. Siempre en ámbito "design" (el borrador local no guarda
 *    contenido de secciones).
 *  - `polishStoryAnswers`: 2–3 respuestas → capítulos de «Vuestra historia»
 *    (ver `story-polish.ts` para el uso). Con o sin sesión.
 */
import { createClient } from "@/lib/supabase/server";
import { clientIp, keyedHash, rateLimit } from "@/lib/rate-limit";
import { proposeSiteEditCore, type ProposeSiteEditInput, type ProposeSiteEditResult } from "./site-editor";
import { readBuilderIdeaCore, type ReadIdeaResult } from "./idea-reader";
import { polishStoryCore, type PolishStoryInput, type PolishStoryResult } from "./story-polish";

// Los tipos se importan de ./story-polish: un archivo "use server" solo puede exportar funciones async.

const SESSION_ERROR = "La sesión ha caducado. Volved a entrar.";

const hashed = (value: string) => keyedHash(value).slice(0, 32);

export async function proposeSiteEdit(input: ProposeSiteEditInput): Promise<ProposeSiteEditResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_ERROR };
  return proposeSiteEditCore(input, {
    surface: "panel",
    gatewayUser: hashed(`user:${user.id}`),
    // 20 por hora y 60 por día por pareja.
    allow: async () => (await rateLimit("ai-edit-h", user.id, 20, 3600)) && (await rateLimit("ai-edit-d", user.id, 60, 86_400)),
  });
}

export async function proposeDraftSiteEdit(input: ProposeSiteEditInput): Promise<ProposeSiteEditResult> {
  const ip = await clientIp();
  // Sin cuenta siempre es el creador. "design" solo lo manda un cliente con la
  // versión anterior en caché (su borrador no guardaría el contenido).
  return proposeSiteEditCore({ ...input, scope: input?.scope === "design" ? "design" : "creator" }, {
    surface: "crear",
    gatewayUser: hashed(`ip:${ip}`),
    // Sin cuenta: más estricto. 8 por hora y 20 por día por IP.
    allow: async () => (await rateLimit("ai-edit-anon-h", ip, 8, 3600)) && (await rateLimit("ai-edit-anon-d", ip, 20, 86_400)),
  });
}

/**
 * Lectura de la idea del creador (/crear, sin cuenta). No guarda nada:
 * propone cómo rellenar el borrador y el cliente solo rellena campos vacíos.
 */
export async function readBuilderIdea(idea: unknown): Promise<ReadIdeaResult> {
  const ip = await clientIp();
  return readBuilderIdeaCore(idea, {
    gatewayUser: hashed(`ip:${ip}`),
    // Una lectura por idea: 10 por hora y 30 al día por IP bastan.
    allow: async () => (await rateLimit("ai-idea-h", ip, 10, 3600)) && (await rateLimit("ai-idea-d", ip, 30, 86_400)),
  });
}

/**
 * Pulido de la historia del creador (/crear sin cuenta y /onboarding con
 * cuenta). No guarda nada; si la IA no está, devuelve el texto tal cual.
 */
export async function polishStoryAnswers(input: PolishStoryInput): Promise<PolishStoryResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const ip = user ? "" : await clientIp();
  const key = user ? `user:${user.id}` : `ip:${ip}`;
  return polishStoryCore(input, {
    surface: user ? "panel" : "crear",
    gatewayUser: hashed(key),
    // Una o dos veces por pareja: 6 por hora y 15 al día bastan.
    allow: async () => (await rateLimit("ai-story-h", key, 6, 3600)) && (await rateLimit("ai-story-d", key, 15, 86_400)),
  });
}
