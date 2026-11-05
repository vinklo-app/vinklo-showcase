import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn(), sync: vi.fn(), redirect: vi.fn(), admin: vi.fn(), finish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/data/account-deletion", () => ({ finishPendingDeletion: mocks.finish }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/data/site", () => ({ syncDraftFromLegacy: mocks.sync }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { mocks.redirect(path); throw new Error(`REDIRECT:${path}`); } }));
import { createWedding, createWeddingFromCreator, updateWeddingSettings } from "./wedding";
import { composeBuilderDocument, EMPTY_DRAFT } from "@/lib/wedding-builder";
import type { SiteDocument } from "@/lib/site-document";

const weddingId = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Record<string, Reply[]>, rpcReply: Reply = { data: null, error: null }) {
  const next = (table: string): Reply => replies[table]?.shift() ?? { data: null, error: null };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
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
/** getCurrentWedding: la boda por membresía (primera lectura de weddings). */
const member = () => ({ data: { id: weddingId, slug: "ana-y-luis", wedding_members: [{ role: "owner" }] }, error: null });
const settings = { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst: 80, pageConfig: { style: "natural" as const, welcomeMessage: "", venue: "Finca", address: "", time: "" } };

beforeEach(() => { vi.clearAllMocks(); calls = []; mocks.sync.mockResolvedValue({ ok: true, draftVersion: 2, changed: true }); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("updateWeddingSettings (S-01)", () => {
  it("tras guardar en weddings sincroniza el borrador y no revalida la web pública", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(settings)).toEqual({ ok: true });
    const updateIndex = calls.findIndex((c) => c.table === "weddings" && c.method === "update");
    expect(updateIndex).toBeGreaterThan(-1);
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), weddingId);
    expect(mocks.revalidate.mock.calls.flat()).toEqual(expect.arrayContaining(["/panel", "/panel/ajustes"]));
    expect(mocks.revalidate.mock.calls.flat()).not.toContain("/b/ana-y-luis");
  });
  it("un fallo del sync no rompe el guardado de ajustes", async () => {
    mocks.sync.mockResolvedValue({ ok: false, code: "conflict" });
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(settings)).toEqual({ ok: true });
  });
  it("si el update de weddings falla no sincroniza ni revalida", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: null, error: { code: "42501" } }] }));
    expect((await updateWeddingSettings(settings)).ok).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("updateWeddingSettings: fecha límite para confirmar", () => {
  const future = "2099-05-01";
  const withDeadline = (rsvpDeadline: string) => ({ ...settings, weddingDate: "2099-06-12", rsvpDeadline });
  const updatePayload = () => calls.find((c) => c.table === "weddings" && c.method === "update")?.args[0] as Record<string, unknown> | undefined;

  it("guarda la fecha límite con la sesión de la pareja (membresía), sin service role", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: null }, error: null }, { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(withDeadline(future))).toEqual({ ok: true });
    expect(updatePayload()).toMatchObject({ rsvp_deadline: future });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
  });
  it("vacío borra la fecha límite (null)", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: future }, error: null }, { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(withDeadline(""))).toEqual({ ok: true });
    expect(updatePayload()).toMatchObject({ rsvp_deadline: null });
  });
  it("sin la clave no toca la fecha límite guardada", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(settings)).toEqual({ ok: true });
    expect(updatePayload()).not.toHaveProperty("rsvp_deadline");
  });
  it("rechaza una fecha límite posterior a la boda sin tocar la base", async () => {
    mocks.client.mockResolvedValue(database({}));
    expect(await updateWeddingSettings(withDeadline("2099-06-13"))).toEqual({ ok: false, error: "La fecha límite para confirmar no puede ser posterior a la boda." });
    expect(calls).toEqual([]);
  });
  it("acepta la fecha límite el mismo día de la boda", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: null }, error: null }, { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(withDeadline("2099-06-12"))).toEqual({ ok: true });
  });
  it("rechaza fechas inválidas", async () => {
    mocks.client.mockResolvedValue(database({}));
    expect(await updateWeddingSettings(withDeadline("2099-02-31"))).toEqual({ ok: false, error: "Elegid una fecha límite válida." });
  });
  it("rechaza FIJAR una fecha límite ya pasada", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: null }, error: null }] }));
    expect(await updateWeddingSettings(withDeadline("2020-01-01"))).toEqual({ ok: false, error: "La fecha límite para confirmar ya ha pasado. Elegid hoy o un día posterior, o dejadla vacía." });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });
  it("una fecha límite ya vencida que no cambia no bloquea otros ajustes", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: "2020-01-01" }, error: null }, { data: { id: weddingId, slug: "ana-y-luis" }, error: null }] }));
    expect(await updateWeddingSettings(withDeadline("2020-01-01"))).toEqual({ ok: true });
  });
  it("si la base rechaza el par (check 23514) explica el motivo", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: null }, error: null }, { data: null, error: { code: "23514", message: 'new row for relation "weddings" violates check constraint "weddings_rsvp_deadline_before_wedding"' } }] }));
    expect(await updateWeddingSettings(withDeadline(future))).toEqual({ ok: false, error: "La fecha límite para confirmar no puede ser posterior a la boda." });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("otro check de weddings no se presenta como error del plazo", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [member(), { data: { rsvp_deadline: null }, error: null }, { data: null, error: { code: "23514", message: 'violates check constraint "weddings_page_config_check"' } }] }));
    expect(await updateWeddingSettings(withDeadline(future))).toEqual({ ok: false, error: "No hemos podido guardar los cambios. Probad de nuevo." });
  });
});

describe("createWedding: web inicial publicada", () => {
  const input = { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst: 80 };
  it("inserta wedding_sites v1 y publica con p_document antes de redirigir al panel", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: [{ revision_id: "rev-1" }], error: null }));
    await expect(createWedding(input)).rejects.toThrow("REDIRECT:/panel");
    const siteInsert = calls.find((c) => c.table === "wedding_sites" && c.method === "insert");
    expect(siteInsert?.args[0]).toMatchObject({ wedding_id: weddingId, draft_version: 1 });
    const rpc = calls.find((c) => c.table === "rpc" && c.method === "wedding_site_publish");
    expect(rpc?.args[0]).toMatchObject({ p_wedding_id: weddingId, p_expected_version: 1 });
    expect(JSON.stringify((rpc?.args[0] as { p_document: unknown }).p_document)).toEqual(JSON.stringify((siteInsert?.args[0] as { draft_document: unknown }).draft_document));
    expect(calls.indexOf(siteInsert!)).toBeLessThan(calls.indexOf(rpc!));
  });
  it("la web inicial (adaptador) nace en «Como una web», no en Story", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: [{ revision_id: "rev-1" }], error: null }));
    await expect(createWedding(input)).rejects.toThrow("REDIRECT:/panel");
    const siteInsert = calls.find((c) => c.table === "wedding_sites" && c.method === "insert");
    expect((siteInsert?.args[0] as { draft_document: SiteDocument }).draft_document.layout).toBe("web");
  });
  it("si el RPC de publicación da error, la boda se crea igualmente y se registra", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: null, error: { code: "40001" } }));
    await expect(createWedding(input)).rejects.toThrow("REDIRECT:/panel");
    expect(calls.some((c) => c.table === "rpc" && c.method === "wedding_site_publish")).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
  it("si la publicación inicial falla, la boda se crea igualmente y se registra el error", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: { code: "42P01" } }] }));
    await expect(createWedding(input)).rejects.toThrow("REDIRECT:/panel");
    expect(console.error).toHaveBeenCalled();
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
  });
});

describe("createWeddingFromCreator: el borrador v1 es lo que vio la pareja y NO se publica (se publica una vez al final, P1-8)", () => {
  const input = { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst: 80, pageConfig: { style: "natural" as const, welcomeMessage: "Hola", venue: "", address: "", time: "" } };
  const creatorDraft = { ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCount: "80", style: "natural" as const, welcomeMessage: "Hola", palette: "mar" as const, layout: "web" as const };
  const created = () => database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: [{ revision_id: "rev-1" }], error: null });
  // El documento del borrador v1 insertado (el creador no publica al crear).
  const published = () => (calls.find((c) => c.table === "wedding_sites" && c.method === "insert")?.args[0] as { draft_document: SiteDocument }).draft_document;

  it("crea el borrador con el documento del creador (sobre, paleta, maqueta), sin redirigir y SIN publicar", async () => {
    mocks.client.mockResolvedValue(created());
    const result = await createWeddingFromCreator({ ...input, site: composeBuilderDocument(creatorDraft) });
    expect(result).toEqual({ ok: true, site: "creator" });
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(published()).toMatchObject({ opening: "sobre", palette: "mar", layout: "web" });
  });
  it("nunca nace en Story (Premium): un borrador antiguo sin maqueta se guarda en web y sin ritmo", async () => {
    mocks.client.mockResolvedValue(created());
    await createWeddingFromCreator({ ...input, site: { ...composeBuilderDocument({ ...creatorDraft, layout: null }), storySeconds: 8 } });
    expect(published().layout).toBe("web");
    expect("storySeconds" in published()).toBe(false);
  });
  it("un borrador anterior al sobre (sin `opening`) también nace con el sobre", async () => {
    mocks.client.mockResolvedValue(created());
    const old: Record<string, unknown> = { ...creatorDraft };
    delete old.opening;
    await createWeddingFromCreator({ ...input, site: composeBuilderDocument(old as typeof creatorDraft) });
    expect(published().opening).toBe("sobre");
  });
  it("«Sin sobre» se publica como elección explícita", async () => {
    mocks.client.mockResolvedValue(created());
    await createWeddingFromCreator({ ...input, site: composeBuilderDocument({ ...creatorDraft, opening: "ninguno" }) });
    expect(published().opening).toBe("ninguno");
  });
  it("nombres y fecha salen de los datos validados y nunca entra una foto del cliente", async () => {
    mocks.client.mockResolvedValue(created());
    const site = composeBuilderDocument({ ...creatorDraft, partnerName1: "Otra", partnerName2: "Persona" }, { url: "https://evil.example.com/x.jpg", alt: "" });
    await createWeddingFromCreator({ ...input, site });
    const cover = published().scenes[0];
    expect(cover?.type === "cover" && cover.props).toMatchObject({ partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", image: null });
  });
  it("un documento que no cumple el contrato no bloquea: se publica el adaptador", async () => {
    mocks.client.mockResolvedValue(created());
    const result = await createWeddingFromCreator({ ...input, site: { schemaVersion: 9 } });
    expect(result).toEqual({ ok: true, site: "legacy" });
    expect(published().scenes[0]?.type).toBe("cover");
  });
  it("sin sesión o con boda ya creada devuelve a dónde ir en vez de lanzar", async () => {
    mocks.client.mockResolvedValue({ ...created(), auth: { getUser: async () => ({ data: { user: null } }) } });
    expect(await createWeddingFromCreator(input)).toEqual({ ok: false, redirect: "/login" });
    mocks.client.mockResolvedValue(database({ weddings: [member()] }));
    expect(await createWeddingFromCreator(input)).toEqual({ ok: false, redirect: "/panel" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("el programa de «Vuestro día» se guarda en la agenda del panel y se publica con sus ids (no se pierde al guardar ajustes)", async () => {
    const rows = [
      { id: "aaaaaaaa-1111-4111-8111-000000000001", title: "Ceremonia", time_label: "12:30", place: "Iglesia de San Pedro", address: null, notes: null, sort: 1 },
      { id: "bbbbbbbb-2222-4222-8222-000000000002", title: "Banquete", time_label: "15:00", place: "Finca Los Olivos", address: null, notes: null, sort: 2 },
    ];
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_agenda_items: [{ data: rows, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: [{ revision_id: "rev-1" }], error: null }));
    const day = { ceremony: { time: "12:30", place: "Iglesia de San Pedro" }, cocktail: { time: "", place: "" }, banquet: { time: "15:00", place: "Finca Los Olivos" } };
    await createWeddingFromCreator({ ...input, site: composeBuilderDocument({ ...creatorDraft, day }) });
    const insert = calls.find((c) => c.table === "wedding_agenda_items" && c.method === "insert");
    expect(insert?.args[0]).toEqual([
      { wedding_id: weddingId, title: "Ceremonia", time_label: "12:30", place: "Iglesia de San Pedro", address: null, notes: null, sort: 1 },
      { wedding_id: weddingId, title: "Banquete", time_label: "15:00", place: "Finca Los Olivos", address: null, notes: null, sort: 2 },
    ]);
    const agenda = published().scenes.find((scene) => scene.type === "agenda");
    expect(agenda?.type === "agenda" && agenda.enabled && agenda.props.items.map((item) => [item.id, item.title, item.timeLabel, item.place])).toEqual([["m-aaaaaaaa1111411181110000", "Ceremonia", "12:30", "Iglesia de San Pedro"], ["m-bbbbbbbb2222422282220000", "Banquete", "15:00", "Finca Los Olivos"]]);
  });
  it("si no se puede crear el borrador lo dice (el creador lo guarda sobre la versión 0 y publica)", async () => {
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: { code: "42P01" } }] }));
    expect(await createWeddingFromCreator({ ...input, site: composeBuilderDocument(creatorDraft) })).toEqual({ ok: true, site: "failed" });
  });
});

describe("crear boda con la anterior aún borrándose (P2-5)", () => {
  const input = { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst: 80 };
  const blocked = { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "weddings_one_per_couple_idx"' } };
  /** Admin que encuentra (o no) una boda propia marcada con deleted_at. */
  function adminWith(markedId: string | null) {
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not"]) chain[m] = (...args: unknown[]) => { filters.push([m, ...args]); return chain; };
    chain.maybeSingle = async () => ({ data: markedId ? { id: markedId } : null, error: null });
    return { client: { from: () => chain }, filters };
  }

  it("termina la purga pendiente una vez y vuelve a intentar con el mismo slug", async () => {
    const admin = adminWith("old-wedding");
    mocks.admin.mockReturnValue(admin.client);
    mocks.finish.mockResolvedValue({ ok: true });
    // getCurrentWedding, insert bloqueado, getCurrentWeddingFresh, insert bueno.
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, blocked, { data: null, error: null }, { data: { id: weddingId }, error: null }], wedding_sites: [{ data: null, error: null }] }, { data: [{ revision_id: "rev-1" }], error: null }));
    await expect(createWedding(input)).rejects.toThrow("REDIRECT:/panel");
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith("wedding", "old-wedding");
    expect(admin.filters).toContainEqual(["not", "deleted_at", "is", null]);
    const slugs = calls.filter((c) => c.table === "weddings" && c.method === "insert").map((c) => (c.args[0] as { slug: string }).slug);
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).toBe(slugs[1]);
  });

  it("si sigue bloqueada, lo dice sin redirigir (sin bucle panel ↔ onboarding)", async () => {
    mocks.admin.mockReturnValue(adminWith("old-wedding").client);
    mocks.finish.mockResolvedValue({ ok: false, phase: "wedding-photos" });
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, blocked, { data: null, error: null }, blocked, { data: null, error: null }] }));
    const result = await createWeddingFromCreator({ ...input, pageConfig: { style: "natural" as const, welcomeMessage: "", venue: "", address: "", time: "" } });
    expect(result).toEqual({ ok: false, error: "Estamos terminando de borrar vuestra boda anterior. Probad de nuevo en unos minutos." });
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sin boda marcada, el bloqueo es el de siempre (ya gestiona una boda)", async () => {
    mocks.admin.mockReturnValue(adminWith(null).client);
    mocks.client.mockResolvedValue(database({ weddings: [{ data: null, error: null }, blocked, { data: null, error: null }] }));
    const result = await createWeddingFromCreator({ ...input, pageConfig: { style: "natural" as const, welcomeMessage: "", venue: "", address: "", time: "" } });
    expect(result).toEqual({ ok: false, error: "Esta cuenta ya gestiona una boda. Entrad en el panel." });
    expect(mocks.finish).not.toHaveBeenCalled();
  });
});
