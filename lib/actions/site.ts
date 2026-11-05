"use server";

/**
 * Server actions del motor de webs (borrador y publicación).
 *
 * Modelo: una fila `wedding_sites` por boda con el borrador y su versión
 * (optimistic locking), y revisiones inmutables en `wedding_site_revisions`.
 * Publicar es atómico en el RPC `wedding_site_publish`. Siempre con el
 * cliente de sesión: RLS decide. La única excepción es Storage de la foto
 * (H05, abajo), tras comprobar la pertenencia con la sesión.
 *
 * Reglas:
 *  - La persistencia del borrador (`persistDraft`) vive en lib/data/site.ts
 *    para que ajustes y agenda la reutilicen sin exponerla como action.
 *  - Guardar el borrador NUNCA revalida `/b/[slug]`: editar no altera la web
 *    publicada. Solo publicar/despublicar lo hacen.
 *  - `weddings.page_config` y los nombres/fecha se sincronizan al publicar
 *    (ajustes y OG image siguen leyendo esas columnas), dentro de la misma
 *    RPC (p_legacy, 20261025110000).
 *  - H05 (fotos): el borrador referencia las fotos en el bucket PRIVADO
 *    `wedding-photos-drafts` (lib/photo-ref.ts). Desde las escenas v2 (6-oct-
 *    2026) puede haber muchas (portada, capítulos, galería): `collectImages`
 *    es la única lista que cuenta. Guardar solo acepta referencias privadas
 *    de la propia boda y borra los objetos privados que ya no usa ningún
 *    sitio (salvo la portada quitada, que el editor puede deshacer).
 *    Publicar copia TODAS al bucket público, guarda el borrador con las URL
 *    públicas (bloqueo optimista) y publica ese documento; la RPC rechaza
 *    cualquier referencia privada (20261007100000).
 *    Storage va con service_role (lib/data/photo-storage.ts) solo tras
 *    comprobar que la ruta es de la boda de la sesión.
 *  - Mensajes en español de España, sin filtrar detalles internos.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { publicSiteTag } from "@/lib/data/site-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { DRAFT_GENERIC_ERROR, getSiteEditorState, persistDraft } from "@/lib/data/site";
import { listSiteHistory, parseHistoryEntry, recordSiteHistory } from "@/lib/data/site-history";
import type { SiteVersionRow } from "@/lib/site-chat/thread";
import { discardUnpublishedCopy, promoteDraftPhoto, removeDraftPhotos } from "@/lib/data/photo-storage";
import { parseDraftPhotoUrl, referencesDraftPhoto, type DraftPhotoRef } from "@/lib/photo-ref";
import { collectImages, findScene, legacyConfigFromDocument, mapImages, parseSiteDocument, publishIssues, resolveLayout, type SceneImage, type SiteDocument, type SiteDocumentIssue } from "@/lib/site-document";

export interface SiteEditorState {
  weddingId: string;
  slug: string;
  /** Borrador actual (si no existe fila aún, el adaptador v1 de la boda). */
  draft: SiteDocument;
  /** Versión del borrador para optimistic locking (baseVersion al guardar). 0 = aún sin fila. */
  draftVersion: number;
  publishedRevisionId: string | null;
  publishedAt: string | null;
  /** true si el borrador difiere de la revisión publicada (o no hay ninguna). */
  hasUnpublishedChanges: boolean;
  /** true si el borrador guardado en BD no validaba y se muestra el adaptador en su lugar. */
  draftCorrupt?: boolean;
}

export type SaveDraftResult =
  /** `history`: la versión apuntada en el historial (null sin la migración o si no se pudo). */
  | { ok: true; draftVersion: number; history?: { id: string; createdAt: string } | null }
  | { ok: false; code: "conflict"; draftVersion: number; error: string }
  | { ok: false; code: "invalid"; issues: SiteDocumentIssue[]; error: string }
  | { ok: false; code: "error"; error: string };

export type PublishResult =
  /** `draftVersion`: versión del borrador tras publicar (sube si se reescribió la URL de la foto). */
  | { ok: true; revisionId: string; publishedAt: string; draftVersion?: number }
  | { ok: false; code: "conflict" | "invalid" | "error"; error: string; issues?: SiteDocumentIssue[] };

const GENERIC_ERROR = DRAFT_GENERIC_ERROR;
const SESSION_ERROR = "La sesión ha caducado. Volved a entrar.";
const PUBLISH_INVALID_ERROR = "La web no cumple el formato necesario para publicarse. Guardad los cambios de nuevo y revisad la portada antes de publicar.";
const PUBLISH_CONFLICT_ERROR = "La web ha cambiado desde que abristeis el editor. Recargad y revisad los cambios antes de publicar.";
const PUBLISH_ERROR = "No hemos podido publicar la web. Probad de nuevo.";
const PHOTO_MISSING_ERROR = "No encontramos una de las fotos del borrador. Volved a subirla y publicad de nuevo.";
const PHOTO_REF_INVALID = "Una de las fotos no es válida. Volved a subirla.";
const STORY_PREMIUM_ERROR = "«Como una Story» es Premium y llegará pronto. Vuestra invitación sigue como una web.";

/** URL de la foto de portada (o null). */
function coverImage(doc: SiteDocument): SceneImage | null {
  return findScene(doc, "cover")?.props.image ?? null;
}

/**
 * Fotos privadas del documento (portada, capítulos, galería), validadas
 * contra la boda de la sesión.
 *  - `none`: ninguna imagen usa el bucket privado (sin fotos o URL públicas).
 *  - `own`: referencias canónicas (sin repetir) a objetos de ESTA boda.
 *  - `invalid`: el documento menciona el bucket privado de otra forma
 *    (otra boda, URL firmada, ruta no canónica, fuera de las imágenes). Se
 *    rechaza: con service_role firmaríamos o publicaríamos la foto ajena.
 */
function draftPhotosOf(doc: SiteDocument, weddingId: string): { kind: "none" } | { kind: "own"; refs: DraftPhotoRef[] } | { kind: "invalid" } {
  const refs = new Map<string, DraftPhotoRef>();
  for (const image of collectImages(doc)) {
    const ref = parseDraftPhotoUrl(image.url);
    if (ref) {
      if (ref.weddingId !== weddingId) return { kind: "invalid" };
      refs.set(ref.path, ref);
    } else if (referencesDraftPhoto(image.url)) {
      return { kind: "invalid" };
    }
  }
  // Ninguna otra mención del bucket privado en el documento (textos, enlaces).
  const rest = mapImages(doc, (image) => (parseDraftPhotoUrl(image.url) ? null : image));
  if (referencesDraftPhoto(JSON.stringify(rest))) return { kind: "invalid" };
  return refs.size > 0 ? { kind: "own", refs: Array.from(refs.values()) } : { kind: "none" };
}

/** Rutas privadas de `doc` (vacío si no usa el bucket privado o no valida). */
function draftPaths(doc: SiteDocument, weddingId: string): Set<string> {
  const photos = draftPhotosOf(doc, weddingId);
  return new Set(photos.kind === "own" ? photos.refs.map((r) => r.path) : []);
}

async function savedDraftDocument(supabase: SupabaseClient, weddingId: string): Promise<SiteDocument | null> {
  const { data } = await supabase.from("wedding_sites").select("draft_document").eq("wedding_id", weddingId).maybeSingle();
  const parsed = data ? parseSiteDocument((data as { draft_document: unknown }).draft_document) : null;
  return parsed?.ok ? parsed.document : null;
}

type Session = { supabase: SupabaseClient; wedding: { id: string; slug: string } };

/** Plan de la boda (RLS: solo la pareja lee su fila). Ante cualquier duda, gratuito. */
async function isPremium(supabase: SupabaseClient, weddingId: string): Promise<boolean> {
  const { data } = await supabase.from("weddings").select("plan").eq("id", weddingId).maybeSingle();
  return (data as { plan?: unknown } | null)?.plan === "premium";
}

/** Sesión + boda de la pareja (RLS). null si no hay sesión o boda. */
async function ownWedding(): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_ERROR };
  const current = await getCurrentWedding(supabase);
  if (!current) return { ok: false, error: "No hemos encontrado vuestra boda. Cread la web primero." };
  return { ok: true, session: { supabase, wedding: current.wedding } };
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Guarda el borrador con bloqueo optimista. `history` (opcional): además,
 * apunta la versión en el historial del chat (IA, a mano o restaurada). Es
 * mejor esfuerzo: si la tabla no existe o falla, el borrador se guarda igual.
 */
export async function saveSiteDraft(input: { document: unknown; baseVersion: number; history?: unknown }): Promise<SaveDraftResult> {
  if (!input || !isVersion(input.baseVersion)) return { ok: false, code: "error", error: GENERIC_ERROR };
  const parsed = parseSiteDocument(input.document);
  if (!parsed.ok) return { ok: false, code: "invalid", issues: parsed.issues, error: parsed.issues[0]?.message ?? "Revisad el contenido de la web." };

  const auth = await ownWedding();
  if (!auth.ok) return { ok: false, code: "error", error: auth.error };
  const { supabase, wedding } = auth.session;

  const photos = draftPhotosOf(parsed.document, wedding.id);
  if (photos.kind === "invalid") {
    return { ok: false, code: "invalid", issues: [{ path: "scenes", message: PHOTO_REF_INVALID }], error: PHOTO_REF_INVALID };
  }
  // Fotos privadas del borrador guardado que el nuevo ya no usa: se borran
  // (nunca están en una revisión publicada: la RPC lo impide). Solo se mira
  // el guardado si el nuevo trae fotos privadas (si no trae ninguna, no se
  // borra nada: quitar la portada se puede deshacer desde el editor).
  // Excepción dentro de ese caso: la portada quitada (image → null) se
  // conserva; sustituida por otra foto → sí se borra.
  // La Story es Premium (13-oct-2026): sin plan Premium no se pasa de web a
  // Story. Solo se rechaza el CAMBIO: un borrador guardado que ya era Story se
  // guarda igual. Con baseVersion 0 no hay fila: es el adaptador de una boda
  // antigua (Story de siempre), que debe poder guardarse. Con baseVersion > 0
  // y un borrador guardado ilegible o ausente no sabemos si es un cambio:
  // se cierra (solo pasa con plan Premium).
  const toStory = resolveLayout(parsed.document) === "historia" && input.baseVersion > 0;
  const savedDoc = (photos.kind === "own" || toStory) && input.baseVersion > 0 ? await savedDraftDocument(supabase, wedding.id) : null;
  if (toStory && (!savedDoc || resolveLayout(savedDoc) !== "historia") && !(await isPremium(supabase, wedding.id))) {
    return { ok: false, code: "invalid", issues: [{ path: "layout", message: STORY_PREMIUM_ERROR }], error: STORY_PREMIUM_ERROR };
  }
  const orphaned: string[] = [];
  if (savedDoc) {
    const keep = draftPaths(parsed.document, wedding.id);
    const previousCover = parseDraftPhotoUrl(coverImage(savedDoc)?.url);
    if (previousCover && !coverImage(parsed.document)) keep.add(previousCover.path);
    for (const path of draftPaths(savedDoc, wedding.id)) if (!keep.has(path)) orphaned.push(path);
  }

  const result = await persistDraft(supabase, wedding.id, parsed.document, input.baseVersion);
  if (result.ok) {
    if (orphaned.length > 0) await removeDraftPhotos(orphaned);
    const entry = input.history === undefined ? null : parseHistoryEntry(input.history);
    const history = entry ? await recordSiteHistory(supabase, wedding.id, result.draftVersion, parsed.document, entry) : null;
    // Editar no altera lo publicado: aquí NO se revalida /b/[slug].
    revalidatePath("/panel/ajustes");
    return entry ? { ...result, history } : result;
  }
  return result;
}

export type SiteHistoryResult = { ok: true; available: boolean; rows: SiteVersionRow[] } | { ok: false; error: string };

/**
 * Versiones del borrador para el chat del editor (las 50 últimas, de la más
 * antigua a la más reciente). Las dos personas de la pareja ven las mismas.
 */
export async function listSiteDraftHistory(): Promise<SiteHistoryResult> {
  const auth = await ownWedding();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, wedding } = auth.session;
  const { available, rows } = await listSiteHistory(supabase, wedding.id);
  return { ok: true, available, rows };
}

function isVersionConflict(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "40001" || /site_version_conflict/.test(error.message ?? "");
}

function isDocumentInvalid(error: { code?: string; message?: string }): boolean {
  return error.code === "22023" || /site_document_invalid/.test(error.message ?? "");
}

export async function publishSite(input: { baseVersion: number }): Promise<PublishResult> {
  if (!input || !isVersion(input.baseVersion)) return { ok: false, code: "error", error: GENERIC_ERROR };
  const auth = await ownWedding();
  if (!auth.ok) return { ok: false, code: "error", error: auth.error };
  const { supabase, wedding } = auth.session;

  const state = await getSiteEditorState(supabase, wedding.id);
  if (!state) return { ok: false, code: "error", error: GENERIC_ERROR };
  if (state.draftCorrupt) return { ok: false, code: "error", error: "El borrador guardado no es válido. Guardad la web de nuevo antes de publicar." };

  const issues = publishIssues(state.draft);
  if (issues.length > 0) return { ok: false, code: "invalid", error: issues[0]?.message ?? "Completad la web antes de publicar.", issues };

  let expectedVersion = input.baseVersion;
  if (expectedVersion === 0) {
    // Boda anterior al motor: la primera publicación crea la fila con el adaptador.
    const created = await persistDraft(supabase, wedding.id, state.draft, 0);
    if (!created.ok) {
      if (created.code === "conflict") return { ok: false, code: "conflict", error: PUBLISH_CONFLICT_ERROR };
      return { ok: false, code: "error", error: created.error };
    }
    expectedVersion = created.draftVersion;
  }

  // H05: las fotos de borrador viven en el bucket privado. Antes de publicar
  // se copian TODAS al público (rutas nuevas) y el borrador se guarda con esas
  // URL bajo el bloqueo optimista; la RPC exige que lo publicado sea el
  // borrador guardado y rechaza cualquier referencia privada (20261007100000).
  const photos = draftPhotosOf(state.draft, wedding.id);
  if (photos.kind === "invalid") {
    return { ok: false, code: "invalid", error: PHOTO_REF_INVALID, issues: [{ path: "scenes", message: PHOTO_REF_INVALID }] };
  }
  let document = state.draft;
  const promotedPaths: string[] = [];
  const discardCopies = async () => { for (const path of promotedPaths) await discardUnpublishedCopy(path); };
  if (photos.kind === "own") {
    const publicUrl = new Map<string, string>();
    for (const ref of photos.refs) {
      const copy = await promoteDraftPhoto(wedding.id, ref.path);
      if (!copy.ok) {
        await discardCopies();
        return { ok: false, code: "error", error: copy.reason === "missing" ? PHOTO_MISSING_ERROR : PUBLISH_ERROR };
      }
      promotedPaths.push(copy.path);
      publicUrl.set(ref.path, copy.url);
    }
    const rewritten = parseSiteDocument(mapImages(state.draft, (image) => {
      const ref = parseDraftPhotoUrl(image.url);
      const url = ref ? publicUrl.get(ref.path) : undefined;
      return url ? { ...image, url } : image;
    }));
    if (!rewritten.ok) {
      await discardCopies();
      console.error("[site] rewritten draft failed validation");
      return { ok: false, code: "error", error: PUBLISH_ERROR };
    }
    const saved = await persistDraft(supabase, wedding.id, rewritten.document, expectedVersion);
    if (!saved.ok) {
      await discardCopies();
      if (saved.code === "conflict") return { ok: false, code: "conflict", error: PUBLISH_CONFLICT_ERROR };
      return { ok: false, code: "error", error: PUBLISH_ERROR };
    }
    document = rewritten.document;
    expectedVersion = saved.draftVersion;
  }

  // S-03: el RPC publica exactamente el documento validado aquí (igualdad
  // jsonb con el borrador en BD; si difiere → site_version_conflict).
  // 5.7 (20261025110000): la sincronización del modelo antiguo viaja en la
  // MISMA transacción que la publicación (p_legacy). Sin esa migración, la
  // RPC no conoce p_legacy (PGRST202/42883): se publica con la firma antigua
  // y se sincroniza después, como antes.
  const legacy = legacySyncFromDocument(document);
  let syncedInRpc = true;
  let { data, error } = await supabase.rpc("wedding_site_publish", { p_wedding_id: wedding.id, p_expected_version: expectedVersion, p_document: document, p_legacy: legacy });
  if (error && isMissingRpcSignature(error)) {
    syncedInRpc = false;
    ({ data, error } = await supabase.rpc("wedding_site_publish", { p_wedding_id: wedding.id, p_expected_version: expectedVersion, p_document: document }));
  }
  if (error) {
    // Las copias públicas no llegaron a publicarse: el borrador vuelve a las
    // referencias privadas y solo entonces se borran las copias (si otra
    // pestaña guardó entretanto, se quedan: pueden estar en ese borrador).
    if (promotedPaths.length > 0) {
      const restored = await persistDraft(supabase, wedding.id, state.draft, expectedVersion);
      if (restored.ok) await discardCopies();
      else console.error("[site] publish failed and draft photos could not be restored", restored.code);
    }
    return publishRpcFailure(error);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { revision_id?: string; published_at?: string; draft_version?: number } | null | undefined;
  if (!row?.revision_id || !row.published_at) {
    console.error("[site] publish rpc returned no row");
    return { ok: false, code: "error", error: PUBLISH_ERROR };
  }

  // Las fotos privadas ya no las referencia nada: el borrador apunta a las
  // copias públicas. Mejor esfuerzo (un fallo deja objetos privados huérfanos).
  if (photos.kind === "own") await removeDraftPhotos(photos.refs.map((r) => r.path));

  // Solo sin la migración 20261025110000: sincronizar después (no atómico;
  // un fallo aquí no deshace la publicación, se registra y se sigue).
  if (!syncedInRpc) {
    const { error: syncError } = await supabase.from("weddings").update(legacy).eq("id", wedding.id);
    if (syncError) console.error("[site] legacy sync after publish failed", syncError.code);
  }

  revalidateTag(publicSiteTag(wedding.slug));
  revalidatePath(`/b/${wedding.slug}`);
  revalidatePath("/panel");
  revalidatePath("/panel/ajustes");
  return { ok: true, revisionId: row.revision_id, publishedAt: row.published_at, draftVersion: typeof row.draft_version === "number" ? row.draft_version : expectedVersion };
}

/**
 * Columnas de `weddings` que se sincronizan al publicar (ajustes y OG image
 * siguen leyéndolas). Clave ausente = no tocarla. La foto publicada alimenta
 * la OG image y el adaptador v1 («la imagen de ajustes manda» en
 * mergeLegacyIntoDocument): mantenerla igual evita que un guardado de ajustes
 * devuelva una foto antigua al borrador. Siempre la URL pública: `document`
 * ya no referencia el bucket privado.
 */
function legacySyncFromDocument(document: SiteDocument): Record<string, unknown> {
  const cover = findScene(document, "cover");
  const sync: Record<string, unknown> = { page_config: legacyConfigFromDocument(document) };
  if (cover?.props.partnerName1) sync.partner_name_1 = cover.props.partnerName1;
  if (cover?.props.partnerName2) sync.partner_name_2 = cover.props.partnerName2;
  if (cover?.props.weddingDate) sync.wedding_date = cover.props.weddingDate;
  if (cover) sync.cover_image_url = cover.props.image?.url ?? null;
  return sync;
}

/** La RPC aún no acepta p_legacy (migración 20261025110000 sin aplicar). */
function isMissingRpcSignature(error: { code?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

function publishRpcFailure(error: { code?: string; message?: string }): PublishResult {
  if (isVersionConflict(error)) return { ok: false, code: "conflict", error: PUBLISH_CONFLICT_ERROR };
  // P0002 site_not_found: la fila desapareció entre leer y publicar (otra pestaña).
  if (error.code === "P0002") return { ok: false, code: "conflict", error: PUBLISH_CONFLICT_ERROR };
  // 42501 site_forbidden: la boda ya no pertenece a esta sesión.
  if (error.code === "42501") return { ok: false, code: "error", error: SESSION_ERROR };
  // 22023 site_document_invalid: la BD también exige el contrato al publicar
  // (auditoría H04; y H05: ninguna referencia al bucket privado). Aquí solo
  // llega si Zod/la app y SQL divergen.
  // 23514: un CHECK de weddings rechazó la sincronización (nombres,
  // tamaño de page_config); con 20261025110000 tampoco se publica nada.
  if (isDocumentInvalid(error) || error.code === "23514") {
    console.error("[site] publish rejected by database contract", error.code);
    return { ok: false, code: "invalid", error: PUBLISH_INVALID_ERROR };
  }
  console.error("[site] publish rpc failed", error.code);
  return { ok: false, code: "error", error: PUBLISH_ERROR };
}

export async function unpublishSite(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await ownWedding();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, wedding } = auth.session;
  const { error } = await supabase.rpc("wedding_site_unpublish", { p_wedding_id: wedding.id });
  if (error) {
    console.error("[site] unpublish rpc failed", error.code);
    return { ok: false, error: "No hemos podido retirar la web. Probad de nuevo." };
  }
  revalidateTag(publicSiteTag(wedding.slug));
  revalidatePath(`/b/${wedding.slug}`);
  revalidatePath("/panel");
  revalidatePath("/panel/ajustes");
  return { ok: true };
}
