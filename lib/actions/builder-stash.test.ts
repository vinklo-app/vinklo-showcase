import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), admin: vi.fn(), user: vi.fn(), rpc: vi.fn(), row: vi.fn(), deleted: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "test-ip", rateLimit: mocks.rateLimit }));

import { clearStashedDraft, loadStashedDraft, stashBuilderDraft } from "./builder-stash";
import { EMPTY_DRAFT, type BuilderDraft } from "@/lib/wedding-builder";

const draft: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", step: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.rateLimit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.row.mockResolvedValue({ data: { draft }, error: null });
  mocks.user.mockResolvedValue({ data: { user: { email: "Ana@Example.com" } } });
  mocks.admin.mockReturnValue({
    rpc: mocks.rpc,
    from: () => ({
      delete: () => ({ lt: async () => ({ error: null }), eq: mocks.deleted }),
      select: () => ({ eq: (_: string, email: string) => ({ gt: () => ({ maybeSingle: () => mocks.row(email) }) }) }),
    }),
  });
});

describe("stashBuilderDraft", () => {
  it("guarda el borrador validado bajo el correo en minúsculas", async () => {
    expect(await stashBuilderDraft({ email: " Ana@Example.com ", draft })).toEqual({ ok: true });
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe("builder_draft_stash_put");
    expect(args).toMatchObject({ p_email: "ana@example.com", p_draft: draft });
    expect(Date.parse(args.p_expires_at) - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });
  it("compara con la fecha de edición del borrador (P2-4), no con la de la petición", async () => {
    const edited = "2026-10-11T08:00:00.000Z";
    await stashBuilderDraft({ email: "ana@example.com", draft: { ...draft, updatedAt: edited } });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_updated_at: edited, p_draft: { updatedAt: edited } });
  });
  it("un borrador sin fecha (anterior a P2-4) cuenta como recién editado", async () => {
    const before = Date.now();
    await stashBuilderDraft({ email: "ana@example.com", draft });
    expect(Date.parse(mocks.rpc.mock.calls[0][1].p_updated_at)).toBeGreaterThanOrEqual(before);
  });
  it("con el contenido de la IA lo guarda entero; si no cabe en la columna, guarda la copia sin ese contenido", async () => {
    const sections = { faq: { order: ["q-1"], known: [], items: [{ id: "q-1", question: "¿Hay aparcamiento?", answer: "Sí." }], text: [] } };
    const rich: BuilderDraft = { ...draft, sections };
    expect(await stashBuilderDraft({ email: "ana@example.com", draft: rich })).toEqual({ ok: true });
    expect(mocks.rpc.mock.calls[0][1].p_draft.sections).toEqual(sections);

    mocks.rpc.mockReset().mockResolvedValueOnce({ data: null, error: { code: "23514" } }).mockResolvedValueOnce({ data: true, error: null });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft: rich })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect("sections" in mocks.rpc.mock.calls[1][1].p_draft).toBe(false);
    expect(mocks.rpc.mock.calls[1][1].p_draft.partnerName1).toBe("Ana");
  });
  it("si el servidor ya tenía uno más reciente no lo pisa y sigue diciendo que hay copia", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft })).toEqual({ ok: true });
  });
  it("rechaza un correo o un borrador inválidos sin tocar la base de datos", async () => {
    expect(await stashBuilderDraft({ email: "no-es-correo", draft })).toEqual({ ok: false });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft: { ...draft, step: 99 } })).toEqual({ ok: false });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft: { ...draft, photoData: "data:image/png;base64,AAAA" } })).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls[0][1].p_draft).not.toHaveProperty("photoData");
    expect(mocks.admin).toHaveBeenCalledTimes(1);
  });
  it("no guarda con el límite por IP superado", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect(await stashBuilderDraft({ email: "ana@example.com", draft })).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un fallo de la base de datos no lanza: el acceso sigue", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft })).toEqual({ ok: false });
    mocks.admin.mockImplementation(() => { throw new Error("sin service role"); });
    expect(await stashBuilderDraft({ email: "ana@example.com", draft })).toEqual({ ok: false });
  });
});

describe("loadStashedDraft", () => {
  it("devuelve el borrador del correo de la sesión, nunca el de otro", async () => {
    expect(await loadStashedDraft()).toEqual(draft);
    expect(mocks.row).toHaveBeenCalledWith("ana@example.com");
  });
  it("migra una copia guardada antes de la maqueta (v2) a la forma actual", async () => {
    const v2: Record<string, unknown> = { ...draft, version: 2 };
    delete v2.layout;
    delete v2.opening;
    mocks.row.mockResolvedValueOnce({ data: { draft: v2 }, error: null });
    // Sin `opening` guardado, el sobre por defecto (regresión 8-oct-2026).
    expect(await loadStashedDraft()).toEqual({ ...draft, layout: null, opening: "sobre" });
  });
  it("sin sesión no consulta nada", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect(await loadStashedDraft()).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("ignora una fila corrupta, ausente o un fallo", async () => {
    mocks.row.mockResolvedValueOnce({ data: { draft: { version: 7 } }, error: null });
    expect(await loadStashedDraft()).toBeNull();
    mocks.row.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadStashedDraft()).toBeNull();
    mocks.row.mockRejectedValueOnce(new Error("caída"));
    expect(await loadStashedDraft()).toBeNull();
  });
});

describe("clearStashedDraft", () => {
  it("borra solo la copia del correo de la sesión y nunca lanza", async () => {
    await clearStashedDraft();
    expect(mocks.deleted).toHaveBeenCalledWith("email", "ana@example.com");
    mocks.admin.mockImplementation(() => { throw new Error("sin service role"); });
    await expect(clearStashedDraft()).resolves.toBeUndefined();
  });
});
