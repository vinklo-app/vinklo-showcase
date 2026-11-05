"use server";

/**
 * «Eliminar nuestra boda» y «Eliminar mi cuenta» (Ajustes, plan maestro
 * §5.10, S2; dos fases desde la revisión Fable 2026-10-11, P2-5).
 *
 * Boda: solo el dueño (rol owner de getCurrentWedding), escribiendo la
 * dirección de la boda (slug) para confirmar. Fase 1: la RPC
 * wedding_mark_deleted (con la SESIÓN: vuelve a comprobar que es el dueño)
 * marca la boda y apunta la purga; desde ahí no se sirve a nadie. Fase 2, en
 * el momento: fila con cascada y Storage (lib/data/account-deletion.ts). Si
 * la fase 2 falla no se pide nada a la pareja: el cron diario la termina.
 * Así un fallo a medias nunca deja fotos borradas y la boda viva.
 *
 * Cuenta: escribiendo el propio correo. Según la boda (planAccountDeletion):
 * sin boda o pareja secundaria -> solo la cuenta; dueño con pareja -> la boda
 * pasa a la pareja; dueño sin pareja -> la boda se marca y se borra entera.
 * Después se apunta y se borra el usuario de Auth con service_role (perfil y
 * membresía caen en cascada); si Auth falla, lo reintenta el cron.
 *
 * Ambas: rate limit por usuario, Sentry sin datos personales (fase y
 * código), cierre de sesión y redirección a «/» con una cookie de aviso.
 * Exports = endpoints: solo estas dos acciones.
 */
import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  finishPendingDeletion,
  markWeddingDeleted,
  planAccountDeletion,
  purgeEmailLeftovers,
  queueUserDeletion,
  transferWedding,
} from "@/lib/data/account-deletion";
import { DELETION_NOTICE_COOKIE, DELETION_NOTICE_MAX_AGE, normalizeConfirmation, type DeletionNoticeKind } from "@/lib/deletion-notice";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DeletionState = { error: string | null };

const SESSION_ERROR = "La sesión ha caducado. Volved a entrar.";
const RATE_ERROR = "Demasiados intentos seguidos. Esperad unos minutos y probad de nuevo.";
const GENERIC_ERROR = "No hemos podido completarlo. No se ha borrado nada; probad de nuevo en un momento.";
const MAX_ATTEMPTS = 5;
const WINDOW_SECS = 3600;

function report(message: string, phase: string, code?: string) {
  Sentry.captureMessage(message, { level: "error", extra: { phase, code: code ?? null } });
}

async function finish(kind: DeletionNoticeKind): Promise<never> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // La sesión puede no existir ya (cuenta borrada): las cookies se limpian igual.
  }
  (await cookies()).set(DELETION_NOTICE_COOKIE, kind, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DELETION_NOTICE_MAX_AGE,
  });
  redirect("/");
}

export async function deleteWedding(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const current = await getCurrentWedding();
  if (!current) return { error: SESSION_ERROR };
  if (current.role !== "owner") return { error: "Solo quien creó la boda puede eliminarla." };
  if (normalizeConfirmation(formData.get("confirm")) !== current.wedding.slug.toLowerCase()) {
    return { error: `Escribid exactamente «${current.wedding.slug}» para confirmar.` };
  }
  if (!(await rateLimit("borrar-boda", current.userId, MAX_ATTEMPTS, WINDOW_SECS))) return { error: RATE_ERROR };

  const marked = await markWeddingDeleted(current.supabase, current.wedding.id);
  if (marked === "forbidden") return { error: "Solo quien creó la boda puede eliminarla." };
  if (marked !== "ok") {
    report("borrar boda: marca fallida", "mark", marked);
    return { error: GENERIC_ERROR };
  }
  // La boda ya no se sirve: lo que falle ahora lo termina el cron diario.
  const purge = await finishPendingDeletion("wedding", current.wedding.id);
  if (!purge.ok) report("borrar boda: purga pendiente para el cron", purge.phase, purge.code);
  return finish("boda");
}

/** Bloqueo «indefinido» (100 años) mientras el cron termina de borrar el usuario. */
const BAN_UNTIL_PURGED = "876000h";

export async function deleteAccount(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: SESSION_ERROR };
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email || normalizeConfirmation(formData.get("confirm")) !== email) {
    return { error: "Escribe tu correo exactamente como lo usas para entrar." };
  }
  if (!(await rateLimit("borrar-cuenta", user.id, MAX_ATTEMPTS, WINDOW_SECS))) return { error: RATE_ERROR };

  const admin = createAdminClient();
  let plan;
  try {
    plan = await planAccountDeletion(user.id, admin);
  } catch {
    report("borrar cuenta: lectura de boda fallida", "plan");
    return { error: GENERIC_ERROR };
  }

  if (plan.kind === "owner-with-partner") {
    if (!(await transferWedding(plan.weddingId, user.id, plan.partnerId, admin))) {
      report("borrar cuenta: transferencia fallida", "transfer");
      return { error: GENERIC_ERROR };
    }
  } else if (plan.kind === "owner-alone") {
    const marked = await markWeddingDeleted(supabase, plan.weddingId);
    if (marked !== "ok") {
      report("borrar cuenta: marca de la boda fallida", "mark", marked);
      return { error: GENERIC_ERROR };
    }
    const purge = await finishPendingDeletion("wedding", plan.weddingId, admin);
    if (!purge.ok) report("borrar cuenta: purga de la boda pendiente para el cron", purge.phase, purge.code);
  }

  // Apuntado ANTES de intentarlo: si Auth falla, el cron lo reintenta.
  const queued = await queueUserDeletion(user.id, admin);
  await purgeEmailLeftovers(email, admin);
  const auth = await finishPendingDeletion("user", user.id, admin);
  if (!auth.ok) {
    report("borrar cuenta: usuario de Auth pendiente", auth.phase, auth.code);
    // Apuntado para el cron: hasta que lo borre, que no pueda volver a entrar
    // (best-effort; el borrado del cron lo deja sin efecto). Sin apunte NO se
    // bloquea: tienen que poder entrar a pedirlo otra vez.
    if (queued) {
      try {
        await admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_UNTIL_PURGED });
      } catch { /* El cron lo borra igual. */ }
    }
    // Sin apunte ni borrado no hay reintento posible: que lo vuelvan a pedir.
    if (!queued) {
      return {
        error:
          plan.kind === "owner-alone"
            ? "Hemos borrado la boda, pero no la cuenta. Probad de nuevo en un momento."
            : GENERIC_ERROR,
      };
    }
  }
  return finish("cuenta");
}
