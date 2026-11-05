"use server";

/**
 * Server actions de la boda: creación (onboarding) y alta de cobros
 * (Stripe Connect Express).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { weddingSettingsSchema, isValidWeddingDate, pageConfigSchema, rsvpDeadlineIssue, RSVP_DEADLINE_AFTER_WEDDING, type WeddingPageConfig, type WeddingSettingsInput } from "@/lib/wedding-settings";
import { madridToday } from "@/lib/rsvp-window";
import { RSVP_MVP } from "@/lib/product-scope";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding, getCurrentWeddingFresh } from "@/lib/data/current-wedding";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { documentFromLegacy, findScene, parseSiteDocument, type SiteDocument } from "@/lib/site-document";
import { creatorSiteDocument } from "@/lib/wedding-builder";
import { syncDraftFromLegacy } from "@/lib/data/site";
import { clearStashedDraft } from "@/lib/actions/builder-stash";
import { finishPendingDeletion } from "@/lib/data/account-deletion";
import { buildBaseSlug, slugCandidate } from "@/lib/wedding-slug";

// ---------------------------------------------------------------------------
// createWedding
// ---------------------------------------------------------------------------

export interface CreateWeddingInput {
  partnerName1: string;
  partnerName2: string;
  /** Fecha de la boda en formato YYYY-MM-DD. */
  weddingDate: string;
  guestCountEst: number;
  pageConfig?: Partial<WeddingPageConfig>;
  /** Referencia interna para estadísticas (el invitado elige importe libre
   *  desde 2026-07-08); si no llega, 150 € por defecto. */
  cubiertoPriceCents?: number;
  /** Teléfono móvil ES para Bizum (opcional). */
  bizumPhone?: string;
}

export interface ActionError {
  error: string;
}

/** Móvil español: 9 dígitos empezando por 6 o 7 (tras normalizar prefijo). */
const ES_MOBILE_RE = /^[67]\d{8}$/;

function normalizeEsMobile(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "").replace(/^\+34|^0034|^34(?=\d{9}$)/, "");
  return ES_MOBILE_RE.test(digits) ? digits : null;
}

const createWeddingSchema = z.object({
  pageConfig: pageConfigSchema.default(() => pageConfigSchema.parse({})),
  partnerName1: z
    .string()
    .trim()
    .min(2, "Escribid el primer nombre (mínimo 2 letras).")
    .max(80, "El nombre es demasiado largo."),
  partnerName2: z
    .string()
    .trim()
    .min(2, "Escribid el segundo nombre (mínimo 2 letras).")
    .max(80, "El nombre es demasiado largo."),
  weddingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegid la fecha de la boda.")
    .refine(isValidWeddingDate, "La fecha no es válida."),
  guestCountEst: z
    .number()
    .int("El número de invitados debe ser un número entero.")
    .min(1, "Al menos un invitado, ¿no?")
    .max(2000, "Máximo 2.000 invitados."),
  cubiertoPriceCents: z
    .number()
    .int()
    .min(1000)
    .max(100000)
    .default(15000),
  bizumPhone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .refine(
      (v) => v === undefined || normalizeEsMobile(v) !== null,
      "El teléfono de Bizum debe ser un móvil español (empieza por 6 o 7)."
    ),
});

/**
 * Crea la boda de la pareja autenticada. Valida con zod, genera un slug
 * único (ana-y-luis, ana-y-luis-2, …) e inserta con el cliente RLS
 * (couple_id = auth.uid()). Redirige a /panel al terminar.
 */
/** Documento en «Como una web» (sin el ritmo de la Story, que ahí no aplica). */
function asWebLayout(doc: SiteDocument): SiteDocument {
  const next: SiteDocument = { ...doc, layout: "web" };
  delete next.storySeconds;
  return next;
}

export async function createWedding(
  input: CreateWeddingInput
): Promise<ActionError> {
  const outcome = await createWeddingCore(input, undefined, true);
  if (outcome.kind === "error") return { error: outcome.error };
  redirect(outcome.kind === "redirect" ? outcome.to : "/panel");
}

/** Qué borrador v1 quedó al crear (sin publicar desde el creador): el documento del creador, el adaptador o nada (falló). */
export type InitialSite = "creator" | "legacy" | "failed";

export interface CreatorWeddingInput extends CreateWeddingInput {
  /** El documento que la pareja vio en el creador (sin foto). Se valida y sanea en el servidor. */
  site?: unknown;
}

export type CreatorWeddingResult =
  | { ok: true; site: InitialSite }
  | { ok: false; error: string }
  | { ok: false; redirect: "/login" | "/panel" };

/**
 * Lo mismo que `createWedding` para el creador (/crear → /onboarding), pero
 * SIN `redirect()`: devuelve el resultado y el creador sigue (foto) y navega.
 *
 * Regresión 8-oct-2026 (webs sin sobre): el creador confiaba en que el
 * `redirect("/panel")` de la acción le llegase como excepción para terminar
 * el trabajo (guardar diseño, sobre, módulos). Si Next no puede servir el
 * destino dentro de la respuesta de la acción, la promesa se resuelve con
 * `undefined` y navega a pantalla completa: ese trabajo no llegaba a
 * ejecutarse y la web quedaba publicada con el adaptador v1 (sin sobre, sin
 * paleta, sin maqueta). Ahora el borrador v1 ya es el documento del
 * creador (`site`; se publica una vez, al final, desde el cliente) y la
 * navegación la decide el cliente.
 */
export async function createWeddingFromCreator(input: CreatorWeddingInput): Promise<CreatorWeddingResult> {
  // El creador crea el borrador completo SIN publicar: publica una sola vez
  // al final, con las fotos ya subidas (`finishCreatedWedding`).
  const outcome = await createWeddingCore(input, input?.site, false);
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind === "redirect") return { ok: false, redirect: outcome.to };
  return { ok: true, site: outcome.site };
}

const PREVIOUS_WEDDING_PENDING = "Estamos terminando de borrar vuestra boda anterior. Probad de nuevo en unos minutos.";

/** Boda propia ya marcada para borrar (la sesión no la ve: RLS). Nunca lanza. */
async function markedWeddingOf(userId: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from("weddings").select("id").eq("couple_id", userId).not("deleted_at", "is", null).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

type CreateOutcome =
  | { kind: "created"; site: InitialSite }
  | { kind: "error"; error: string }
  | { kind: "redirect"; to: "/login" | "/panel" };

async function createWeddingCore(input: CreateWeddingInput, site: unknown, publishNow: boolean): Promise<CreateOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { kind: "redirect", to: "/login" };
  }

  const parsed = createWeddingSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { kind: "error", error: first?.message ?? "Revisad los datos del formulario." };
  }

  // Si ya tienen boda (propia o aceptada de su pareja), al panel directamente.
  if (await getCurrentWedding(supabase)) {
    return { kind: "redirect", to: "/panel" };
  }

  const values = parsed.data;
  const bizumPhone =
    values.bizumPhone !== undefined
      ? normalizeEsMobile(values.bizumPhone)
      : null;

  // La constraint única resuelve colisiones sin consultar bodas ajenas.
  const base = buildBaseSlug(values.partnerName1, values.partnerName2, values.weddingDate);
  let created = false;
  let weddingId: string | null = null;
  let purgeRetried = false;
  for (let attempt = 1; attempt <= 20 && !created; attempt += 1) {
    // Nunca un slug reservado (ana-y-luis → /demo, rutas de la app).
    const candidate = slugCandidate(base, attempt);
    if (!candidate) continue;

    const { data: inserted, error: insertError } = await supabase
      .from("weddings")
      .insert({
        slug: candidate,
        couple_id: user.id,
        partner_name_1: values.partnerName1,
        partner_name_2: values.partnerName2,
        wedding_date: values.weddingDate,
        guest_count_est: values.guestCountEst,
        page_config: values.pageConfig,
        cubierto_price_cents: values.cubiertoPriceCents,
        bizum_phone: bizumPhone,
      })
      .select("id")
      .single();

    if (!insertError) {
      created = true;
      weddingId = (inserted as { id: string } | null)?.id ?? null;
    } else if (insertError.code === "23505") {
      // Otra pestaña puede haber creado la boda de esta pareja en paralelo,
      // o la pareja aceptó entretanto la invitación a otra boda (un usuario,
      // una boda: wedding_members_one_wedding_per_user / weddings_one_per_couple_idx).
      const detail = `${insertError.message ?? ""} ${insertError.details ?? ""}`;
      if (await getCurrentWeddingFresh(supabase)) return { kind: "redirect", to: "/panel" };
      // La boda anterior está marcada para borrar (P2-5) y su fase 2 no
      // terminó: se reintenta una vez aquí; si sigue, se avisa sin mandar al
      // panel (que la oculta y devolvería a /onboarding: bucle).
      if (/weddings_one_per_couple_idx/.test(detail)) {
        const pending = await markedWeddingOf(user.id);
        if (pending) {
          if (!purgeRetried) {
            purgeRetried = true;
            await finishPendingDeletion("wedding", pending);
            attempt -= 1; // mismo slug
            continue;
          }
          return { kind: "error", error: PREVIOUS_WEDDING_PENDING };
        }
      }
      if (/wedding_members_one_wedding_per_user|weddings_one_per_couple_idx/.test(detail)) {
        return { kind: "error", error: "Esta cuenta ya gestiona una boda. Entrad en el panel." };
      }
      // Si no, colisión de slug: se prueba el siguiente sufijo.
    } else {
      // 23505 = colisión de slug por carrera: probamos el siguiente sufijo.
      return { kind: "error", error: "No hemos podido crear la boda. Probad de nuevo." };
    }
  }

  if (!created) {
    return { kind: "error", error: "No hemos podido crear la boda. Probad de nuevo." };
  }

  // El borrador v1 se crea siempre. Solo `createWedding` (sin paso posterior)
  // lo publica aquí; el creador lo publica al final, con las fotos subidas,
  // para que ningún invitado vea una portada sin foto. Si falla, la boda ya
  // existe y /b/[slug] se sirve por el adaptador.
  const initial = weddingId ? await createInitialSite(supabase, weddingId, values, site, publishNow) : "failed";
  // La boda existe: la copia del borrador en servidor ya no hace falta.
  await clearStashedDraft();

  return { kind: "created", site: initial };
}

/**
 * Crea la fila `wedding_sites` (borrador v1) y, solo si `publishNow`, la
 * publica con el RPC atómico. El borrador
 * v1 es el documento del creador (`site`, saneado por `creatorSiteDocument`:
 * sobre, paleta, maqueta, escenas y módulos tal como los vio la pareja) o,
 * si no llega o no vale, el adaptador de los valores recién creados. Cliente
 * de sesión: RLS. Nunca lanza; un fallo se registra y la creación de la boda
 * sigue adelante.
 */
async function createInitialSite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weddingId: string,
  values: { partnerName1: string; partnerName2: string; weddingDate: string; pageConfig: WeddingPageConfig },
  site: unknown,
  publishNow: boolean,
): Promise<InitialSite> {
  try {
    const legacy = documentFromLegacy({
      partner_name_1: values.partnerName1,
      partner_name_2: values.partnerName2,
      wedding_date: values.weddingDate,
      cover_image_url: null,
      page_config: values.pageConfig,
      agenda: [],
    });
    const sanitized = site === undefined ? null : creatorSiteDocument(site, legacy);
    if (site !== undefined && !sanitized) console.error("[wedding] creator document rejected; publishing the adapter");
    const fromCreator = sanitized ? await seedAgenda(supabase, weddingId, sanitized, values) : null;
    // Una boda nueva nunca nace en Story (Premium desde el 13-oct-2026, sin
    // venta): ni el creador ni el adaptador de respaldo. Se guarda en web.
    const draft = asWebLayout(fromCreator ?? legacy);
    const { error: siteError } = await supabase
      .from("wedding_sites")
      .insert({ wedding_id: weddingId, draft_document: draft, draft_version: 1 });
    if (siteError) {
      console.error("[wedding] initial site insert failed", siteError.code);
      return "failed";
    }
    if (publishNow) {
      const { error: publishError } = await supabase.rpc("wedding_site_publish", { p_wedding_id: weddingId, p_expected_version: 1, p_document: draft });
      if (publishError) {
        console.error("[wedding] initial site publish failed", publishError.code);
        return "failed";
      }
    }
    return fromCreator ? "creator" : "legacy";
  } catch (cause) {
    console.error("[wedding] initial site draft threw", cause instanceof Error ? cause.message : "unknown");
    return "failed";
  }
}

/**
 * El programa del creador («Vuestro día») vive en `wedding_agenda_items`,
 * la misma tabla que edita el panel (El día): si solo estuviera en el
 * documento, el primer guardado de ajustes o agenda lo borraría
 * (`syncDraftFromLegacy` reconstruye el programa desde la tabla). Inserta las
 * filas y devuelve el documento con el programa tal como lo pinta el
 * adaptador a partir de ellas (mismos ids: la próxima sincronización no
 * cambia nada). Si la inserción falla se publica igualmente (se registra).
 */
async function seedAgenda(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weddingId: string,
  document: SiteDocument,
  values: { partnerName1: string; partnerName2: string; weddingDate: string; pageConfig: WeddingPageConfig },
): Promise<SiteDocument> {
  const agenda = findScene(document, "agenda");
  const items = agenda?.props.items ?? [];
  if (!agenda || items.length === 0) return document;
  const { data, error } = await supabase
    .from("wedding_agenda_items")
    .insert(items.map((item, index) => ({ wedding_id: weddingId, title: item.title, time_label: item.timeLabel || null, place: item.place || null, address: item.address || null, notes: item.notes || null, sort: index + 1 })))
    .select("id, title, time_label, place, address, notes, sort");
  const rows = (data ?? []) as Array<{ id: string; title: string; time_label: string | null; place: string | null; address: string | null; notes: string | null; sort: number }>;
  if (error || rows.length !== items.length) {
    console.error("[wedding] initial agenda insert failed", error?.code ?? "rows");
    return document;
  }
  const fromRows = findScene(documentFromLegacy({ partner_name_1: values.partnerName1, partner_name_2: values.partnerName2, wedding_date: values.weddingDate, cover_image_url: null, page_config: values.pageConfig, agenda: [...rows].sort((a, b) => a.sort - b.sort) }), "agenda");
  if (!fromRows) return document;
  const parsed = parseSiteDocument({ ...document, scenes: document.scenes.map((scene) => (scene.type === "agenda" ? { ...scene, enabled: true, props: { ...scene.props, items: fromRows.props.items } } : scene)) });
  return parsed.ok ? parsed.document : document;
}

// ---------------------------------------------------------------------------
// startStripeOnboarding
// ---------------------------------------------------------------------------

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/**
 * Crea (si hace falta) la cuenta Stripe Connect Express de la pareja y
 * redirige al enlace de onboarding de Stripe. Pensada como action de un
 * <form> en /panel; los fallos redirigen a /panel?stripe=error.
 */
export async function startStripeOnboarding(): Promise<void> {
  if (RSVP_MVP) redirect("/panel");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: wedding } = await supabase
    .from("weddings")
    .select("id, stripe_account_id, stripe_onboarded")
    .limit(1)
    .maybeSingle();

  if (!wedding) {
    redirect("/onboarding");
  }
  if (wedding.stripe_onboarded) {
    redirect("/panel");
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    redirect("/panel?stripe=sin-claves");
  }

  let onboardingUrl: string | null = null;
  try {
    const stripe = getStripe();

    let accountId: string | null = wedding.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "ES",
        email: user.email ?? undefined,
        business_type: "individual",
        // Al declarar capabilities hay que pedirlas TODAS explícitamente
        // (con el bloque presente, Stripe ya no añade card/transfers solo).
        // klarna_payments habilita "Paga en 3" para los invitados.
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
          klarna_payments: { requested: true },
        },
      });
      accountId = account.id;

      // El id de cuenta se persiste con service role (dato de plataforma).
      const admin = createAdminClient();
      const { error: updateError } = await admin
        .from("weddings")
        .update({ stripe_account_id: accountId })
        .eq("id", wedding.id);
      if (updateError) {
        throw new Error("No se pudo guardar el stripe_account_id");
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl()}/panel`,
      return_url: `${appUrl()}/panel`,
      type: "account_onboarding",
    });
    onboardingUrl = link.url;
  } catch {
    onboardingUrl = null;
  }

  if (!onboardingUrl) {
    redirect("/panel?stripe=error");
  }
  redirect(onboardingUrl);
}

/** RLS and an explicit owner filter protect every update, without service role. */
export async function updateWeddingSettings(input: WeddingSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = weddingSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisad los datos." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "La sesión ha caducado. Volved a entrar." };
  // La boda de la sesión por membresía (dueño o pareja invitada) + RLS.
  const mine = await getCurrentWedding(supabase);
  if (!mine) return { ok: false, error: "No hemos podido guardar los cambios. Probad de nuevo." };
  const { partnerName1, partnerName2, weddingDate, guestCountEst, pageConfig, rsvpDeadline } = parsed.data;
  if (rsvpDeadline !== undefined) {
    // Valor guardado de SU boda (RLS + id de la sesión) para no bloquear un plazo ya
    // vencido que no cambia. Si la lectura falla, no se guarda nada.
    const { data: current, error: currentError } = await supabase.from("weddings").select("rsvp_deadline").eq("id", mine.wedding.id).maybeSingle();
    if (currentError || !current) return { ok: false, error: "No hemos podido guardar los cambios. Probad de nuevo." };
    const issue = rsvpDeadlineIssue(rsvpDeadline, (current as { rsvp_deadline: string | null }).rsvp_deadline ?? null, madridToday());
    if (issue) return { ok: false, error: issue };
  }
  const { data, error } = await supabase.from("weddings").update({ partner_name_1: partnerName1, partner_name_2: partnerName2, wedding_date: weddingDate, guest_count_est: guestCountEst, ...(pageConfig ? { page_config: pageConfig } : {}), ...(rsvpDeadline !== undefined ? { rsvp_deadline: rsvpDeadline } : {}) }).eq("id", mine.wedding.id).select("id, slug").maybeSingle();
  // Solo el check del plazo; otros checks de weddings caen al error genérico.
  if (error?.code === "23514" && `${error.message ?? ""} ${error.details ?? ""}`.includes("weddings_rsvp_deadline_before_wedding")) return { ok: false, error: RSVP_DEADLINE_AFTER_WEDDING };
  if (error || !data) return { ok: false, error: "No hemos podido guardar los cambios. Probad de nuevo." };
  // S-01: los ajustes alimentan el borrador de la web (bajo bloqueo optimista);
  // un fallo ahí se registra dentro y no deshace el guardado de ajustes.
  await syncDraftFromLegacy(supabase, (data as { id: string; slug: string }).id);
  revalidatePath("/panel");
  revalidatePath("/panel/ajustes");
  revalidatePath("/panel/invitados");
  // Fase 1: editar ajustes ya no altera la web publicada; solo publishSite
  // revalida /b/[slug]. La fecha límite NO es contenido publicado: la página
  // pública es force-dynamic y la lee en cada visita, así que aplica ya.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// updateNotifyPref — preferencia de avisos por email de la pareja
// ---------------------------------------------------------------------------

const NOTIFY_PREFS = ["inmediato", "semanal", "nunca"] as const;
export type NotifyPref = (typeof NOTIFY_PREFS)[number];

/**
 * Guarda cómo quiere la pareja enterarse de las aportaciones. Va con el
 * cliente de sesión: RLS garantiza que solo puede tocar su propia boda.
 */
export async function updateNotifyPref(
  pref: NotifyPref,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!NOTIFY_PREFS.includes(pref)) {
    return { ok: false, error: "Preferencia no válida." };
  }
  const current = await getCurrentWedding();
  if (!current) return { ok: false, error: "Sesión caducada. Vuelve a entrar." };

  const { error } = await current.supabase
    .from("weddings")
    .update({ notify_contribution: pref })
    .eq("id", current.wedding.id);
  if (error) {
    return { ok: false, error: "No hemos podido guardarlo. Prueba de nuevo." };
  }
  return { ok: true };
}
