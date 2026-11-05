import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /login desde el creador (revisión UX, ítem 7): el botón dice «Comprobando…»
 * mientras Turnstile no ha dado token, y hay un enlace para volver a la
 * invitación sin perder el borrador. La contraseña sigue siendo el método por
 * defecto.
 */
let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
// Las acciones de servidor no se llaman al pintar.
vi.mock("./actions", () => ({ signInWithPasswordAction: vi.fn(), signUpWithPasswordAction: vi.fn(), requestPasswordResetAction: vi.fn() }));
vi.mock("./keep-draft", () => ({ keepBuilderDraft: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  query = "";
});

async function renderLogin(search: string, siteKey = "") {
  query = search;
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  vi.resetModules();
  const { default: LoginPage } = await import("./page");
  return renderToStaticMarkup(<LoginPage />);
}

describe("submitLabel", () => {
  it("enviando > esperando al CAPTCHA > normal", async () => {
    const { CAPTCHA_WAIT_LABEL, submitLabel } = await import("./captcha");
    expect(CAPTCHA_WAIT_LABEL).toBe("Comprobando…");
    expect(submitLabel({ pending: true, pendingLabel: "Creando la cuenta…", ready: false, label: "Crear la cuenta" })).toBe("Creando la cuenta…");
    expect(submitLabel({ pending: false, pendingLabel: "Creando la cuenta…", ready: false, label: "Crear la cuenta" })).toBe("Comprobando…");
    expect(submitLabel({ pending: false, pendingLabel: "Creando la cuenta…", ready: true, label: "Crear la cuenta" })).toBe("Crear la cuenta");
  });
});

describe("/login?registro=1", () => {
  it("enlace «← Volver a vuestra invitación» a /crear; contraseña por defecto, en «Crear cuenta»", async () => {
    const html = await renderLogin("registro=1");
    expect(html).toMatch(/<a class="ac-link ac-back" href="\/crear">.*Volver a vuestra invitación<\/a>/);
    expect(html).toContain("Cread <em>vuestra cuenta.</em>");
    expect(html).toContain('id="signup-password"');
    expect(html).toContain(">Crear la cuenta</button>");
  });
  it("sin venir del creador (ni borrador), no hay enlace de volver", async () => {
    expect(await renderLogin("")).not.toContain("Volver a vuestra invitación");
  });
  it("con Turnstile activo y aún sin token, el botón dice «Comprobando…» (desactivado)", async () => {
    const html = await renderLogin("registro=1", "clave-de-prueba");
    expect(html).toMatch(/<button type="submit" class="ac-btn" disabled="">Comprobando…<\/button>/);
    expect(html).not.toContain(">Crear la cuenta</button>");
  });
});
