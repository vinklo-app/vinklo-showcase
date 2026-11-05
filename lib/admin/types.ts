/**
 * Tipos del admin del fundador (producto v2: web gratis + CRM de invitados).
 *
 * Convención: toda cifra es `number | null`. `null` significa «la fuente no
 * está disponible» (tabla o columna sin migrar en ese entorno, o error de
 * lectura) y se pinta como «—»; nunca se confunde con un 0 real.
 */

export type Metric = number | null;

export interface DailyCount {
  /** Día civil en Europe/Madrid, YYYY-MM-DD. */
  date: string;
  count: number;
}

export interface RecentSignIn {
  email: string;
  lastSignInAt: string;
  /** Cuenta del equipo o de pruebas (lib/admin/test-accounts.ts), no un cliente real. */
  isInternal: boolean;
}

export interface UsersOverview {
  total: number;
  last24h: number;
  last7d: number;
  last30d: number;
  /** 30 días, del más antiguo al de hoy. */
  daily: DailyCount[];
  recentSignIns: RecentSignIn[];
  /** true si se alcanzó el tope de páginas de listUsers (cifras = mínimo). */
  truncated: boolean;
  /** Cuántas de `total` son cuentas internas (equipo o pruebas). */
  internalTotal: number;
}

export interface PaletteCount {
  id: string;
  label: string;
  count: number;
}

export interface WeddingsOverview {
  total: Metric;
  published: Metric;
  withPhoto: Metric;
  /** Paleta del borrador (o estilo v1 si la boda no tiene fila de web). */
  palettes: PaletteCount[] | null;
}

export interface GuestsOverview {
  total: Metric;
  prepared: Metric;
  sent: Metric;
  yes: Metric;
  no: Metric;
  pending: Metric;
}

export type WaitlistKind = "pareja" | "planner" | "proveedor" | "otro";

export interface AdminWaitlistRow {
  id: string;
  email: string;
  name: string | null;
  kind: WaitlistKind;
  wedding_date: string | null;
  source: string | null;
  created_at: string;
  /** undefined si la columna aún no existe en ese entorno. */
  interested_in_gifts?: boolean;
}

export interface WaitlistOverview {
  total: Metric;
  byKind: Record<WaitlistKind, Metric>;
  interestedInGifts: Metric;
  latest: AdminWaitlistRow[];
}

export interface FunnelStep {
  key: "registered" | "wedding" | "published" | "guest" | "rsvp";
  label: string;
  count: Metric;
}

/**
 * Estado de la web pública de una boda (cuatro valores honestos):
 *  - published   puntero a revisión ≠ null
 *  - retired     se publicó y se retiró (la web responde 404)
 *  - draft       fila de web creada pero nunca publicada (sirve el adaptador v1)
 *  - legacy      sin fila en wedding_sites (sirve el adaptador v1)
 */
export type SiteState = "published" | "retired" | "draft" | "legacy";

export interface AdminWeddingSummary {
  id: string;
  slug: string;
  partnerNames: string;
  weddingDate: string | null;
  createdAt: string;
  siteState: SiteState;
  hasPhoto: boolean;
  palette: string | null;
  guestCount: Metric;
  /** Cuenta del equipo o de pruebas (lib/admin/test-accounts.ts), no un cliente real. */
  isInternal: boolean;
}

export interface PaymentsHistory {
  contributions: number;
  confirmed: number;
  confirmedCents: number;
  cardFeesCents: number;
}

export interface AdminOverview {
  generatedAt: string;
  users: UsersOverview | null;
  weddings: WeddingsOverview;
  guests: GuestsOverview;
  waitlist: WaitlistOverview;
  funnel: FunnelStep[];
  latestWeddings: AdminWeddingSummary[];
  /** null si no hay ninguna aportación histórica (la sección no se pinta). */
  payments: PaymentsHistory | null;
  /** Fuentes que no se pudieron leer (para la nota al pie). */
  unavailable: string[];
}

export const WAITLIST_KINDS: readonly WaitlistKind[] = ["pareja", "planner", "proveedor", "otro"];

export const WAITLIST_KIND_LABELS: Record<WaitlistKind, string> = {
  pareja: "Pareja",
  planner: "Planner",
  proveedor: "Proveedor",
  otro: "Otro",
};

export const SITE_STATE_LABELS: Record<SiteState, string> = {
  published: "Publicada",
  retired: "Retirada (404)",
  draft: "v1 · borrador sin publicar",
  legacy: "v1 · adaptador",
};
