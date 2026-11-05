import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), destination: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));
vi.mock("@/lib/auth/post-login", () => ({ postLoginPath: mocks.destination }));
vi.mock("@/lib/auth/pending-password", () => ({ finishEmailVerification: mocks.finish }));

import { confirmEmailLinkAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.destination.mockResolvedValue("/panel");
});

describe("confirmEmailLinkAction (enlace mágico verificado en servidor)", () => {
  it("verifica el token_hash con el cliente de servidor y devuelve el destino", async () => {
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "email" })).toEqual({ ok: true, to: "/panel" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    mocks.destination.mockResolvedValue("/unirse");
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "signup" })).toEqual({ ok: true, to: "/unirse" });
    // Contraseña pendiente de «Crear cuenta» / pre-secuestro, con el usuario verificado.
    expect(mocks.finish).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { id: "u1" });
  });

  it("ni la recuperación ni el cambio de correo tocan la contraseña aquí", async () => {
    await confirmEmailLinkAction({ tokenHash: "abc", type: "recovery" });
    await confirmEmailLinkAction({ tokenHash: "abc", type: "email_change" });
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("recuperación de contraseña va a /login/restablecer", async () => {
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "recovery" })).toEqual({ ok: true, to: "/login/restablecer" });
    expect(mocks.destination).not.toHaveBeenCalled();
  });

  it("rechaza tipos desconocidos o sin token sin llamar a Auth", async () => {
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "phone_change" })).toEqual({ ok: false });
    expect(await confirmEmailLinkAction({ tokenHash: "", type: "email" })).toEqual({ ok: false });
    expect(await confirmEmailLinkAction({ tokenHash: 42, type: "email" })).toEqual({ ok: false });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("enlace caducado o usado → ok:false (la página muestra «ya no vale»)", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { status: 403 } });
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "email" })).toEqual({ ok: false });
    mocks.verifyOtp.mockRejectedValue(new Error("red"));
    expect(await confirmEmailLinkAction({ tokenHash: "abc", type: "email" })).toEqual({ ok: false });
  });
});
