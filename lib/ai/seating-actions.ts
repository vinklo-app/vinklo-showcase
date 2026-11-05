"use server";

/**
 * Server actions de la IA de las mesas (lib/ai/seating-ai.ts). Ninguna
 * guarda nada: el plano leído se revisa y se guarda con `saveFloorPlan`
 * (lib/actions/tables.ts); las explicaciones solo se enseñan.
 * Solo exporta funciones async (Turbopack rechaza otra cosa en "use server").
 */
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { keyedHash, rateLimit } from "@/lib/rate-limit";
import { FLOOR_PLAN_ERRORS, explainSeatingCore, readFloorPlanCore, type ExplainSeatingResult, type ReadFloorPlanResult } from "./seating-ai";

const SESSION_ERROR = "La sesión ha caducado. Volved a entrar.";
const hashed = (value: string) => keyedHash(value).slice(0, 32);

/** Lee el plano del salón (FormData con el campo «plano»: la imagen ya preparada en el navegador). */
export async function readFloorPlan(form: FormData): Promise<ReadFloorPlanResult> {
  const context = await getCurrentWedding();
  if (!context) return { ok: false, error: SESSION_ERROR };
  const file = form instanceof FormData ? form.get("plano") : null;
  if (!(file instanceof Blob)) return { ok: false, error: FLOOR_PLAN_ERRORS.file };
  const user = context.userId;
  return readFloorPlanCore({ type: file.type, size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) }, {
    gatewayUser: hashed(`user:${user}`),
    // Un plano por boda, con algún reintento: 6 por hora y 20 al día por pareja.
    allow: async () => (await rateLimit("ai-floor-h", user, 6, 3600)) && (await rateLimit("ai-floor-d", user, 20, 86_400)),
  });
}

/** Una frase por mesa de la propuesta. Solo datos anónimos (ver explainTablesSchema). */
export async function explainSeating(tables: unknown): Promise<ExplainSeatingResult> {
  const context = await getCurrentWedding();
  if (!context) return { ok: false };
  const user = context.userId;
  return explainSeatingCore(tables, {
    gatewayUser: hashed(`user:${user}`),
    // Una por propuesta: 30 por hora y 100 al día por pareja.
    allow: async () => (await rateLimit("ai-explain-h", user, 30, 3600)) && (await rateLimit("ai-explain-d", user, 100, 86_400)),
  });
}
