import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ site: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/site-public", () => ({ getPublicSiteResult: mocks.site }));
import { documentFromLegacy } from "@/lib/site-document";
import { GET } from "./route";

const document = documentFromLegacy({
  partner_name_1: "María", partner_name_2: "Jorge", wedding_date: "2027-09-04", cover_image_url: null, page_config: { style: "editorial", venue: "La Finca", address: "Camino 1", time: "17:30" },
  agenda: [{ id: "a1", title: "Ceremonia", time_label: "17:30", place: null, address: null, notes: null }, { id: "a2", title: "Recena", time_label: "02:30", place: null, address: null, notes: null }],
});
const get = (slug = "maria-y-jorge") => GET(new Request(`https://vinklo.es/b/${slug}/calendario.ics`), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.site.mockResolvedValue({ status: "ok", site: { slug: "maria-y-jorge", document, plan: "free", source: "published", publishedAt: null } });
});

describe("/b/[slug]/calendario.ics (#13)", () => {
  it("text/calendar inline, con fin, aviso el día antes, DTSTAMP real y la URL general (sin token)", async () => {
    const before = Date.now();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="boda-maria-y-jorge.ics"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).toContain("DTSTART:20270904T153000Z");
    // Recena a las 02:30 del día 5 (00:30Z) es más tarde que 17:30 + 8 h (23:30Z).
    expect(body).toContain("DTEND:20270905T003000Z");
    expect(body).toContain("TRIGGER:-P1D");
    expect(body).toContain("URL:https://vinklo.es/b/maria-y-jorge");
    expect(body).not.toContain("invitacion=");
    const stamp = /DTSTAMP:(\d{8}T\d{6}Z)/.exec(body)![1];
    const stampMs = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));
    expect(stampMs).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  });
  it("misma visibilidad que la página: retirada o inexistente → 404; fallo de lectura → 503", async () => {
    mocks.site.mockResolvedValue({ status: "not_found" });
    expect((await get()).status).toBe(404);
    mocks.site.mockResolvedValue({ status: "unavailable" });
    expect((await get()).status).toBe(503);
  });
  it("slug mal formado: 404 sin leer nada", async () => {
    expect((await get("../x")).status).toBe(404);
    expect(mocks.site).not.toHaveBeenCalled();
  });
  it("sin fecha de boda no hay evento", async () => {
    const noDate = documentFromLegacy({ partner_name_1: "María", partner_name_2: "Jorge", wedding_date: null, cover_image_url: null, page_config: { style: "editorial" } });
    mocks.site.mockResolvedValue({ status: "ok", site: { slug: "maria-y-jorge", document: noDate, plan: "free", source: "legacy", publishedAt: null } });
    expect((await get()).status).toBe(404);
  });
});
