import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La lectura de la frase de la landing con la IA simulada: nunca sale a la
 * red. Si la IA no está configurada, se pasa del límite o falla, la idea se
 * lee igual con patrones (el creador nunca se bloquea).
 */
const mocks = vi.hoisted(() => ({ generateText: vi.fn(), rateLimit: vi.fn(async () => true) }));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText, Output: { object: (opts: unknown) => ({ kind: "object", ...(opts as object) }) } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("./cost", () => ({ gatewayCost: () => undefined, logAiUsage: () => undefined }));

import { IDEA_READER_DEFAULT_MODEL, IDEA_SAME_TEXT_MAX, IDEA_UNAVAILABLE, ideaFingerprint, readBuilderIdeaCore } from "./idea-reader";

const idea = "Somos Elena y Marcos, nos casamos el 19 de junio de 2027 en la Finca Los Olivos con unos 90 invitados";
const ctx = { allow: async () => true, gatewayUser: "hash" };

beforeEach(() => {
  mocks.generateText.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockImplementation(async () => true);
});
afterEach(() => vi.unstubAllEnvs());

describe("readBuilderIdeaCore: frase de la landing", () => {
  it("sin IA configurada: lee con patrones y no llama al modelo", async () => {
    vi.stubEnv("VINKLO_AI_EDITOR", "off");
    const result = await readBuilderIdeaCore(idea, ctx);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion).toMatchObject({ partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-06-19" });
  });

  it("si la IA falla, devuelve la lectura por patrones (no un error)", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    mocks.generateText.mockRejectedValue(Object.assign(new Error("gateway down"), { statusCode: 503 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await readBuilderIdeaCore(idea, ctx);
    spy.mockRestore();
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion).toMatchObject({ partnerName1: "Elena", partnerName2: "Marcos" });
  });

  it("respeta el límite por IP: sin permiso no se llama al modelo", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const result = await readBuilderIdeaCore(idea, { ...ctx, allow: async () => false });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("respeta la bolsa global anónima", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    mocks.rateLimit.mockImplementation(async (...args: unknown[]) => args[0] !== "ai-idea-global-d:anon");
    await readBuilderIdeaCore(idea, ctx);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-idea-global-d:anon", "all", 200, 86_400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("con IA: usa el modelo configurado y solo pasa datos que están en el texto", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    mocks.generateText.mockResolvedValue({
      output: {
        partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-06-19", guestCount: 90,
        venue: "Finca Los Olivos", address: null, time: "21:30", style: "natural", palette: null,
        welcomeMessage: "Queremos celebrarlo contigo bajo los olivos.",
        bus: false, hotels: false, menu: false, kids: false, song: false, busStops: null, hotelNames: null,
      },
      usage: { inputTokens: 200, outputTokens: 80 },
    });
    const result = await readBuilderIdeaCore(idea, ctx);
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.model).toBe(IDEA_READER_DEFAULT_MODEL);
    expect(call.prompt).toContain(idea);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion).toMatchObject({ partnerName1: "Elena", partnerName2: "Marcos", weddingDate: "2027-06-19", venue: "Finca Los Olivos", style: "natural" });
    // «21:30» no aparece en la frase: no se inventa.
    expect(result.suggestion.time).toBeUndefined();
  });

  it("una frase demasiado corta no gasta una lectura", async () => {
    const result = await readBuilderIdeaCore("En mayo", ctx);
    expect(result).toEqual({ ok: false, error: IDEA_UNAVAILABLE });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});

describe("readBuilderIdeaCore: la misma frase no vacía la bolsa global (F7)", () => {
  it("límite por frase (normalizada) antes de la bolsa global; superado, patrones sin modelo ni bolsa", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    mocks.rateLimit.mockImplementation(async (...args: unknown[]) => args[0] !== "ai-idea-same-d");
    const result = await readBuilderIdeaCore(idea, ctx);
    expect(result.ok).toBe(true);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-idea-same-d", ideaFingerprint(idea), IDEA_SAME_TEXT_MAX, 86_400);
    expect(mocks.rateLimit).not.toHaveBeenCalledWith("ai-idea-global-d:anon", "all", 200, 86_400);
  });
  it("superado el límite por IP, ni se cuenta la frase ni la bolsa global", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    await readBuilderIdeaCore(idea, { ...ctx, allow: async () => false });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it("mayúsculas, tildes y espacios no cambian la clave", () => {
    expect(ideaFingerprint("  Somos ÉLENA   y Marcos ")).toBe(ideaFingerprint("somos elena y marcos"));
  });
});
