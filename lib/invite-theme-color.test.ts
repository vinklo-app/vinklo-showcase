import { describe, expect, it } from "vitest";
import { initialInvitePhase, inviteThemeColor } from "./invite-theme-color";
import { resolvePalette, type SiteDocument } from "./site-document";
import { sampleDocument } from "@/components/landing/landing-lovable-sample";

function doc(patch: Partial<SiteDocument>, withPhoto: boolean): SiteDocument {
  const base = sampleDocument("editorial", true);
  const scenes = base.scenes.map((s) =>
    s.type === "cover" ? { ...s, props: { ...s.props, image: withPhoto ? { url: "https://x.test/a.jpg", alt: "", width: 800, height: 1200 } : null } } : s,
  );
  return { ...base, scenes, ...patch };
}

describe("inviteThemeColor", () => {
  const paper = (d: SiteDocument) => resolvePalette(d).paper;
  const ink = (d: SiteDocument) => resolvePalette(d).ink;

  it("Story con foto a sangre: tinta en la portada, papel en el resto", () => {
    const d = doc({ opening: "ninguno" }, true);
    expect(inviteThemeColor(d, "cover")).toBe(ink(d));
    expect(inviteThemeColor(d, "scene")).toBe(paper(d));
  });
  it("con el sobre cerrado, papel aunque la portada lleve foto", () => {
    const d = doc({ opening: "sobre" }, true);
    expect(inviteThemeColor(d, "sealed")).toBe(paper(d));
  });
  it("Story sin foto: papel siempre", () => {
    const d = doc({}, false);
    expect(inviteThemeColor(d, "cover")).toBe(paper(d));
  });
  it("maqueta web (portada en marco con papel alrededor): papel", () => {
    const d = doc({ layout: "web" }, true);
    expect(inviteThemeColor(d, "cover")).toBe(paper(d));
  });
  it("respeta la paleta elegida", () => {
    const d = doc({ opening: "ninguno", palette: "natural" }, true);
    expect(inviteThemeColor(d, "cover")).toBe("#293b30");
    expect(inviteThemeColor(d, "scene")).toBe("#f4f5ec");
  });
  it("fase inicial: sobre si lo hay (por defecto lo hay), portada si es «ninguno»", () => {
    expect(initialInvitePhase(doc({ opening: "ninguno" }, true))).toBe("cover");
    expect(initialInvitePhase(doc({ opening: "sobre" }, true))).toBe("sealed");
    expect(initialInvitePhase(doc({ opening: undefined }, true))).toBe("sealed");
  });
});
