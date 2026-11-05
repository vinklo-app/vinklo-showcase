/**
 * Lecturas agregadas del admin del fundador (producto v2).
 *
 * - Solo se llama DESPUÉS de `assertAdmin()` y con el cliente service_role
 *   (lo inyecta la página; aquí no se crea ninguno, así los tests pasan un
 *   mock encadenable).
 * - Invitados: SOLO conteos (`count: exact, head: true`); ninguna fila de
 *   invitado, nombre ni teléfono cruza la red para el resumen.
 * - Producción puede ir por detrás de las migraciones locales: cada cifra
 *   degrada a `null` («—») si su tabla o columna no existe; nada lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { SITE_PALETTES } from "@/lib/site-document";
import { isInternalEmail } from "./test-accounts";
import type {
  AdminOverview,
  AdminWaitlistRow,
  AdminWeddingSummary,
  DailyCount,
  FunnelStep,
  Metric,
  PaletteCount,
  PaymentsHistory,
  RecentSignIn,
  SiteState,
  UsersOverview,
  WaitlistKind,
} from "./types";
import { WAITLIST_KINDS } from "./types";

const DAY_MS = 86_400_000;
const MADRID_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD del día civil en Madrid. */
export function madridDay(date: Date): string {
  return MADRID_DAY.format(date);
}

// ---------------------------------------------------------------------------
// Helpers puros (testeados sin Supabase)
// ---------------------------------------------------------------------------

export interface AuthUserLite {
  id?: string;
  email?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
}

/** Altas totales, ventanas móviles de 24 h / 7 d / 30 d y serie diaria de `days` días. */
export function summarizeSignups(
  createdAts: readonly string[],
  now: Date,
  days = 30,
): Pick<UsersOverview, "total" | "last24h" | "last7d" | "last30d" | "daily"> {
  const nowMs = now.getTime();
  const perDay = new Map<string, number>();
  let last24h = 0;
  let last7d = 0;
  let last30d = 0;
  for (const raw of createdAts) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) continue;
    const age = nowMs - t;
    if (age >= 0 && age < DAY_MS) last24h += 1;
    if (age >= 0 && age < 7 * DAY_MS) last7d += 1;
    if (age >= 0 && age < 30 * DAY_MS) last30d += 1;
    const key = madridDay(new Date(t));
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const daily: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = madridDay(new Date(nowMs - i * DAY_MS));
    // Un cambio de hora puede repetir un día al restar 24 h; se omite el duplicado.
    if (daily.at(-1)?.date === key) continue;
    daily.push({ date: key, count: perDay.get(key) ?? 0 });
  }
  return { total: createdAts.length, last24h, last7d, last30d, daily };
}

/** Últimos inicios de sesión, más recientes primero. */
export function recentSignIns(users: readonly AuthUserLite[], limit = 10): RecentSignIn[] {
  return users
    .filter((u): u is AuthUserLite & { email: string; last_sign_in_at: string } => Boolean(u.email && u.last_sign_in_at))
    .sort((a, b) => Date.parse(b.last_sign_in_at) - Date.parse(a.last_sign_in_at))
    .slice(0, limit)
    .map((u) => ({ email: u.email, lastSignInAt: u.last_sign_in_at, isInternal: isInternalEmail(u.email) }));
}

export interface SitePaletteRow {
  wedding_id: string;
  palette: string | null;
  theme: string | null;
}

const PALETTE_LABELS = new Map<string, string>(SITE_PALETTES.map((p) => [p.id, p.label]));

/**
 * Bodas por paleta. Con fila de web manda el borrador (`palette` ?? `themeId`);
 * sin fila, el estilo v1 (`page_config.style`, por defecto «editorial»).
 */
export function paletteBreakdown(
  weddings: ReadonlyArray<{ id: string; style: string | null }>,
  sites: readonly SitePaletteRow[],
): PaletteCount[] {
  const siteByWedding = new Map(sites.map((s) => [s.wedding_id, s]));
  const counts = new Map<string, number>();
  for (const w of weddings) {
    const site = siteByWedding.get(w.id);
    const id = (site ? site.palette ?? site.theme : w.style) || "editorial";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: PALETTE_LABELS.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
}

export interface SiteRowLite {
  published_revision_id: string | null;
  published_at: string | null;
}

export function siteStateOf(site: SiteRowLite | null | undefined): SiteState {
  if (!site) return "legacy";
  if (site.published_revision_id) return "published";
  if (site.published_at) return "retired";
  return "draft";
}

export function buildFunnel(counts: {
  registered: Metric;
  wedding: Metric;
  published: Metric;
  guest: Metric;
  rsvp: Metric;
}): FunnelStep[] {
  return [
    { key: "registered", label: "Cuentas registradas", count: counts.registered },
    { key: "wedding", label: "Boda creada", count: counts.wedding },
    { key: "published", label: "Web publicada", count: counts.published },
    { key: "guest", label: "≥ 1 invitado", count: counts.guest },
    { key: "rsvp", label: "≥ 1 respuesta", count: counts.rsvp },
  ];
}

/** Porcentaje entero de `part` sobre `whole`, o null si no se puede calcular. */
export function percentOf(part: Metric, whole: Metric): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

export function summarizePayments(
  total: number,
  confirmedRows: ReadonlyArray<{ total_cents: number; service_fee_cents: number; method: string }>,
): PaymentsHistory {
  let confirmedCents = 0;
  let cardFeesCents = 0;
  for (const row of confirmedRows) {
    confirmedCents += row.total_cents;
    if (row.method === "card") cardFeesCents += row.service_fee_cents;
  }
  return { contributions: total, confirmed: confirmedRows.length, confirmedCents, cardFeesCents };
}

// ---------------------------------------------------------------------------
// Lecturas (cliente inyectado)
// ---------------------------------------------------------------------------

type Client = Pick<SupabaseClient, "from" | "auth">;
type CountResult = { count: number | null; error: unknown };
type RowsResult<T> = { data: T[] | null; error: unknown };

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MAX_USER_PAGES = 20;

/** Conteo `head: true`; null si la consulta falla (tabla/columna sin migrar). */
export async function headCount(
  query: PromiseLike<CountResult>,
  source: string,
  unavailable: Set<string>,
): Promise<Metric> {
  try {
    const { count, error } = await query;
    if (error || count === null || count === undefined) {
      unavailable.add(source);
      return null;
    }
    return count;
  } catch {
    unavailable.add(source);
    return null;
  }
}

/** Lee todas las filas por páginas de 1000 (tope de PostgREST). null si falla. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<RowsResult<T>>,
): Promise<T[] | null> {
  const rows: T[] = [];
  try {
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const from = i * PAGE_SIZE;
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error || !data) return null;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
  } catch {
    return null;
  }
  return rows;
}

/**
 * R09 (plan maestro §5.2): Auth no admite contar por SQL desde PostgREST y
 * ADMIN_EMAILS vive en el entorno, no en la base, así que una RPC «solo
 * admins» no tendría con qué comprobarlo. En vez de paginar todo Auth en
 * cada vista del admin, la lista ligera (id, email, fechas) se guarda en la
 * MEMORIA del servidor 5 minutos (nunca en la Data Cache persistente ni en
 * páginas públicas). Solo se guardan lecturas correctas; las peticiones
 * simultáneas comparten la misma lectura.
 */
export const USERS_CACHE_TTL_MS = 5 * 60 * 1000;
type FetchedUsers = { users: AuthUserLite[]; truncated: boolean };
let usersCache: { at: number; value: Promise<FetchedUsers | null> } | null = null;

/** Solo para tests: vacía la caché en memoria de usuarios de Auth. */
export function resetAdminUsersCache(): void {
  usersCache = null;
}

async function fetchAllUsers(client: Client): Promise<FetchedUsers | null> {
  const users: AuthUserLite[] = [];
  let truncated = false;
  try {
    for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
      if (error) return null;
      const batch = (data?.users ?? []) as AuthUserLite[];
      // Solo lo que usa el resumen: nada de metadatos ni identidades en memoria.
      users.push(...batch.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })));
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_USER_PAGES) truncated = true;
    }
  } catch {
    return null;
  }
  return { users, truncated };
}

function cachedUsers(client: Client): Promise<FetchedUsers | null> {
  const nowMs = Date.now();
  if (usersCache && nowMs - usersCache.at < USERS_CACHE_TTL_MS) return usersCache.value;
  const entry = { at: nowMs, value: fetchAllUsers(client) };
  usersCache = entry;
  // Un fallo no se cachea: la próxima vista vuelve a intentarlo.
  void entry.value.then((value) => { if (!value && usersCache === entry) usersCache = null; });
  return entry.value;
}

export async function loadUsers(
  client: Client,
  now: Date,
): Promise<(UsersOverview & { idToEmail: Map<string, string> }) | null> {
  const fetched = await cachedUsers(client);
  if (!fetched) return null;
  const { users, truncated } = fetched;
  const idToEmail = new Map<string, string>();
  for (const u of users) if (u.id && u.email) idToEmail.set(u.id, u.email);
  return {
    ...summarizeSignups(users.map((u) => u.created_at), now),
    recentSignIns: recentSignIns(users),
    truncated,
    internalTotal: users.filter((u) => isInternalEmail(u.email)).length,
    idToEmail,
  };
}

interface LatestWeddingRow {
  id: string;
  slug: string;
  partner_name_1: string;
  partner_name_2: string;
  wedding_date: string | null;
  created_at: string;
  cover_image_url: string | null;
  style: string | null;
  couple_id?: string;
  wedding_guests?: Array<{ count: number }> | null;
  wedding_sites?:
    | (SiteRowLite & { palette: string | null; theme: string | null })
    | Array<SiteRowLite & { palette: string | null; theme: string | null }>
    | null;
}

const LATEST_COLUMNS =
  "id, slug, partner_name_1, partner_name_2, wedding_date, created_at, cover_image_url, style:page_config->>style, couple_id";
const SITE_EMBED =
  "wedding_sites(published_revision_id, published_at, palette:draft_document->>palette, theme:draft_document->>themeId)";
// `wedding_guests(count)` es un agregado de PostgREST: si el proyecto tiene
// los agregados desactivados (db-aggregates-enabled), se reintenta sin él.
const LATEST_ATTEMPTS: ReadonlyArray<{ select: string; missing: string[] }> = [
  { select: `${LATEST_COLUMNS}, wedding_guests(count), ${SITE_EMBED}`, missing: [] },
  { select: `${LATEST_COLUMNS}, wedding_guests(count)`, missing: ["wedding_sites"] },
  { select: `${LATEST_COLUMNS}, ${SITE_EMBED}`, missing: ["wedding_guests.count"] },
  { select: LATEST_COLUMNS, missing: ["wedding_sites", "wedding_guests.count"] },
];

export function toWeddingSummary(row: LatestWeddingRow, idToEmail: ReadonlyMap<string, string> = new Map()): AdminWeddingSummary {
  const site = Array.isArray(row.wedding_sites) ? row.wedding_sites[0] ?? null : row.wedding_sites ?? null;
  const guestAgg = Array.isArray(row.wedding_guests) ? row.wedding_guests[0] : undefined;
  return {
    id: row.id,
    slug: row.slug,
    partnerNames: `${row.partner_name_1} y ${row.partner_name_2}`,
    weddingDate: row.wedding_date,
    createdAt: row.created_at,
    siteState: siteStateOf(site),
    hasPhoto: Boolean(row.cover_image_url),
    palette: (site ? site.palette ?? site.theme : row.style) || "editorial",
    guestCount: typeof guestAgg?.count === "number" ? guestAgg.count : null,
    isInternal: isInternalEmail(row.couple_id ? idToEmail.get(row.couple_id) : null),
  };
}

/** Últimas bodas con estado de la web y nº de invitados (agregado embebido). */
export async function loadLatestWeddings(
  client: Client,
  limit: number,
  unavailable: Set<string>,
  idToEmail: ReadonlyMap<string, string> = new Map(),
): Promise<AdminWeddingSummary[]> {
  const run = (select: string) =>
    client.from("weddings").select(select).order("created_at", { ascending: false }).limit(limit) as unknown as PromiseLike<
      RowsResult<LatestWeddingRow>
    >;
  try {
    for (const attempt of LATEST_ATTEMPTS) {
      const { data, error } = await run(attempt.select);
      if (error || !data) continue;
      attempt.missing.forEach((source) => unavailable.add(source));
      return data.map((row) => toWeddingSummary(row, idToEmail));
    }
  } catch {
    // cae al marcador de abajo
  }
  unavailable.add("weddings");
  return [];
}

async function loadPalettes(client: Client, unavailable: Set<string>): Promise<PaletteCount[] | null> {
  const weddings = await fetchAll<{ id: string; style: string | null }>((from, to) =>
    client.from("weddings").select("id, style:page_config->>style").order("id").range(from, to) as unknown as PromiseLike<
      RowsResult<{ id: string; style: string | null }>
    >,
  );
  if (!weddings) {
    unavailable.add("weddings");
    return null;
  }
  const sites = await fetchAll<SitePaletteRow>((from, to) =>
    client
      .from("wedding_sites")
      .select("wedding_id, palette:draft_document->>palette, theme:draft_document->>themeId")
      .order("wedding_id")
      .range(from, to) as unknown as PromiseLike<RowsResult<SitePaletteRow>>,
  );
  if (!sites) unavailable.add("wedding_sites");
  return paletteBreakdown(weddings, sites ?? []);
}

async function loadWaitlistLatest(client: Client, unavailable: Set<string>): Promise<AdminWaitlistRow[]> {
  const run = (select: string) =>
    client.from("waitlist").select(select).order("created_at", { ascending: false }).limit(20) as unknown as PromiseLike<
      RowsResult<AdminWaitlistRow>
    >;
  try {
    let { data, error } = await run("id, email, name, kind, wedding_date, source, created_at, interested_in_gifts");
    if (error) ({ data, error } = await run("id, email, name, kind, wedding_date, source, created_at"));
    if (error || !data) {
      unavailable.add("waitlist");
      return [];
    }
    return data;
  } catch {
    unavailable.add("waitlist");
    return [];
  }
}

async function loadPayments(client: Client): Promise<PaymentsHistory | null> {
  // Histórico: la sección solo existe si hubo aportaciones (pagos desactivados en v2).
  const scratch = new Set<string>();
  const total = await headCount(client.from("contributions").select("id", { count: "exact", head: true }), "contributions", scratch);
  if (!total) return null;
  const confirmed = await fetchAll<{ total_cents: number; service_fee_cents: number; method: string }>((from, to) =>
    client
      .from("contributions")
      .select("total_cents, service_fee_cents, method")
      .eq("status", "confirmed")
      .order("id")
      .range(from, to) as unknown as PromiseLike<RowsResult<{ total_cents: number; service_fee_cents: number; method: string }>>,
  );
  return summarizePayments(total, confirmed ?? []);
}

/** Resumen completo. Todas las lecturas en paralelo; ninguna lanza. */
export async function loadAdminOverview(client: Client, now = new Date()): Promise<AdminOverview> {
  const unavailable = new Set<string>();
  const head = (table: string) => client.from(table).select("id", { count: "exact", head: true });
  const c = (q: PromiseLike<CountResult>, source: string) => headCount(q, source, unavailable);

  // Se espera primero para poder cruzar couple_id → email (cuentas internas)
  // al pintar las últimas bodas; el resto de lecturas sigue en paralelo.
  const users = await loadUsers(client, now);
  if (!users) unavailable.add("auth.users");
  const idToEmail = users?.idToEmail ?? new Map<string, string>();

  const [
    nWeddings,
    nPublished,
    nPhoto,
    nGuests,
    nPrepared,
    nSent,
    nYes,
    nNo,
    nPending,
    nWeddingsWithGuest,
    nWeddingsWithRsvp,
    nWait,
    nGifts,
    byKindList,
    palettes,
    latestWeddings,
    latestWaitlist,
    payments,
  ] = await Promise.all([
    c(head("weddings"), "weddings"),
    c(head("wedding_sites").not("published_revision_id", "is", null), "wedding_sites"),
    c(head("weddings").not("cover_image_url", "is", null), "weddings"),
    c(head("wedding_guests"), "wedding_guests"),
    c(head("wedding_guests").not("invitation_prepared_at", "is", null), "wedding_guests.invitation_prepared_at"),
    c(head("wedding_guests").not("invitation_sent_at", "is", null), "wedding_guests.invitation_sent_at"),
    c(head("wedding_guests").eq("rsvp_status", "si"), "wedding_guests"),
    c(head("wedding_guests").eq("rsvp_status", "no"), "wedding_guests"),
    c(head("wedding_guests").eq("rsvp_status", "pendiente"), "wedding_guests"),
    // Bodas DISTINTAS con ≥ 1 invitado / ≥ 1 respuesta: el embed !inner filtra
    // el padre sin multiplicar filas (PostgREST agrega el hijo por fila padre).
    c(client.from("weddings").select("id, wedding_guests!inner(id)", { count: "exact", head: true }), "wedding_guests"),
    c(
      client
        .from("weddings")
        .select("id, wedding_guests!inner(id)", { count: "exact", head: true })
        .neq("wedding_guests.rsvp_status", "pendiente"),
      "wedding_guests",
    ),
    c(head("waitlist"), "waitlist"),
    c(head("waitlist").eq("interested_in_gifts", true), "waitlist.interested_in_gifts"),
    Promise.all(WAITLIST_KINDS.map((kind) => c(head("waitlist").eq("kind", kind), "waitlist"))),
    loadPalettes(client, unavailable),
    loadLatestWeddings(client, 20, unavailable, idToEmail),
    loadWaitlistLatest(client, unavailable),
    loadPayments(client),
  ]);

  const byKind = Object.fromEntries(WAITLIST_KINDS.map((kind, i) => [kind, byKindList[i] ?? null])) as Record<WaitlistKind, Metric>;

  return {
    generatedAt: now.toISOString(),
    users,
    weddings: { total: nWeddings, published: nPublished, withPhoto: nPhoto, palettes },
    guests: { total: nGuests, prepared: nPrepared, sent: nSent, yes: nYes, no: nNo, pending: nPending },
    waitlist: { total: nWait, byKind, interestedInGifts: nGifts, latest: latestWaitlist },
    funnel: buildFunnel({
      registered: users?.total ?? null,
      wedding: nWeddings,
      published: nPublished,
      guest: nWeddingsWithGuest,
      rsvp: nWeddingsWithRsvp,
    }),
    latestWeddings,
    payments,
    unavailable: [...unavailable].sort(),
  };
}
