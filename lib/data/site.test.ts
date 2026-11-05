import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromLegacy, findScene, parseSiteDocument } from "@/lib/site-document";

vi.mock("server-only", () => ({}));
import { getSiteEditorState, syncDraftFromLegacy } from "./site";

const weddingId = "11111111-1111-4111-8111-111111111111";
const legacyWedding = {
  id: weddingId, slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis",
  wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "natural" as const, venue: "Finca" },
};
const legacyDoc = documentFromLegacy({ ...legacyWedding, agenda: [] });
function customizedDoc() {
  const parsed = parseSiteDocument({ ...legacyDoc, scenes: legacyDoc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, eyebrow: "¡Por fin!", showCountdown: false } } : s)) });
  if (!parsed.ok) throw new Error("fixture");
  return parsed.document;
}

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Record<string, Reply[]>) {
  const next = (table: string): Reply => replies[table]?.shift() ?? { data: null, error: null };
  return {
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
  } as never;
}
const weddingRow = (overrides: Partial<typeof legacyWedding> = {}): Reply => ({ data: { ...legacyWedding, ...overrides }, error: null });
const siteRow = (draft: unknown, version: number): Reply => ({ data: { draft_version: version, draft_document: draft }, error: null });

beforeEach(() => { calls = []; vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("syncDraftFromLegacy", () => {
  it("sin fila crea el borrador con el adaptador (versión 1)", async () => {
    const db = database({ wedding_sites: [{ data: null, error: null }, { data: { draft_version: 1 }, error: null }], weddings: [weddingRow()] });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: true, draftVersion: 1, changed: true });
    const insert = calls.find((c) => c.table === "wedding_sites" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ wedding_id: weddingId, draft_version: 1 });
    expect(JSON.stringify((insert?.args[0] as { draft_document: unknown }).draft_document)).toEqual(JSON.stringify(legacyDoc));
  });
  it("fusiona los ajustes nuevos conservando lo que el modelo antiguo no conoce y sube la versión bajo lock", async () => {
    const db = database({ wedding_sites: [siteRow(customizedDoc(), 3), { data: { draft_version: 4 }, error: null }], weddings: [weddingRow({ partner_name_1: "Ana María" })] });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: true, draftVersion: 4, changed: true });
    const update = calls.find((c) => c.table === "wedding_sites" && c.method === "update");
    const written = (update?.args[0] as { draft_document: Parameters<typeof findScene>[0]; draft_version: number });
    expect(written.draft_version).toBe(4);
    expect(findScene(written.draft_document, "cover")).toMatchObject({ props: { partnerName1: "Ana María", eyebrow: "¡Por fin!", showCountdown: false } });
    expect(calls).toContainEqual({ table: "wedding_sites", method: "eq", args: ["draft_version", 3] });
  });
  it("no escribe nada si el borrador ya coincide con lo fusionado", async () => {
    const db = database({ wedding_sites: [siteRow(legacyDoc, 2)], weddings: [weddingRow()] });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: true, draftVersion: 2, changed: false });
    expect(calls.some((c) => c.method === "update" || c.method === "insert")).toBe(false);
  });
  it("repara un borrador corrupto en BD con el adaptador", async () => {
    const db = database({ wedding_sites: [siteRow({ schemaVersion: 99 }, 5), { data: { draft_version: 6 }, error: null }], weddings: [weddingRow()] });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: true, draftVersion: 6, changed: true });
  });
  it("en conflicto reintenta una vez y, si vuelve a fallar, registra sin lanzar", async () => {
    const db = database({
      wedding_sites: [siteRow(customizedDoc(), 3), { data: null, error: null }, { data: { draft_version: 4 }, error: null }, siteRow(customizedDoc(), 4), { data: null, error: null }, { data: { draft_version: 5 }, error: null }],
      weddings: [weddingRow({ partner_name_1: "Ana María" }), weddingRow({ partner_name_1: "Ana María" })],
    });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: false, code: "conflict" });
    expect(calls.filter((c) => c.table === "wedding_sites" && c.method === "update")).toHaveLength(2);
    expect(console.error).toHaveBeenCalled();
  });
  it("en conflicto el reintento puede tener éxito", async () => {
    const db = database({
      wedding_sites: [siteRow(customizedDoc(), 3), { data: null, error: null }, { data: { draft_version: 4 }, error: null }, siteRow(customizedDoc(), 4), { data: { draft_version: 5 }, error: null }],
      weddings: [weddingRow({ partner_name_1: "Ana María" }), weddingRow({ partner_name_1: "Ana María" })],
    });
    expect(await syncDraftFromLegacy(db, weddingId)).toEqual({ ok: true, draftVersion: 5, changed: true });
  });
  it("un fallo de BD o una excepción nunca se propagan al llamador", async () => {
    const failing = database({ wedding_sites: [{ data: null, error: { code: "42P01", message: "missing" } }] });
    expect(await syncDraftFromLegacy(failing, weddingId)).toEqual({ ok: false, code: "error" });
    const throwing = { from() { throw new Error("boom"); } } as never;
    expect(await syncDraftFromLegacy(throwing, weddingId)).toEqual({ ok: false, code: "error" });
  });
});

describe("getSiteEditorState", () => {
  it("sin fila devuelve el adaptador con versión 0 y cambios pendientes", async () => {
    const db = database({ weddings: [weddingRow()], wedding_sites: [{ data: null, error: null }] });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toMatchObject({ weddingId, slug: "ana-y-luis", draftVersion: 0, publishedRevisionId: null, hasUnpublishedChanges: true });
    expect(JSON.stringify(state?.draft)).toEqual(JSON.stringify(legacyDoc));
  });
  it("compara canónicamente borrador y revisión publicada", async () => {
    const published = { ...legacyDoc, scenes: [...legacyDoc.scenes].map((s) => ({ ...s, props: { ...s.props } })) };
    const db = database({
      weddings: [weddingRow()],
      wedding_sites: [{ data: { draft_document: legacyDoc, draft_version: 2, published_revision_id: "rev-1", published_at: "2026-10-01T10:00:00Z" }, error: null }],
      wedding_site_revisions: [{ data: { document: published }, error: null }],
    });
    expect((await getSiteEditorState(db, weddingId))?.hasUnpublishedChanges).toBe(false);
    expect(calls).toContainEqual({ table: "wedding_site_revisions", method: "eq", args: ["wedding_id", weddingId] });
  });
});
