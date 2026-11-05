/**
 * QA fase 1 — casos límite de las server actions del motor de webs
 * (lib/actions/site.ts) y del loader público (lib/data/site-public.ts) que
 * no cubren los tests del agente BE. Mismo patrón de mocks que
 * lib/actions/site.test.ts: cliente falso con cola de respuestas por tabla.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromLegacy, type SiteDocument } from "@/lib/site-document";

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn(), admin: vi.fn(), weddingPublic: vi.fn(), agenda: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate, revalidateTag: () => {}, unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/app/b/[slug]/wedding-public", () => ({ getWeddingPublic: mocks.weddingPublic, getWeddingAgenda: mocks.agenda }));
import { publishSite, saveSiteDraft } from "@/lib/actions/site";
import { getPublicSite } from "@/lib/data/site-public";

const weddingId = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const legacyWedding = {
  id: weddingId, slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis",
  wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "natural" as const, venue: "Finca" },
};
const validDocument: SiteDocument = documentFromLegacy({ ...legacyWedding, agenda: [] });

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

function database(replies: Record<string, Reply[]>, rpcReply: Reply = { data: null, error: null }, signedIn = true) {
  const next = (table: string): Reply => replies[table]?.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    rpc: vi.fn(async (name: string, args: unknown) => { calls.push({ table: "rpc", method: name, args: [args] }); return rpcReply; }),
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "insert", "update", "order"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => next(table);
      chain.single = async () => next(table);
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next(table)).then(resolve);
      return chain;
    },
  };
}
const owner = (): Reply => ({ data: { id: weddingId, slug: "ana-y-luis" }, error: null });
const weddingRow = (): Reply => ({ data: { ...legacyWedding }, error: null });
const siteRow = (draft: unknown, version: number): Reply => ({ data: { draft_document: draft, draft_version: version, published_revision_id: null, published_at: null }, error: null });

beforeEach(() => { vi.clearAllMocks(); calls = []; vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("baseVersion: solo enteros ≥ 0", () => {
  const bad: unknown[] = ["1", "", NaN, Infinity, -Infinity, null, undefined, true, {}, [], -0.5, 1.5, -1];
  const label = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v) ?? "undefined");
  it.each(bad.map((v) => [label(v), v]))("saveSiteDraft rechaza baseVersion %s sin abrir sesión", async (_label, value) => {
    const result = await saveSiteDraft({ document: validDocument, baseVersion: value as number });
    expect(result).toMatchObject({ ok: false, code: "error" });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(bad.map((v) => [label(v), v]))("publishSite rechaza baseVersion %s sin abrir sesión", async (_label, value) => {
    const result = await publishSite({ baseVersion: value as number });
    expect(result).toMatchObject({ ok: false, code: "error" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("enteros fuera de int4 (1e21, 2^53+2) pasan la validación local y los rechaza la BD → error genérico sin filtrar detalle", async () => {
    // Observación QA (no bloqueante): isVersion solo exige Number.isInteger; un tope (p. ej. 2^31-1) lo cortaría antes de abrir sesión.
    for (const value of [1e21, Number.MAX_SAFE_INTEGER + 2]) {
      calls = [];
      // Primero se lee el borrador guardado (el documento es Story: control Premium, 13-oct-2026); era Story también.
      mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_document: validDocument }, error: null }, { data: null, error: { code: "22003", message: "value out of range for type integer" } }] }));
      const result = await saveSiteDraft({ document: validDocument, baseVersion: value });
      expect(result).toMatchObject({ ok: false, code: "error" });
      expect(JSON.stringify(result)).not.toContain("out of range");
    }
  });
  it("input nulo/indefinido no revienta", async () => {
    expect(await saveSiteDraft(null as never)).toMatchObject({ ok: false, code: "error" });
    expect(await saveSiteDraft(undefined as never)).toMatchObject({ ok: false, code: "error" });
    expect(await publishSite(null as never)).toMatchObject({ ok: false, code: "error" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("-0 y 0 son equivalentes: crean la fila", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 1 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: -0 })).toEqual({ ok: true, draftVersion: 1 });
    expect(calls.some((c) => c.table === "wedding_sites" && c.method === "insert")).toBe(true);
  });
});

describe("saveSiteDraft · creación concurrente (23505)", () => {
  it("dos pestañas con draftVersion 0: la segunda recibe conflict con la versión real y no revalida", async () => {
    mocks.client.mockResolvedValue(database({
      weddings: [owner()],
      wedding_sites: [{ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }, { data: { draft_version: 1 }, error: null }],
    }));
    const result = await saveSiteDraft({ document: validDocument, baseVersion: 0 });
    expect(result).toEqual({ ok: false, code: "conflict", draftVersion: 1, error: expect.stringMatching(/pestaña/i) });
    expect(JSON.stringify(result)).not.toContain("unique constraint");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    // Tras el 23505 se relee la versión (select … maybeSingle) para que el cliente pueda reintentar con base correcta.
    const inserts = calls.filter((c) => c.table === "wedding_sites" && c.method === "insert");
    const selects = calls.filter((c) => c.table === "wedding_sites" && c.method === "select");
    expect(inserts).toHaveLength(1);
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });
  it("si la relectura tras el 23505 falla, devuelve conflict con draftVersion 0 (el cliente volverá a intentar crear)", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: null, error: { code: "23505", message: "dup" } }, { data: null, error: { code: "PGRST000", message: "down" } }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 0 })).toMatchObject({ ok: false, code: "conflict", draftVersion: 0 });
  });
  it("persiste el documento normalizado por Zod, no el input crudo", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 1 }, error: null }] }));
    const loose = JSON.parse(JSON.stringify(validDocument));
    loose.scenes[0].props.partnerName1 = "  Ana  ";
    delete loose.scenes[0].props.eyebrow;
    expect((await saveSiteDraft({ document: loose, baseVersion: 0 })).ok).toBe(true);
    const insert = calls.find((c) => c.method === "insert")!.args[0] as { draft_document: SiteDocument };
    expect(insert.draft_document.scenes[0]).toMatchObject({ props: { partnerName1: "Ana", eyebrow: "¡Nos casamos!" } });
  });
});

describe("publishSite · forma de la respuesta del RPC", () => {
  const rpcRow = { revision_id: revisionId, published_at: "2026-10-02T12:00:00Z", draft_version: 3 };
  const state = () => ({ weddings: [owner(), weddingRow(), { data: null, error: null }], wedding_sites: [siteRow(validDocument, 3)] });

  it("acepta un objeto (PostgREST con una fila) igual que un array", async () => {
    mocks.client.mockResolvedValue(database(state(), { data: rpcRow, error: null }));
    expect(await publishSite({ baseVersion: 3 })).toEqual({ ok: true, revisionId, publishedAt: "2026-10-02T12:00:00Z", draftVersion: 3 });
    expect(mocks.revalidate).toHaveBeenCalledWith("/b/ana-y-luis");
  });
  it("acepta un array de una fila", async () => {
    mocks.client.mockResolvedValue(database(state(), { data: [rpcRow], error: null }));
    expect(await publishSite({ baseVersion: 3 })).toEqual({ ok: true, revisionId, publishedAt: "2026-10-02T12:00:00Z", draftVersion: 3 });
  });
  it.each([[[]], [null], [{}], [{ revision_id: revisionId }], [{ published_at: "2026-10-02T12:00:00Z" }]])("sin fila útil (%j) devuelve error, no sincroniza weddings ni revalida", async (data) => {
    mocks.client.mockResolvedValue(database(state(), { data, error: null }));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "error" });
    expect(calls.some((c) => c.table === "weddings" && c.method === "update")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("P0002 site_not_found → conflict; 42501 site_forbidden → error de sesión; ninguno revalida", async () => {
    mocks.client.mockResolvedValue(database(state(), { data: null, error: { code: "P0002", message: "site_not_found" } }));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "conflict" });
    mocks.client.mockResolvedValue(database(state(), { data: null, error: { code: "42501", message: "site_forbidden" } }));
    const forbidden = await publishSite({ baseVersion: 3 });
    expect(forbidden).toMatchObject({ ok: false, code: "error", error: expect.stringMatching(/sesión/i) });
    expect(JSON.stringify(forbidden)).not.toContain("site_forbidden");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("con baseVersion distinta de la fila leída deja que el RPC decida (no hay comprobación previa en código)", async () => {
    // Documenta el comportamiento: el bloqueo optimista vive en la RPC. Aquí el RPC responde conflicto.
    mocks.client.mockResolvedValue(database(state(), { data: null, error: { code: "40001", message: "site_version_conflict" } }));
    expect(await publishSite({ baseVersion: 1 })).toMatchObject({ ok: false, code: "conflict" });
    // S-03: el RPC recibe también el documento que el servidor validó (igualdad jsonb con draft_document en BD).
    // 5.7: y la sincronización de weddings (p_legacy) en la misma llamada.
    expect(calls.find((c) => c.table === "rpc")?.args[0]).toEqual({ p_wedding_id: weddingId, p_expected_version: 1, p_document: validDocument, p_legacy: expect.objectContaining({ page_config: expect.any(Object) }) });
  });
  it("un borrador corrupto en BD bloquea la publicación sin llamar al RPC", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow({ schemaVersion: 1, scenes: "nope" }, 2)] }, { data: rpcRow, error: null }));
    const result = await publishSite({ baseVersion: 2 });
    expect(result).toMatchObject({ ok: false, code: "error", error: expect.stringMatching(/Guardad la web de nuevo/) });
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
  });
});

describe("getPublicSite · plan inválido y web retirada (vista S-02)", () => {
  function viewDatabase(reply: Reply) {
    return {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
        chain.maybeSingle = async () => reply;
        return chain;
      },
    };
  }
  const row = (plan: unknown, extra: Record<string, unknown> = {}) => ({ data: { slug: "ana-y-luis", plan, is_published: true, document: validDocument, published_at: "2026-10-02T12:00:00Z", unpublished_at: null, schema_version: 1, revision_id: revisionId, ...extra }, error: null });

  it.each([["gold"], [null], [undefined], [1], [""]])("plan %j → cae a «free» (fail-safe: aparece el pie de marca) y sigue sirviendo la revisión", async (plan) => {
    mocks.admin.mockReturnValue(viewDatabase(row(plan)));
    const site = await getPublicSite("ana-y-luis");
    expect(site).toMatchObject({ source: "published", plan: "free", slug: "ana-y-luis", revisionId });
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === "select")?.args[0]).toMatch(/is_published/);
  });
  it("web retirada (is_published=false, document null) → null (404) sin caer al adaptador", async () => {
    mocks.weddingPublic.mockResolvedValue({ ...legacyWedding, plan: "free", cubierto_price_cents: 0, stripe_onboarded: false });
    mocks.admin.mockReturnValue(viewDatabase(row("free", { is_published: false, document: null, unpublished_at: "2026-10-03T08:00:00Z", revision_id: null })));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
  });
  it("fila sin is_published (vista antigua) se trata como retirada: null, no adaptador", async () => {
    // Observación QA: el default de is_published es false; una vista sin la columna daría 404 a toda boda publicada.
    mocks.admin.mockReturnValue(viewDatabase({ data: { slug: "ana-y-luis", plan: "free", document: validDocument, published_at: "2026-10-02T12:00:00Z", schema_version: 1 }, error: null }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
  });
  it("publicada pero sin documento en la fila → falla cerrado (null), nunca el adaptador (auditoría H01)", async () => {
    mocks.weddingPublic.mockResolvedValue({ ...legacyWedding, plan: "free", cubierto_price_cents: 0, stripe_onboarded: false });
    mocks.agenda.mockResolvedValue([]);
    mocks.admin.mockReturnValue(viewDatabase(row("free", { document: null })));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("si el adaptador lanza con datos legados fuera de contrato → null con log, no 500", async () => {
    // BUG-1/2/3 ya están corregidos en lib/site-document.ts (ver contract.test.ts); se fuerza el throw con una fila
    // imposible (nombre null → TypeError en .trim()) para cubrir la red de seguridad de getLegacySite.
    mocks.admin.mockReturnValue(viewDatabase({ data: null, error: null }));
    mocks.weddingPublic.mockResolvedValue({ ...legacyWedding, partner_name_1: null as never, plan: "free", cubierto_price_cents: 0, stripe_onboarded: false });
    mocks.agenda.mockResolvedValue([]);
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(console.error).toHaveBeenCalledWith("[site-public] legacy adapter failed", expect.objectContaining({ slug: "ana-y-luis" }));
  });
  it("plan premium válido se respeta", async () => {
    mocks.admin.mockReturnValue(viewDatabase(row("premium")));
    expect((await getPublicSite("ana-y-luis"))?.plan).toBe("premium");
  });
  it("slug vacío en la fila o published_at no string → fila inválida → falla cerrado, nunca el adaptador (auditoría H01)", async () => {
    mocks.weddingPublic.mockResolvedValue({ ...legacyWedding, plan: "free", cubierto_price_cents: 0, stripe_onboarded: false });
    mocks.agenda.mockResolvedValue([]);
    mocks.admin.mockReturnValue(viewDatabase({ data: { slug: 7, plan: "free", is_published: true, document: validDocument, published_at: 123 }, error: null }));
    expect(await getPublicSite("ana-y-luis")).toBeNull();
    expect(mocks.weddingPublic).not.toHaveBeenCalled();
  });
});
