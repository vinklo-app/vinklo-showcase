import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  signIn: vi.fn(),
  verifyOtp: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  resend: vi.fn(),
  resetPassword: vi.fn(),
  remember: vi.fn(),
  finish: vi.fn(),
  destination: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "203.0.113.7", rateLimit: mocks.rateLimit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mocks.signIn,
      verifyOtp: mocks.verifyOtp,
      signUp: mocks.signUp,
      signInWithOtp: mocks.signInWithOtp,
      resend: mocks.resend,
      resetPasswordForEmail: mocks.resetPassword,
    },
  }),
}));
// Destino tras entrar (invitación de pareja / boda por membresía / crearla):
// lib/auth/post-login.ts, probado aparte.
vi.mock("@/lib/auth/post-login", () => ({ postLoginPath: mocks.destination }));
// Cookie cifrada de la contraseña pendiente: lib/auth/pending-password.test.ts.
vi.mock("@/lib/auth/pending-password", () => ({
  rememberPendingPassword: mocks.remember,
  finishEmailVerification: mocks.finish,
}));

import { requestPasswordResetAction, signInWithPasswordAction, signUpWithPasswordAction, verifyLoginCodeAction } from "./actions";

const form = (email: string, password: string) => {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
};
const initial = { error: null, email: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "u1", email: "ana@ejemplo.es" } }, error: null });
  mocks.resetPassword.mockResolvedValue({ error: null });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.resend.mockResolvedValue({ error: null });
  mocks.destination.mockResolvedValue("/panel");
});

describe("signInWithPasswordAction", () => {
  it("valida antes de gastar intentos o llamar a Auth", async () => {
    const r = await signInWithPasswordAction(initial, form("no-es-correo", "x"));
    expect(r.error).toMatch(/correo válido/);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("limita por IP y no llama a Auth si se supera (o el limitador falla)", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    const r = await signInWithPasswordAction(initial, form("prueba@vinklo.es", "secreta"));
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-password", "203.0.113.7", 5, 900);
    expect(r.error).toMatch(/Demasiados intentos/);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("limita también por correo normalizado y no llama a Auth si se supera", async () => {
    mocks.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = await signInWithPasswordAction(initial, form(" Prueba@Vinklo.es ", "secreta"));
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-password-email", "prueba@vinklo.es", 5, 900);
    expect(r.error).toMatch(/Demasiados intentos/);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("no revela si la cuenta existe y conserva el correo, nunca la contraseña", async () => {
    mocks.signIn.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    const r = await signInWithPasswordAction(initial, form(" Prueba@Vinklo.es ", "mala"));
    expect(r).toEqual({ error: "El correo o la contraseña no son correctos.", email: "prueba@vinklo.es" });
    expect(JSON.stringify(r)).not.toContain("mala");
  });

  it("redirige como el enlace mágico: /panel con boda, /onboarding sin ella, /unirse con invitación", async () => {
    await expect(signInWithPasswordAction(initial, form("prueba@vinklo.es", "secreta"))).rejects.toMatchObject({ to: "/panel" });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "prueba@vinklo.es", password: "secreta", options: { captchaToken: undefined } });
    mocks.destination.mockResolvedValue("/onboarding");
    await expect(signInWithPasswordAction(initial, form("prueba@vinklo.es", "secreta"))).rejects.toMatchObject({ to: "/onboarding" });
    mocks.destination.mockResolvedValue("/unirse");
    await expect(signInWithPasswordAction(initial, form("prueba@vinklo.es", "secreta"))).rejects.toMatchObject({ to: "/unirse" });
  });

  it("correo sin confirmar (solo tras acertar la contraseña): reenvía la confirmación y pide el código", async () => {
    mocks.signIn.mockResolvedValue({ error: { status: 400, code: "email_not_confirmed" } });
    const r = await signInWithPasswordAction(initial, form("Ana@Ejemplo.es", "girasoles7"));
    expect(r).toEqual({ error: null, email: "ana@ejemplo.es", needsCode: true });
    expect(mocks.resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", email: "ana@ejemplo.es" }));
    expect(mocks.remember).toHaveBeenCalledWith("ana@ejemplo.es", "girasoles7");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("signUpWithPasswordAction (crear cuenta con contraseña)", () => {
  const signUpInitial = { status: "idle" as const, error: null, email: "" };
  const CHECK = { status: "check-email", error: null, email: "ana@ejemplo.es" };

  it("valida correo y longitud (8–72 caracteres y 72 bytes) antes de gastar intentos o llamar a Auth", async () => {
    expect((await signUpWithPasswordAction(signUpInitial, form("no-es-correo", "girasoles7"))).error).toMatch(/correo válido/);
    const short = await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "corta1"));
    expect(short.error).toMatch(/al menos 8 caracteres/);
    expect(JSON.stringify(short)).not.toContain("corta1");
    expect((await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "x".repeat(73)))).error).toMatch(/al menos 8/);
    // 40 «ñ» = 40 caracteres pero 80 bytes: bcrypt no lo admitiría.
    expect((await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "ñ".repeat(40)))).error).toMatch(/cuentan más/);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("limita por IP y por correo normalizado (fail-closed) antes de llamar a Auth", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    const byIp = await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "girasoles7"));
    expect(mocks.rateLimit).toHaveBeenCalledWith("signup-password", "203.0.113.7", 5, 900);
    expect(byIp.error).toMatch(/Demasiados intentos/);

    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const byEmail = await signUpWithPasswordAction(signUpInitial, form(" Ana@Ejemplo.es ", "girasoles7"));
    expect(mocks.rateLimit).toHaveBeenCalledWith("signup-password-email", "ana@ejemplo.es", 5, 900);
    expect(byEmail.error).toMatch(/Demasiados intentos/);
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("nunca llama a signUp: envía el código (crea la cuenta sin contraseña) y guarda la contraseña en la cookie", async () => {
    const r = await signUpWithPasswordAction(signUpInitial, form(" Ana@Ejemplo.es ", "girasoles7"));
    expect(r).toEqual(CHECK);
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@ejemplo.es",
      options: expect.objectContaining({ shouldCreateUser: true }),
    });
    expect(mocks.signInWithOtp.mock.calls[0][0]).not.toHaveProperty("password");
    expect(mocks.remember).toHaveBeenCalledWith("ana@ejemplo.es", "girasoles7");
    expect(JSON.stringify(r)).not.toContain("girasoles7");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sin enumeración: doble envío seguido (Auth limita el correo) responde igual que el primero", async () => {
    const first = await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "girasoles7"));
    mocks.signInWithOtp.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    const second = await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "girasoles7"));
    expect(second).toEqual(first);
    expect(second).toEqual(CHECK);
    expect(mocks.remember).toHaveBeenCalledTimes(2);
  });

  it("otro 429 → espera; 5xx u otros → genérico sin detalles y sin guardar la contraseña", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: { status: 429, code: "over_request_rate_limit" } });
    expect((await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "girasoles7"))).error).toMatch(/Demasiados intentos/);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.signInWithOtp.mockResolvedValue({ error: { status: 500, message: "db down" } });
    const r = await signUpWithPasswordAction(signUpInitial, form("ana@ejemplo.es", "girasoles7"));
    expect(r).toEqual({ status: "idle", error: "No hemos podido crear la cuenta. Probad de nuevo en un momento.", email: "ana@ejemplo.es" });
    expect(mocks.remember).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("requestPasswordResetAction (crear o cambiar la contraseña)", () => {
  const resetForm = (email: string) => {
    const fd = new FormData();
    fd.set("email", email);
    return fd;
  };

  it("limita por IP y también por correo antes de llamar a Auth", async () => {
    mocks.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = await requestPasswordResetAction({ sent: false, error: null }, resetForm(" Ana@Ejemplo.es "));
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-password-reset", "203.0.113.7", 5, 900);
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-password-reset-email", "ana@ejemplo.es", 5, 900);
    expect(r.error).toMatch(/Demasiados intentos/);
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it("mismo mensaje exista o no la cuenta", async () => {
    const ok = await requestPasswordResetAction({ sent: false, error: null }, resetForm("ana@ejemplo.es"));
    mocks.resetPassword.mockResolvedValue({ error: { status: 400, code: "user_not_found" } });
    const unknown = await requestPasswordResetAction({ sent: false, error: null }, resetForm("nadie@ejemplo.es"));
    expect(ok).toEqual({ sent: true, error: null });
    expect(unknown).toEqual(ok);
  });
});

const codeForm = (email: string, token: string) => {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("token", token);
  return fd;
};

describe("verifyLoginCodeAction (código de 6 cifras)", () => {
  it("con un código válido verifica en servidor (type email) y redirige como el enlace", async () => {
    await expect(verifyLoginCodeAction({ error: null }, codeForm(" Ana@Ejemplo.es ", "123 456"))).rejects.toMatchObject({ to: "/panel" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "ana@ejemplo.es", token: "123456", type: "email" });
    // Contraseña pendiente / pre-secuestro, con el usuario verificado.
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { id: "u1", email: "ana@ejemplo.es" });
    mocks.destination.mockResolvedValue("/onboarding");
    await expect(verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123-456"))).rejects.toMatchObject({ to: "/onboarding" });
  });

  it("valida formato antes de gastar intentos o llamar a Auth", async () => {
    for (const token of ["12345", "1234567", "abcdef", ""]) {
      const r = await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", token));
      expect(r.error).toMatch(/6 cifras/);
    }
    const r = await verifyLoginCodeAction({ error: null }, codeForm("no-es-correo", "123456"));
    expect(r.error).toMatch(/6 cifras/);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("código incorrecto: mensaje genérico (no revela si la cuenta existe) y nunca repite el código", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { status: 403, code: "otp_expired" } });
    const wrong = await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "654321"));
    mocks.verifyOtp.mockResolvedValue({ error: { status: 400, code: "user_not_found" } });
    const unknown = await verifyLoginCodeAction({ error: null }, codeForm("nadie@ejemplo.es", "654321"));
    expect(wrong).toEqual(unknown);
    expect(wrong.error).toMatch(/Ese código no vale/);
    expect(JSON.stringify(wrong)).not.toContain("654321");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("limita por IP y por correo (fail-closed) antes de llamar a Auth", async () => {
    await expect(verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123456"))).rejects.toBeTruthy();
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-code", "203.0.113.7", 10, 900);
    expect(mocks.rateLimit).toHaveBeenCalledWith("login-code-email", "ana@ejemplo.es", 5, 900);

    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const byEmail = await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123456"));
    expect(byEmail.error).toMatch(/Demasiados intentos/);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();

    mocks.rateLimit.mockResolvedValue(false);
    const byIp = await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123456"));
    expect(byIp.error).toMatch(/Demasiados intentos/);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("429 de Auth → espera; 5xx → error genérico sin detalles", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { status: 429 } });
    expect((await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123456"))).error).toMatch(/Demasiados intentos/);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verifyOtp.mockResolvedValue({ error: { status: 500, message: "db down" } });
    const r = await verifyLoginCodeAction({ error: null }, codeForm("ana@ejemplo.es", "123456"));
    expect(r).toEqual({ error: "No hemos podido entrar. Probad de nuevo en un momento." });
    spy.mockRestore();
  });
});

describe("CAPTCHA (Turnstile)", () => {
  const withToken = (fd: FormData) => {
    fd.set("captchaToken", "tok-123");
    return fd;
  };
  const CAPTCHA_MSG = "No hemos podido comprobar que sois personas. Esperad un segundo y probad de nuevo.";

  it("pasa el token a Auth en entrar, crear cuenta y pedir el enlace de contraseña", async () => {
    await expect(signInWithPasswordAction(initial, withToken(form("ana@ejemplo.es", "girasoles7")))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signIn.mock.calls[0][0].options).toEqual({ captchaToken: "tok-123" });
    await signUpWithPasswordAction({ status: "idle", error: null, email: "" }, withToken(form("ana@ejemplo.es", "girasoles7")));
    expect(mocks.signInWithOtp.mock.calls[0][0].options.captchaToken).toBe("tok-123");
    const fd = new FormData();
    fd.set("email", "ana@ejemplo.es");
    await requestPasswordResetAction({ sent: false, error: null }, withToken(fd));
    expect(mocks.resetPassword.mock.calls[0][1].captchaToken).toBe("tok-123");
  });

  it("token rechazado: lo dice claro (no «contraseña incorrecta») y no guarda la contraseña", async () => {
    const captchaFailed = { error: { status: 400, code: "captcha_failed" } };
    mocks.signIn.mockResolvedValue(captchaFailed);
    expect(await signInWithPasswordAction(initial, form("ana@ejemplo.es", "girasoles7"))).toEqual({ error: CAPTCHA_MSG, email: "ana@ejemplo.es" });
    mocks.signInWithOtp.mockResolvedValue(captchaFailed);
    const r = await signUpWithPasswordAction({ status: "idle", error: null, email: "" }, form("ana@ejemplo.es", "girasoles7"));
    expect(r).toEqual({ status: "idle", error: CAPTCHA_MSG, email: "ana@ejemplo.es" });
    expect(mocks.remember).not.toHaveBeenCalled();
    mocks.resetPassword.mockResolvedValue(captchaFailed);
    const fd = new FormData();
    fd.set("email", "ana@ejemplo.es");
    expect(await requestPasswordResetAction({ sent: false, error: null }, fd)).toEqual({ sent: false, error: CAPTCHA_MSG });
  });
});
