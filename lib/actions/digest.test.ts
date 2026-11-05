import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ current: vi.fn(), admin: vi.fn(), revalidate: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/data/current-wedding", () => ({ getCurrentWedding: mocks.current, isMissingMembership: (e: { code?: string } | null) => e?.code === "42703" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.capture }));

import { getDigestPref, setDigestEnabled } from "./digest";

function client(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update"]) chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain; };
  chain.maybeSingle = async () => result;
  return { calls, from: (table: string) => { calls.push(["from", table]); return chain; } };
}

beforeEach(() => vi.clearAllMocks());

describe("resumen diario: preferencia por miembro", () => {
  it("guarda la baja SOLO en la fila (boda de la sesión, usuario de la sesión)", async () => {
    const admin = client({ data: { user_id: "u-1" }, error: null });
    mocks.admin.mockReturnValue(admin);
    mocks.current.mockResolvedValue({ userId: "u-1", wedding: { id: "w-1", slug: "ana-y-luis" } });
    expect(await setDigestEnabled(false)).toEqual({ ok: true });
    expect(admin.calls).toEqual([["from", "wedding_members"], ["update", { digest_opt_out: true }], ["eq", "wedding_id", "w-1"], ["eq", "user_id", "u-1"], ["select", "user_id"]]);
    expect(mocks.revalidate).toHaveBeenCalledWith("/panel/ajustes");
  });
  it("rechaza lo que no es booleano y sin sesión no escribe", async () => {
    expect((await setDigestEnabled("no")).ok).toBe(false);
    mocks.current.mockResolvedValue(null);
    expect((await setDigestEnabled(true)).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("lectura: activo por defecto; sin la migración la tarjeta no aparece", async () => {
    mocks.current.mockResolvedValue({ userId: "u-1", wedding: { id: "w-1" }, supabase: client({ data: { digest_opt_out: false }, error: null }) });
    expect(await getDigestPref()).toEqual({ available: true, enabled: true });
    mocks.current.mockResolvedValue({ userId: "u-1", wedding: { id: "w-1" }, supabase: client({ data: null, error: { code: "42703" } }) });
    expect(await getDigestPref()).toEqual({ available: false });
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
