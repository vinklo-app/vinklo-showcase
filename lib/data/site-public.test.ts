import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromLegacy, LEGACY_SCENE_IDS, SITE_SCHEMA_VERSION } from "@/lib/site-document";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), weddingPublic: vi.fn(), agenda: vi.fn(), captureMessage: vi.fn(), captureException: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.captureMessage, captureException: mocks.captureException }));
// La caché de Next no existe en tests: una caché mínima con la misma regla
// (guarda lo que la función devuelve; si lanza, no guarda nada).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join("|");
    if (mocks.store.has(key)) return mocks.store.get(key);
    const value = await fn();
    mocks.store.set(key, value);
    return value;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/app/b/[slug]/wedding-public", () => ({ getWeddingPublic: mocks.weddingPublic, getWeddingAgenda: mocks.agenda }));
import { getPublicSite, getPublicSiteResult } from "./site-public";

const legacyWedding = {
  slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12",
  cover_image_url: null, plan: "free" as const, cubierto_price_cents: 0, stripe_onboarded: false,
  page_config: { style: "clasico" as const, welcomeMessage: "¡Os esperamos!", venue: "Finca", address: "", time: "18:30" },
};
const publishedDocument = documentFromLegacy({ ...legacyWedding, partner_name_1: "Ana María", agenda: [] });

let calls: Array<{ table: string; method: string; args: unknown[] }>;
function viewDatabase(reply: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      chain.maybeSingle = async () => reply;
      return chain;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.weddingPublic.mockResolvedValue(legacyWedding);
  mocks.agenda.mockResolvedValue([{ id: "a1b2c3d4-0000-4000-8000-000000000000", title: "Ceremonia", time_label: "13:00", place: null, address: null, notes: null, sort: 1 }]);
});

describe("getPublicSite", () => {
  it("sirve la revisión publicada cuando la vista devuelve un documento válido", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: { slug: "ana-y-luis", plan: "premium", is_published: true, document: publishedDocument, published_at: "2026-10-02T12:00:00Z", unpublished_at: null, schema_version: SITE_SCHEMA_VERSION, revision_id: "rev-1" }, error: null }));
    const site = await getPublicSite("ana-y-luis");
    expect(site).toMatchObject({ slug: "ana-y-luis", source: "published", publishedAt: "2026-10-02T12:00:00Z", plan: "premium", revisionId: "rev-1" });
    expect(site?.document.scenes[0]).toMatchObject({ type: "cover", props: { partnerName1: "Ana María" } });
    expect(calls).toContainEqual({ table: "wedding_sites_public", method: "eq", args: ["slug", "ana-y-luis"] });
    expect(calls.find((c) => c.method === "select")?.args[0]).not.toMatch(/token|guest|stripe|couple/);
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
  });
  it("cae al adaptador v1 (con agenda) cuando no hay revisión publicada", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: null }));
    const site = await getPublicSite("ana-y-luis");
    expect(site).toMatchObject({ slug: "ana-y-luis", source: "legacy", publishedAt: null, plan: "free" });
    expect(site?.document.themeId).toBe("clasico");
    const agenda = site?.document.scenes.find((s) => s.id === LEGACY_SCENE_IDS.agenda);
    expect(agenda).toMatchObject({ type: "agenda", enabled: true, props: { items: [{ title: "Ceremonia", timeLabel: "13:00" }] } });
    expect(mocks.agenda).toHaveBeenCalledWith("ana-y-luis");
  });
  it("un documento inválido en BD (p. ej. schemaVersion futuro) falla cerrado: null, nunca el adaptador (auditoría H01)", async () => {
    const future = { ...publishedDocument, schemaVersion: 2, secretMarker: "do-not-log" };
    mocks.admin.mockReturnValue(viewDatabase({ data: { slug: "ana-y-luis", plan: "free", is_published: true, document: future, published_at: "2026-10-02T12:00:00Z", unpublished_at: null, schema_version: 2, revision_id: "rev-2" }, error: null }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(mocks.agenda).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("do-not-log");
  });
  it("una web retirada (is_published=false) devuelve null sin caer al adaptador", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: { slug: "ana-y-luis", plan: "free", is_published: false, document: null, published_at: null, unpublished_at: "2026-10-02T13:00:00Z", schema_version: null, revision_id: null }, error: null }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(mocks.agenda).not.toHaveBeenCalled();
  });
  it("si el adaptador lanza con datos legados fuera de contrato devuelve null y registra, sin 500", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: null }));
    mocks.weddingPublic.mockResolvedValue({ ...legacyWedding, partner_name_1: null as unknown as string });
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
  it("un error leyendo la vista (migración pendiente) falla cerrado: null, nunca el adaptador (auditoría H01)", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: { code: "42P01", message: "relation does not exist" } }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(mocks.agenda).not.toHaveBeenCalled();
  });
  it("devuelve null si tampoco existe la boda en el modelo antiguo", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: null }));
    mocks.weddingPublic.mockResolvedValue(null);
    expect(await getPublicSite("nadie-y-nadie")).toBeNull();
  });
  it("no consulta slugs malformados", async () => {
    expect(await getPublicSite("../../secret")).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
  });
});

describe("getPublicSiteResult: no encontrada ≠ fallo de lectura (revisión perf P1-3)", () => {
  const published = { data: { slug: "ana-y-luis", plan: "free", is_published: true, document: publishedDocument, published_at: "2026-10-02T12:00:00Z", unpublished_at: null, schema_version: SITE_SCHEMA_VERSION, revision_id: "rev-1" }, error: null };
  it("fallo leyendo la vista → unavailable (no not_found), a Sentry sin slug, y sin caer al adaptador", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: { code: "57P01", message: "terminating connection" } }));
    expect(await getPublicSiteResult("ana-y-luis")).toEqual({ status: "unavailable" });
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = mocks.captureMessage.mock.calls[0]!;
    expect(message).toBe("site-public: lectura de la invitación fallida");
    expect(context).toMatchObject({ level: "error", extra: { code: "57P01" }, fingerprint: ["site-public-transient"] });
    expect(JSON.stringify(mocks.captureMessage.mock.calls)).not.toContain("ana-y-luis");
  });
  it("el fallo NO se cachea: la siguiente visita vuelve a leer y ya sirve la invitación", async () => {
    mocks.admin.mockReturnValueOnce(viewDatabase({ data: null, error: { code: "57P01", message: "x" } })).mockReturnValue(viewDatabase(published));
    expect((await getPublicSiteResult("ana-y-luis")).status).toBe("unavailable");
    const second = await getPublicSiteResult("ana-y-luis");
    expect(second.status).toBe("ok");
    expect(mocks.admin).toHaveBeenCalledTimes(2);
  });
  it("lo publicado sí se cachea (no vuelve a leer)", async () => {
    mocks.admin.mockReturnValue(viewDatabase(published));
    expect((await getPublicSiteResult("ana-y-luis")).status).toBe("ok");
    expect((await getPublicSiteResult("ana-y-luis")).status).toBe("ok");
    expect(mocks.admin).toHaveBeenCalledTimes(1);
  });
  it("una excepción inesperada (p. ej. de la caché) también es unavailable y va a Sentry una sola vez, sin su mensaje", async () => {
    mocks.admin.mockImplementation(() => { throw new Error("boom ana-y-luis"); });
    expect(await getPublicSiteResult("ana-y-luis")).toEqual({ status: "unavailable" });
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(mocks.captureMessage.mock.calls[0]![1]).toMatchObject({ extra: { code: "unexpected" }, fingerprint: ["site-public-transient"] });
    expect(JSON.stringify(mocks.captureMessage.mock.calls)).not.toContain("ana-y-luis");
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
  it("retirada, inexistente o slug malformado → not_found, sin Sentry", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: { ...published.data, is_published: false, document: null }, error: null }));
    expect(await getPublicSiteResult("ana-y-luis")).toEqual({ status: "not_found" });
    mocks.store.clear();
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: null }));
    mocks.weddingPublic.mockResolvedValue(null);
    expect(await getPublicSiteResult("nadie-y-nadie")).toEqual({ status: "not_found" });
    expect(await getPublicSiteResult("../../secret")).toEqual({ status: "not_found" });
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
  it("getPublicSite sigue devolviendo null en ambos casos (resto de llamantes intactos)", async () => {
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: { code: "57P01", message: "x" } }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
  });
});
