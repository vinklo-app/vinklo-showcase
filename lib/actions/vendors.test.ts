import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), mvp: true, rateLimit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/product-scope", () => ({ get RSVP_MVP() { return mocks.mvp; }, BACKLOG_MESSAGE: "backlog" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data/current-wedding", () => ({ getCurrentWedding: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "test-ip", rateLimit: mocks.rateLimit }));
vi.mock("@/lib/emails/send", () => ({ sendEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getVendorByToken, submitVendorSetup } from "./vendors";

const token = "33333333-3333-4333-8333-333333333333";

/** Cliente admin que no encuentra ningún proveedor (y registra que se usó). */
function emptyAdmin() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  return { from: vi.fn(() => chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mvp = true;
});

describe("getVendorByToken (R12, plan §5.1)", () => {
  it("con RSVP_MVP no resuelve el token ni abre el cliente de servicio", async () => {
    expect(await getVendorByToken(token)).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("fuera del MVP sigue consultando por token (comportamiento del backlog)", async () => {
    mocks.mvp = false;
    const admin = emptyAdmin();
    mocks.admin.mockReturnValue(admin);
    expect(await getVendorByToken(token)).toBeNull();
    expect(admin.from).toHaveBeenCalledWith("vendors");
  });
});

describe("submitVendorSetup con la boda en borrado (P2-5)", () => {
  it("rechaza el envío sin subir la factura ni tocar el proveedor", async () => {
    mocks.mvp = false;
    mocks.rateLimit.mockResolvedValue(true);
    const filters: unknown[][] = [];
    const upload = vi.fn();
    const update = vi.fn();
    const chainFor = (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = (...args: unknown[]) => { filters.push([table, m, ...args]); return chain; };
      chain.update = update;
      chain.maybeSingle = async () => (table === "vendors"
        ? { data: { id: "v1", name: "Fotos", status: "invited", iban: null, wedding_id: "w1", invite_token_expires_at: null }, error: null }
        : { data: null, error: null });
      return chain;
    };
    mocks.admin.mockReturnValue({ from: vi.fn(chainFor), storage: { from: () => ({ upload }) } });
    const fd = new FormData();
    fd.set("token", token);
    fd.set("totalEur", "1000");
    fd.set("iban", "ES9121000418450200051332");
    fd.set("tranchesJson", JSON.stringify([{ label: "Señal", amountEur: "1000" }]));
    fd.set("invoice", new File([new Uint8Array([37, 80, 68, 70])], "f.pdf", { type: "application/pdf" }));
    expect(await submitVendorSetup(fd)).toEqual({ ok: false, error: "Enlace no válido." });
    expect(filters).toContainEqual(["weddings", "is", "deleted_at", null]);
    expect(upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
