/**
 * Cron diario (Vercel, 08:00 UTC — UNO al día: el plan Hobby rompe todos
 * los deploys si un cron es sub-diario). Trabajos:
 *
 *  0. Resumen diario de respuestas (plan maestro §2.6, activo también con
 *     RSVP_MVP): bodas con respuestas de invitados en las últimas 24 h →
 *     un correo a cada miembro (wedding_members) que no se ha dado de baja.
 *     Idempotente por (boda, día) con el evento `digest_rsvp_daily`.
 *  0a. Borradores del creador caducados (builder_draft_stash.expires_at).
 *  0a'. Borrados pendientes (P2-5): bodas marcadas y cuentas cuya fase 2
 *     (fila, Storage, Auth) falló en el momento; lote corto y con reloj
 *     (lib/data/account-deletion.ts, runPendingDeletions).
 *  0b. Retención (plan maestro §5.9 y §5.3, activo también con RSVP_MVP):
 *     aviso único 30 días antes, anonimización de invitados 12 meses después
 *     de la boda y purga de events de más de 13 meses (lib/retention-jobs.ts).
 *
 *  Los correos a la pareja van a TODOS los miembros (§5.11,
 *  lib/data/wedding-member-emails.ts).
 *
 *  1. Recordatorio de vencimiento: tramos pendientes que vencen en
 *     exactamente 7 días → email sobrio a la pareja.
 *  2. Empujón de compartir: bodas a 30 días con <5 aportaciones
 *     confirmadas → email cálido con su enlace.
 *
 * Idempotencia: cada envío deja un evento (`reminder_tranche_7d` /
 * `reminder_nudge_30d`) y se consulta antes de reenviar, así una
 * reejecución del mismo día no duplica correos. Sin RESEND_API_KEY los
 * envíos se saltan con aviso (sendEmail ya lo gestiona).
 */
import * as Sentry from "@sentry/nextjs";

import { RSVP_MVP } from "@/lib/product-scope";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { weddingMemberEmails } from "@/lib/data/wedding-member-emails";
import { runRetentionJobs } from "@/lib/retention-jobs";
import { runPendingDeletions } from "@/lib/data/account-deletion";
import { checkEnv } from "@/lib/env";
import { sendEmail } from "@/lib/emails/send";
import {
  rsvpDigestHtml,
  shareNudgeHtml,
  trancheReminderHtml,
  weeklyDigestHtml,
} from "@/lib/emails/templates";
import { formatEurCents } from "@/lib/fees";
import { FREE_CONTRIBUTION_LIMIT } from "@/lib/premium";
import {
  RSVP_DIGEST_EVENT,
  RSVP_DIGEST_WINDOW_HOURS,
  groupRsvpDigests,
  rsvpDigestKey,
  rsvpDigestSentence,
  rsvpDigestSubject,
  type RespondedRow,
} from "@/lib/rsvp-digest";
import {
  NUDGE_BEFORE_WEDDING_DAYS,
  isoDaysFromNow,
  selectTranchesToRemind,
  selectWeddingsToNudge,
  type TrancheForReminder,
  type WeddingForNudge,
} from "@/lib/reminders";

export const dynamic = "force-dynamic";
// Vercel Hobby (sin Fluid compute) limita las funciones a 60 s y un valor mayor
// hace fallar el despliegue; con los volúmenes actuales sobra.
export const maxDuration = 60;

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Fecha civil de Madrid, YYYY-MM-DD. */
function todayMadridIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(new Date());
}

/** true si hoy es lunes en Madrid (día de envío del resumen semanal). */
function isMondayMadrid(): boolean {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Madrid",
      weekday: "short",
    }).format(new Date()) === "Mon"
  );
}

const dueDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
});

interface WeddingContact {
  id: string;
  slug: string;
  couple_id: string;
}

/** Email de la pareja vía auth.users (profiles no guarda email). */
async function coupleEmail(
  admin: ReturnType<typeof createAdminClient>,
  coupleId: string,
): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(coupleId);
  return data.user?.email ?? null;
}

/**
 * true si ya existe un evento de este tipo con este payload key=value. Con
 * `weddingId` se acota también por boda (todos los eventos de aviso llevan
 * wedding_id): usa el índice y no mezcla bodas.
 */
async function alreadySent(
  admin: ReturnType<typeof createAdminClient>,
  type: string,
  key: string,
  value: string,
  weddingId?: string,
): Promise<boolean> {
  let query = admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("type", type)
    .contains("payload", { [key]: value });
  if (weddingId) query = query.eq("wedding_id", weddingId);
  const { count } = await query;
  return (count ?? 0) > 0;
}

/** Comparación en tiempo constante (evita el side-channel de temporización). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Resumen diario de respuestas (§2.6). Devuelve cuántas bodas recibieron
 * el correo. Los fallos van a Sentry sin datos personales (ni correos, ni
 * nombres, ni ids de invitados): solo la fase y el código.
 */
async function sendRsvpDigests(admin: ReturnType<typeof createAdminClient>, today: string): Promise<number> {
  const since = new Date(Date.now() - RSVP_DIGEST_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("wedding_guests")
    .select("wedding_id, rsvp_status, rsvp_companions")
    .gte("responded_at", since)
    .in("rsvp_status", ["si", "no"])
    .limit(5000);
  if (error) {
    // 42703 = columna inexistente: la migración 20261021100000 aún no está.
    Sentry.captureMessage("rsvp digest: lectura de respuestas fallida", { level: "warning", extra: { code: error.code } });
    return 0;
  }
  const digests = groupRsvpDigests((rows ?? []) as RespondedRow[]);
  if (digests.length === 0) return 0;

  const { data: memberRows, error: membersError } = await admin
    .from("wedding_members")
    .select("wedding_id, user_id")
    .in("wedding_id", digests.map((d) => d.weddingId))
    .eq("digest_opt_out", false);
  if (membersError) {
    Sentry.captureMessage("rsvp digest: lectura de miembros fallida", { level: "warning", extra: { code: membersError.code } });
    return 0;
  }

  let sent = 0;
  for (const digest of digests) {
    const key = rsvpDigestKey(digest.weddingId, today);
    try {
      const members = (memberRows ?? []).filter((m) => m.wedding_id === digest.weddingId);
      if (members.length === 0) continue;
      if (await alreadySent(admin, RSVP_DIGEST_EVENT, "day_key", key, digest.weddingId)) continue;

      const { data: confirmedRows, error: totalError } = await admin
        .from("wedding_guests")
        .select("rsvp_companions")
        .eq("wedding_id", digest.weddingId)
        .eq("rsvp_status", "si");
      const totalConfirmed = totalError ? null : (confirmedRows ?? []).reduce((sum, r) => sum + 1 + Math.max(0, r.rsvp_companions ?? 0), 0);
      const html = rsvpDigestHtml({
        sentence: rsvpDigestSentence(digest),
        totalConfirmed,
        panelUrl: `${appUrl()}/panel/invitados`,
        settingsUrl: `${appUrl()}/panel/ajustes#avisos`,
      });

      let delivered = 0;
      for (const member of members) {
        try {
          const email = await coupleEmail(admin, member.user_id);
          if (!email) continue;
          const result = await sendEmail({ to: email, subject: rsvpDigestSubject(digest), html });
          if (!result.skipped) delivered += 1;
        } catch {
          Sentry.captureMessage("rsvp digest: envío fallido", { level: "error" });
        }
      }
      // Sin RESEND_API_KEY (local) no se marca: así no se pierde el de mañana en producción.
      if (delivered === 0) continue;
      await admin.from("events").insert({
        wedding_id: digest.weddingId,
        type: RSVP_DIGEST_EVENT,
        payload: { day_key: key, sent_on: today, recipients: delivered },
      });
      sent += 1;
    } catch {
      Sentry.captureMessage("rsvp digest: boda fallida", { level: "error" });
    }
  }
  return sent;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Deja constancia (Sentry, una vez por proceso) de variables esperadas que
  // faltan en producción, p. ej. RESEND_API_KEY: sin ella los correos se saltan.
  checkEnv();

  const admin = createAdminClient();
  // Mantenimiento independiente del backlog financiero. Máximo 50.000 por ejecución.
  let cleaned = 0;
  for (let batch = 0; batch < 5; batch += 1) {
    const { data, error } = await admin.rpc("cleanup_rate_limit_hits", { p_batch_size: 10000 });
    if (error || typeof data !== "number") {
      console.error("[cron] rate-limit cleanup unavailable");
      return NextResponse.json({ error: "maintenance_failed" }, { status: 503 });
    }
    cleaned += data;
    if (data < 10000) break;
  }
  // Borradores del creador caducados (builder_draft_stash.expires_at). Sin
  // grants para anon: solo service_role. Un fallo aquí no frena el resto.
  let draftsPurged = 0;
  try {
    // La tabla no tiene `id` (PK = email): devolver `id` hacía fallar el borrado entero.
    const { data, error } = await admin.from("builder_draft_stash").delete().lt("expires_at", new Date().toISOString()).select("email");
    if (error) Sentry.captureMessage("cron: purga de borradores fallida", { level: "warning", extra: { code: error.code } });
    else draftsPurged = data?.length ?? 0;
  } catch {
    Sentry.captureMessage("cron: purga de borradores fallida", { level: "warning" });
  }
  // Borrados pendientes (P2-5): antes que el resto, con su propio reloj.
  let deletions: { done: number; failed: number; stuck?: number; error?: string } = { done: 0, failed: 0 };
  try {
    deletions = await runPendingDeletions(admin);
    if (deletions.stuck) {
      // Alguna lleva STUCK_ATTEMPTS días fallando: ya no es un fallo pasajero.
      Sentry.captureMessage("cron: borrados pendientes atascados", { level: "error", extra: { failed: deletions.failed, stuck: deletions.stuck, code: deletions.error ?? null } });
    } else if (deletions.error || deletions.failed > 0) {
      Sentry.captureMessage("cron: borrados pendientes con fallos", { level: "warning", extra: { failed: deletions.failed, code: deletions.error ?? null } });
    }
  } catch {
    Sentry.captureMessage("cron: borrados pendientes fallidos", { level: "warning" });
  }
  const today = todayMadridIso();
  // Antes de la salida del MVP: el resumen de respuestas es del producto actual.
  let rsvpDigests = 0;
  try {
    rsvpDigests = await sendRsvpDigests(admin, today);
  } catch {
    Sentry.captureMessage("rsvp digest: fallo general", { level: "error" });
  }
  // Retención (§5.9, §5.3): antes de la salida del MVP, no depende de pagos.
  const retention = await runRetentionJobs(admin, today, appUrl());
  if (RSVP_MVP) return NextResponse.json({ cleaned, draftsPurged, deletions, rsvpDigests, retention, skipped: true, reason: "financial_features_in_backlog" });
  const sent = { tranches: 0, nudges: 0, digests: 0 };
  const errors: string[] = [];

  // ---- 1. Vencimientos a 7 días ----------------------------------------
  try {
    const target = isoDaysFromNow(today, 7);
    const { data: trancheRows } = await admin
      .from("payment_tranches")
      .select(
        "id, vendor_id, label, amount_cents, due_date, status, vendors(name, wedding_id, weddings(id, slug, couple_id, deleted_at))",
      )
      .eq("status", "pending")
      .eq("due_date", target);

    const due = selectTranchesToRemind(
      (trancheRows ?? []) as unknown as TrancheForReminder[],
      today,
    );

    for (const tranche of due) {
      const row = (trancheRows ?? []).find((r) => r.id === tranche.id) as
        | (TrancheForReminder & {
            vendors: { name: string; weddings: (WeddingContact & { deleted_at?: string | null }) | null } | null;
          })
        | undefined;
      const vendor = row?.vendors;
      const wedding = vendor?.weddings;
      // Boda en borrado (P2-5): sin recordatorios.
      if (!vendor || !wedding || wedding.deleted_at) continue;

      if (await alreadySent(admin, "reminder_tranche_7d", "tranche_id", tranche.id, wedding.id)) {
        continue;
      }
      const emails = await weddingMemberEmails(admin, wedding.id);
      if (emails.length === 0) continue;

      for (const email of emails) {
        await sendEmail({
          to: email,
          subject: `Vence pronto: ${vendor.name} (${tranche.label})`,
          html: trancheReminderHtml({
            vendorName: vendor.name,
            trancheLabel: tranche.label,
            amountFormatted: formatEurCents(tranche.amount_cents),
            dueDateFormatted: dueDateFormatter.format(
              new Date(`${tranche.due_date}T12:00:00`),
            ),
            panelUrl: `${appUrl()}/panel`,
          }),
        });
      }
      await admin.from("events").insert({
        wedding_id: wedding.id,
        type: "reminder_tranche_7d",
        payload: { tranche_id: tranche.id, sent_on: today },
      });
      sent.tranches += 1;
    }
  } catch (error) {
    errors.push(`tranches: ${error instanceof Error ? error.message : "?"}`);
  }

  // ---- 2. Empujón a 30 días de la boda ----------------------------------
  try {
    const target = isoDaysFromNow(today, NUDGE_BEFORE_WEDDING_DAYS);
    const { data: weddingRows } = await admin
      .from("weddings")
      .select("id, slug, couple_id, wedding_date")
      .eq("wedding_date", target)
      .is("deleted_at", null);

    const withCounts: (WeddingForNudge & WeddingContact)[] = [];
    for (const w of weddingRows ?? []) {
      const { count } = await admin
        .from("contributions")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", w.id)
        .eq("status", "confirmed");
      withCounts.push({
        id: w.id,
        slug: w.slug,
        couple_id: w.couple_id,
        wedding_date: w.wedding_date,
        confirmedContributions: count ?? 0,
      });
    }

    for (const wedding of selectWeddingsToNudge(withCounts, today)) {
      const contact = withCounts.find((w) => w.id === wedding.id);
      if (!contact) continue;
      if (await alreadySent(admin, "reminder_nudge_30d", "wedding_id", wedding.id, wedding.id)) {
        continue;
      }
      const emails = await weddingMemberEmails(admin, contact.id);
      if (emails.length === 0) continue;

      for (const email of emails) {
        await sendEmail({
          to: email,
          subject: `Faltan ${NUDGE_BEFORE_WEDDING_DAYS} días — compartid vuestro enlace`,
          html: shareNudgeHtml({
            daysLeft: NUDGE_BEFORE_WEDDING_DAYS,
            guestUrl: `${appUrl()}/b/${contact.slug}`,
            panelUrl: `${appUrl()}/panel`,
          }),
        });
      }
      await admin.from("events").insert({
        wedding_id: wedding.id,
        type: "reminder_nudge_30d",
        payload: { wedding_id: wedding.id, sent_on: today },
      });
      sent.nudges += 1;
    }
  } catch (error) {
    errors.push(`nudges: ${error instanceof Error ? error.message : "?"}`);
  }

  // ---- 3. Resumen semanal (lunes): parejas con preferencia 'semanal' ----
  // Solo se envía si hubo aportaciones confirmadas en los últimos 7 días —
  // sin actividad, sin correo. Idempotente por (boda, lunes) vía events.
  if (isMondayMadrid()) {
    try {
      const { data: weeklyWeddings } = await admin
        .from("weddings")
        .select("id, slug, couple_id, partner_name_1, partner_name_2, plan")
        .eq("notify_contribution", "semanal")
        .is("deleted_at", null);

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      for (const w of weeklyWeddings ?? []) {
        if (await alreadySent(admin, "digest_weekly", "week_key", `${w.id}:${today}`, w.id)) {
          continue;
        }
        const { data: weekRows } = await admin
          .from("contributions")
          .select("guest_name, total_cents, created_at")
          .eq("wedding_id", w.id)
          .eq("status", "confirmed")
          .gte("created_at", since)
          .order("created_at", { ascending: true });
        if (!weekRows || weekRows.length === 0) continue;

        const { data: allRows } = await admin
          .from("contributions")
          .select("total_cents")
          .eq("wedding_id", w.id)
          .eq("status", "confirmed");
        const allTotal = (allRows ?? []).reduce((s, r) => s + r.total_cents, 0);
        const weekTotal = weekRows.reduce((s, r) => s + r.total_cents, 0);

        const emails = await weddingMemberEmails(admin, w.id);
        if (emails.length === 0) continue;

        const remainingFreeSlots =
          w.plan === "free"
            ? Math.max(0, FREE_CONTRIBUTION_LIMIT - (allRows?.length ?? 0))
            : null;

        for (const email of emails) {
          await sendEmail({
            to: email,
            subject:
              weekRows.length === 1
                ? "Vuestra semana: 1 aportación nueva"
                : `Vuestra semana: ${weekRows.length} aportaciones nuevas`,
            html: weeklyDigestHtml({
              partnerNames: `${w.partner_name_1} y ${w.partner_name_2}`,
              weekItems: weekRows.map((r) => ({
                guestName: r.guest_name,
                amountFormatted: formatEurCents(r.total_cents),
              })),
              weekTotalFormatted: formatEurCents(weekTotal),
              allTotalFormatted: formatEurCents(allTotal),
              remainingFreeSlots,
              panelUrl: `${appUrl()}/panel`,
            }),
          });
        }
        await admin.from("events").insert({
          wedding_id: w.id,
          type: "digest_weekly",
          payload: { week_key: `${w.id}:${today}`, sent_on: today },
        });
        sent.digests += 1;
      }
    } catch (error) {
      errors.push(`digests: ${error instanceof Error ? error.message : "?"}`);
    }
  }

  // ---- 4. Limpieza de hits de rate limiting de más de 1 día ----------
  try {
    await admin
      .from("rate_limit_hits")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  } catch (error) {
    errors.push(`rl_cleanup: ${error instanceof Error ? error.message : "?"}`);
  }

  return NextResponse.json({ ok: errors.length === 0, sent, draftsPurged, deletions, rsvpDigests, errors });
}
