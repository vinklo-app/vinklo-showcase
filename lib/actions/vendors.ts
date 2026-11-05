"use server";

import { RSVP_MVP, BACKLOG_MESSAGE } from "@/lib/product-scope";

/**
 * Vendor portal actions (PLAN.md §1, §4, M2).
 *
 * Two access modes, deliberately different:
 *  - Couple-facing (inviteVendor, markTranchePaid): the session RLS
 *    client. Policies "vendors_all_couple" and "payment_tranches_all_couple"
 *    (see the core schema migration) already scope every read/write to the
 *    couple's own wedding, so an id belonging to another couple simply
 *    matches zero rows — no manual ownership check needed beyond that.
 *  - Vendor-facing (getVendorByToken, submitVendorSetup): the vendor never
 *    has a Supabase session (magic link, no login) — a service-role admin
 *    client is used, with invite_token as the ONLY scoping key. Every query
 *    here filters by token first and resolves vendor_id server-side; a
 *    vendor never sees the bote total or any other vendor's row.
 */

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/emails/send";
import { weddingMemberEmails } from "@/lib/data/wedding-member-emails";
import {
  vendorInviteHtml,
  vendorSetupNoticeHtml,
} from "@/lib/emails/templates";
import { BRAND_NAME } from "@/lib/brand";
import { parseEsAmountToCents } from "@/lib/amounts";
import {
  VENDOR_CATEGORIES,
  MAX_TRANCHES,
  MIN_TRANCHES,
  MAX_INVOICE_BYTES,
  isValidIbanEs,
  normalizeIban,
  type VendorCategory,
} from "@/lib/vendors";

export type VendorActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Probad de nuevo.";

/** Free tier limit (PLAN.md §3): 3 vendors, upgrade prompt beyond that. */
const FREE_VENDOR_LIMIT = 3;

/**
 * Límites anti-abuso (hardening 2026-09-07), vía rl_check atómico:
 * - inviteVendor envía un email a una dirección arbitraria: 30 invitaciones
 *   por pareja y día (una boda real no pasa de una decena de proveedores).
 * - submitVendorSetup sube un PDF de hasta 10 MB y añade plazos con un
 *   enlace sin sesión: 6 envíos por enlace y hora, y 12 por IP y hora.
 */
const INVITES_PER_DAY = 30;
const VENDOR_SUBMITS_PER_HOUR = 6;
const VENDOR_SUBMITS_PER_IP_HOUR = 12;

/** Clave de rate limit sin exponer el token en claro en rate_limit_hits. */
function tokenBucket(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

async function ownWedding(): Promise<{
  id: string;
  plan: "free" | "premium";
} | null> {
  const current = await getCurrentWedding();
  if (!current) return null;
  const { data } = await current.supabase
    .from("weddings")
    .select("id, plan")
    .eq("id", current.wedding.id)
    .maybeSingle();
  if (!data) return null;
  return data as { id: string; plan: "free" | "premium" };
}

// ============ Couple: invite a vendor ============

const inviteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribid el nombre del proveedor (mínimo 2 letras).")
    .max(120, "El nombre es demasiado largo."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("El email no parece correcto.")
    .max(160, "El email es demasiado largo."),
  category: z.enum(VENDOR_CATEGORIES, { message: "Elegid una categoría." }),
});

/**
 * Invita a un proveedor: crea su fila (RLS: solo en la boda de la sesión,
 * status inicial "invited") y envía el enlace mágico /v/[token] por email.
 * Gate del plan gratuito: 3 proveedores máximo.
 */
export async function inviteVendor(input: {
  name: string;
  email: string;
  category: VendorCategory;
}): Promise<VendorActionResult> {
  if (RSVP_MVP) return { ok: false, error: BACKLOG_MESSAGE };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? GENERIC_ERROR,
    };
  }

  const wedding = await ownWedding();
  if (!wedding) return { ok: false, error: GENERIC_ERROR };

  const invitesAllowed = await rateLimit(
    "vendor_invite",
    wedding.id,
    INVITES_PER_DAY,
    86_400,
  );
  if (!invitesAllowed) {
    return {
      ok: false,
      error:
        "Habéis enviado muchas invitaciones hoy. Probad de nuevo mañana o escribidnos.",
    };
  }

  const supabase = await createClient();

  if (wedding.plan === "free") {
    const { count } = await supabase
      .from("vendors")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", wedding.id);
    if ((count ?? 0) >= FREE_VENDOR_LIMIT) {
      return {
        ok: false,
        error:
          "El plan gratuito incluye 3 proveedores. Pasad a Premium para invitar más.",
      };
    }
  }

  const { data: vendor, error } = await supabase
    .from("vendors")
    .insert({
      wedding_id: wedding.id,
      name: parsed.data.name,
      email: parsed.data.email,
      category: parsed.data.category,
      status: "invited",
    })
    .select("id, invite_token")
    .single();

  if (error || !vendor) return { ok: false, error: GENERIC_ERROR };

  const { data: weddingNames } = await supabase
    .from("weddings")
    .select("partner_name_1, partner_name_2")
    .eq("id", wedding.id)
    .maybeSingle();

  const partnerNames = weddingNames
    ? `${weddingNames.partner_name_1} y ${weddingNames.partner_name_2}`
    : BRAND_NAME;

  const inviteUrl = `${appUrl()}/v/${vendor.invite_token}`;

  try {
    await sendEmail({
      to: parsed.data.email,
      subject: `${partnerNames} os han invitado a su portal de proveedores`,
      html: vendorInviteHtml({
        vendorName: parsed.data.name,
        partnerNames,
        inviteUrl,
      }),
    });
  } catch {
    // El proveedor ya está creado; si el email falla, la pareja siempre
    // puede copiar y reenviar el enlace a mano — no revertimos el alta.
  }

  revalidatePath("/panel/proveedores");
  return { ok: true };
}

// ============ Couple: mark a tranche as paid ============

const uuidSchema = z.uuid();

/**
 * Marca una tranche como pagada. RLS (payment_tranches_all_couple) exige
 * que la tranche cuelgue de un proveedor de la boda de la sesión, así que
 * un id ajeno actualiza cero filas — el .eq("status","pending") de más
 * evita reabrir un pago ya confirmado.
 */
export async function markTranchePaid(
  trancheId: string,
): Promise<VendorActionResult> {
  if (RSVP_MVP) return { ok: false, error: BACKLOG_MESSAGE };
  if (!uuidSchema.safeParse(trancheId).success) {
    return { ok: false, error: "Pago no válido." };
  }

  const wedding = await ownWedding();
  if (!wedding) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_tranches")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", trancheId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, error: GENERIC_ERROR };
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pago ya no está pendiente." };
  }

  revalidatePath("/panel/proveedores");
  revalidatePath("/panel");
  return { ok: true };
}

// ============ Vendor (magic link, no session): read ============

export interface VendorPortalData {
  vendor: {
    id: string;
    name: string;
    category: string;
    status: "invited" | "active";
  };
  weddingPartnerNames: string;
  invoice: { total_cents: number; notes: string | null } | null;
  tranches: {
    id: string;
    label: string;
    amount_cents: number;
    due_date: string | null;
    status: "pending" | "paid";
  }[];
}

/**
 * Resuelve el token del enlace mágico a los datos del proveedor. Sin
 * sesión — el token ES la autenticación. Solo expone columnas del propio
 * vendor + su última factura + sus tranches: nunca el bote de la boda ni
 * otros proveedores.
 */
export async function getVendorByToken(
  token: string,
): Promise<VendorPortalData | null> {
  // R12 (plan maestro §5.1): el portal /v está en backlog; aunque alguien
  // llame a la action directamente, no se resuelve ningún token.
  if (RSVP_MVP) return null;
  if (!uuidSchema.safeParse(token).success) return null;

  const admin = createAdminClient();
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, category, status, wedding_id, invite_token_expires_at")
    .eq("invite_token", token)
    .maybeSingle();
  if (!vendor) return null;

  // Seguridad (auditoría 2026-07-12): la invitación caduca a los 30 días
  // si el proveedor no completó el setup. Una vez activo, el enlace sigue
  // sirviendo para consultar el estado de sus cobros.
  if (
    vendor.status === "invited" &&
    vendor.invite_token_expires_at &&
    new Date(vendor.invite_token_expires_at) < new Date()
  ) {
    return null;
  }

  const [{ data: wedding }, { data: invoice }, { data: tranchesData }] =
    await Promise.all([
      admin
        .from("weddings")
        .select("partner_name_1, partner_name_2")
        .eq("id", vendor.wedding_id)
        .is("deleted_at", null)
        .maybeSingle(),
      admin
        .from("vendor_invoices")
        .select("total_cents, notes")
        .eq("vendor_id", vendor.id)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("payment_tranches")
        .select("id, label, amount_cents, due_date, status")
        .eq("vendor_id", vendor.id)
        .order("due_date", { ascending: true, nullsFirst: false }),
    ]);
  // Boda borrada o en borrado (P2-5): el portal deja de servirse.
  if (!wedding) return null;

  return {
    vendor: {
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      status: vendor.status,
    },
    weddingPartnerNames: wedding
      ? `${wedding.partner_name_1} y ${wedding.partner_name_2}`
      : BRAND_NAME,
    invoice: invoice ?? null,
    tranches: tranchesData ?? [],
  };
}

// ============ Vendor (magic link, no session): setup ============

const trancheInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Cada plazo necesita una etiqueta (p. ej. «Señal»).")
    .max(80, "La etiqueta del plazo es demasiado larga."),
  amountEur: z.string().trim().min(1, "Cada plazo necesita un importe."),
  dueDate: z.string().trim().optional(),
});

const setupSchema = z.object({
  token: z.uuid(),
  totalEur: z.string().trim().min(1, "Indicad el importe total."),
  iban: z
    .string()
    .trim()
    .min(1, "Indicad el IBAN de la cuenta a la que os pagan."),
  notes: z.string().trim().max(500, "La nota es demasiado larga.").optional(),
  tranches: z
    .array(trancheInputSchema)
    .min(MIN_TRANCHES, "Añadid al menos un plazo de pago.")
    .max(MAX_TRANCHES, `Podéis añadir como máximo ${MAX_TRANCHES} plazos.`),
});

/**
 * Alta del proveedor tras el enlace mágico: factura (PDF), importe total,
 * IBAN y N plazos de pago. FormData porque incluye un fichero — se llama
 * directamente desde el cliente (no como <form action>), igual que el
 * resto de acciones de este repo con useTransition.
 */
export async function submitVendorSetup(
  formData: FormData,
): Promise<VendorActionResult> {
  if (RSVP_MVP) return { ok: false, error: BACKLOG_MESSAGE };
  const tokenRaw = formData.get("token");
  const totalEurRaw = formData.get("totalEur");
  const ibanRaw = formData.get("iban");
  const notesRaw = formData.get("notes");
  const tranchesRaw = formData.get("tranchesJson");
  const file = formData.get("invoice");

  let tranchesParsed: unknown = [];
  if (typeof tranchesRaw === "string") {
    try {
      tranchesParsed = JSON.parse(tranchesRaw);
    } catch {
      return { ok: false, error: GENERIC_ERROR };
    }
  }

  const parsed = setupSchema.safeParse({
    token: typeof tokenRaw === "string" ? tokenRaw : "",
    totalEur: typeof totalEurRaw === "string" ? totalEurRaw : "",
    iban: typeof ibanRaw === "string" ? ibanRaw : "",
    notes: typeof notesRaw === "string" ? notesRaw : undefined,
    tranches: tranchesParsed,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? GENERIC_ERROR,
    };
  }

  // Anti-abuso: un enlace filtrado no puede machacar el calendario ni llenar
  // el bucket de facturas en bucle (por enlace y por IP).
  const [byToken, byIp] = await Promise.all([
    rateLimit(
      "vendor_setup",
      tokenBucket(parsed.data.token),
      VENDOR_SUBMITS_PER_HOUR,
      3600,
    ),
    rateLimit("vendor_setup_ip", await clientIp(), VENDOR_SUBMITS_PER_IP_HOUR, 3600),
  ]);
  if (!byToken || !byIp) {
    return {
      ok: false,
      error: "Habéis enviado varias veces seguidas. Esperad un momento, por favor.",
    };
  }

  const totalCents = parseEsAmountToCents(parsed.data.totalEur);
  if (totalCents === null || totalCents <= 0) {
    return { ok: false, error: "El importe total no parece correcto." };
  }

  if (!isValidIbanEs(parsed.data.iban)) {
    return {
      ok: false,
      error: "El IBAN no parece correcto (ESxx xxxx xxxx xxxx xxxx xxxx).",
    };
  }
  const iban = normalizeIban(parsed.data.iban);

  const tranches: {
    label: string;
    amount_cents: number;
    due_date: string | null;
  }[] = [];
  for (const tranche of parsed.data.tranches) {
    const cents = parseEsAmountToCents(tranche.amountEur);
    if (cents === null || cents <= 0) {
      return {
        ok: false,
        error: `El importe del plazo «${tranche.label}» no parece correcto.`,
      };
    }
    let dueDate: string | null = null;
    if (tranche.dueDate && tranche.dueDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tranche.dueDate)) {
        return {
          ok: false,
          error: `La fecha del plazo «${tranche.label}» no parece correcta.`,
        };
      }
      dueDate = tranche.dueDate;
    }
    tranches.push({ label: tranche.label, amount_cents: cents, due_date: dueDate });
  }

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Adjuntad la factura o el presupuesto en PDF." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, error: "La factura debe ser un PDF." };
  }
  if (file.size > MAX_INVOICE_BYTES) {
    return { ok: false, error: "La factura no puede superar los 10 MB." };
  }

  const admin = createAdminClient();
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, status, iban, wedding_id, invite_token_expires_at")
    .eq("invite_token", parsed.data.token)
    .maybeSingle();
  if (!vendor) return { ok: false, error: "Enlace no válido." };
  // Boda borrada o en borrado (P2-5): el portal no admite envíos.
  const { data: liveWedding } = await admin
    .from("weddings")
    .select("id")
    .eq("id", vendor.wedding_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!liveWedding) return { ok: false, error: "Enlace no válido." };

  // Seguridad (auditoría 2026-07-12):
  // 1) La invitación caduca a los 30 días sin completar el setup.
  if (
    vendor.status === "invited" &&
    vendor.invite_token_expires_at &&
    new Date(vendor.invite_token_expires_at) < new Date()
  ) {
    return {
      ok: false,
      error:
        "Este enlace ha caducado. Pedid a la pareja que os envíe una invitación nueva.",
    };
  }
  // 2) Con el proveedor ya activo, el IBAN de cobro queda bloqueado: un
  //    reenvío no puede cambiarlo en silencio (el portador de un enlace
  //    filtrado podría desviar los cobros). Cambios de IBAN → la pareja
  //    reinvita o se gestiona con ella.
  const ibanChanged =
    Boolean(vendor.iban) && normalizeIban(iban) !== normalizeIban(vendor.iban ?? "");
  if (vendor.status === "active" && ibanChanged) {
    return {
      ok: false,
      error:
        "El IBAN ya está establecido y no puede cambiarse desde este enlace. Contactad con la pareja para actualizarlo.",
    };
  }

  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "factura.pdf";
  const filePath = `${vendor.id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from("invoices")
    .upload(filePath, file, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    return { ok: false, error: "No hemos podido subir la factura. Probad de nuevo." };
  }

  const { error: invoiceError } = await admin.from("vendor_invoices").insert({
    vendor_id: vendor.id,
    file_path: filePath,
    total_cents: totalCents,
    notes:
      parsed.data.notes && parsed.data.notes !== "" ? parsed.data.notes : null,
  });
  if (invoiceError) return { ok: false, error: GENERIC_ERROR };

  const { error: tranchesError } = await admin.from("payment_tranches").insert(
    tranches.map((t) => ({
      vendor_id: vendor.id,
      label: t.label,
      amount_cents: t.amount_cents,
      due_date: t.due_date,
    })),
  );
  if (tranchesError) return { ok: false, error: GENERIC_ERROR };

  await admin
    .from("vendors")
    .update({ status: "active", iban })
    .eq("id", vendor.id);

  // 3) La pareja se entera de CADA envío del portal (nada silencioso): todos
  // los miembros de la boda (§5.11), no solo el dueño original.
  try {
    const emails = await weddingMemberEmails(admin, vendor.wedding_id);
    for (const email of emails) {
      await sendEmail({
        to: email,
        subject: `${vendor.name} ha actualizado su ficha de proveedor`,
        html: vendorSetupNoticeHtml({
          vendorName: vendor.name,
          panelUrl: `${appUrl()}/panel/proveedores`,
          ibanChanged: !vendor.iban || ibanChanged,
        }),
      });
    }
  } catch (noticeError) {
    // El aviso nunca bloquea el setup del proveedor.
    console.error("No se pudo avisar a la pareja del setup:", noticeError);
  }

  revalidatePath(`/v/${parsed.data.token}`);
  return { ok: true };
}
