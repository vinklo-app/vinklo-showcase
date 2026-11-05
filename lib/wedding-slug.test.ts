import { describe, expect, it } from "vitest";

import { buildBaseSlug, isReservedSlug, RESERVED_SLUGS, slugCandidate, slugifyName } from "./wedding-slug";

describe("slugs reservados", () => {
  it("incluye la boda de ejemplo y las rutas de la app", () => {
    for (const slug of ["ana-y-luis", "demo", "crear", "panel", "login", "b", "v", "api", "admin"]) {
      expect(isReservedSlug(slug)).toBe(true);
    }
    expect(isReservedSlug(" Ana-Y-Luis ")).toBe(true);
    expect(isReservedSlug("ana-y-luis-12-06-2027")).toBe(false);
  });
  it("ningún candidato devuelto es reservado; los reservados se saltan", () => {
    for (const slug of RESERVED_SLUGS) expect(slugCandidate(slug, 1)).toBeNull();
    expect(slugCandidate("ana-y-luis-12-06-2027", 1)).toBe("ana-y-luis-12-06-2027");
    expect(slugCandidate("ana-y-luis-12-06-2027", 3)).toBe("ana-y-luis-12-06-2027-3");
  });
  it("Ana y Luis nunca reciben el slug de la demo", () => {
    const base = buildBaseSlug("Ana", "Luis", "2027-06-12");
    expect(base).toBe("ana-y-luis-12-06-2027");
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = slugCandidate(base, attempt);
      expect(candidate).not.toBeNull();
      expect(isReservedSlug(candidate!)).toBe(false);
    }
  });
  it("translitera acentos y ñ", () => {
    expect(slugifyName("José María")).toBe("jose-maria");
    expect(buildBaseSlug("Íñigo", "", "2027-01-05")).toBe("inigo-y-novio-05-01-2027");
  });
});
