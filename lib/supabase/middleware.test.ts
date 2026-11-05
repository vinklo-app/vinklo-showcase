import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: unknown, _key: unknown, options: { cookies: { setAll: (cookies: unknown[]) => void } }) => ({
    auth: { getUser: async () => {
      options.cookies.setAll([{ name: "sb-test-auth-token", value: "", options: { path: "/", maxAge: 0 } }]);
      return { data: { user: auth.user } };
    } },
  }),
}));
import { updateSession } from "./middleware";
beforeEach(() => { auth.user = null; });
describe("cookies al refrescar la sesión", () => {
  it("conserva el borrado de una cookie inválida al redirigir a login", async () => {
    const response = await updateSession(new NextRequest("https://example.test/panel/invitados?private=query"));
    expect(response.headers.get("location")).toBe("https://example.test/login");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("el manifest del panel se sirve sin sesión (el navegador lo pide sin cookies)", async () => {
    const response = await updateSession(new NextRequest("https://example.test/panel/manifest.webmanifest"));
    expect(response.headers.get("location")).toBeNull();
    // Solo esa ruta exacta: el resto del panel sigue protegido.
    const other = await updateSession(new NextRequest("https://example.test/panel/manifest.webmanifest/x"));
    expect(other.headers.get("location")).toBe("https://example.test/login");
  });
  it("una respuesta autenticada nunca entra en una caché compartida", async () => {
    auth.user = { id: "test-user" };
    const response = await updateSession(new NextRequest("https://example.test/panel"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
