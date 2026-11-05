import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromLegacy, findScene } from "@/lib/site-document";
import { EMPTY_SITE_PATCH, type SitePatch } from "./site-edit-patch";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), client: vi.fn(), rateLimit: vi.fn(), ip: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText, Output: { object: (opts: unknown) => ({ kind: "object", ...(opts as object) }) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: mocks.ip, keyedHash: (v: string) => createHash("sha256").update(`t${v}`).digest("hex") }));
import { proposeDraftSiteEdit, proposeSiteEdit } from "./actions";
import { AI_BUSY_ERROR, AI_RATE_ERROR, AI_UNAVAILABLE_ERROR, isAiEditorConfigured, siteEditorModel } from "./site-editor";
import { ACTION_CONTENT, ACTION_SETTINGS, AI_TOO_MANY_SECTIONS_ERROR } from "./messages";

const document = documentFromLegacy({
  partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null,
  page_config: { style: "editorial", welcomeMessage: "Os esperamos", venue: "Finca El Olivar", address: "", time: "17:30" },
});
const patch = (p: Partial<SitePatch>): SitePatch => ({ ...EMPTY_SITE_PATCH, ...p });

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("VINKLO_AI_EDITOR", "");
  vi.stubEnv("VINKLO_AI_EDITOR_MODEL", "");
  mocks.generateText.mockReset();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.ip.mockResolvedValue("203.0.113.9");
  mocks.client.mockReset().mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) } });
});
afterEach(() => vi.unstubAllEnvs());

describe("proposeSiteEdit (con sesión)", () => {
  it("devuelve el documento propuesto validado y el resumen, sin guardar nada", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "natural", coverWelcomeMessage: "¡Venid a celebrarlo!", summary: "Ponemos colores verdes y una bienvenida nueva." }) });
    const result = await proposeSiteEdit({ instruction: "poned el fondo más verde y cambiad la bienvenida", document });
    expect(result).toMatchObject({ ok: true, summary: "Ponemos colores verdes y una bienvenida nueva.", changes: ["los colores (Natural)", "el mensaje de bienvenida"] });
    if (!result.ok) return;
    expect(result.document.palette).toBe("natural");
    expect(findScene(result.document, "cover")?.props.welcomeMessage).toBe("¡Venid a celebrarlo!");

    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.model).toBe("google/gemini-2.5-flash");
    expect(call.prompt).toContain("poned el fondo más verde");
    expect(call.prompt).toContain('"partnerName1":"Ana"');
    expect(call.output.schema).toBeDefined();
    expect(call.providerOptions.gateway.user).toMatch(/^[0-9a-f]{32}$/);
    expect(call.providerOptions.gateway.user).not.toContain("user-a");
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-h", "user-a", 20, 3600);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-d", "user-a", 60, 86_400);
  });

  it("con algo seleccionado en la vista previa, el foco va dentro de la petición de la pareja", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ coverWelcomeMessage: "Os esperamos con muchas ganas", summary: "Cambiamos la bienvenida." }) });
    const result = await proposeSiteEdit({ instruction: "más cercana", document, focus: "en la sección «Portada», el campo «Bienvenida» (ahora: «Os esperamos»)" });
    expect(result.ok).toBe(true);
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.prompt).toContain("<<<\nLa pareja ha seleccionado: en la sección «Portada», el campo «Bienvenida» (ahora: «Os esperamos»); cambia solo eso salvo que pida otra cosa.\nmás cercana\n>>>");
    expect(call.instructions).toContain("cambia solo esa parte");
  });

  it("sin foco el prompt no cambia", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "mar", summary: "Azul." }) });
    await proposeSiteEdit({ instruction: "en azul", document });
    expect(mocks.generateText.mock.calls[0]![0].prompt).not.toContain("ha seleccionado");
  });

  it("explica lo descartado por inventar un lugar", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ venueName: "Palacio de Cristal", rsvpTitle: "¿Venís?", summary: "Cambiamos el lugar y el título." }) });
    const result = await proposeSiteEdit({ instruction: "buscad un lugar más elegante y cambiad el título de confirmar", document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "venue")?.props.venue).toBe("Finca El Olivar");
    expect(result.dropped).toEqual(["el nombre del lugar"]);
    expect(result.summary).toContain("No hemos cambiado el nombre del lugar");
  });

  it("sin cambios aplicables devuelve error con la explicación del modelo", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ summary: "La fecha no se puede cambiar desde aquí; hacedlo en Ajustes." }) });
    // Sin clasificar (notPossible null): el resumen del modelo y, para no dejar un callejón sin salida, el atajo al contenido.
    expect(await proposeSiteEdit({ instruction: "cambiad la fecha al 3 de mayo", document })).toEqual({ ok: false, error: "La fecha no se puede cambiar desde aquí; hacedlo en Ajustes.", action: ACTION_CONTENT });
  });

  it("valida la petición y el documento antes de llamar al modelo", async () => {
    expect(await proposeSiteEdit({ instruction: "   ", document })).toEqual({ ok: false, error: "Contadnos qué queréis cambiar." });
    expect(await proposeSiteEdit({ instruction: "x".repeat(501), document })).toMatchObject({ ok: false, error: expect.stringContaining("500") });
    expect(await proposeSiteEdit({ instruction: 42, document })).toMatchObject({ ok: false });
    expect(await proposeSiteEdit({ instruction: "hola", document: { ...document, scenes: [] } })).toMatchObject({ ok: false, error: expect.stringContaining("No hemos podido leer") });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("sin sesión no llama al modelo", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: "La sesión ha caducado. Volved a entrar." });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("degrada sin gateway configurada, con el interruptor apagado o si la gateway falla", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL", "");
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: AI_UNAVAILABLE_ERROR });
    expect(mocks.rateLimit).not.toHaveBeenCalled();

    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("VINKLO_AI_EDITOR", "off");
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: AI_UNAVAILABLE_ERROR });

    vi.stubEnv("VINKLO_AI_EDITOR", "");
    mocks.generateText.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { name: "GatewayAuthenticationError", statusCode: 401 }));
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: AI_UNAVAILABLE_ERROR });
  });

  it("límite de uso agotado (o RPC caída: fail-closed) no llama al modelo", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: AI_RATE_ERROR });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("tope global de gasto diario (H15): agotado, incluso con cuota individual libre, no llama al modelo", async () => {
    // El límite por usuario pasa; solo el tope global ("ai-edit-global-d") falla.
    mocks.rateLimit.mockImplementation(async (action: string) => action !== "ai-edit-global-d");
    // No culpa a la pareja (plan 4.6): «ahora no podemos» y cómo hacerlo a mano.
    expect(await proposeSiteEdit({ instruction: "hola", document })).toEqual({ ok: false, error: AI_BUSY_ERROR, action: ACTION_CONTENT });
    expect(AI_BUSY_ERROR).not.toMatch(/habéis pedido/i);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-global-d", "all", 300, 86_400);
  });

  it("el tope global se comprueba también en /crear (anónimo) y es configurable por env", async () => {
    vi.stubEnv("VINKLO_AI_EDITOR_DAILY_BUDGET", "50");
    mocks.generateText.mockResolvedValue({ output: patch({ summary: "ok" }) });
    await proposeDraftSiteEdit({ instruction: "hola", document });
    // /crear usa su propia bolsa (un tercio) y no toca la de las parejas con sesión.
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-global-d:anon", "all", 16, 86_400);
    expect(mocks.rateLimit).not.toHaveBeenCalledWith("ai-edit-global-d", "all", expect.anything(), 86_400);
  });

  it("agotar la bolsa anónima no bloquea a las parejas con sesión", async () => {
    mocks.rateLimit.mockImplementation(async (action: string) => action !== "ai-edit-global-d:anon");
    expect(await proposeDraftSiteEdit({ instruction: "hola", document })).toMatchObject({ ok: false, error: AI_BUSY_ERROR });
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "natural", summary: "Colores verdes." }) });
    expect(await proposeSiteEdit({ instruction: "hola", document })).toMatchObject({ ok: true });
  });

  it("un fallo de la gateway no deja la instrucción ni el documento en los logs", async () => {
    const secretInstruction = "cambiad el texto a Rocío y Fernando, 14 de marzo";
    mocks.generateText.mockRejectedValue(Object.assign(new Error("boom"), { name: "AI_APICallError", statusCode: 500 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await proposeSiteEdit({ instruction: secretInstruction, document });
    expect(errorSpy).toHaveBeenCalledWith("[ai] site edit failed", "AI_APICallError", 500);
    const loggedText = errorSpy.mock.calls.flat().map((arg) => JSON.stringify(arg)).join(" ");
    expect(loggedText).not.toContain(secretInstruction);
    expect(loggedText).not.toContain(JSON.stringify(document));
    expect(loggedText).not.toContain("Ana");
    errorSpy.mockRestore();
  });
});

describe("proposeDraftSiteEdit (/crear, sin cuenta)", () => {
  it("funciona sin sesión, limita por IP y nunca toca Supabase", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "rosa", summary: "Colores rosa empolvado." }) });
    const result = await proposeDraftSiteEdit({ instruction: "más rosa", document });
    expect(result).toMatchObject({ ok: true, summary: "Colores rosa empolvado." });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-anon-h", "203.0.113.9", 8, 3600);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-edit-anon-d", "203.0.113.9", 20, 86_400);
    expect(mocks.generateText.mock.calls[0]![0].providerOptions.gateway.tags).toContain("surface:crear");
  });
});

describe("configuración", () => {
  it("detecta la gateway por clave, token OIDC o ejecución en Vercel", () => {
    expect(isAiEditorConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isAiEditorConfigured({ AI_GATEWAY_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isAiEditorConfigured({ VERCEL_OIDC_TOKEN: "t" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isAiEditorConfigured({ VERCEL: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isAiEditorConfigured({ VERCEL: "1", VINKLO_AI_EDITOR: "off" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("modelo por defecto y override validado", () => {
    expect(siteEditorModel({} as NodeJS.ProcessEnv)).toBe("google/gemini-2.5-flash");
    expect(siteEditorModel({ VINKLO_AI_EDITOR_MODEL: "anthropic/claude-sonnet-5" } as unknown as NodeJS.ProcessEnv)).toBe("anthropic/claude-sonnet-5");
    expect(siteEditorModel({ VINKLO_AI_EDITOR_MODEL: "bad model; drop" } as unknown as NodeJS.ProcessEnv)).toBe("google/gemini-2.5-flash");
  });
});

describe("contenido de las secciones (plan 4.5)", () => {
  it("«añade una pregunta frecuente sobre el aparcamiento» crea la sección y lo explica sin jerga", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({
      faq: { title: null, contact: null, items: [{ id: null, question: "¿Hay aparcamiento?", answer: "" }] },
      summary: "Añadimos la escena de preguntas con la del aparcamiento.",
    }) });
    const result = await proposeSiteEdit({ instruction: "añade una pregunta frecuente sobre el aparcamiento", document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "faq")?.props.items).toEqual([{ id: "q-1", question: "¿Hay aparcamiento?", answer: "" }]);
    expect(result.changes).toEqual(["Preguntas: sección nueva", "Preguntas: + ¿Hay aparcamiento?"]);
    expect(result.summary).toBe("Añadimos la sección de preguntas con la del aparcamiento. Escribid la respuesta a «¿Hay aparcamiento?» en Vuestro contenido.");
    expect(result.action).toEqual(ACTION_CONTENT);
    expect(`${result.summary} ${result.changes.join(" ")}`).not.toMatch(/escena/i);
  });

  it("lo imposible se explica con qué hacer y un atajo, aunque el modelo no diga nada útil", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ notPossible: ["date"], summary: "No podemos." }) });
    expect(await proposeSiteEdit({ instruction: "cambiad la fecha al 3 de mayo", document })).toEqual({
      ok: false,
      error: "La fecha no se cambia con la IA: cambiadla en «Los datos», más abajo en esta página.",
      action: ACTION_SETTINGS,
    });
  });

  it("lo imposible se suma al resumen cuando el resto sí se aplica", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "rosa", notPossible: ["photo"], summary: "Ponemos el rosa." }) });
    const result = await proposeSiteEdit({ instruction: "más rosa y cambiad la foto", document });
    expect(result).toMatchObject({ ok: true, summary: "Ponemos el rosa. La foto no se cambia con la IA: subid otra en «La foto», arriba en esta página.", action: { target: "la-foto" } });
  });

  it("un error de límites que habla de escenas se traduce", async () => {
    const crowded = { ...document, scenes: [...document.scenes, ...Array.from({ length: 14 - document.scenes.length }, (_, i) => ({ id: `fotos-${i + 1}`, type: "gallery" as const, enabled: true, props: { title: "", images: [] } }))] };
    mocks.generateText.mockResolvedValue({ output: patch({ faq: { title: null, contact: null, items: [{ id: null, question: "¿Hay aparcamiento?", answer: "" }] } }) });
    expect(await proposeSiteEdit({ instruction: "añade una pregunta sobre el aparcamiento", document: crowded })).toEqual({ ok: false, error: AI_TOO_MANY_SECTIONS_ERROR, action: ACTION_CONTENT });
  });

  it("en /crear (sin cuenta) el contenido SÍ se cambia (13-oct-2026): programa y preguntas", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({
      agendaItems: [{ id: null, timeLabel: "12:00", title: "Ceremonia", place: "Iglesia de San Juan" }, { id: null, timeLabel: "23:00", title: "Baile", place: "" }],
      faq: { title: null, contact: null, items: [{ id: null, question: "¿Hay aparcamiento?", answer: "Sí, en la propia finca." }] },
      summary: "Añadimos el programa y una pregunta.",
    }) });
    const result = await proposeDraftSiteEdit({ instruction: "ceremonia a las 12:00 en la Iglesia de San Juan, baile a las 23:00 y una pregunta del aparcamiento: sí, en la propia finca", document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "agenda")?.props.items.map((i) => `${i.timeLabel} ${i.title}`)).toEqual(["12:00 Ceremonia", "23:00 Baile"]);
    expect(findScene(result.document, "faq")?.props.items[0]).toMatchObject({ question: "¿Hay aparcamiento?", answer: "Sí, en la propia finca." });
    // Sin atajos al panel: en el creador no existen esos apartados.
    expect(result.action).toBeUndefined();
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.instructions).not.toContain("deja agendaItems, story, details, faq, transport y stay en null");
    expect(call.instructions).toContain("nunca historia");
  });

  it("en /crear, lo que no se puede se dice con los textos del creador (sin atajos al panel)", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ notPossible: ["names"], summary: "" }) });
    const result = await proposeDraftSiteEdit({ instruction: "cambiad mi nombre", document, scope: "creator" });
    expect(result).toEqual({ ok: false, error: "Los nombres no se cambian con la IA: escribidlos en su paso del creador." });
  });

  it("un cliente anterior del creador (ámbito «design») sigue sin tocar el contenido y lo dice", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ faq: { title: null, contact: null, items: [{ id: null, question: "¿Hay aparcamiento?", answer: "" }] }, summary: "" }) });
    const result = await proposeDraftSiteEdit({ instruction: "añade una pregunta sobre el aparcamiento", document, scope: "design" });
    expect(result).toEqual({ ok: false, error: "Preguntas: lo podréis añadir cuando hayáis creado la web, desde Vuestro contenido (o pedírselo a la IA allí)." });
    expect(mocks.generateText.mock.calls[0]![0].instructions).toContain("deja agendaItems, story, details, faq, transport y stay en null");
  });

  it("quitar el sobre o volver a la Story no se hace y se explica (panel y creador)", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ layout: "historia", opening: "ninguno", summary: "Quitamos el sobre." }) });
    const panel = await proposeSiteEdit({ instruction: "sin sobre y como una story", document: { ...document, layout: "web" } });
    expect(panel).toEqual({ ok: false, error: "«Como una Story» no se activa desde el chat: elegidla a mano en «La forma». La invitación siempre se abre con el sobre: eso no se cambia." });
    const creator = await proposeDraftSiteEdit({ instruction: "sin sobre", document: { ...document, layout: "web" }, scope: "creator" });
    expect(creator).toMatchObject({ ok: false, error: expect.stringContaining("«Como una Story» no se activa desde el chat.") });

    mocks.generateText.mockResolvedValue({ output: patch({ palette: "rosa", opening: "ninguno", summary: "Ponemos rosa." }) });
    const mixed = await proposeSiteEdit({ instruction: "rosa y sin sobre", document });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.document.palette).toBe("rosa");
    expect("opening" in mixed.document).toBe(false);
    expect(mixed.summary).toBe("Ponemos rosa. La invitación siempre se abre con el sobre: eso no se cambia.");
  });

  it("el creador con sesión puede pedir el ámbito «design»", async () => {
    mocks.generateText.mockResolvedValue({ output: patch({ palette: "mar", stay: { title: null, intro: null, hotels: [{ id: null, name: "Hotel Sol", note: "", code: "", link: null }] }, summary: "Azul mar." }) });
    const result = await proposeSiteEdit({ instruction: "azul mar y el hotel sol", document, scope: "design" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findScene(result.document, "stay")).toBeUndefined();
    expect(result.summary).toContain("Alojamiento: lo podréis añadir");
  });

  it("el prompt no lleva fotos y el coste se registra sin datos personales", async () => {
    const withPhoto = { ...document, scenes: document.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: { url: "https://cdn.example.com/secreta.jpg", alt: "" } } } : s)) };
    mocks.generateText.mockResolvedValue({
      output: patch({ palette: "oro", summary: "Oro viejo." }),
      usage: { inputTokens: 4000, outputTokens: 500, inputTokenDetails: { cacheReadTokens: 0 }, outputTokenDetails: { reasoningTokens: 200 } },
      providerMetadata: { gateway: { cost: "0.0025" } },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const instruction = "colores oro para Ana y Luis";
    expect((await proposeSiteEdit({ instruction, document: withPhoto })).ok).toBe(true);
    expect(mocks.generateText.mock.calls[0]![0].prompt).not.toContain("secreta.jpg");
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[ai] usage"));
    expect(line).toBeDefined();
    const data = JSON.parse(line!.replace("[ai] usage ", ""));
    expect(data).toMatchObject({ feature: "site-editor", surface: "panel", model: "google/gemini-2.5-flash", in: 4000, out: 500, reasoning: 200, priceKnown: true, gatewayUsd: 0.0025 });
    expect(data.eur).toBeGreaterThan(0);
    expect(line).not.toContain("Ana");
    expect(line).not.toContain(instruction);
    info.mockRestore();
  });
});
