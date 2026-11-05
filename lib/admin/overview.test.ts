import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildFunnel,
  loadAdminOverview,
  loadLatestWeddings,
  loadUsers,
  madridDay,
  paletteBreakdown,
  percentOf,
  recentSignIns,
  siteStateOf,
  summarizePayments,
  summarizeSignups,
  toWeddingSummary,
  resetAdminUsersCache,
  USERS_CACHE_TTL_MS,
} from "./overview";

// La lista de Auth se cachea 5 min en memoria (R09): cada test parte de cero.
beforeEach(() => resetAdminUsersCache());

const NOW = new Date("2026-10-04T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// ---------------------------------------------------------------------------
// Mock encadenable de supabase-js: cada consulta registra tabla, select y
// filtros; al hacer `await` se resuelve con `respond(query)`.
// ---------------------------------------------------------------------------

interface Query {
  table: string;
  select: string;
  head: boolean;
  filters: string[];
  range?: [number, number];
}
type Result = { data?: unknown; count?: number | null; error?: unknown };

function mockClient(respond: (q: Query) => Result, users: Array<Record<string, unknown>> | Error = []) {
  const queries: Query[] = [];
  const builder = (table: string) => {
    const q: Query = { table, select: "", head: false, filters: [] };
    queries.push(q);
    const chain: Record<string, unknown> = {
      select(cols: string, opts?: { head?: boolean }) {
        q.select = cols;
        q.head = Boolean(opts?.head);
        return chain;
      },
      eq: (c: string, v: unknown) => (q.filters.push(`${c}=eq.${String(v)}`), chain),
      neq: (c: string, v: unknown) => (q.filters.push(`${c}=neq.${String(v)}`), chain),
      not: (c: string, op: string, v: unknown) => (q.filters.push(`${c}=not.${op}.${String(v)}`), chain),
      order: () => chain,
      limit: () => chain,
      range: (from: number, to: number) => ((q.range = [from, to]), chain),
      then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(respond(q)).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return chain;
  };
  const client = {
    from: builder,
    auth: {
      admin: {
        listUsers: async ({ page }: { page: number }) =>
          users instanceof Error
            ? { data: { users: [] }, error: users }
            : { data: { users: page === 1 ? users : [] }, error: null },
      },
    },
  };
  return { client: client as never, queries };
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

describe("summarizeSignups", () => {
  it("cuenta ventanas móviles y construye 30 días acabando hoy (Madrid)", () => {
    const created = [hoursAgo(1), hoursAgo(23), hoursAgo(30), hoursAgo(24 * 6), hoursAgo(24 * 20), hoursAgo(24 * 45)];
    const s = summarizeSignups(created, NOW);
    expect(s).toMatchObject({ total: 6, last24h: 2, last7d: 4, last30d: 5 });
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)).toEqual({ date: "2026-10-04", count: 1 }); // 23 h antes = día 3 en Madrid
    expect(s.daily.reduce((sum, d) => sum + d.count, 0)).toBe(5);
  });

  it("agrupa por día civil de Madrid, no por UTC", () => {
    // 23:30 UTC del 3 de octubre = 01:30 del 4 en Madrid (CEST).
    expect(madridDay(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04");
    const s = summarizeSignups(["2026-10-03T23:30:00Z"], NOW);
    expect(s.daily.at(-1)?.count).toBe(1);
  });

  it("ignora fechas inválidas sin lanzar", () => {
    expect(summarizeSignups(["no-es-fecha"], NOW).last30d).toBe(0);
  });
});

describe("recentSignIns", () => {
  it("ordena por último acceso y descarta cuentas sin acceso o sin email", () => {
    const rows = recentSignIns([
      { email: "a@x.es", created_at: hoursAgo(100), last_sign_in_at: hoursAgo(5) },
      { email: "b@x.es", created_at: hoursAgo(100), last_sign_in_at: hoursAgo(1) },
      { email: "c@x.es", created_at: hoursAgo(100), last_sign_in_at: null },
      { email: null, created_at: hoursAgo(100), last_sign_in_at: hoursAgo(2) },
    ]);
    expect(rows.map((r) => r.email)).toEqual(["b@x.es", "a@x.es"]);
  });
});

describe("paletteBreakdown", () => {
  it("usa la paleta del borrador, después themeId y, sin web, el estilo v1", () => {
    const result = paletteBreakdown(
      [
        { id: "w1", style: "clasico" },
        { id: "w2", style: null },
        { id: "w3", style: "natural" },
        { id: "w4", style: null },
      ],
      [
        { wedding_id: "w1", palette: "rosa", theme: "clasico" },
        { wedding_id: "w2", palette: null, theme: "natural" },
      ],
    );
    expect(result).toEqual([
      { id: "natural", label: "Natural", count: 2 },
      { id: "editorial", label: "Editorial", count: 1 },
      { id: "rosa", label: "Rosa empolvado", count: 1 },
    ]);
  });
});

describe("siteStateOf", () => {
  it("distingue los cuatro estados de la web", () => {
    expect(siteStateOf(null)).toBe("legacy");
    expect(siteStateOf({ published_revision_id: null, published_at: null })).toBe("draft");
    expect(siteStateOf({ published_revision_id: "r1", published_at: "2026-10-01" })).toBe("published");
    expect(siteStateOf({ published_revision_id: null, published_at: "2026-10-01" })).toBe("retired");
  });
});

describe("funnel y porcentajes", () => {
  it("mantiene el orden del embudo y conserva los null", () => {
    const f = buildFunnel({ registered: 10, wedding: 6, published: 4, guest: null, rsvp: 1 });
    expect(f.map((s) => s.key)).toEqual(["registered", "wedding", "published", "guest", "rsvp"]);
    expect(f[3]?.count).toBeNull();
  });
  it("percentOf no divide entre cero ni entre null", () => {
    expect(percentOf(3, 4)).toBe(75);
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(null, 4)).toBeNull();
  });
});

describe("summarizePayments", () => {
  it("suma confirmadas y solo las comisiones de tarjeta", () => {
    expect(
      summarizePayments(5, [
        { total_cents: 10_000, service_fee_cents: 285, method: "card" },
        { total_cents: 5_000, service_fee_cents: 0, method: "bizum_manual" },
      ]),
    ).toEqual({ contributions: 5, confirmed: 2, confirmedCents: 15_000, cardFeesCents: 285 });
  });
});

describe("toWeddingSummary", () => {
  it("lee el agregado embebido de invitados y la web (objeto o array)", () => {
    const base = {
      id: "w1",
      slug: "ana-y-luis",
      partner_name_1: "Ana",
      partner_name_2: "Luis",
      wedding_date: "2027-06-12",
      created_at: hoursAgo(3),
      cover_image_url: "https://x.supabase.co/storage/v1/object/public/wedding-photos/w1/cover.jpg",
      style: "clasico",
      wedding_guests: [{ count: 12 }],
    };
    const a = toWeddingSummary({ ...base, wedding_sites: { published_revision_id: "r", published_at: "x", palette: "mar", theme: "editorial" } });
    expect(a).toMatchObject({ siteState: "published", guestCount: 12, hasPhoto: true, palette: "mar", partnerNames: "Ana y Luis" });
    const b = toWeddingSummary({ ...base, cover_image_url: null, wedding_sites: [] });
    expect(b).toMatchObject({ siteState: "legacy", hasPhoto: false, palette: "clasico" });
  });
});

// ---------------------------------------------------------------------------
// Loader con Supabase simulado
// ---------------------------------------------------------------------------

describe("loadAdminOverview", () => {
  function happyRespond(q: Query): Result {
    const f = q.filters.join("&");
    if (q.head) {
      if (q.table === "weddings" && q.select.includes("!inner")) return { count: f.includes("rsvp_status=neq") ? 1 : 3 };
      const table: Record<string, number> = { weddings: 5, wedding_sites: 4, wedding_guests: 40, waitlist: 7, contributions: 0 };
      if (f === "cover_image_url=not.is.null") return { count: 2 };
      if (f === "published_revision_id=not.is.null") return { count: 3 };
      if (f === "invitation_prepared_at=not.is.null") return { count: 30 };
      if (f === "invitation_sent_at=not.is.null") return { count: 20 };
      if (f === "rsvp_status=eq.si") return { count: 9 };
      if (f === "rsvp_status=eq.no") return { count: 2 };
      if (f === "rsvp_status=eq.pendiente") return { count: 29 };
      if (f === "interested_in_gifts=eq.true") return { count: 4 };
      if (f.startsWith("kind=eq.")) return { count: f === "kind=eq.pareja" ? 6 : f === "kind=eq.planner" ? 1 : 0 };
      return { count: table[q.table] ?? 0 };
    }
    if (q.table === "weddings" && q.select.startsWith("id, style")) return { data: [{ id: "w1", style: null }] };
    if (q.table === "wedding_sites") return { data: [{ wedding_id: "w1", palette: "oro", theme: "editorial" }] };
    if (q.table === "weddings") return { data: [] };
    if (q.table === "waitlist") return { data: [{ id: "1", email: "p@x.es", kind: "pareja", created_at: hoursAgo(1), interested_in_gifts: true }] };
    return { data: [] };
  }

  it("agrega todo con conteos y sin leer filas de invitados", async () => {
    const { client, queries } = mockClient(happyRespond, [
      { email: "a@x.es", created_at: hoursAgo(2), last_sign_in_at: hoursAgo(1) },
      { email: "b@x.es", created_at: hoursAgo(24 * 10), last_sign_in_at: null },
    ]);
    const o = await loadAdminOverview(client, NOW);

    expect(o.users).toMatchObject({ total: 2, last24h: 1, last7d: 1, last30d: 2, truncated: false });
    expect(o.weddings).toEqual({ total: 5, published: 3, withPhoto: 2, palettes: [{ id: "oro", label: "Oro viejo", count: 1 }] });
    expect(o.guests).toEqual({ total: 40, prepared: 30, sent: 20, yes: 9, no: 2, pending: 29 });
    expect(o.waitlist).toMatchObject({ total: 7, interestedInGifts: 4, byKind: { pareja: 6, planner: 1, proveedor: 0, otro: 0 } });
    expect(o.funnel.map((s) => s.count)).toEqual([2, 5, 3, 3, 1]);
    expect(o.payments).toBeNull();
    expect(o.unavailable).toEqual([]);

    // Ninguna lectura de wedding_guests trae filas: solo conteos o agregados embebidos.
    const guestRowReads = queries.filter((q) => q.table === "wedding_guests" && !q.head);
    expect(guestRowReads).toEqual([]);
  });

  it("degrada a null cuando faltan columnas o tablas sin migrar, sin lanzar", async () => {
    const { client } = mockClient((q) => {
      const f = q.filters.join("&");
      if (q.table === "wedding_sites" || q.select.includes("wedding_sites(")) return { error: { code: "PGRST205" } };
      if (f.startsWith("invitation_")) return { error: { code: "42703" } };
      if (f === "interested_in_gifts=eq.true" || q.select.includes("interested_in_gifts")) return { error: { code: "42703" } };
      return happyRespond(q);
    }, new Error("auth down"));
    const o = await loadAdminOverview(client, NOW);

    expect(o.users).toBeNull();
    expect(o.weddings.published).toBeNull();
    expect(o.guests.prepared).toBeNull();
    expect(o.guests.sent).toBeNull();
    expect(o.waitlist.interestedInGifts).toBeNull();
    expect(o.waitlist.latest).toHaveLength(1); // reintento sin la columna nueva
    expect(o.funnel[0]?.count).toBeNull();
    expect(o.weddings.palettes).toEqual([{ id: "editorial", label: "Editorial", count: 1 }]);
    expect(o.unavailable).toEqual(
      expect.arrayContaining(["auth.users", "wedding_sites", "wedding_guests.invitation_prepared_at", "waitlist.interested_in_gifts"]),
    );
  });

  it("solo pinta el histórico de pagos si hubo aportaciones", async () => {
    const { client } = mockClient((q) => {
      if (q.table === "contributions" && q.head) return { count: 3 };
      if (q.table === "contributions") {
        expect(q.filters).toContain("status=eq.confirmed");
        return { data: [{ total_cents: 2_000, service_fee_cents: 60, method: "card" }] };
      }
      return happyRespond(q);
    });
    const o = await loadAdminOverview(client, NOW);
    expect(o.payments).toEqual({ contributions: 3, confirmed: 1, confirmedCents: 2_000, cardFeesCents: 60 });
  });
});

describe("loadLatestWeddings", () => {
  it("reintenta sin el embed de wedding_sites si la tabla no existe", async () => {
    const unavailable = new Set<string>();
    const { client, queries } = mockClient((q) =>
      q.select.includes("wedding_sites(")
        ? { error: { code: "PGRST200" } }
        : {
            data: [
              {
                id: "w1",
                slug: "ana-y-luis",
                partner_name_1: "Ana",
                partner_name_2: "Luis",
                wedding_date: null,
                created_at: hoursAgo(1),
                cover_image_url: null,
                style: null,
                wedding_guests: [{ count: 0 }],
              },
            ],
          },
    );
    const rows = await loadLatestWeddings(client, 20, unavailable);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.select).toContain("wedding_guests(count)");
    expect(rows[0]).toMatchObject({ slug: "ana-y-luis", siteState: "legacy", guestCount: 0, palette: "editorial" });
    expect(unavailable.has("wedding_sites")).toBe(true);
  });
});

describe("loadLatestWeddings sin agregados de PostgREST", () => {
  it("reintenta sin wedding_guests(count) y deja el nº de invitados en null", async () => {
    const unavailable = new Set<string>();
    const { client } = mockClient((q) =>
      q.select.includes("(count)")
        ? { error: { code: "PGRST123", message: "Use of aggregate functions is not allowed" } }
        : {
            data: [
              {
                id: "w1",
                slug: "ana-y-luis",
                partner_name_1: "Ana",
                partner_name_2: "Luis",
                wedding_date: null,
                created_at: hoursAgo(1),
                cover_image_url: null,
                style: null,
                wedding_sites: { published_revision_id: "r1", published_at: hoursAgo(1), palette: null, theme: "natural" },
              },
            ],
          },
    );
    const rows = await loadLatestWeddings(client, 20, unavailable);
    expect(rows[0]).toMatchObject({ siteState: "published", guestCount: null, palette: "natural" });
    expect([...unavailable]).toEqual(["wedding_guests.count"]);
  });
});

describe("loadUsers: caché de 5 minutos (R09, plan §5.2)", () => {
  function countingClient(users: Array<Record<string, unknown>>, fail = false) {
    const listUsers = vi.fn(async ({ page }: { page: number }) =>
      fail ? { data: { users: [] }, error: new Error("auth down") } : { data: { users: page === 1 ? users : [] }, error: null });
    return { client: { auth: { admin: { listUsers } } } as never, listUsers };
  }

  it("no vuelve a paginar Auth dentro de los 5 minutos y sí después", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const { client, listUsers } = countingClient([{ id: "u1", email: "a@x.es", created_at: hoursAgo(2), last_sign_in_at: hoursAgo(1), app_metadata: { secret: 1 } }]);
      const first = await loadUsers(client, NOW);
      const second = await loadUsers(client, NOW);
      expect(listUsers).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(first?.idToEmail.get("u1")).toBe("a@x.es");
      vi.setSystemTime(NOW.getTime() + USERS_CACHE_TTL_MS + 1);
      await loadUsers(client, NOW);
      expect(listUsers).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un fallo de Auth no se cachea", async () => {
    const down = countingClient([], true);
    expect(await loadUsers(down.client, NOW)).toBeNull();
    const up = countingClient([{ id: "u1", email: "a@x.es", created_at: hoursAgo(2) }]);
    expect(await loadUsers(up.client, NOW)).toMatchObject({ total: 1 });
    expect(up.listUsers).toHaveBeenCalledTimes(1);
  });
});
