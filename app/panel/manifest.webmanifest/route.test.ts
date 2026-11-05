import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { PANEL_MANIFEST_PATH } from "@/lib/pwa/panel-manifest";
import { GET } from "./route";

describe("manifest del panel", () => {
  it("se sirve como manifest y el icono abre /panel", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const body = await response.json();
    expect(body).toMatchObject({ id: "/panel", start_url: "/panel", display: "standalone", lang: "es" });
    expect(body.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("el ámbito incluye /login y /auth para entrar sin salir del icono", async () => {
    const body = await GET().json();
    for (const path of ["/panel", "/login", "/auth/confirm", "/onboarding", "/unirse"]) {
      expect(path.startsWith(body.scope)).toBe(true);
    }
  });

  it("es una app distinta de la web pública, que conserva su manifest", async () => {
    const body = await GET().json();
    const publicManifest = manifest();
    expect(publicManifest.start_url).toBe("/");
    expect(publicManifest.id ?? publicManifest.start_url).not.toBe(body.id);
    expect(PANEL_MANIFEST_PATH).toBe("/panel/manifest.webmanifest");
  });
});
