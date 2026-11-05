/**
 * QA fase 1 — contrato del documento y adaptador v1.
 *
 * Complementa lib/site-document.test.ts (coordinador): round-trip con
 * page_config, rechazo de props desconocidos a todos los niveles, frontera
 * exacta de los 32 KB, publishIssues, ids estables y determinismo.
 *
 * Los tests «BUG-1…3» documentan bugs del adaptador encontrados en QA y
 * corregidos después en lib/site-document.ts (regresión).
 */
import { describe, expect, it } from "vitest";
import {
  documentByteSize,
  documentFromBuilderDraft,
  documentFromLegacy,
  enabledScenes,
  findScene,
  LEGACY_SCENE_IDS,
  legacyConfigFromDocument,
  parseSiteDocument,
  publishIssues,
  SITE_DOCUMENT_MAX_BYTES,
  SITE_MAX_AGENDA_ITEMS,
  type LegacyWeddingSource,
  type SiteDocument,
} from "@/lib/site-document";
import { pageConfigSchema, type WeddingPageConfig } from "@/lib/wedding-settings";
import { EMPTY_DRAFT } from "@/lib/wedding-builder";

const source: LegacyWeddingSource = {
  partner_name_1: "Ana",
  partner_name_2: "Luis",
  wedding_date: "2027-06-12",
  cover_image_url: null,
  page_config: { style: "clasico", welcomeMessage: "  Hola a todos  ", venue: "Palacio", address: "Plaza 1", time: "18:30" },
  agenda: [],
};

const agendaRow = (id: string, title = "Momento") => ({ id, title, time_label: null, place: null, address: null, notes: null });

describe("round-trip documentFromLegacy → legacyConfigFromDocument", () => {
  it("conserva page_config normalizado por Zod (trim y defaults)", () => {
    const doc = documentFromLegacy(source);
    const expected: WeddingPageConfig = pageConfigSchema.parse(source.page_config);
    expect(legacyConfigFromDocument(doc)).toEqual(expected);
    expect(legacyConfigFromDocument(doc).welcomeMessage).toBe("Hola a todos");
  });

  it.each([
    [{}],
    [{ style: "natural" as const }],
    [{ style: "editorial" as const, venue: "Finca", time: "" }],
    [{ welcomeMessage: "x".repeat(400), address: "y".repeat(240), venue: "z".repeat(160), time: "23:59" }],
  ])("round-trip estable para page_config %#", (config) => {
    const doc = documentFromLegacy({ ...source, page_config: config });
    expect(legacyConfigFromDocument(doc)).toEqual(pageConfigSchema.parse(config));
  });

  it("page_config null/undefined o inválido → defaults, y vuelve a defaults", () => {
    for (const page_config of [null, undefined, { style: "neon" } as never, { time: "99:99" } as never]) {
      const doc = documentFromLegacy({ ...source, page_config });
      expect(legacyConfigFromDocument(doc)).toEqual(pageConfigSchema.parse({}));
    }
  });

  it("un lugar deshabilitado se proyecta vacío (no se filtra texto oculto a page_config)", () => {
    const doc = documentFromLegacy(source);
    const hidden: SiteDocument = { ...doc, scenes: doc.scenes.map((s) => (s.type === "venue" ? { ...s, enabled: false } : s)) } as SiteDocument;
    expect(legacyConfigFromDocument(hidden)).toEqual({ style: "clasico", welcomeMessage: "Hola a todos", venue: "", address: "", time: "" });
  });

  it("el documento del adaptador es idempotente al reparsear (parse(doc) === doc)", () => {
    const doc = documentFromLegacy({ ...source, cover_image_url: "https://example.com/a.jpg", agenda: [agendaRow("6f1d2c3b-aaaa-4bbb-8ccc-000000000001", "Ceremonia")] });
    const again = parseSiteDocument(JSON.parse(JSON.stringify(doc)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(JSON.stringify(again.document)).toBe(JSON.stringify(doc));
  });
});

describe("parseSiteDocument · strictness", () => {
  const valid = documentFromLegacy(source);

  it("rechaza claves desconocidas en la raíz, en la escena y en props", () => {
    expect(parseSiteDocument({ ...valid, extra: 1 }).ok).toBe(false);
    const sceneExtra = { ...valid, scenes: [{ ...valid.scenes[0], extra: 1 }, ...valid.scenes.slice(1)] };
    const r1 = parseSiteDocument(sceneExtra);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.issues[0]).toEqual({ path: "scenes.0", message: expect.stringContaining("extra") });
    const propsExtra = { ...valid, scenes: [{ ...valid.scenes[0], props: { ...valid.scenes[0].props, extra: 1 } }, ...valid.scenes.slice(1)] };
    const r2 = parseSiteDocument(propsExtra);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues[0]?.path).toBe("scenes.0.props");
  });

  it("rechaza claves desconocidas en un item de agenda y en la imagen", () => {
    const agenda = { id: "programa", type: "agenda", props: { items: [{ id: "m-1", title: "Cena", secret: "x" }] } };
    expect(parseSiteDocument({ ...valid, scenes: [...valid.scenes.slice(0, 3), agenda] }).ok).toBe(false);
    const image = { url: "https://example.com/a.jpg", alt: "", base64: "AAAA" };
    expect(parseSiteDocument({ ...valid, scenes: [{ ...valid.scenes[0], props: { ...valid.scenes[0].props, image } }, ...valid.scenes.slice(1)] }).ok).toBe(false);
  });

  it("rechaza datos privados que no existen en el contrato (invitados, tokens, pagos)", () => {
    for (const key of ["guests", "invitationToken", "stripeAccountId", "bizumPhone"]) {
      expect(parseSiteDocument({ ...valid, [key]: "x" }).ok).toBe(false);
    }
  });

  it("no acepta tipos de escena fuera del catálogo ni templateId/locale distintos", () => {
    expect(parseSiteDocument({ ...valid, scenes: [...valid.scenes, { id: "video", type: "video", props: {} }] }).ok).toBe(false);
    expect(parseSiteDocument({ ...valid, templateId: "otro" }).ok).toBe(false);
    expect(parseSiteDocument({ ...valid, locale: "en-GB" }).ok).toBe(false);
    expect(parseSiteDocument({ ...valid, templateVersion: 2 }).ok).toBe(false);
  });

  it("nunca lanza con entradas basura", () => {
    for (const input of [null, undefined, 1, "str", [], {}, { schemaVersion: 1 }]) {
      expect(parseSiteDocument(input).ok).toBe(false);
    }
  });

  it("frontera exacta del presupuesto: el último documento dentro del límite pasa y el siguiente falla", () => {
    const item = (i: number) => ({ id: `m-${i}`, title: "t".repeat(120), timeLabel: "", place: "p".repeat(160), address: "a".repeat(240), notes: "n".repeat(400) });
    let under: unknown = null;
    let over: unknown = null;
    // Una agenda llena (≈38 KB) no basta para pasarse de 48 KB: se añade una segunda que crece.
    const full = { id: "programa", type: "agenda", enabled: true, props: { title: "El día de la boda", items: Array.from({ length: SITE_MAX_AGENDA_ITEMS }, (_, i) => item(i)) } };
    for (let n = 1; n <= SITE_MAX_AGENDA_ITEMS; n++) {
      const candidate = { ...valid, scenes: [...valid.scenes.filter((s) => s.type !== "agenda"), full, { id: "programa-2", type: "agenda", enabled: true, props: { title: "La fiesta", items: Array.from({ length: n }, (_, i) => item(i)) } }] };
      const parsed = parseSiteDocument(candidate);
      if (parsed.ok) {
        expect(documentByteSize(parsed.document)).toBeLessThanOrEqual(SITE_DOCUMENT_MAX_BYTES);
        under = candidate;
      } else {
        over = candidate;
        expect(parsed.issues[0]?.message).toContain(`${SITE_DOCUMENT_MAX_BYTES}`);
        break;
      }
    }
    expect(under).not.toBeNull();
    expect(over).not.toBeNull();
  });

  it("el presupuesto cuenta bytes UTF-8, no caracteres", () => {
    const ascii = documentFromLegacy({ ...source, page_config: { welcomeMessage: "a".repeat(400) } });
    const multibyte = documentFromLegacy({ ...source, page_config: { welcomeMessage: "ñ".repeat(400) } });
    expect(documentByteSize(multibyte) - documentByteSize(ascii)).toBe(400);
  });
});

describe("publishIssues", () => {
  it("documento completo → sin issues", () => {
    expect(publishIssues(documentFromLegacy(source))).toEqual([]);
  });
  it("nombres de 1 letra o vacíos → un issue de nombres; sin fecha → otro; ambos → dos", () => {
    expect(publishIssues(documentFromLegacy({ ...source, partner_name_1: "A" }))).toEqual([{ path: "scenes.0.props", message: expect.stringContaining("nombres") }]);
    expect(publishIssues(documentFromLegacy({ ...source, partner_name_2: "   " }))).toHaveLength(1);
    expect(publishIssues(documentFromLegacy({ ...source, wedding_date: null }))).toEqual([{ path: "scenes.0.props.weddingDate", message: expect.stringContaining("fecha") }]);
    expect(publishIssues(documentFromLegacy({ ...source, partner_name_1: "", wedding_date: "2027-02-30" }))).toHaveLength(2);
  });
  it("el borrador vacío del wizard no es publicable pero sí guardable", () => {
    const doc = documentFromBuilderDraft(EMPTY_DRAFT);
    expect(parseSiteDocument(doc).ok).toBe(true);
    expect(publishIssues(doc)).toHaveLength(2);
  });
});

describe("ids estables y determinismo del adaptador", () => {
  it("las escenas del adaptador llevan siempre portada/lugar/programa/asistencia en ese orden", () => {
    const doc = documentFromLegacy(source);
    expect(LEGACY_SCENE_IDS).toEqual({ cover: "portada", venue: "lugar", rsvp: "asistencia", agenda: "programa" });
    expect(doc.scenes.map((s) => [s.id, s.type])).toEqual([["portada", "cover"], ["lugar", "venue"], ["programa", "agenda"], ["asistencia", "rsvp"]]);
    // Las escenas vacías existen pero deshabilitadas: el editor podrá activarlas sin cambiar ids.
    expect(enabledScenes(doc).map((s) => s.id)).toEqual(["portada", "lugar", "asistencia"]);
    expect(findScene(doc, "agenda")?.enabled).toBe(false);
  });

  it("dos llamadas con la misma fila producen el mismo JSON (sin fechas ni aleatoriedad)", () => {
    const row = { ...source, agenda: [agendaRow("6f1d2c3b-aaaa-4bbb-8ccc-000000000001", "Cena")] };
    expect(JSON.stringify(documentFromLegacy(row))).toBe(JSON.stringify(documentFromLegacy(row)));
  });

  it("los ids de los momentos derivan del uuid de la fila y cumplen el patrón de sceneId", () => {
    const doc = documentFromLegacy({ ...source, agenda: [agendaRow("6F1D2C3B-AAAA-4BBB-8CCC-000000000001"), agendaRow("")] });
    const items = findScene(doc, "agenda")!.props.items;
    expect(items[0].id).toBe("m-6f1d2c3baaaa4bbb8ccc0000");
    expect(items[1].id).toBe("m-1");
    for (const item of items) expect(item.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
  });

  it("recorta a los límites del contrato sin lanzar (nombres 80, agenda 40 items, campos largos)", () => {
    const doc = documentFromLegacy({
      ...source,
      partner_name_1: " " + "A".repeat(100) + " ",
      agenda: Array.from({ length: 45 }, (_, i) => ({ ...agendaRow(String(i), "T".repeat(150)), time_label: "L".repeat(30), address: "https://maps.example/" + "x".repeat(300), notes: "n".repeat(500) })),
    });
    expect(findScene(doc, "cover")!.props.partnerName1).toHaveLength(80);
    const items = findScene(doc, "agenda")!.props.items;
    expect(items).toHaveLength(SITE_MAX_AGENDA_ITEMS);
    expect(items[0].title).toHaveLength(120);
    expect(items[0].timeLabel).toHaveLength(20);
    expect(items[0].address).toHaveLength(240);
    expect(items[0].notes).toHaveLength(400);
  });
});

describe("bugs del adaptador detectados en QA (corregidos en lib/site-document.ts)", () => {
  // weddings.cover_image_url es `text` sin límite y la pareja puede escribirla
  // (grant update por columna). Una URL válida de más de 2048 caracteres hace
  // que documentFromLegacy lance (sceneImageSchema.url.max(2048)) y la página
  // pública de esa boda devuelve 500 en vez de degradar al monograma.
  it("BUG-1: una cover_image_url válida de >2048 caracteres no debería lanzar", () => {
    expect(() => documentFromLegacy({ ...source, cover_image_url: "https://example.com/" + "a".repeat(2100) })).not.toThrow();
  });

  // wedding_agenda_items.title es `text not null` sin check; el action recorta
  // y exige 2 letras, pero una fila con título solo de espacios (PostgREST
  // directo) hace lanzar al adaptador (min(1) tras trim). `|| "Momento"` solo
  // cubre la cadena vacía.
  it("BUG-2: un título de agenda solo con espacios no debería lanzar", () => {
    expect(() => documentFromLegacy({ ...source, agenda: [agendaRow("6f1d2c3b-aaaa-4bbb-8ccc-000000000001", "   ")] })).not.toThrow();
  });

  // El contrato dice «Imagen ya alojada… Nunca base64», pero z.string().url()
  // acepta data: y javascript:. No lanza (no es un 500), pero contradice el
  // contrato y llega al <img src> del renderer.
  it("BUG-3: el adaptador no debería aceptar esquemas data:/javascript: como imagen", () => {
    expect(findScene(documentFromLegacy({ ...source, cover_image_url: "data:image/png;base64,AAAA" }), "cover")!.props.image).toBeNull();
    expect(findScene(documentFromLegacy({ ...source, cover_image_url: "javascript:alert(1)" }), "cover")!.props.image).toBeNull();
  });
});
