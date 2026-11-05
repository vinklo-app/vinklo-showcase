import { beforeEach, describe, expect, it, vi } from "vitest";

// P1-6: destino de /auth/confirm tras verificar el enlace en el cliente.
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), postLoginPath: vi.fn() }));
const supabase = { auth: { getUser: mocks.getUser } };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@/lib/auth/post-login", () => ({ postLoginPath: mocks.postLoginPath }));

import { GET } from "./route";

const ORIGIN = "https://vinklo.es";
const call = () => GET(new Request(`${ORIGIN}/auth/continuar`));

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.postLoginPath.mockReset().mockResolvedValue("/panel");
});

describe("GET /auth/continuar", () => {
  it("con sesión: al destino de postLoginPath, sin caché", async () => {
    const res = await call();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/panel`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.postLoginPath).toHaveBeenCalledWith(supabase);
  });
  it("invitación de pareja pendiente: /unirse", async () => {
    mocks.postLoginPath.mockResolvedValue("/unirse");
    expect((await call()).headers.get("location")).toBe(`${ORIGIN}/unirse`);
  });
  it("sin sesión: /login y no consulta el destino", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await call();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
    expect(mocks.postLoginPath).not.toHaveBeenCalled();
  });
});
