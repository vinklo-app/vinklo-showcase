"use server";

/**
 * Segunda cuenta de pareja (2026-10-15, migración 20261015100000).
 *
 * - Invitar / reenviar / cancelar: cliente de sesión + RLS
 *   (wedding_member_invites, `owns_wedding`). La boda sale SIEMPRE de
 *   getCurrentWedding(); nunca de un id del cliente.
 * - El token viaja solo en el correo; en la base se guarda su SHA-256.
 * - Aceptar: RPC `accept_wedding_invite` (definer) exige email de la sesión,
 *   token vigente, que el usuario no tenga otra boda y máximo 2 miembros.
 * - Rate limit por usuario (fail-closed) en invitar/reenviar y en aceptar.
 *
 * Exports = endpoints: solo lo que llama la UI.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentWedding, isMissingMembership, type WeddingRole } from "@/lib/data/current-wedding";
import { partnerInviteHtml } from "@/lib/emails/templates";
import { sendEmail } from "@/lib/emails/send";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { JOIN_COOKIE, JOIN_TOKEN_RE, acceptErrorMessage, type AcceptCode } from "@/lib/partner/join";

const INVITE_DAYS = 7;
const INVITE_MAX_PER_HOUR = 5;
const ACCEPT_MAX = 10;
const ACCEPT_WINDOW_SECS = 15 * 60;

const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const GENERIC_ERROR = "No hemos podido guardarlo. Probad de nuevo en un momento.";
const LIMIT_ERROR = "Habéis enviado varias invitaciones seguidas. Esperad un rato y probad de nuevo.";
const MISSING_ERROR = "La cuenta compartida aún no está disponible. Probad más tarde.";

export type PartnerMember = { email: string; role: WeddingRole; isMe: boolean; since: string };
export type PartnerInvite = { email: string; sentAt: string; expiresAt: string; expired: boolean };
export type PartnerState =
  | { ok: true; available: true; role: WeddingRole; myEmail: string | null; members: PartnerMember[]; invite: PartnerInvite | null }
  | { ok: true; available: false }
  | { ok: false; error: string };

export type PartnerActionResult =
  | { ok: true; emailed: boolean; devLink?: string }
  | { ok: false; error: string };

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Escribid un correo válido."));

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function newToken(): { token: string; hash: string } {
  // 32 bytes → 43 caracteres base64url (JOIN_TOKEN_RE y el regex de la RPC).
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token, "utf8").digest("hex") };
}

function expiresAt(): string {
  return new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000).toISOString();
}

/** Envía el correo. Sin RESEND_API_KEY (local) devuelve el enlace solo fuera de producción. */
async function deliver(to: string, inviterEmail: string | null, token: string): Promise<{ emailed: boolean; devLink?: string }> {
  const joinUrl = `${appUrl()}/unirse?token=${encodeURIComponent(token)}`;
  const result = await sendEmail({
    to,
    subject: "Te invitan a preparar vuestra boda en Vinklo",
    html: partnerInviteHtml({ inviterEmail: inviterEmail ?? "Tu pareja", joinUrl, days: INVITE_DAYS }),
  });
  if (result.skipped) {
    return process.env.NODE_ENV === "production" ? { emailed: false } : { emailed: false, devLink: joinUrl };
  }
  return { emailed: true };
}

/** Estado de «Vuestra pareja» para Ajustes. */
export async function getPartnerState(): Promise<PartnerState> {
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: SESSION_ERROR };
  const { supabase, wedding } = current;
  const [members, invites] = await Promise.all([
    supabase.rpc("wedding_partners"),
    supabase.from("wedding_member_invites").select("email, sent_at, expires_at")
      .eq("wedding_id", wedding.id).is("accepted_at", null).limit(1).maybeSingle(),
  ]);
  if (isMissingMembership(members.error) || members.error?.code === "PGRST202" || isMissingMembership(invites.error)) {
    return { ok: true, available: false };
  }
  if (members.error || invites.error) return { ok: false, error: "No hemos podido cargar vuestra pareja. Recargad la página." };
  const rows = (members.data ?? []) as Array<{ email: string | null; role: string; created_at: string; is_me: boolean }>;
  const invite = invites.data as { email: string; sent_at: string; expires_at: string } | null;
  return {
    ok: true,
    available: true,
    role: current.role,
    myEmail: current.userEmail,
    members: rows.map(row => ({ email: row.email ?? "", role: row.role === "partner" ? "partner" : "owner", isMe: row.is_me, since: row.created_at })),
    invite: invite ? { email: invite.email, sentAt: invite.sent_at, expiresAt: invite.expires_at, expired: Date.parse(invite.expires_at) <= Date.now() } : null,
  };
}

function refresh() { revalidatePath("/panel/ajustes"); }

/** Invitar a la pareja por email (una invitación pendiente por boda). */
export async function invitePartner(rawEmail: string): Promise<PartnerActionResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, error: "Escribid un correo válido." };
  const email = parsed.data;
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: SESSION_ERROR };
  if (current.userEmail && current.userEmail.toLowerCase() === email) return { ok: false, error: "Ese es vuestro propio correo: escribid el de vuestra pareja." };
  if (!(await rateLimit("pareja-invitar", current.userId, INVITE_MAX_PER_HOUR, 3600))) return { ok: false, error: LIMIT_ERROR };

  const { token, hash } = newToken();
  const { error } = await current.supabase.from("wedding_member_invites").insert({
    wedding_id: current.wedding.id, email, token_hash: hash, expires_at: expiresAt(), created_by: current.userId,
  });
  if (error) {
    if (isMissingMembership(error)) return { ok: false, error: MISSING_ERROR };
    const detail = `${error.message ?? ""} ${error.details ?? ""}`;
    if (error.code === "23505") return { ok: false, error: "Ya hay una invitación pendiente: reenviadla o cancelad la anterior." };
    if (detail.includes("wedding_members_full")) return { ok: false, error: "Ya sois dos en esta boda." };
    if (detail.includes("wedding_invite_self")) return { ok: false, error: "Esa persona ya gestiona esta boda." };
    console.error("[pareja] invite insert failed", error.code);
    return { ok: false, error: GENERIC_ERROR };
  }
  try {
    const sent = await deliver(email, current.userEmail, token);
    refresh();
    return { ok: true, ...sent };
  } catch {
    // Sin correo la invitación no sirve: se retira para poder repetir.
    await current.supabase.from("wedding_member_invites").delete().eq("wedding_id", current.wedding.id).is("accepted_at", null);
    refresh();
    return { ok: false, error: "No hemos podido enviar el correo. Probad de nuevo en un momento." };
  }
}

/** Reenviar: enlace nuevo (el anterior deja de valer) y 7 días más. */
export async function resendPartnerInvite(): Promise<PartnerActionResult> {
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: SESSION_ERROR };
  if (!(await rateLimit("pareja-invitar", current.userId, INVITE_MAX_PER_HOUR, 3600))) return { ok: false, error: LIMIT_ERROR };
  const { token, hash } = newToken();
  const { data, error } = await current.supabase.from("wedding_member_invites")
    .update({ token_hash: hash, expires_at: expiresAt(), sent_at: new Date().toISOString() })
    .eq("wedding_id", current.wedding.id).is("accepted_at", null)
    .select("email").maybeSingle();
  if (error) return { ok: false, error: isMissingMembership(error) ? MISSING_ERROR : GENERIC_ERROR };
  if (!data) { refresh(); return { ok: false, error: "No hay ninguna invitación pendiente." }; }
  try {
    const sent = await deliver((data as { email: string }).email, current.userEmail, token);
    refresh();
    return { ok: true, ...sent };
  } catch {
    return { ok: false, error: "No hemos podido enviar el correo. Probad de nuevo en un momento." };
  }
}

/** Cancelar la invitación pendiente: su enlace deja de valer. */
export async function cancelPartnerInvite(): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: SESSION_ERROR };
  const { error } = await current.supabase.from("wedding_member_invites").delete()
    .eq("wedding_id", current.wedding.id).is("accepted_at", null);
  if (error) return { ok: false, error: isMissingMembership(error) ? MISSING_ERROR : GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** Quitar el acceso a la pareja (solo quien creó la boda). */
export async function removePartner(): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: SESSION_ERROR };
  if (current.role !== "owner") return { ok: false, error: "Solo quien creó la boda puede quitar el acceso." };
  const { error } = await current.supabase.rpc("remove_wedding_partner");
  if (error) return { ok: false, error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ /unirse

export type AcceptState = { error: string | null; code: AcceptCode | null };

/** Sin sesión: guarda el token en una cookie y lleva a /login (vuelve por /auth/continuar). */
export async function continueToLogin(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (JOIN_TOKEN_RE.test(token)) {
    (await cookies()).set(JOIN_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 24 * 3600,
    });
  }
  redirect("/login?unirse=1");
}

/** «No soy yo»: cierra la sesión y entra con otro correo conservando el token. */
export async function switchJoinAccount(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await continueToLogin(formData);
}

/** «Ahora no»: olvida el token pendiente. */
export async function dismissJoin(): Promise<void> {
  (await cookies()).delete(JOIN_COOKIE);
  const current = await getCurrentWedding();
  redirect(current ? "/panel" : "/onboarding");
}

/** Aceptar la invitación con la sesión actual. */
export async function acceptPartnerInvite(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  if (!JOIN_TOKEN_RE.test(token)) return { error: acceptErrorMessage("invalid"), code: "invalid" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: acceptErrorMessage("unauthenticated"), code: "unauthenticated" };
  if (!(await rateLimit("pareja-unirse", user.id, ACCEPT_MAX, ACCEPT_WINDOW_SECS))) {
    return { error: "Demasiados intentos. Esperad unos minutos y probad de nuevo.", code: null };
  }
  const { data, error } = await supabase.rpc("accept_wedding_invite", { p_token: token });
  if (error) {
    console.error("[pareja] accept failed", error.code);
    return { error: "No hemos podido completar la invitación. Probad de nuevo en un momento.", code: null };
  }
  const code = String(data) as AcceptCode;
  const jar = await cookies();
  jar.delete(JOIN_COOKIE);
  if (code === "ok" || code === "already_member") {
    revalidatePath("/panel", "layout");
    redirect("/panel?pareja=1");
  }
  return { error: acceptErrorMessage(code), code };
}
