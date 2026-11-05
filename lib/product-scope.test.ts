import { describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ database: vi.fn(), stripe: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: access.database }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: access.database }));
vi.mock("@/lib/stripe", () => ({ getStripe: access.stripe }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import { isBacklogPath } from "./product-scope";
import { startCardContribution, logBizumContribution } from "./actions/contribute";
import { startPremiumCheckout } from "./actions/premium";
import { inviteVendor, submitVendorSetup } from "./actions/vendors";

describe("RSVP MVP scope", () => {
  it("blocks legacy routes without blocking the wedding configuration or guests", () => {
    for (const path of ["/precios", "/panel/contribuciones", "/v/token", "/v"]) expect(isBacklogPath(path)).toBe(true);
    for (const path of ["/panel", "/panel/invitados", "/panel/ajustes", "/panel/dia", "/panel/proveedores", "/panel/tareas", "/panel/mesas", "/b/ana-y-luis", "/api/webhooks/stripe", "/guias", "/guias/como-confirmar-asistencia-boda-whatsapp"]) expect(isBacklogPath(path)).toBe(false);
  });
  it("refuses financial and vendor actions before any database or Stripe access", async () => {
    expect((await startCardContribution({} as Parameters<typeof startCardContribution>[0])).ok).toBe(false);
    expect((await logBizumContribution({} as Parameters<typeof logBizumContribution>[0])).ok).toBe(false);
    expect((await inviteVendor({} as Parameters<typeof inviteVendor>[0])).ok).toBe(false);
    expect((await submitVendorSetup(new FormData())).ok).toBe(false);
    await expect(startPremiumCheckout()).rejects.toThrow("redirect:/panel");
    expect(access.database).not.toHaveBeenCalled();
    expect(access.stripe).not.toHaveBeenCalled();
  });
});
