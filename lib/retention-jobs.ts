import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { weddingMemberEmails } from "@/lib/data/wedding-member-emails";
import { sendEmail } from "@/lib/emails/send";
import { retentionNoticeHtml } from "@/lib/emails/templates";

/**
 * Trabajos de retención del cron diario (plan maestro §5.9 y §5.3). Viven
 * aquí, fuera de app/api/cron/daily/route.ts, para que el cron solo tenga
 * que llamar a runRetentionJobs() (y no se mezclen con el resto de pasos).
 *
 * La lógica de fechas está en SQL (migración 20261024100000): aquí solo se
 * avisa por correo y se llama a las funciones. Errores a Sentry sin datos
 * personales: fase y código.
 */

export const RETENTION_NOTICE_SUBJECT = "Los datos de vuestros invitados y regalos: aviso de un año";

/**
 * Bodas avisadas por ejecución. Bajo a propósito: cada aviso cuesta varias
 * llamadas (miembros, Auth, Resend) y el cron no fija maxDuration. Lo que no
 * cabe hoy sale mañana; la anonimización espera siempre 30 días desde el aviso.
 */
const NOTICES_PER_RUN = 25;

const longDate = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** «2027-07-15» -> «15 de julio de 2027» (fecha civil: sin desfase de zona). */
export function formatRetentionDate(isoDate: string): string {
  return longDate.format(new Date(`${isoDate}T00:00:00Z`));
}

export interface RetentionResult {
  notices: number;
  anonymised: number;
  eventsPurged: number;
}

type NoticeCandidate = { wedding_id: string; anonymise_on: string };

/** Avisos de 30 días: un correo a cada miembro; se marca solo si alguien lo recibió. */
export async function sendRetentionNotices(admin: SupabaseClient, today: string, appUrl: string): Promise<number> {
  const { data, error } = await admin.rpc("retention_notice_candidates", { p_today: today, p_limit: NOTICES_PER_RUN });
  if (error) {
    Sentry.captureMessage("retención: lectura de avisos fallida", { level: "warning", extra: { code: error.code } });
    return 0;
  }
  let noticed = 0;
  for (const candidate of (Array.isArray(data) ? data : []) as NoticeCandidate[]) {
    try {
      const emails = await weddingMemberEmails(admin, candidate.wedding_id);
      const html = retentionNoticeHtml({
        anonymiseOnFormatted: formatRetentionDate(candidate.anonymise_on),
        panelUrl: `${appUrl}/panel/invitados`,
        giftsUrl: `${appUrl}/panel#regalos`,
        privacyUrl: `${appUrl}/privacidad#cuanto-tiempo-conservamos-tus-datos`,
      });
      let delivered = 0;
      for (const to of emails) {
        try {
          const result = await sendEmail({ to, subject: RETENTION_NOTICE_SUBJECT, html });
          if (!result.skipped) delivered += 1;
        } catch {
          Sentry.captureMessage("retención: envío de aviso fallido", { level: "error" });
        }
      }
      // Nadie a quien escribir (boda sin miembros con correo): se marca igual,
      // para que la anonimización no espere para siempre. Sin RESEND_API_KEY
      // (local) o si todos los envíos fallan, no se marca: se reintenta mañana.
      if (delivered === 0 && emails.length > 0) continue;
      const { error: markError } = await admin.rpc("mark_retention_notice", { p_wedding_id: candidate.wedding_id });
      if (markError) {
        Sentry.captureMessage("retención: marca de aviso fallida", { level: "error", extra: { code: markError.code } });
        continue;
      }
      noticed += 1;
    } catch {
      Sentry.captureMessage("retención: aviso de boda fallido", { level: "error" });
    }
  }
  return noticed;
}

/** Anonimiza las bodas vencidas (12 meses y 30 días desde el aviso). */
export async function anonymiseExpiredGuests(admin: SupabaseClient, today: string): Promise<number> {
  const { data, error } = await admin.rpc("anonymise_expired_guests", { p_today: today, p_limit: 200 });
  if (error || typeof data !== "number") {
    Sentry.captureMessage("retención: anonimización fallida", { level: "error", extra: { code: error?.code ?? "shape" } });
    return 0;
  }
  return data;
}

/** Borra events de más de 13 meses, hasta 50 000 por ejecución. */
export async function purgeOldEvents(admin: SupabaseClient): Promise<number> {
  let purged = 0;
  for (let batch = 0; batch < 5; batch += 1) {
    const { data, error } = await admin.rpc("purge_old_events", { p_batch_size: 10000 });
    if (error || typeof data !== "number") {
      Sentry.captureMessage("retención: purga de events fallida", { level: "warning", extra: { code: error?.code ?? "shape" } });
      break;
    }
    purged += data;
    if (data < 10000) break;
  }
  return purged;
}

/**
 * Los tres pasos, en orden (avisar, anonimizar, purgar), cada uno aislado:
 * el fallo de uno no impide los demás ni el resto del cron.
 */
export async function runRetentionJobs(admin: SupabaseClient, today: string, appUrl: string): Promise<RetentionResult> {
  const result: RetentionResult = { notices: 0, anonymised: 0, eventsPurged: 0 };
  try {
    result.notices = await sendRetentionNotices(admin, today, appUrl);
  } catch {
    Sentry.captureMessage("retención: avisos, fallo general", { level: "error" });
  }
  try {
    result.anonymised = await anonymiseExpiredGuests(admin, today);
  } catch {
    Sentry.captureMessage("retención: anonimización, fallo general", { level: "error" });
  }
  try {
    result.eventsPurged = await purgeOldEvents(admin);
  } catch {
    Sentry.captureMessage("retención: purga, fallo general", { level: "error" });
  }
  return result;
}
