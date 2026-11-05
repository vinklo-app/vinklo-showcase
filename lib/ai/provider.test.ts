import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
vi.mock("server-only", () => ({}));
import { aiModelId, aiProvider, isAiConfigured, resolveAiModel } from "./provider";

afterEach(() => vi.unstubAllEnvs());

describe("selección de proveedor", () => {
  it("elige Anthropic con clave, conserva gateway explícita y el modo heredado", () => {
    expect(aiProvider({ ANTHROPIC_API_KEY: "fake" })).toBe("anthropic");
    expect(aiProvider({ ANTHROPIC_API_KEY: "fake", VINKLO_AI_PROVIDER: "gateway" })).toBe("gateway");
    expect(aiProvider({ AI_GATEWAY_API_KEY: "fake" })).toBe("gateway");
  });
  it("Anthropic explícito sin clave no usa credenciales gateway ni OIDC", () => {
    const env = { VINKLO_AI_PROVIDER: "anthropic", AI_GATEWAY_API_KEY: "fake", VERCEL: "1" };
    expect(isAiConfigured(env)).toBe(false);
    expect(() => resolveAiModel("site-editor", env)).toThrow();
  });
  it("rechaza proveedor desconocido y respeta el apagado global", () => {
    expect(isAiConfigured({ VINKLO_AI_PROVIDER: "other", ANTHROPIC_API_KEY: "fake" })).toBe(false);
    expect(isAiConfigured({ VINKLO_AI_EDITOR: "off", ANTHROPIC_API_KEY: "fake" })).toBe(false);
  });
  it("en modo Anthropic ignora los modelos heredados de Google", () => {
    const env = { VINKLO_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake", VINKLO_AI_EDITOR_MODEL: "google/gemini-2.5-flash" };
    expect(aiModelId("site-editor", env)).toBe("claude-sonnet-5-5");
    expect(aiModelId("floor-plan", env)).toBe("claude-sonnet-5-5");
    for (const feature of ["idea-reader", "story-polish", "seating-explain", "crm-assistant"] as const) expect(aiModelId(feature, env)).toBe("claude-haiku-5-5");
    expect(aiModelId("site-editor", { ...env, VINKLO_AI_EDITOR_MODEL: "claude-custom-model" })).toBe("claude-custom-model");
  });
  it("mantiene modelos y atribución gateway sin cambiar de proveedor", () => {
    const config = resolveAiModel("site-editor", { AI_GATEWAY_API_KEY: "fake", VINKLO_AI_EDITOR_MODEL: "google/custom" });
    expect(config.model).toBe("google/custom");
    expect(config.provider).toBe("gateway");
    expect(config.options("hash", "panel")).toEqual({ gateway: { user: "hash", tags: ["feature:site-editor", "surface:panel"] } });
  });
  it("el SDK llama exclusivamente a Anthropic con cabecera y modelo directos (transporte simulado)", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({
      id: "msg_local", type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: [{ type: "text", text: "Respuesta simulada" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 8, output_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const config = resolveAiModel("site-editor", { VINKLO_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-only-fake-key" }, transport);
    expect(config.options("hash", "panel")).toBeUndefined();
    const result = await generateText({ model: config.model, prompt: "Prueba local", maxRetries: 0, maxOutputTokens: 40 });
    expect(result.text).toBe("Respuesta simulada");
    expect(transport).toHaveBeenCalledTimes(1);
    const [endpoint, request] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(endpoint)).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(request.headers);
    expect(headers.get("x-api-key")).toBe("test-only-fake-key");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(JSON.parse(String(request.body))).toMatchObject({ model: "claude-sonnet-5-5" });
  });
});
