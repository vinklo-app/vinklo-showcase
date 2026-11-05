import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), from: vi.fn(), rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/product-scope", () => ({ RSVP_MVP: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/wedding-settings", async () => import("../../../lib/wedding-settings"));

import { getGuestRsvpCurrent, getWeddingPublic } from "./wedding-public";

describe("RSVP public wedding projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.from.mockReturnValue(db);
    db.select.mockReturnValue(db);
    db.eq.mockReturnValue(db);
  });
  it("reads the safe public view without financial fields", async () => {
    db.maybeSingle.mockResolvedValue({ error: null, data: { slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, plan: "free" } });
    const wedding = await getWeddingPublic("ana-y-luis");
    expect(wedding?.partner_name_1).toBe("Ana");
    expect(wedding?.page_config.style).toBe("editorial");
    expect(db.from).toHaveBeenCalledWith("weddings_public");
    expect(db.select.mock.calls[0][0]).not.toMatch(/stripe|cubierto|contribution/);
    expect(db.eq).toHaveBeenCalledWith("slug", "ana-y-luis");
  });
  it("fails closed on malformed rows and database errors", async () => {
    db.maybeSingle.mockResolvedValue({ error: null, data: { slug: "ana-y-luis" } });
    expect(await getWeddingPublic("ana-y-luis")).toBeNull();
    db.maybeSingle.mockResolvedValue({ error: { message: "unavailable" }, data: null });
    expect(await getWeddingPublic("ana-y-luis")).toBeNull();
  });
  it("does not query malformed slugs", async () => {
    expect(await getWeddingPublic("../../secret")).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
  it("returns the saved page content and safely defaults invalid old config", async () => {
    const data = { slug: "ana-y-luis", partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, plan: "free", page_config: { style: "natural", welcomeMessage: "¡Os esperamos!", time: "18:30" } };
    db.maybeSingle.mockResolvedValue({ error: null, data });
    expect((await getWeddingPublic("ana-y-luis"))?.page_config).toMatchObject({ style: "natural", welcomeMessage: "¡Os esperamos!", time: "18:30" });
    db.maybeSingle.mockResolvedValue({ error: null, data: { ...data, page_config: [] } });
    expect((await getWeddingPublic("ana-y-luis"))?.page_config.style).toBe("editorial");
  });
});

describe("enlace personal: válido, no válido o fallo de lectura", () => {
  const token = "b".repeat(64);
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("NULL de una lectura correcta (revocado, de otra boda) → invalid", async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "invalid" });
    // Solo el hash viaja a la RPC.
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(token);
  });
  it("token mal formado → invalid sin consultar", async () => {
    expect(await getGuestRsvpCurrent("ana-y-luis", "corto")).toEqual({ status: "invalid" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("error de la RPC, excepción o forma inesperada → error (no se trata como enlace no válido)", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "error" });
    db.rpc.mockRejectedValue(new Error("red"));
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "error" });
    db.rpc.mockResolvedValue({ data: [1, 2], error: null });
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "error" });
  });
  it("plazo cerrado según la RPC ({closed: true}, paso 2) → closed", async () => {
    db.rpc.mockResolvedValue({ data: { closed: true }, error: null });
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "closed" });
  });
  it("con la RPC del paso 1 (textos + booleanos) → valid, y los textos no salen", async () => {
    db.rpc.mockResolvedValue({ data: { status: "si", companions: 1, notes: "Celíaca", logistic_notes: "Carrito", companion_list: [{ name: "Leo" }], has_health_note: true, has_logistic_note: true, has_companion_names: true, answers: null, responded_at: null, max_companions: null }, error: null });
    const state = await getGuestRsvpCurrent("ana-y-luis", token);
    expect(state.status).toBe("valid");
    expect(JSON.stringify(state)).not.toMatch(/Celíaca|Carrito|Leo/);
    if (state.status === "valid") expect(state.current.previous).toMatchObject({ hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true });
  });
  it("pendiente o con respuesta → valid", async () => {
    db.rpc.mockResolvedValue({ data: { status: null, max_companions: 2 }, error: null });
    expect(await getGuestRsvpCurrent("ana-y-luis", token)).toEqual({ status: "valid", current: { previous: null, maxCompanions: 2, guestName: null } });
    db.rpc.mockResolvedValue({ data: { status: "no", companions: 0, answers: null, responded_at: null, max_companions: null }, error: null });
    const state = await getGuestRsvpCurrent("ana-y-luis", token);
    expect(state.status).toBe("valid");
    if (state.status === "valid") expect(state.current.previous?.status).toBe("no");
  });
});
