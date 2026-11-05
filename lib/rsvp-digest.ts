/**
 * Resumen diario de respuestas para la pareja (plan maestro §2.6). Lógica
 * pura: el cron (app/api/cron/daily/route.ts) lee las filas y envía; aquí se
 * agrupa por boda y se redacta. Un correo al día por miembro, nunca uno por
 * respuesta.
 */

export const RSVP_DIGEST_EVENT = "digest_rsvp_daily";
export const RSVP_DIGEST_WINDOW_HOURS = 24;

export interface RespondedRow {
  wedding_id: string;
  rsvp_status: string;
  rsvp_companions: number | null;
}

export interface WeddingDigest {
  weddingId: string;
  /** Personas que vienen (quien responde + acompañantes) entre las respuestas «sí». */
  yesPeople: number;
  /** Invitaciones que respondieron «no». */
  noGuests: number;
}

/** Agrupa por boda las respuestas de la ventana. Solo «si» y «no». */
export function groupRsvpDigests(rows: readonly RespondedRow[]): WeddingDigest[] {
  const byWedding = new Map<string, WeddingDigest>();
  for (const row of rows) {
    if (row.rsvp_status !== "si" && row.rsvp_status !== "no") continue;
    const digest = byWedding.get(row.wedding_id) ?? { weddingId: row.wedding_id, yesPeople: 0, noGuests: 0 };
    if (row.rsvp_status === "si") digest.yesPeople += 1 + Math.max(0, row.rsvp_companions ?? 0);
    else digest.noGuests += 1;
    byWedding.set(row.wedding_id, digest);
  }
  return [...byWedding.values()].filter((d) => d.yesPeople + d.noGuests > 0);
}

/** «4 personas han confirmado y 1 invitado no podrá ir» (sin punto final). */
export function rsvpDigestCounts({ yesPeople, noGuests }: Pick<WeddingDigest, "yesPeople" | "noGuests">): string {
  const parts: string[] = [];
  if (yesPeople > 0) parts.push(yesPeople === 1 ? "1 persona ha confirmado" : `${yesPeople} personas han confirmado`);
  if (noGuests > 0) parts.push(noGuests === 1 ? "1 invitado no podrá ir" : `${noGuests} invitados no podrán ir`);
  return parts.join(" y ");
}

/** Frase principal del correo. */
export function rsvpDigestSentence(digest: Pick<WeddingDigest, "yesPeople" | "noGuests">): string {
  return `En las últimas 24 horas, ${rsvpDigestCounts(digest)}.`;
}

/** Asunto: corto y con el dato. */
export function rsvpDigestSubject(digest: Pick<WeddingDigest, "yesPeople" | "noGuests">): string {
  return `Nuevas respuestas: ${rsvpDigestCounts(digest)}`;
}

/** Clave de idempotencia: un resumen por boda y día (Madrid). */
export function rsvpDigestKey(weddingId: string, todayIso: string): string {
  return `${weddingId}:${todayIso}`;
}
