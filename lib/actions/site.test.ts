import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromLegacy, siteDocumentSchema, type SiteDocument } from "@/lib/site-document";

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn(), revalidateTag: vi.fn(), promote: vi.fn(), removeDrafts: vi.fn(), discard: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/photo-storage", () => ({ promoteDraftPhoto: mocks.promote, removeDraftPhotos: mocks.removeDrafts, discardUnpublishedCopy: mocks.discard }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate, revalidateTag: mocks.revalidateTag }));
import { publishSite, saveSiteDraft, unpublishSite } from "./site";

const weddingId = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const legacyWedding = {
  id: weddingId, slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis",
  wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "natural" as const, venue: "Finca" },
};
// En web (lo que crea el creador): la Story tiene sus propias pruebas (Premium, abajo).
const validDocument: SiteDocument = siteDocumentSchema.parse({ ...documentFromLegacy({ ...legacyWedding, agenda: [] }), layout: "web" });
const storyDocument: SiteDocument = documentFromLegacy({ ...legacyWedding, agenda: [] });
const incompleteDocument: SiteDocument = documentFromLegacy({ ...legacyWedding, partner_name_2: "", wedding_date: null, agenda: [] });

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

/**
 * Cliente falso: cada tabla tiene una cola de respuestas; cualquier terminal
 * (maybeSingle, single, await) consume la siguiente. `rpc` se registra en el
 * mismo array para poder comprobar el orden.
 */
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
const weddingRow = (overrides: Partial<typeof legacyWedding> = {}): Reply => ({ data: { ...legacyWedding, ...overrides }, error: null });
const siteRow = (draft: unknown, version: number, published: string | null = null): Reply => ({
  data: { draft_document: draft, draft_version: version, published_revision_id: published, published_at: published ? "2026-10-01T10:00:00Z" : null }, error: null,
});
const indexOf = (predicate: (call: Call) => boolean) => calls.findIndex(predicate);

// ------------------------------------------------------------------ H05 fotos
const draftPath = (hex: string, wedding = weddingId) => `${wedding}/cover-${hex.repeat(32)}.jpg`;
const draftRef = (hex: string, wedding = weddingId) => `https://sb.example.co/storage/v1/object/authenticated/wedding-photos-drafts/${draftPath(hex, wedding)}`;
const publicPhoto = `https://sb.example.co/storage/v1/object/public/wedding-photos/${weddingId}/cover-${"c".repeat(32)}.jpg`;
function withPhoto(doc: SiteDocument, url: string | null): SiteDocument {
  return { ...doc, scenes: doc.scenes.map((scene) => (scene.type === "cover" ? { ...scene, props: { ...scene.props, image: url ? { url, alt: "Foto de Ana y Luis", width: 1200, height: 800 } : null } } : scene)) } as SiteDocument;
}
const updates = () => calls.filter((c) => c.table === "wedding_sites" && c.method === "update").map((c) => c.args[0] as { draft_document: SiteDocument; draft_version: number });
const coverUrl = (doc: SiteDocument) => (doc.scenes.find((s) => s.type === "cover") as { props: { image: { url: string } | null } }).props.image?.url ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example.co");
  mocks.promote.mockResolvedValue({ ok: true, path: `${weddingId}/cover-${"c".repeat(32)}.jpg`, url: publicPhoto });
  mocks.removeDrafts.mockResolvedValue(undefined);
  mocks.discard.mockResolvedValue(undefined);
});

describe("saveSiteDraft", () => {
  it("rechaza un documento inválido antes de abrir sesión", async () => {
    const result = await saveSiteDraft({ document: { schemaVersion: 99 }, baseVersion: 0 });
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "invalid") throw new Error("expected invalid");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rechaza versiones base negativas o no enteras", async () => {
    expect((await saveSiteDraft({ document: validDocument, baseVersion: -1 })).ok).toBe(false);
    expect((await saveSiteDraft({ document: validDocument, baseVersion: 1.5 })).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin sesión no consulta tablas", async () => {
    mocks.client.mockResolvedValue(database({}, undefined, false));
    expect((await saveSiteDraft({ document: validDocument, baseVersion: 0 })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("crea la fila con draft_version 1 cuando baseVersion es 0 y no revalida la web pública", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 1 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 0 })).toEqual({ ok: true, draftVersion: 1 });
    const insert = calls.find((c) => c.table === "wedding_sites" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ wedding_id: weddingId, draft_version: 1 });
    expect(JSON.stringify((insert?.args[0] as { draft_document: unknown }).draft_document)).toEqual(JSON.stringify(validDocument));
    expect(mocks.revalidate).toHaveBeenCalledWith("/panel/ajustes");
    expect(mocks.revalidate.mock.calls.flat()).not.toContain("/b/ana-y-luis");
  });
  it("actualiza con bloqueo optimista por wedding_id y draft_version", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
    expect(calls.find((c) => c.method === "update")?.args[0]).toMatchObject({ draft_version: 4 });
    expect(calls).toContainEqual({ table: "wedding_sites", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_sites", method: "eq", args: ["draft_version", 3] });
    expect(calls.some((c) => c.table === "weddings" && c.method === "update")).toBe(false);
  });
  it("devuelve conflicto con la versión actual cuando otra pestaña guardó antes", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: null, error: null }, { data: { draft_version: 5 }, error: null }] }));
    const result = await saveSiteDraft({ document: validDocument, baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "conflict", draftVersion: 5 });
    if (result.ok || result.code !== "conflict") throw new Error("expected conflict");
    expect(result.error).toMatch(/pestaña/i);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("trata la unique de wedding_id como conflicto al crear", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: null, error: { code: "23505", message: "duplicate" } }, { data: { draft_version: 2 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 0 })).toMatchObject({ ok: false, code: "conflict", draftVersion: 2 });
  });
  it("con historial: guarda el borrador y apunta la versión (petición acotada, author por la base)", async () => {
    mocks.client.mockResolvedValue(database({
      weddings: [owner()],
      wedding_sites: [{ data: { draft_version: 4 }, error: null }],
      wedding_site_drafts_history: [{ data: { id: "h-1", created_at: "2026-10-09T10:00:00Z" }, error: null }],
    }));
    const result = await saveSiteDraft({ document: validDocument, baseVersion: 3, history: { kind: "ai", prompt: `  ${"a".repeat(700)}`, summary: "Cambiamos los colores.", changes: ["los colores (Mar)", 7], author_id: "otra" } });
    expect(result).toEqual({ ok: true, draftVersion: 4, history: { id: "h-1", createdAt: "2026-10-09T10:00:00Z" } });
    const insert = calls.find((c) => c.table === "wedding_site_drafts_history" && c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ wedding_id: weddingId, kind: "ai", summary: "Cambiamos los colores.", changes: ["los colores (Mar)"], draft_version: 4 });
    expect((insert.prompt as string).length).toBe(600);
    expect(insert).not.toHaveProperty("author_id");
    // El historial va DESPUÉS del guardado con bloqueo optimista.
    expect(indexOf((c) => c.table === "wedding_site_drafts_history")).toBeGreaterThan(indexOf((c) => c.table === "wedding_sites" && c.method === "update"));
  });
  it("sin la migración del historial el borrador se guarda igual (history: null)", async () => {
    mocks.client.mockResolvedValue(database({
      weddings: [owner()],
      wedding_sites: [{ data: { draft_version: 4 }, error: null }],
      wedding_site_drafts_history: [{ data: null, error: { code: "PGRST205", message: "missing" } }],
    }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 3, history: { kind: "manual", summary: "x" } })).toEqual({ ok: true, draftVersion: 4, history: null });
  });
  it("en conflicto no apunta nada en el historial; un tipo desconocido tampoco", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: null, error: null }, { data: { draft_version: 5 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 3, history: { kind: "ai" } })).toMatchObject({ ok: false, code: "conflict" });
    expect(calls.some((c) => c.table === "wedding_site_drafts_history")).toBe(false);
    calls = [];
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 3, history: { kind: "borrar" } })).toEqual({ ok: true, draftVersion: 4 });
    expect(calls.some((c) => c.table === "wedding_site_drafts_history")).toBe(false);
  });
  it("un fallo de BD no filtra detalles ni revalida", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: null, error: { code: "42P01", message: "private detail" } }] }));
    const result = await saveSiteDraft({ document: validDocument, baseVersion: 2 });
    expect(result).toMatchObject({ ok: false, code: "error" });
    expect(JSON.stringify(result)).not.toContain("private detail");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("publishSite", () => {
  const publishOk: Reply = { data: [{ revision_id: revisionId, published_at: "2026-10-02T12:00:00Z", draft_version: 3 }], error: null };

  it("no publica un borrador incompleto", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(incompleteDocument, 3)] }, publishOk));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (result.ok) throw new Error("expected failure");
    expect(result.issues?.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("traduce el error 40001 del RPC a conflicto sin tocar weddings", async () => {
    const conflict: Reply = { data: null, error: { code: "40001", message: "site_version_conflict" } };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, conflict));
    const result = await publishSite({ baseVersion: 2 });
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect(calls.some((c) => c.table === "weddings" && c.method === "update")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("también detecta el conflicto por el mensaje aunque cambie el código", async () => {
    const conflict: Reply = { data: null, error: { code: "P0001", message: "site_version_conflict" } };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, conflict));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "conflict" });
  });
  it("publica: una sola RPC con la versión esperada y la sincronización de weddings (5.7), y solo entonces revalida", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, publishOk));
    expect(await publishSite({ baseVersion: 3 })).toEqual({ ok: true, revisionId, publishedAt: "2026-10-02T12:00:00Z", draftVersion: 3 });
    // Sin foto privada no hay copia ni borrado en Storage.
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.removeDrafts).not.toHaveBeenCalled();

    const rpcCalls = calls.filter((c) => c.table === "rpc" && c.method === "wedding_site_publish");
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args[0] as { p_document: unknown; p_legacy: unknown };
    expect(args).toMatchObject({ p_wedding_id: weddingId, p_expected_version: 3 });
    // S-03: el RPC recibe exactamente el documento validado en servidor.
    expect(JSON.stringify(args.p_document)).toEqual(JSON.stringify(validDocument));
    // Atómico: la sincronización viaja en la RPC; ningún update aparte de weddings.
    expect(args.p_legacy).toMatchObject({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "natural", venue: "Finca" } });
    expect(calls.some((c) => c.table === "weddings" && c.method === "update")).toBe(false);
    expect(mocks.revalidate.mock.calls.flat()).toEqual(expect.arrayContaining(["/b/ana-y-luis", "/panel", "/panel/ajustes"]));
  });
  it("sin la migración de p_legacy (PGRST202) publica con la firma antigua y sincroniza después", async () => {
    const db = database({ weddings: [owner(), weddingRow(), { data: null, error: null }], wedding_sites: [siteRow(validDocument, 3)] });
    const replies: Reply[] = [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }, publishOk];
    db.rpc = vi.fn(async (name: string, args: unknown) => { calls.push({ table: "rpc", method: name, args: [args] }); return replies.shift()!; });
    mocks.client.mockResolvedValue(db);
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: true, revisionId });
    const rpcCalls = calls.filter((c) => c.table === "rpc");
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].args[0]).toHaveProperty("p_legacy");
    expect(rpcCalls[1].args[0]).not.toHaveProperty("p_legacy");
    const syncIndex = indexOf((c) => c.table === "weddings" && c.method === "update");
    expect(syncIndex).toBeGreaterThan(calls.indexOf(rpcCalls[1]));
    expect(calls[syncIndex].args[0]).toMatchObject({ partner_name_1: "Ana", wedding_date: "2027-06-12" });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["id", weddingId] });
  });
  it("si un CHECK de weddings rechaza la sincronización (23514), no publica y devuelve invalid", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, { data: null, error: { code: "23514", message: "wedding_names_length" } }));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.stringify(result)).not.toContain("wedding_names_length");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("con baseVersion 0 crea primero la fila con el adaptador y publica la versión 1", async () => {
    const created: Reply = { data: { draft_version: 1 }, error: null };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow(), { data: null, error: null }], wedding_sites: [{ data: null, error: null }, created] }, publishOk));
    expect((await publishSite({ baseVersion: 0 })).ok).toBe(true);
    const insert = calls.find((c) => c.table === "wedding_sites" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ wedding_id: weddingId, draft_version: 1 });
    expect(JSON.stringify((insert?.args[0] as { draft_document: unknown }).draft_document)).toEqual(JSON.stringify(storyDocument));
    const rpc = calls.find((c) => c.table === "rpc");
    expect(rpc?.args[0]).toMatchObject({ p_wedding_id: weddingId, p_expected_version: 1 });
    expect(JSON.stringify((rpc?.args[0] as { p_document: unknown }).p_document)).toEqual(JSON.stringify(storyDocument));
    expect(indexOf((c) => c.method === "insert")).toBeLessThan(indexOf((c) => c.table === "rpc"));
  });
  it("si la BD rechaza el documento por contrato (auditoría H04) devuelve invalid sin sincronizar ni revalidar", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid: Reply = { data: null, error: { code: "22023", message: "site_document_invalid", details: "cover_names" } };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, invalid));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.stringify(result)).not.toContain("cover_names");
    expect(calls.some((c) => c.table === "weddings" && c.method === "update")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("un fallo genérico del RPC no revalida ni filtra el mensaje interno", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(validDocument, 3)] }, { data: null, error: { code: "42883", message: "function does not exist" } }));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "error" });
    expect(JSON.stringify(result)).not.toContain("function does not exist");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("sin la migración, si la sincronización de weddings falla tras publicar, informa éxito y registra el fallo", async () => {
    const db = database({ weddings: [owner(), weddingRow(), { data: null, error: { code: "42501", message: "denied" } }], wedding_sites: [siteRow(validDocument, 3)] });
    const replies: Reply[] = [{ data: null, error: { code: "42883", message: "function does not exist" } }, publishOk];
    db.rpc = vi.fn(async (name: string, args: unknown) => { calls.push({ table: "rpc", method: name, args: [args] }); return replies.shift()!; });
    mocks.client.mockResolvedValue(db);
    expect((await publishSite({ baseVersion: 3 })).ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/b/ana-y-luis");
    // La instantánea pública cacheada se invalida al publicar (R01).
    expect(mocks.revalidateTag).toHaveBeenCalledWith("site:ana-y-luis");
  });
});

describe("unpublishSite", () => {
  it("llama al RPC y revalida la web pública", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()] }));
    expect(await unpublishSite()).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "rpc", method: "wedding_site_unpublish", args: [{ p_wedding_id: weddingId }] });
    expect(mocks.revalidate).toHaveBeenCalledWith("/b/ana-y-luis");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("site:ana-y-luis");
  });
  it("sin sesión falla sin tocar el RPC", async () => {
    mocks.client.mockResolvedValue(database({}, undefined, false));
    expect((await unpublishSite()).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("H05: foto de borrador en bucket privado", () => {
  const publishOk = (version: number): Reply => ({ data: [{ revision_id: revisionId, published_at: "2026-10-02T12:00:00Z", draft_version: version }], error: null });
  const draft = withPhoto(validDocument, draftRef("a"));

  it("publicar copia la foto al bucket público, guarda el borrador reescrito y publica ESE documento", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(draft, 3), { data: { draft_version: 4 }, error: null }] }, publishOk(4)));
    expect(await publishSite({ baseVersion: 3 })).toEqual({ ok: true, revisionId, publishedAt: "2026-10-02T12:00:00Z", draftVersion: 4 });

    expect(mocks.promote).toHaveBeenCalledWith(weddingId, draftPath("a"));
    // 1) borrador reescrito bajo el bloqueo optimista (3 → 4) con la URL pública
    const [saved] = updates();
    expect(saved.draft_version).toBe(4);
    expect(calls).toContainEqual({ table: "wedding_sites", method: "eq", args: ["draft_version", 3] });
    expect(coverUrl(saved.draft_document)).toBe(publicPhoto);
    // 2) la RPC publica la versión 4 y exactamente ese documento, sin rastro del bucket privado
    const rpc = calls.find((c) => c.table === "rpc")!;
    const args = rpc.args[0] as { p_expected_version: number; p_document: SiteDocument };
    expect(args.p_expected_version).toBe(4);
    expect(JSON.stringify(args.p_document)).toBe(JSON.stringify(saved.draft_document));
    expect(JSON.stringify(args.p_document)).not.toContain("wedding-photos-drafts");
    expect(indexOf((c) => c.method === "update" && c.table === "wedding_sites")).toBeLessThan(indexOf((c) => c.table === "rpc"));
    // 3) después: se borra el objeto privado y la OG/ajustes reciben la URL pública
    expect(mocks.removeDrafts).toHaveBeenCalledWith([draftPath("a")]);
    expect(mocks.discard).not.toHaveBeenCalled();
    expect((rpc.args[0] as { p_legacy: unknown }).p_legacy).toMatchObject({ cover_image_url: publicPhoto });
  });

  it("si otra pestaña guardó antes, descarta la copia pública y no publica", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(draft, 3), { data: null, error: null }, { data: { draft_version: 5 }, error: null }] }, publishOk(4)));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "conflict" });
    expect(mocks.discard).toHaveBeenCalledWith(`${weddingId}/cover-${"c".repeat(32)}.jpg`);
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
    expect(mocks.removeDrafts).not.toHaveBeenCalled();
  });

  it("si la RPC falla, el borrador vuelve a la referencia privada y la copia pública se descarta", async () => {
    const failure: Reply = { data: null, error: { code: "42883", message: "boom" } };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(draft, 3), { data: { draft_version: 4 }, error: null }, { data: { draft_version: 5 }, error: null }] }, failure));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "error" });
    const [rewritten, restored] = updates();
    expect(coverUrl(rewritten.draft_document)).toBe(publicPhoto);
    expect(coverUrl(restored.draft_document)).toBe(draftRef("a"));
    expect(restored.draft_version).toBe(5);
    expect(mocks.discard).toHaveBeenCalledTimes(1);
    expect(mocks.removeDrafts).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("si no se puede restaurar el borrador tras fallar la RPC, la copia pública se conserva (puede estar referenciada)", async () => {
    const failure: Reply = { data: null, error: { code: "40001", message: "site_version_conflict" } };
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(draft, 3), { data: { draft_version: 4 }, error: null }, { data: null, error: null }, { data: { draft_version: 6 }, error: null }] }, failure));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "conflict" });
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("si la foto privada ya no existe, pide volver a subirla y no toca el borrador ni la RPC", async () => {
    mocks.promote.mockResolvedValueOnce({ ok: false, reason: "missing" });
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(draft, 3)] }, publishOk(4)));
    const result = await publishSite({ baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "error", error: expect.stringContaining("Volved a subirla") });
    expect(updates()).toEqual([]);
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
  });

  it("nunca copia la foto privada de OTRA boda (service_role entre parejas)", async () => {
    const foreign = withPhoto(validDocument, draftRef("a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow()], wedding_sites: [siteRow(foreign, 3)] }, publishOk(4)));
    expect(await publishSite({ baseVersion: 3 })).toMatchObject({ ok: false, code: "invalid" });
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
  });

  it("una foto ya pública (datos anteriores a H05) se publica tal cual, sin copiar", async () => {
    const legacy = withPhoto(validDocument, `https://sb.example.co/storage/v1/object/public/wedding-photos/${weddingId}/cover-old.jpg`);
    mocks.client.mockResolvedValue(database({ weddings: [owner(), weddingRow(), { data: null, error: null }], wedding_sites: [siteRow(legacy, 3)] }, publishOk(3)));
    expect((await publishSite({ baseVersion: 3 })).ok).toBe(true);
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect((calls.find((c) => c.table === "rpc")!.args[0] as { p_expected_version: number }).p_expected_version).toBe(3);
  });

  it("guardar rechaza referencias privadas ajenas o no canónicas sin escribir", async () => {
    for (const url of [
      draftRef("a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      `https://sb.example.co/storage/v1/object/sign/wedding-photos-drafts/${draftPath("a")}?token=x`,
      `https://sb.example.co/storage/v1/object/public/wedding-photos-drafts/${draftPath("a")}`,
    ]) {
      calls = [];
      mocks.client.mockResolvedValue(database({ weddings: [owner()] }));
      const result = await saveSiteDraft({ document: withPhoto(validDocument, url), baseVersion: 3 });
      expect(result).toMatchObject({ ok: false, code: "invalid" });
      expect(updates()).toEqual([]);
    }
  });

  it("sustituir la foto borra el objeto privado anterior (después de guardar)", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_document: withPhoto(validDocument, draftRef("a")) }, error: null }, { data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: withPhoto(validDocument, draftRef("b")), baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
    expect(mocks.removeDrafts).toHaveBeenCalledWith([draftPath("a")]);
  });

  it("no borra nada si el guardado choca, si se quita la foto (Deshacer) o si la foto no cambia", async () => {
    // conflicto
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_document: withPhoto(validDocument, draftRef("a")) }, error: null }, { data: null, error: null }, { data: { draft_version: 5 }, error: null }] }));
    expect(await saveSiteDraft({ document: withPhoto(validDocument, draftRef("b")), baseVersion: 3 })).toMatchObject({ ok: false, code: "conflict" });
    // quitar la foto
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 4 }, error: null }] }));
    expect((await saveSiteDraft({ document: withPhoto(validDocument, null), baseVersion: 3 })).ok).toBe(true);
    // misma foto (p. ej. cambio de paleta)
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_document: withPhoto(validDocument, draftRef("a")) }, error: null }, { data: { draft_version: 4 }, error: null }] }));
    expect((await saveSiteDraft({ document: { ...withPhoto(validDocument, draftRef("a")), palette: "mar" }, baseVersion: 3 })).ok).toBe(true);
    // sustituir una foto PÚBLICA (ya publicada) nunca borra en Storage
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_document: withPhoto(validDocument, publicPhoto) }, error: null }, { data: { draft_version: 4 }, error: null }] }));
    expect((await saveSiteDraft({ document: withPhoto(validDocument, draftRef("b")), baseVersion: 3 })).ok).toBe(true);
    expect(mocks.removeDrafts).not.toHaveBeenCalled();
  });
});

describe("saveSiteDraft: la Story es Premium (13-oct-2026)", () => {
  const saved = (doc: SiteDocument): Reply => ({ data: { draft_document: doc }, error: null });
  const plan = (value: "free" | "premium"): Reply => ({ data: { plan: value }, error: null });

  it("sin Premium rechaza pasar de web a Story y no guarda nada", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("free")], wedding_sites: [saved(validDocument)] }));
    const result = await saveSiteDraft({ document: storyDocument, baseVersion: 3 });
    expect(result).toMatchObject({ ok: false, code: "invalid", error: expect.stringMatching(/Story.*Premium/) });
    expect(updates()).toEqual([]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("también con `layout: \"historia\"` explícito", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("free")], wedding_sites: [saved(validDocument)] }));
    expect(await saveSiteDraft({ document: { ...storyDocument, layout: "historia" }, baseVersion: 3 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("con Premium sí se pasa a Story", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("premium")], wedding_sites: [saved(validDocument), { data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: storyDocument, baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
  });

  it("un borrador que ya era Story se guarda sin mirar el plan", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [saved(storyDocument), { data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: { ...storyDocument, storySeconds: 8 }, baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
    expect(calls.some((c) => c.table === "weddings" && c.method === "select" && c.args[0] === "plan")).toBe(false);
  });

  it("sin borrador guardado legible y baseVersion > 0: sin Premium se cierra, con Premium pasa", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("free")], wedding_sites: [{ data: null, error: null }] }));
    expect(await saveSiteDraft({ document: storyDocument, baseVersion: 3 })).toMatchObject({ ok: false, code: "invalid" });
    expect(updates()).toEqual([]);
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("free")], wedding_sites: [{ data: { draft_document: { schemaVersion: 99 } }, error: null }] }));
    expect(await saveSiteDraft({ document: storyDocument, baseVersion: 3 })).toMatchObject({ ok: false, code: "invalid" });
    mocks.client.mockResolvedValue(database({ weddings: [owner(), plan("premium")], wedding_sites: [{ data: null, error: null }, { data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: storyDocument, baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
  });

  it("el primer guardado de una boda antigua (baseVersion 0, adaptador en Story) no se bloquea", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 1 }, error: null }] }));
    expect(await saveSiteDraft({ document: storyDocument, baseVersion: 0 })).toEqual({ ok: true, draftVersion: 1 });
  });

  it("pasar de Story a web nunca se bloquea", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [owner()], wedding_sites: [{ data: { draft_version: 4 }, error: null }] }));
    expect(await saveSiteDraft({ document: validDocument, baseVersion: 3 })).toEqual({ ok: true, draftVersion: 4 });
  });
});
