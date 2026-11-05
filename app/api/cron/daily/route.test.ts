import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), send: vi.fn(), capture: vi.fn(), mvp: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/product-scope", () => ({ get RSVP_MVP() { return mocks.mvp; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/emails/send", () => ({ sendEmail: mocks.send }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.capture }));

import { GET, maxDuration } from "./route";
import { isoDaysFromNow } from "@/lib/reminders";

const W = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Result = { data: unknown; error: unknown; count?: number };

/** Cliente falso: cada tabla devuelve lo configurado y registra filtros e inserciones. */
function fakeAdmin(tables: Record<string, Result | (() => Result)>, users: Record<string, string>) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const filters: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    rpc: async () => ({ data: 0, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ? { email: users[id] } : null } }) } },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "gte", "lt", "limit", "contains", "order", "delete", "is", "not", "update"]) {
        chain[method] = (...args: unknown[]) => { filters.push({ table, method, args }); return chain; };
      }
      chain.insert = async (row: unknown) => { inserts.push({ table, row }); return { error: null }; };
      chain.then = (resolve: (value: unknown) => unknown) => {
        const entry = tables[table];
        const value = typeof entry === "function" ? entry() : entry ?? { data: [], error: null, count: 0 };
        return Promise.resolve(value).then(resolve);
      };
      return chain;
    },
  };
  return { client, inserts, filters };
}

function request() {
  return new Request("https://vinklo.es/api/cron/daily", { headers: { authorization: "Bearer s3cret" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mvp = true;
  process.env.CRON_SECRET = "s3cret";
  process.env.NEXT_PUBLIC_APP_URL = "https://vinklo.es";
  mocks.send.mockResolvedValue({ skipped: false, id: "e1" });
});

describe("cron diario: resumen de respuestas (§2.6)", () => {
  it("con RSVP_MVP también envía: un correo a cada miembro y un evento por boda", async () => {
    let guestsCall = 0;
    const fake = fakeAdmin({
      wedding_guests: () => (guestsCall++ === 0
        ? { data: [{ wedding_id: W, rsvp_status: "si", rsvp_companions: 3 }, { wedding_id: W, rsvp_status: "no", rsvp_companions: 0 }], error: null }
        : { data: [{ rsvp_companions: 3 }, { rsvp_companions: 1 }], error: null }),
      wedding_members: { data: [{ wedding_id: W, user_id: "u-1" }, { wedding_id: W, user_id: "u-2" }], error: null },
      events: { data: null, error: null, count: 0 },
    }, { "u-1": "ana@example.com", "u-2": "luis@example.com" });
    mocks.admin.mockReturnValue(fake.client);

    const response = await GET(request());
    const body = await response.json();
    expect(body).toMatchObject({ rsvpDigests: 1, skipped: true });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.map(([input]) => input.to)).toEqual(["ana@example.com", "luis@example.com"]);
    const [{ subject, html }] = mocks.send.mock.calls[0]!;
    expect(subject).toBe("Nuevas respuestas: 4 personas han confirmado y 1 invitado no podrá ir");
    expect(html).toContain("En total ya vienen 6 personas.");
    // Solo miembros que no se han dado de baja.
    expect(fake.filters).toContainEqual({ table: "wedding_members", method: "eq", args: ["digest_opt_out", false] });
    expect(fake.filters.some((f) => f.table === "wedding_guests" && f.method === "gte" && f.args[0] === "responded_at")).toBe(true);
    // La comprobación de idempotencia se acota por boda.
    expect(fake.filters).toContainEqual({ table: "events", method: "eq", args: ["wedding_id", W] });
    expect(fake.inserts).toEqual([{ table: "events", row: expect.objectContaining({ wedding_id: W, type: "digest_rsvp_daily", payload: expect.objectContaining({ recipients: 2 }) }) }]);
  });

  it("si ya se envió hoy, no repite", async () => {
    const fake = fakeAdmin({
      wedding_guests: { data: [{ wedding_id: W, rsvp_status: "si", rsvp_companions: 0 }], error: null },
      wedding_members: { data: [{ wedding_id: W, user_id: "u-1" }], error: null },
      events: { data: null, error: null, count: 1 },
    }, { "u-1": "ana@example.com" });
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.rsvpDigests).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sin la migración (columna inexistente) no rompe el cron y avisa sin datos personales", async () => {
    const fake = fakeAdmin({ wedding_guests: { data: null, error: { code: "42703", message: "column responded_at does not exist" } } }, {});
    mocks.admin.mockReturnValue(fake.client);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(String), { level: "warning", extra: { code: "42703" } });
  });

  it("sin RESEND_API_KEY (envío saltado) no marca el día como enviado", async () => {
    mocks.send.mockResolvedValue({ skipped: true });
    const fake = fakeAdmin({
      wedding_guests: { data: [{ wedding_id: W, rsvp_status: "si", rsvp_companions: 0 }], error: null },
      wedding_members: { data: [{ wedding_id: W, user_id: "u-1" }], error: null },
      events: { data: null, error: null, count: 0 },
    }, { "u-1": "ana@example.com" });
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.rsvpDigests).toBe(0);
    expect(fake.inserts).toEqual([]);
  });
});

describe("cron diario: retención (§5.9, §5.3)", () => {
  it("con RSVP_MVP también corre: aviso a todos los miembros, anonimización y purga de events", async () => {
    const fake = fakeAdmin({
      wedding_guests: { data: [], error: null },
      wedding_members: { data: [{ user_id: "u-1" }, { user_id: "u-2" }], error: null },
    }, { "u-1": "ana@example.com", "u-2": "luis@example.com" });
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    fake.client.rpc = (async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "retention_notice_candidates") return { data: [{ wedding_id: W, anonymise_on: "2027-07-15" }], error: null };
      if (name === "mark_retention_notice") return { data: true, error: null };
      if (name === "anonymise_expired_guests") return { data: 1, error: null };
      if (name === "purge_old_events") return { data: 7, error: null };
      return { data: 0, error: null };
    }) as typeof fake.client.rpc;
    mocks.admin.mockReturnValue(fake.client);

    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ skipped: true, retention: { notices: 1, anonymised: 1, eventsPurged: 7 } });
    expect(mocks.send.mock.calls.map(([input]) => input.to)).toEqual(["ana@example.com", "luis@example.com"]);
    expect(rpcCalls.map((c) => c.name)).toEqual([
      "cleanup_rate_limit_hits",
      "retention_notice_candidates",
      "mark_retention_notice",
      "anonymise_expired_guests",
      "purge_old_events",
    ]);
    // Los avisos de servicio no filtran por la baja del resumen.
    expect(fake.filters).not.toContainEqual({ table: "wedding_members", method: "eq", args: ["digest_opt_out", false] });
  });
});

describe("cron diario: mantenimiento", () => {
  it("el cron admite hasta 300 s", () => {
    expect(maxDuration).toBe(60);
  });
  it("purga los borradores del creador caducados (expires_at < ahora) y lo informa", async () => {
    const fake = fakeAdmin({ builder_draft_stash: { data: [{ email: "a@x.es" }, { email: "b@x.es" }], error: null } }, {});
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.draftsPurged).toBe(2);
    // La tabla no tiene `id`: devolver `id` hacía fallar el borrado en PostgREST.
    expect(fake.filters).toContainEqual({ table: "builder_draft_stash", method: "select", args: ["email"] });
    const lt = fake.filters.find((f) => f.table === "builder_draft_stash" && f.method === "lt");
    expect(lt?.args[0]).toBe("expires_at");
    expect(Date.parse(lt!.args[1] as string)).toBeLessThanOrEqual(Date.now());
  });
  it("reintenta los borrados pendientes (P2-5) en un lote acotado y lo informa", async () => {
    const deleteUser = vi.fn(async () => ({ error: null }));
    const fake = fakeAdmin({ pending_deletions: { data: [{ id: "q1", kind: "user", target_id: "u-9", vendor_ids: [], attempts: 1 }], error: null } }, {});
    (fake.client.auth.admin as Record<string, unknown>).deleteUser = deleteUser;
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.deletions).toEqual({ done: 1, failed: 0 });
    expect(deleteUser).toHaveBeenCalledWith("u-9");
    expect(fake.filters).toContainEqual({ table: "pending_deletions", method: "limit", args: [10] });
  });
  it("un borrado que falla por quinta vez sube a error en Sentry", async () => {
    const deleteUser = vi.fn(async () => ({ error: { status: 500, code: "unexpected_failure" } }));
    const fake = fakeAdmin({ pending_deletions: { data: [{ id: "q1", kind: "user", target_id: "u-9", vendor_ids: [], attempts: 4 }], error: null } }, {});
    (fake.client.auth.admin as Record<string, unknown>).deleteUser = deleteUser;
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.deletions).toEqual({ done: 0, failed: 1, stuck: 1 });
    expect(mocks.capture).toHaveBeenCalledWith("cron: borrados pendientes atascados", { level: "error", extra: { failed: 1, stuck: 1, code: null } });
    expect(mocks.capture).not.toHaveBeenCalledWith("cron: borrados pendientes con fallos", expect.anything());
  });
  it("si la cola de borrados no se puede leer, avisa y el resto del cron sigue", async () => {
    const fake = fakeAdmin({ pending_deletions: { data: null, error: { code: "42P01" } } }, {});
    mocks.admin.mockReturnValue(fake.client);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).deletions).toEqual({ done: 0, failed: 0, error: "42P01" });
    expect(mocks.capture).toHaveBeenCalledWith("cron: borrados pendientes con fallos", { level: "warning", extra: { failed: 0, code: "42P01" } });
  });
  it("si la purga de borradores falla, avisa sin datos y el resto del cron sigue", async () => {
    const fake = fakeAdmin({ builder_draft_stash: { data: null, error: { code: "42P01" } } }, {});
    mocks.admin.mockReturnValue(fake.client);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).draftsPurged).toBe(0);
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(String), { level: "warning", extra: { code: "42P01" } });
  });
});

describe("cron diario: recordatorios de plazos (backlog, fuera del MVP)", () => {
  it("no avisa de plazos de una boda en borrado (P2-5)", async () => {
    mocks.mvp = false;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
    const due = isoDaysFromNow(today, 7);
    const tranche = (id: string, weddingId: string, deletedAt: string | null) => ({
      id, vendor_id: `v-${id}`, label: "Señal", amount_cents: 1000, due_date: due, status: "pending",
      vendors: { name: "Fotos", wedding_id: weddingId, weddings: { id: weddingId, slug: "s", couple_id: "u-1", deleted_at: deletedAt } },
    });
    const fake = fakeAdmin({
      payment_tranches: { data: [tranche("t-viva", W, null), tranche("t-borrada", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-11T08:00:00Z")], error: null },
      wedding_members: { data: [{ wedding_id: W, user_id: "u-1" }], error: null },
      events: { data: null, error: null, count: 0 },
    }, { "u-1": "ana@example.com" });
    mocks.admin.mockReturnValue(fake.client);
    const body = await (await GET(request())).json();
    expect(body.sent.tranches).toBe(1);
    expect(mocks.send.mock.calls.filter(([input]) => String(input.subject).startsWith("Vence pronto"))).toHaveLength(1);
    expect(fake.filters).toContainEqual({ table: "payment_tranches", method: "select", args: [expect.stringContaining("deleted_at")] });
  });
});
