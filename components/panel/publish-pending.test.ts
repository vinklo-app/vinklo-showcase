import { describe, expect, it } from "vitest";
import { draftChipLabel, hasPendingPublish, shortChipLabel } from "./publish-pending";
import type { SiteEditorState } from "@/lib/actions/site";

const base = { weddingId: "w", slug: "s", draft: {} as SiteEditorState["draft"], draftVersion: 3 };
const PUBLISHED_AT = "2026-10-01T10:00:00Z";

describe("hasPendingPublish (atajo «Publicar» de la cabecera)", () => {
  it("nunca publicada: hay algo que publicar", () => {
    expect(hasPendingPublish({ ...base, publishedRevisionId: null, publishedAt: null, hasUnpublishedChanges: true }, 3)).toBe(true);
  });
  it("web retirada: se puede volver a publicar", () => {
    expect(hasPendingPublish({ ...base, publishedRevisionId: null, publishedAt: PUBLISHED_AT, hasUnpublishedChanges: false }, 3)).toBe(true);
  });
  it("publicada con cambios en el servidor", () => {
    expect(hasPendingPublish({ ...base, publishedRevisionId: "r1", publishedAt: PUBLISHED_AT, hasUnpublishedChanges: true }, 3)).toBe(true);
  });
  it("publicada y con guardados locales por delante", () => {
    expect(hasPendingPublish({ ...base, publishedRevisionId: "r1", publishedAt: PUBLISHED_AT, hasUnpublishedChanges: false }, 4)).toBe(true);
  });
  it("publicada y sin nada pendiente: no se muestra", () => {
    expect(hasPendingPublish({ ...base, publishedRevisionId: "r1", publishedAt: PUBLISHED_AT, hasUnpublishedChanges: false }, 3)).toBe(false);
  });
});

describe("shortChipLabel (píldora del móvil con «Publicar»)", () => {
  it("retirada se dice «Retirada», nunca «Borrador»; el resto, «Borrador»", () => {
    const withdrawn = { ...base, publishedRevisionId: null, publishedAt: PUBLISHED_AT, hasUnpublishedChanges: false };
    expect(shortChipLabel(withdrawn)).toBe("Retirada");
    expect(draftChipLabel(withdrawn, 3)).toBe("Borrador · web retirada");
    expect(shortChipLabel({ ...base, publishedRevisionId: null, publishedAt: null, hasUnpublishedChanges: true })).toBe("Borrador");
    expect(shortChipLabel({ ...base, publishedRevisionId: "r1", publishedAt: PUBLISHED_AT, hasUnpublishedChanges: true })).toBe("Borrador");
  });
});
