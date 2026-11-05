import { beforeEach, describe, expect, it, vi } from "vitest";

// P1-6 de la revisión: el callback de auth (PKCE, token_hash, anti
// login-CSRF, recuperación, verificación con contraseña pendiente y destino)
// solo tenía tests de sus piezas en lib/auth/*. Aquí la ruta entera, con
// Supabase simulado; lib/auth/login-request es el real.
const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  finishEmailVerification: vi.fn(),
  postLoginPath: vi.fn(),
}));
const supabase = { auth: { exchangeCodeForSession: mocks.exchangeCodeForSession, verifyOtp: mocks.verifyOtp } };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@/lib/auth/pending-password", () => ({ finishEmailVerification: mocks.finishEmailVerification }));
vi.mock("@/lib/auth/post-login", () => ({ postLoginPath: mocks.postLoginPath }));

import { LOGIN_REQUEST_COOKIE } from "@/lib/auth/login-request";
import { GET } from "./route";

const ORIGIN = "https://vinklo.es";
const user = { id: "u1", email: "ana@example.com" };
const call = (query: string, cookie?: string) =>
  GET(new Request(`${ORIGIN}/auth/callback${query}`, cookie ? { headers: { cookie } } : undefined));
const location = (res: Response) => res.headers.get("location");
const clearsMark = (res: Response) =>
  (res.headers.get("set-cookie") ?? "").includes(`${LOGIN_REQUEST_COOKIE}=; path=/; max-age=0`);
const requested = `${LOGIN_REQUEST_COOKIE}=1`;

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset().mockResolvedValue({ data: { user }, error: null });
  mocks.verifyOtp.mockReset().mockResolvedValue({ data: { user }, error: null });
  mocks.finishEmailVerification.mockReset().mockResolvedValue(undefined);
  mocks.postLoginPath.mockReset().mockResolvedValue("/panel");
});

describe("GET /auth/callback con código (PKCE, Google)", () => {
  it("código válido: intercambia, termina la verificación y va al destino", async () => {
    const res = await call("?code=abc");
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`${ORIGIN}/panel`);
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(mocks.finishEmailVerification).toHaveBeenCalledWith(supabase, user);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(clearsMark(res)).toBe(false);
  });
  it("el destino lo decide postLoginPath (p. ej. invitación pendiente → /unirse)", async () => {
    mocks.postLoginPath.mockResolvedValue("/unirse");
    expect(location(await call("?code=abc"))).toBe(`${ORIGIN}/unirse`);
  });
  it("código caducado o inválido: /login?error=auth sin tocar la cuenta", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    const res = await call("?code=abc");
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`);
    expect(mocks.finishEmailVerification).not.toHaveBeenCalled();
    expect(mocks.postLoginPath).not.toHaveBeenCalled();
  });
  it("vuelta de Google sin código (cancelado): /login?error=google", async () => {
    const res = await call("?error=access_denied&error_description=cancelled");
    expect(location(res)).toBe(`${ORIGIN}/login?error=google`);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("sin parámetros: /login?error=auth", async () => {
    expect(location(await call(""))).toBe(`${ORIGIN}/login?error=auth`);
  });
});

describe("GET /auth/callback con token_hash (enlace del correo)", () => {
  it("sin la marca de este navegador: a la pantalla de confirmación, sin verificar (anti login-CSRF)", async () => {
    const res = await call("?token_hash=th1&type=magiclink");
    expect(location(res)).toBe(`${ORIGIN}/auth/confirm?token_hash=th1&type=magiclink`);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("con la marca: verifica, borra la marca y va al destino", async () => {
    const res = await call("?token_hash=th1&type=magiclink", `otra=1; ${requested}`);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "th1", type: "magiclink" });
    expect(mocks.finishEmailVerification).toHaveBeenCalledWith(supabase, user);
    expect(location(res)).toBe(`${ORIGIN}/panel`);
    expect(clearsMark(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });
  it("recuperación: a /login/restablecer, borra la marca y no termina la verificación", async () => {
    const res = await call("?token_hash=th2&type=recovery", requested);
    expect(location(res)).toBe(`${ORIGIN}/login/restablecer`);
    expect(clearsMark(res)).toBe(true);
    expect(mocks.finishEmailVerification).not.toHaveBeenCalled();
    expect(mocks.postLoginPath).not.toHaveBeenCalled();
  });
  it("cambio de correo: entra sin finishEmailVerification", async () => {
    const res = await call("?token_hash=th3&type=email_change", requested);
    expect(location(res)).toBe(`${ORIGIN}/panel`);
    expect(mocks.finishEmailVerification).not.toHaveBeenCalled();
  });
  it("token caducado: /login?error=auth", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect(location(await call("?token_hash=th1&type=signup", requested))).toBe(`${ORIGIN}/login?error=auth`);
  });
  it("tipo no permitido: ni confirmación ni verificación", async () => {
    const res = await call("?token_hash=th1&type=phone_change", requested);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`);
  });
  it("con código y token_hash a la vez manda el código y no borra la marca", async () => {
    const res = await call("?code=abc&token_hash=th1&type=magiclink");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${ORIGIN}/panel`);
    expect(clearsMark(res)).toBe(false);
  });
});
