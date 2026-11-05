import { describe, expect, it } from "vitest";
import { cardVariant, envelopeSvg, mixOklab } from "./invitation-card";
import { getSitePalette, parseSiteDocument } from "@/lib/site-document";
import type { PublicSite } from "@/lib/data/site-public";

function site(extra: Record<string, unknown> = {}, image: unknown = null): PublicSite {
  const parsed = parseSiteDocument({
    schemaVersion: 1,
    templateId: "papel-calido",
    templateVersion: 1,
    themeId: "editorial",
    scenes: [
      { id: "portada", type: "cover", props: { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2026-10-17", image } },
      { id: "rsvp", type: "rsvp", props: {} },
    ],
    ...extra,
  });
  if (!parsed.ok) throw new Error("documento inválido");
  return { slug: "ana-y-luis", document: parsed.document, source: "published", publishedAt: null, plan: "free", revisionId: "r1" };
}

describe("tarjeta social de la invitación", () => {
  it("con sobre (también por defecto) enseña el sobre", () => {
    expect(cardVariant(site())).toBe("envelope");
    expect(cardVariant(site({ opening: "sobre-liso" }))).toBe("envelope");
  });

  it("sin sobre enseña la foto de la pareja y, sin foto, los nombres", () => {
    const photo = { url: "https://x.supabase.co/storage/v1/object/public/wedding-photos/a/cover.jpg", alt: "" };
    expect(cardVariant(site({ opening: "ninguno" }, photo))).toBe("photo");
    expect(cardVariant(site({ opening: "ninguno" }))).toBe("names");
    expect(cardVariant(null)).toBe("brand");
  });

  it("mezcla colores como color-mix en oklab", () => {
    expect(mixOklab("#ffffff", 1, "#000000")).toBe("#ffffff");
    expect(mixOklab("#ffffff", 0, "#9e3b22")).toBe("#9e3b22");
    expect(mixOklab("#000000", 0.5, "#ffffff")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("el sobre usa la paleta de la boda y solo lleva flores en el floral", () => {
    const mar = getSitePalette("mar");
    expect(envelopeSvg(mar, true)).toContain(mar.accent);
    expect(envelopeSvg(mar, true)).toContain("pattern");
    expect(envelopeSvg(mar, false)).not.toContain("pattern");
  });
});
