/**
 * QA fase 1 — getSiteEditorState (lib/data/site.ts) con el cliente de sesión
 * mockeado: el editor sigue funcionando por el adaptador v1 cuando
 * `wedding_sites` aún no existe (migración pendiente) o la fila está corrupta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { documentFromLegacy, type SiteDocument } from "@/lib/site-document";

vi.mock("server-only", () => ({}));
import { getSiteEditorState, sameDocument } from "@/lib/data/site";

const weddingId = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const wedding = {
  id: weddingId, slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis",
  wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "natural", venue: "Finca", time: "18:00" },
};
const agendaRows = [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "18:00", place: "Jardín", address: null, notes: null, sort: 1 }];
const legacyDoc: SiteDocument = documentFromLegacy({ ...wedding, page_config: wedding.page_config as never, agenda: agendaRows });

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

function database(replies: Record<string, Reply[]>): SupabaseClient {
  const next = (table: string): Reply => replies[table]?.shift() ?? { data: null, error: null };
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      chain.maybeSingle = async () => next(table);
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next(table)).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => { calls = []; vi.restoreAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("getSiteEditorState sin tabla wedding_sites", () => {
  it("error 42P01 al leer wedding_sites → adaptador con draftVersion 0 y log solo del código", async () => {
    const db = database({
      weddings: [{ data: wedding, error: null }],
      wedding_agenda_items: [{ data: agendaRows, error: null }],
      wedding_sites: [{ data: null, error: { code: "42P01", message: 'relation "public.wedding_sites" does not exist' } }],
    });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toEqual({
      weddingId, slug: "ana-y-luis", draft: legacyDoc, draftVersion: 0,
      publishedRevisionId: null, publishedAt: null, hasUnpublishedChanges: true,
    });
    expect(state?.draftCorrupt).toBeUndefined();
    expect(sameDocument(state!.draft, legacyDoc)).toBe(true);
    expect(console.error).toHaveBeenCalledWith("[site] wedding_sites read failed", "42P01");
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("does not exist");
    // No intenta leer revisiones.
    expect(calls.some((c) => c.table === "wedding_site_revisions")).toBe(false);
    // Lee la boda por id y la agenda ordenada por sort, siempre con el cliente recibido (RLS).
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_agenda_items", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_agenda_items", method: "order", args: ["sort", { ascending: true }] });
  });

  it("sin fila (tabla existente) → mismo resultado que sin tabla, sin log", async () => {
    const db = database({ weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: agendaRows, error: null }], wedding_sites: [{ data: null, error: null }] });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toMatchObject({ draftVersion: 0, hasUnpublishedChanges: true, publishedRevisionId: null });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("boda no visible para la sesión (RLS) → null sin tocar wedding_sites", async () => {
    const db = database({ weddings: [{ data: null, error: null }] });
    expect(await getSiteEditorState(db, weddingId)).toBeNull();
    expect(calls.some((c) => c.table === "wedding_sites")).toBe(false);
  });

  it("la lectura de la agenda falla → adaptador sin agenda (no revienta)", async () => {
    const db = database({ weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: null, error: { code: "42501", message: "denied" } }], wedding_sites: [{ data: null, error: null }] });
    const state = await getSiteEditorState(db, weddingId);
    expect(state?.draft.scenes.find((s) => s.type === "agenda")).toMatchObject({ enabled: false, props: { items: [] } });
  });
});

describe("getSiteEditorState con fila", () => {
  const siteRow = (draft: unknown, version: number, published: string | null) => ({
    data: { draft_document: draft, draft_version: version, published_revision_id: published, published_at: published ? "2026-10-01T10:00:00Z" : null }, error: null,
  });

  it("borrador corrupto en BD → draftCorrupt, se muestra el adaptador y se conserva la versión real", async () => {
    const db = database({
      weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: agendaRows, error: null }],
      wedding_sites: [siteRow({ schemaVersion: 1, scenes: [] }, 4, revisionId)],
      wedding_site_revisions: [{ data: { document: legacyDoc }, error: null }],
    });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toMatchObject({ draftCorrupt: true, draftVersion: 4, draft: legacyDoc, publishedRevisionId: revisionId, publishedAt: "2026-10-01T10:00:00Z" });
    // El adaptador coincide con lo publicado → sin cambios pendientes aunque el borrador esté corrupto.
    expect(state?.hasUnpublishedChanges).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("borrador igual a la revisión publicada (claves reordenadas por jsonb) → hasUnpublishedChanges false", async () => {
    // jsonb reordena las claves de los objetos: simulamos el peor caso (orden inverso recursivo).
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).reverse().map((k) => [k, reverseKeys((value as Record<string, unknown>)[k])]));
      }
      return value;
    };
    const reordered = reverseKeys(JSON.parse(JSON.stringify(legacyDoc)));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(legacyDoc));
    const db = database({
      weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: agendaRows, error: null }],
      wedding_sites: [siteRow(legacyDoc, 2, revisionId)],
      wedding_site_revisions: [{ data: { document: reordered }, error: null }],
    });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toMatchObject({ draftVersion: 2, hasUnpublishedChanges: false });
    expect(state?.draftCorrupt).toBeUndefined();
    expect(calls).toContainEqual({ table: "wedding_site_revisions", method: "eq", args: ["id", revisionId] });
    expect(calls).toContainEqual({ table: "wedding_site_revisions", method: "eq", args: ["wedding_id", weddingId] });
  });

  it("borrador distinto de la revisión → hasUnpublishedChanges true; revisión ilegible → true", async () => {
    const edited = { ...legacyDoc, themeId: "clasico" };
    const db = database({
      weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: agendaRows, error: null }],
      wedding_sites: [siteRow(edited, 5, revisionId)],
      wedding_site_revisions: [{ data: { document: legacyDoc }, error: null }],
    });
    expect((await getSiteEditorState(db, weddingId))?.hasUnpublishedChanges).toBe(true);

    const db2 = database({
      weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: agendaRows, error: null }],
      wedding_sites: [siteRow(legacyDoc, 5, revisionId)],
      wedding_site_revisions: [{ data: null, error: { code: "PGRST000", message: "down" } }],
    });
    expect((await getSiteEditorState(db2, weddingId))?.hasUnpublishedChanges).toBe(true);
  });

  it("fila sin publicar → publishedRevisionId null, no consulta revisiones", async () => {
    const db = database({ weddings: [{ data: wedding, error: null }], wedding_agenda_items: [{ data: [], error: null }], wedding_sites: [siteRow(legacyDoc, 1, null)] });
    const state = await getSiteEditorState(db, weddingId);
    expect(state).toMatchObject({ draftVersion: 1, publishedRevisionId: null, publishedAt: null, hasUnpublishedChanges: true });
    expect(calls.some((c) => c.table === "wedding_site_revisions")).toBe(false);
  });
});
