import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORY_SECONDS,
  resolveStorySeconds,
  STORY_SECONDS_MAX,
  STORY_SECONDS_MIN,
  storyLayoutAvailable,
  withSiteLayout,
  SITE_DOCUMENT_MAX_BYTES,
  collectImages,
  documentByteSize,
  mapImages,
  sceneHasContent,
  SITE_PALETTES,
  SITE_PALETTE_IDS,
  SITE_THEME_IDS,
  documentFromBuilderDraft,
  documentFromLegacy,
  resolveOpening,
  guestVisibleScene,
  findScene,
  legacyConfigFromDocument,
  mergeLegacyIntoDocument,
  parseSiteDocument,
  RSVP_WHATSAPP_INVALID,
  publishIssues,
  resolveLayout,
  resolvePalette,
  type SiteDocument,
  type SiteDocumentInput,
  type SceneOf,
} from "./site-document";
import { EMPTY_DRAFT } from "./wedding-builder";
import { WEDDING_PAGE_THEMES } from "./wedding-settings";

const base: SiteDocumentInput = {
  schemaVersion: 1,
  templateId: "papel-calido",
  templateVersion: 1,
  themeId: "editorial",
  locale: "es-ES",
  scenes: [
    { id: "portada", type: "cover", props: { partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12" } },
    { id: "asistencia", type: "rsvp", props: {} },
  ],
};

describe("parseSiteDocument", () => {
  it("accepts a minimal valid document and applies defaults", () => {
    const result = parseSiteDocument(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes[0]).toMatchObject({ type: "cover", enabled: true, props: { eyebrow: "¡Nos casamos!", showCountdown: true, image: null } });
    expect(result.document.scenes[1]).toMatchObject({ type: "rsvp", props: { title: "Confirma tu asistencia" } });
  });

  it("rejects unknown keys, foreign schema versions and duplicate ids", () => {
    expect(parseSiteDocument({ ...base, schemaVersion: 2 }).ok).toBe(false);
    expect(parseSiteDocument({ ...base, extra: true }).ok).toBe(false);
    const dup = { ...base, scenes: [base.scenes[0], { ...base.scenes[1], id: "portada" }] };
    const result = parseSiteDocument(dup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.message.includes("mismo identificador"))).toBe(true);
  });

  it("requires the cover first and only one cover/rsvp", () => {
    expect(parseSiteDocument({ ...base, scenes: [base.scenes[1], base.scenes[0]] }).ok).toBe(false);
    const twoCovers = { ...base, scenes: [base.scenes[0], { ...base.scenes[0], id: "otra" }] };
    expect(parseSiteDocument(twoCovers).ok).toBe(false);
  });

  it("enforces text limits and the document byte budget", () => {
    const long = { ...base, scenes: [{ ...base.scenes[0], props: { ...base.scenes[0].props, welcomeMessage: "x".repeat(401) } }] };
    expect(parseSiteDocument(long).ok).toBe(false);
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `m-${i}`, title: "t".repeat(120), notes: "n".repeat(400), place: "p".repeat(160), address: "a".repeat(240) }));
    // Dos agendas llenas (no son únicas) superan el presupuesto de 48 KB.
    const heavy = { ...base, scenes: [...base.scenes, { id: "programa", type: "agenda" as const, props: { items } }, { id: "programa-2", type: "agenda" as const, props: { items } }] };
    const result = parseSiteDocument(heavy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toContain(`${SITE_DOCUMENT_MAX_BYTES}`);
  });
});

describe("documentFromLegacy (adaptador v1)", () => {
  it("maps page_config, cover image and agenda rows without loss", () => {
    const doc = documentFromLegacy({
      partner_name_1: "María",
      partner_name_2: "Jorge",
      wedding_date: "2027-09-04",
      cover_image_url: "https://example.com/foto.jpg",
      page_config: { style: "natural", welcomeMessage: "Hola", venue: "La Finca", address: "Camino 1", time: "17:30" },
      agenda: [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "17:30", place: "Jardín", address: null, notes: null }],
    });
    expect(doc.themeId).toBe("natural");
    expect(doc.scenes.map((s) => s.type)).toEqual(["cover", "venue", "agenda", "rsvp"]);
    expect(doc.scenes[0]).toMatchObject({ props: { partnerName1: "María", weddingDate: "2027-09-04", welcomeMessage: "Hola", image: { url: "https://example.com/foto.jpg" } } });
    expect(doc.scenes[1]).toMatchObject({ enabled: true, props: { venue: "La Finca", time: "17:30" } });
    expect(doc.scenes[2]).toMatchObject({ enabled: true, props: { items: [{ id: "m-6f1d2c3baaaa4bbb8ccc0000", title: "Ceremonia", timeLabel: "17:30", place: "Jardín", address: "", notes: "" }] } });
    expect(publishIssues(doc)).toEqual([]);
    expect(legacyConfigFromDocument(doc)).toEqual({ style: "natural", welcomeMessage: "Hola", venue: "La Finca", address: "Camino 1", time: "17:30" });
  });

  it("tolerates corrupt page_config, missing date and empty venue", () => {
    const doc = documentFromLegacy({ partner_name_1: "A", partner_name_2: "B", wedding_date: "2027-02-31", cover_image_url: "not a url", page_config: { style: "neon" } as never });
    expect(doc.themeId).toBe("editorial");
    expect(doc.scenes[0]).toMatchObject({ props: { weddingDate: "", image: null } });
    expect(doc.scenes[1]).toMatchObject({ enabled: false });
    expect(doc.scenes[2]).toMatchObject({ type: "agenda", enabled: false });
    expect(publishIssues(doc).length).toBe(2);
  });

  it("builds the wizard preview document from a local draft", () => {
    const doc = documentFromBuilderDraft({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", style: "clasico", venue: "Palacio" });
    expect(doc.themeId).toBe("clasico");
    expect(doc.scenes[0]).toMatchObject({ props: { partnerName1: "Ana", weddingDate: "2027-06-12", welcomeMessage: EMPTY_DRAFT.welcomeMessage } });
    expect(doc.scenes[1]).toMatchObject({ enabled: true, props: { venue: "Palacio" } });
  });
});

describe("sceneImageSchema y adaptador: solo https", () => {
  const source = { partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: null };
  it.each(["http://example.com/a.jpg", "http://localhost/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x.com/a", "not a url"])("descarta %s", (url) => {
    expect(documentFromLegacy({ ...source, cover_image_url: url }).scenes[0]).toMatchObject({ props: { image: null } });
    expect(parseSiteDocument({ ...base, scenes: [{ ...base.scenes[0], props: { ...base.scenes[0].props, image: { url } } }, base.scenes[1]] }).ok).toBe(false);
  });
  it("acepta https y recorta espacios", () => {
    expect(documentFromLegacy({ ...source, cover_image_url: "https://cdn.example.com/foto.jpg" }).scenes[0]).toMatchObject({ props: { image: { url: "https://cdn.example.com/foto.jpg" } } });
    const parsed = parseSiteDocument({ ...base, scenes: [{ ...base.scenes[0], props: { ...base.scenes[0].props, image: { url: "  https://cdn.example.com/x.jpg " } } }, base.scenes[1]] });
    expect(parsed.ok && findScene(parsed.document, "cover")?.props.image?.url).toBe("https://cdn.example.com/x.jpg");
  });
  it("una URL https de más de 2048 caracteres o un título de agenda en blanco no hacen lanzar al adaptador", () => {
    expect(() => documentFromLegacy({ ...source, cover_image_url: "https://example.com/" + "a".repeat(2100) })).not.toThrow();
    const doc = documentFromLegacy({ ...source, agenda: [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "   ", time_label: null, place: null, address: null, notes: null }] });
    expect(findScene(doc, "agenda")?.props.items[0]?.title).toBe("Momento");
  });
});

describe("mergeLegacyIntoDocument", () => {
  const legacySource = {
    partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null,
    page_config: { style: "natural" as const, venue: "Finca", address: "", time: "" },
    agenda: [] as Array<{ id: string; title: string; time_label: string | null; place: string | null; address: string | null; notes: string | null }>,
  };
  const row = { id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "13:00", place: null, address: null, notes: null };
  const legacy = documentFromLegacy(legacySource);
  function customized(): SiteDocument {
    const parsed = parseSiteDocument({
      ...legacy,
      themeId: "clasico",
      scenes: [
        { ...legacy.scenes[0], props: { ...findScene(legacy, "cover")!.props, eyebrow: "¡Por fin!", showCountdown: false, image: { url: "https://cdn.example.com/nuestra.jpg", alt: "Nosotros" } } },
        { ...findScene(legacy, "rsvp")!, enabled: false, props: { title: "¿Vienes?", body: "Dinos algo." } },
        { ...findScene(legacy, "venue")!, enabled: false },
        { ...findScene(legacy, "agenda")!, props: { title: "Programa", items: [] } },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return parsed.document;
  }
  it("sin borrador actual devuelve el adaptador tal cual", () => {
    expect(mergeLegacyIntoDocument(null, legacy)).toEqual(legacy);
  });
  it("conserva orden, enabled, eyebrow, showCountdown, imagen y títulos; toma tema y datos de ajustes", () => {
    const current = customized();
    const next = documentFromLegacy({ ...legacySource, partner_name_1: "Ana María", page_config: { ...legacySource.page_config, style: "editorial", venue: "Palacio" } });
    const merged = mergeLegacyIntoDocument(current, next);
    expect(merged.themeId).toBe("editorial");
    expect(merged.scenes.map((s) => s.id)).toEqual(current.scenes.map((s) => s.id));
    expect(findScene(merged, "cover")).toMatchObject({ props: { partnerName1: "Ana María", eyebrow: "¡Por fin!", showCountdown: false, image: { url: "https://cdn.example.com/nuestra.jpg" } } });
    expect(findScene(merged, "rsvp")).toMatchObject({ enabled: false, props: { title: "¿Vienes?", body: "Dinos algo." } });
    expect(findScene(merged, "venue")).toMatchObject({ enabled: false, props: { venue: "Palacio" } });
    expect(findScene(merged, "agenda")).toMatchObject({ props: { title: "Programa" } });
    expect(parseSiteDocument(merged).ok).toBe(true);
  });
  it("la foto del borrador manda: cover_image_url es solo la proyección de lo publicado", () => {
    // Publicada con foto y luego quitada en el borrador: guardar ajustes no debe devolverla.
    const next = documentFromLegacy({ ...legacySource, cover_image_url: "https://cdn.example.com/publicada.jpg" });
    expect(findScene(mergeLegacyIntoDocument(customized(), next), "cover")?.props.image?.url).toBe("https://cdn.example.com/nuestra.jpg");
    const withoutPhoto = parseSiteDocument({ ...customized(), scenes: customized().scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: null } } : s)) });
    if (!withoutPhoto.ok) throw new Error("fixture");
    expect(findScene(mergeLegacyIntoDocument(withoutPhoto.document, next), "cover")?.props.image).toBeNull();
  });
  it("venue/agenda siguen al contenido: el primer momento de la agenda la activa y vaciar el lugar la desactiva", () => {
    const current = customized();
    const withAgenda = documentFromLegacy({ ...legacySource, agenda: [row] });
    expect(findScene(mergeLegacyIntoDocument(current, withAgenda), "agenda")).toMatchObject({ enabled: true, props: { title: "Programa", items: [{ title: "Ceremonia" }] } });
    const emptied = documentFromLegacy({ ...legacySource, page_config: { style: "natural", venue: "", address: "", time: "" } });
    const venueOn = parseSiteDocument({ ...current, scenes: current.scenes.map((s) => (s.type === "venue" ? { ...s, enabled: true } : s)) });
    if (!venueOn.ok) throw new Error("fixture");
    expect(findScene(mergeLegacyIntoDocument(venueOn.document, emptied), "venue")?.enabled).toBe(false);
  });
  it("respeta un lugar ocultado a propósito mientras siga habiendo contenido", () => {
    expect(findScene(mergeLegacyIntoDocument(customized(), legacy), "venue")?.enabled).toBe(false);
  });
  it("es idempotente y determinista", () => {
    const once = mergeLegacyIntoDocument(customized(), legacy);
    expect(mergeLegacyIntoDocument(once, legacy)).toEqual(once);
    expect(JSON.stringify(mergeLegacyIntoDocument(customized(), legacy))).toEqual(JSON.stringify(once));
  });
});

/** Contraste WCAG 2.x entre dos colores #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("SITE_PALETTES", () => {
  it("las 3 primeras son los temas existentes con los mismos valores y en el mismo orden", () => {
    expect(SITE_PALETTES.slice(0, 3).map((p) => p.id)).toEqual([...SITE_THEME_IDS]);
    for (const id of SITE_THEME_IDS) {
      const { paper, ink, accent, surface } = SITE_PALETTES.find((p) => p.id === id)!;
      expect({ paper, ink, accent, surface }).toEqual(WEDDING_PAGE_THEMES[id]);
    }
  });
  it("tiene entre 6 y 8 paletas, ids únicos, alineados con SITE_PALETTE_IDS y colores #rrggbb", () => {
    expect(SITE_PALETTES.length).toBeGreaterThanOrEqual(6);
    expect(SITE_PALETTES.length).toBeLessThanOrEqual(8);
    expect(SITE_PALETTES.map((p) => p.id)).toEqual([...SITE_PALETTE_IDS]);
    for (const p of SITE_PALETTES) {
      expect(p.label.length).toBeGreaterThan(0);
      for (const c of [p.paper, p.ink, p.accent, p.surface]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it.each(SITE_PALETTES.map((p) => [p.id, p] as const))("%s cumple WCAG AA (tinta ≥ 7:1, acento ≥ 4.5:1 sobre papel)", (_id, p) => {
    expect(contrast(p.ink, p.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.accent, p.paper)).toBeGreaterThanOrEqual(4.5);
    // La tinta sobre la superficie secundaria también debe leerse bien.
    expect(contrast(p.ink, p.surface)).toBeGreaterThanOrEqual(7);
  });
});

describe("palette en el documento", () => {
  it("es opcional: los documentos sin palette siguen validando y su JSON no cambia", () => {
    const parsed = parseSiteDocument(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("palette" in parsed.document).toBe(false);
    expect(resolvePalette(parsed.document).id).toBe("editorial");
  });
  it("acepta cualquier id de la lista y rechaza ids desconocidos", () => {
    for (const id of SITE_PALETTE_IDS) {
      const parsed = parseSiteDocument({ ...base, palette: id });
      expect(parsed.ok && resolvePalette(parsed.document).id).toBe(id);
    }
    expect(parseSiteDocument({ ...base, palette: "neon" }).ok).toBe(false);
    expect(parseSiteDocument({ ...base, themeId: "terracota" }).ok).toBe(false);
  });
  it("sin palette se resuelve por themeId", () => {
    const parsed = parseSiteDocument({ ...base, themeId: "natural" });
    expect(parsed.ok && resolvePalette(parsed.document)).toMatchObject(WEDDING_PAGE_THEMES.natural);
  });
  it("mergeLegacyIntoDocument conserva la paleta elegida y legacyConfigFromDocument no la filtra a page_config", () => {
    const legacy = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "clasico" } });
    const withPalette = parseSiteDocument({ ...legacy, palette: "lavanda" });
    if (!withPalette.ok) throw new Error("fixture");
    const merged = mergeLegacyIntoDocument(withPalette.document, legacy);
    expect(merged.palette).toBe("lavanda");
    expect(merged.themeId).toBe("clasico");
    expect(legacyConfigFromDocument(merged).style).toBe("clasico");
    expect("palette" in mergeLegacyIntoDocument(legacy, legacy)).toBe(false);
  });
});

describe("opening en el documento", () => {
  it("es opcional, admite «sobre» y rechaza valores desconocidos", () => {
    const base = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" }, agenda: [] });
    expect("opening" in base).toBe(false);
    expect(parseSiteDocument({ ...base, opening: "sobre" }).ok).toBe(true);
    expect(parseSiteDocument({ ...base, opening: "cortina" }).ok).toBe(false);
  });
  it("sin `opening` la apertura efectiva es el sobre floral; «ninguno» es la elección explícita de abrir directa", () => {
    const base = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" }, agenda: [] });
    expect(resolveOpening(base)).toBe("sobre");
    expect(resolveOpening({ opening: "sobre-liso" })).toBe("sobre-liso");
    const none = parseSiteDocument({ ...base, opening: "ninguno" });
    expect(none.ok && none.document.opening).toBe("ninguno");
    expect(none.ok && resolveOpening(none.document)).toBe("ninguno");
  });
  it("mergeLegacyIntoDocument conserva la apertura del borrador", () => {
    const legacy = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" }, agenda: [] });
    expect(mergeLegacyIntoDocument({ ...legacy, opening: "sobre" }, legacy).opening).toBe("sobre");
    expect(mergeLegacyIntoDocument({ ...legacy, opening: "ninguno" }, legacy).opening).toBe("ninguno");
    expect("opening" in mergeLegacyIntoDocument(legacy, legacy)).toBe(false);
  });
});

describe("layout en el documento", () => {
  const legacy = () => documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" }, agenda: [] });

  it("un documento sin layout sigue siendo válido, sin clave añadida, y se lee como «historia»", () => {
    const parsed = parseSiteDocument(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("layout" in parsed.document).toBe(false);
    expect(resolveLayout(parsed.document)).toBe("historia");
    expect("layout" in legacy()).toBe(false);
  });

  it("admite «historia» y «web» y rechaza cualquier otro valor", () => {
    expect(parseSiteDocument({ ...base, layout: "web" }).ok).toBe(true);
    expect(parseSiteDocument({ ...base, layout: "historia" }).ok).toBe(true);
    for (const layout of ["scroll", "", "WEB", 1, null]) {
      const result = parseSiteDocument({ ...base, layout });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((issue) => issue.path === "layout")).toBe(true);
    }
  });

  it("ida y vuelta: JSON → parse → JSON conserva la maqueta", () => {
    const first = parseSiteDocument({ ...base, layout: "web", palette: "mar", opening: "sobre" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseSiteDocument(JSON.parse(JSON.stringify(first.document)));
    expect(again).toEqual(first);
    if (again.ok) expect(resolveLayout(again.document)).toBe("web");
  });

  it("mergeLegacyIntoDocument conserva la maqueta del borrador (guardar ajustes no la pierde)", () => {
    const doc = legacy();
    expect(mergeLegacyIntoDocument({ ...doc, layout: "web" }, doc).layout).toBe("web");
    expect("layout" in mergeLegacyIntoDocument(doc, doc)).toBe(false);
  });
});

describe("storySeconds (autoavance de la Story)", () => {
  const legacy = () => documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" }, agenda: [] });

  it("sin la clave el documento no cambia (JSON canónico) y se leen 6 s", () => {
    const parsed = parseSiteDocument(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("storySeconds" in parsed.document).toBe(false);
    expect(JSON.stringify(parsed.document)).not.toContain("storySeconds");
    expect(resolveStorySeconds(parsed.document)).toBe(DEFAULT_STORY_SECONDS);
    expect(DEFAULT_STORY_SECONDS).toBe(6);
  });

  it("admite enteros de 3 a 15 y rechaza el resto", () => {
    for (const seconds of [STORY_SECONDS_MIN, 6, 10, STORY_SECONDS_MAX]) {
      const parsed = parseSiteDocument({ ...base, storySeconds: seconds });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(resolveStorySeconds(parsed.document)).toBe(seconds);
    }
    for (const seconds of [0, 2, 16, 6.5, "6", null, -1]) {
      const result = parseSiteDocument({ ...base, storySeconds: seconds });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((issue) => issue.path === "storySeconds")).toBe(true);
    }
  });

  it("la Story es Premium: sin plan solo la conserva quien ya la tiene", () => {
    expect(storyLayoutAvailable(true, { layout: "web" })).toBe(true);
    expect(storyLayoutAvailable(false, { layout: "web" })).toBe(false);
    expect(storyLayoutAvailable(false, { layout: "historia" })).toBe(true);
    // Documentos antiguos sin `layout`: son Story y la siguen teniendo.
    expect(storyLayoutAvailable(false, {})).toBe(true);
  });

  it("withSiteLayout: a web quita el ritmo; a Story quita la clave de maqueta", () => {
    const doc = { ...legacy(), storySeconds: 9 };
    const web = withSiteLayout(doc, "web");
    expect(web.layout).toBe("web");
    expect("storySeconds" in web).toBe(false);
    const back = withSiteLayout({ ...web, storySeconds: 9 }, "historia");
    expect("layout" in back).toBe(false);
    expect(back.storySeconds).toBe(9);
  });

  it("mergeLegacyIntoDocument conserva el ritmo del borrador", () => {
    const doc = legacy();
    expect(mergeLegacyIntoDocument({ ...doc, storySeconds: 9 }, doc).storySeconds).toBe(9);
    expect("storySeconds" in mergeLegacyIntoDocument(doc, doc)).toBe(false);
  });
});

describe("escenas v2 (historia, galería, detalles, preguntas)", () => {
  const img = (n: number, extra: Partial<{ caption: string }> = {}) => ({ url: `https://cdn.test/foto-${n}.jpg`, alt: "", ...extra });
  const v2: SiteDocumentInput = {
    ...base,
    scenes: [
      ...base.scenes,
      { id: "fotos", type: "gallery", props: { title: "Os invitamos a celebrar nuestra historia", images: [img(1, { caption: "Primer viaje" }), img(2)] } },
      { id: "historia", type: "story", props: { chapters: [{ id: "c1", title: "Cómo nos conocimos", body: "En la universidad.", images: [img(3)] }] } },
      { id: "detalles", type: "details", props: { cards: [{ id: "d1", title: "Dress code", teaser: "Fiesta en el jardín", link: "https://ejemplo.test/dress" }] } },
      { id: "preguntas", type: "faq", props: { items: [{ id: "q1", question: "¿Hay aparcamiento?", answer: "Sí." }] } },
    ],
  };

  it("valida las cuatro escenas con sus defaults y pies de foto", () => {
    const result = parseSiteDocument(v2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "story")?.props.title).toBe("Nuestra historia");
    expect(findScene(result.document, "details")?.props.title).toBe("Algunos detalles más");
    expect(findScene(result.document, "faq")?.props.title).toBe("Preguntas y respuestas");
    expect(findScene(result.document, "gallery")?.props.images[0]?.caption).toBe("Primer viaje");
    expect(findScene(result.document, "gallery")?.props.images[1]).not.toHaveProperty("caption");
  });

  it("rechaza enlaces que no sean https y tipos fuera del catálogo", () => {
    const badLink = { ...v2, scenes: v2.scenes.map((s) => (s.type === "details" ? { ...s, props: { cards: [{ id: "d1", title: "X", link: "javascript:alert(1)" }] } } : s)) };
    expect(parseSiteDocument(badLink).ok).toBe(false);
    expect(parseSiteDocument({ ...v2, scenes: [...v2.scenes, { id: "v", type: "video", props: {} }] }).ok).toBe(false);
  });

  it("collectImages recorre portada, capítulos y galería; mapImages reescribe sin mutar", () => {
    const parsed = parseSiteDocument(v2);
    if (!parsed.ok) throw new Error("fixture");
    expect(collectImages(parsed.document).map((i) => i.url)).toEqual(["https://cdn.test/foto-1.jpg", "https://cdn.test/foto-2.jpg", "https://cdn.test/foto-3.jpg"]);
    const rewritten = mapImages(parsed.document, (image) => (image.url.endsWith("2.jpg") ? null : { ...image, url: image.url.replace("cdn.test", "pub.test") }));
    expect(collectImages(rewritten).map((i) => i.url)).toEqual(["https://pub.test/foto-1.jpg", "https://pub.test/foto-3.jpg"]);
    expect(collectImages(parsed.document)).toHaveLength(3);
    expect(parseSiteDocument(rewritten).ok).toBe(true);
  });

  it("sceneHasContent: las v2 vacías no se pintan", () => {
    const parsed = parseSiteDocument({ ...v2, scenes: [...base.scenes, { id: "hh", type: "story", props: {} }, { id: "gg", type: "gallery", props: {} }, { id: "dd", type: "details", props: {} }, { id: "pp", type: "faq", props: {} }] });
    if (!parsed.ok) throw new Error("fixture");
    expect(parsed.document.scenes.slice(2).map(sceneHasContent)).toEqual([false, false, false, false]);
    const full = parseSiteDocument(v2);
    if (!full.ok) throw new Error("fixture");
    expect(full.document.scenes.slice(2).map(sceneHasContent)).toEqual([true, true, true, true]);
  });

  it("plantillas sin rellenar (pregunta sin respuesta, tarjeta solo con título) no cuentan como contenido", () => {
    const parsed = parseSiteDocument({ ...v2, scenes: [...base.scenes, { id: "pp", type: "faq", props: { items: [{ id: "q-a", question: "¿Hay aparcamiento?" }] } }, { id: "dd", type: "details", props: { cards: [{ id: "d-a", title: "Dress code" }] } }] });
    if (!parsed.ok) throw new Error("fixture");
    const [faq, details] = parsed.document.scenes.slice(-2);
    expect([faq, details].map((scene) => sceneHasContent(scene!))).toEqual([false, false]);
    const answered: SceneOf<"faq"> = { id: "pp", type: "faq", enabled: true, props: { title: "Preguntas", contact: "", items: [{ id: "q-a", question: "¿Hay aparcamiento?", answer: "" }, { id: "q-b", question: "¿Y niños?", answer: "Sí." }] } };
    expect(sceneHasContent(answered)).toBe(true);
    expect(guestVisibleScene(answered).props.items.map((item) => item.id)).toEqual(["q-b"]);
  });

  it("un documento al máximo de cada escena cabe en el presupuesto", () => {
    const long = (n: number) => "x".repeat(n);
    const url = `https://cdn.test/storage/v1/object/public/wedding-photos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-${"0".repeat(32)}.jpg`;
    const photo = { url, alt: long(160), width: 2400, height: 1600, caption: long(120) };
    const maxed: SiteDocumentInput = {
      ...base,
      scenes: [
        base.scenes[0]!,
        { id: "fotos", type: "gallery", props: { title: long(80), images: Array.from({ length: 12 }, () => photo) } },
        { id: "historia", type: "story", props: { title: long(80), intro: long(200), chapters: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, title: long(80), body: long(600), images: Array.from({ length: 4 }, () => photo) })) } },
        { id: "detalles", type: "details", props: { title: long(80), intro: long(200), cards: Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, title: long(80), teaser: long(120), body: long(800), link: "https://ejemplo.test/x", linkLabel: long(40) })) } },
        { id: "preguntas", type: "faq", props: { title: long(80), contact: long(160), items: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, question: long(160), answer: long(800) })) } },
        base.scenes[1]!,
      ],
    };
    const result = parseSiteDocument(maxed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(documentByteSize(result.document)).toBeLessThanOrEqual(SITE_DOCUMENT_MAX_BYTES);
  });

  it("mergeLegacyIntoDocument conserva las escenas v2 del borrador", () => {
    const parsed = parseSiteDocument(v2);
    if (!parsed.ok) throw new Error("fixture");
    const legacy = documentFromLegacy({ partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null, page_config: { venue: "Finca" } });
    const merged = mergeLegacyIntoDocument(parsed.document, legacy);
    expect(merged.scenes.map((s) => s.type)).toEqual(["cover", "rsvp", "gallery", "story", "details", "faq", "venue", "agenda"]);
    expect(findScene(merged, "story")?.props.chapters[0]?.title).toBe("Cómo nos conocimos");
  });
});

describe("WhatsApp de la pareja en la escena de asistencia (18-oct-2026)", () => {
  const withWhatsapp = (whatsapp: string): SiteDocumentInput => ({ ...base, scenes: [base.scenes[0]!, { id: "asistencia", type: "rsvp", props: { whatsapp } }] });
  it("acepta un móvil español o internacional y lo guarda sin espacios alrededor", () => {
    const result = parseSiteDocument(withWhatsapp("  612 345 678 "));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes[1]).toMatchObject({ type: "rsvp", props: { whatsapp: "612 345 678" } });
    expect(parseSiteDocument(withWhatsapp("+44 7700 900123")).ok).toBe(true);
  });
  it("rechaza lo que no es un móvil con el mensaje del editor", () => {
    const result = parseSiteDocument(withWhatsapp("912 34"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toBe(RSVP_WHATSAPP_INVALID);
  });
  it("sin la clave el documento no cambia", () => {
    const result = parseSiteDocument(base);
    expect(result.ok && "whatsapp" in result.document.scenes[1]!.props).toBe(false);
  });
});
