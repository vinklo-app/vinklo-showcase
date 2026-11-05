import { describe, expect, it, vi } from "vitest";
import { AI_MODEL_PRICES, USD_TO_EUR, estimateAiCost, estimateAiCostEur, gatewayCost, logAiUsage } from "./cost";

describe("estimateAiCost", () => {
  it("calcula euros con la tabla de precios (entrada, caché y salida)", () => {
    const flash = AI_MODEL_PRICES["google/gemini-2.5-flash"]!;
    const e = estimateAiCost("google/gemini-2.5-flash", { inputTokens: 1_000_000, outputTokens: 100_000, inputTokenDetails: { cacheReadTokens: 200_000 }, outputTokenDetails: { reasoningTokens: 40_000 } });
    const usd = 0.8 * flash.inputUsdPerM + 0.2 * flash.cachedInputUsdPerM + 0.1 * flash.outputUsdPerM;
    expect(e.usd).toBeCloseTo(usd, 10);
    expect(e.eur).toBeCloseTo(usd * USD_TO_EUR, 10);
    expect(e).toMatchObject({ inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 200_000, reasoningTokens: 40_000, priceKnown: true });
  });

  it("Flash-Lite es más barato que Flash para el mismo uso", () => {
    const usage = { inputTokens: 5000, outputTokens: 800 };
    expect(estimateAiCostEur("google/gemini-2.5-flash-lite", usage)).toBeLessThan(estimateAiCostEur("google/gemini-2.5-flash", usage)!);
  });

  it("Claude Haiku 5.5: tarifa normal hasta 100.000 tokens de entrada y larga por encima", () => {
    const short = estimateAiCost("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 10_000, inputTokenDetails: { cacheReadTokens: 50_000 } });
    // 50.000 × 0,10 + 50.000 × 0,01 + 10.000 × 0,50 (USD por millón)
    expect(short.usd).toBeCloseTo((50_000 * 0.1 + 50_000 * 0.01 + 10_000 * 0.5) / 1_000_000, 10);
    expect(short.priceKnown).toBe(true);
    const long = estimateAiCost("claude-haiku-5-5", { inputTokens: 200_000, outputTokens: 10_000 });
    expect(long.usd).toBeCloseTo((200_000 * 0.5 + 10_000 * 2.5) / 1_000_000, 10);
  });
  it("Claude Sonnet 5.5: la caché cuesta 0,10 USD por millón", () => {
    const e = estimateAiCost("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 1_000_000 } });
    expect(e.usd).toBeCloseTo(0.1, 10);
  });
  it("modelo desconocido: precio desconocido y priceKnown false; sin uso: 0", () => {
    expect(estimateAiCost("anthropic/otro", { inputTokens: 1000, outputTokens: 100 })).toMatchObject({ priceKnown: false });
    expect(estimateAiCost("anthropic/otro", { inputTokens: 1000, outputTokens: 100 }).eur).toBeNull();
    expect(estimateAiCostEur("google/gemini-2.5-flash", undefined)).toBe(0);
    expect(estimateAiCostEur("google/gemini-2.5-flash", { inputTokens: Number.NaN, outputTokens: -5 })).toBe(0);
  });
});

describe("logAiUsage", () => {
  it("una línea JSON con función, modelo, tokens y euros; nada más", () => {
    const log = vi.fn();
    logAiUsage({ feature: "story-polish", surface: "crear", model: "google/gemini-2.5-flash-lite", usage: { inputTokens: 300, outputTokens: 200 }, gatewayCostUsd: "0.0001" }, log);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line.startsWith("[ai] usage ")).toBe(true);
    const data = JSON.parse(line.slice("[ai] usage ".length));
    expect(Object.keys(data).sort()).toEqual(["cached", "eur", "feature", "gatewayUsd", "in", "model", "out", "priceKnown", "reasoning", "surface"]);
    expect(data).toMatchObject({ feature: "story-polish", in: 300, out: 200, gatewayUsd: 0.0001 });
  });

  it("nunca lanza", () => {
    expect(() => logAiUsage({ feature: "site-editor", model: "x/y", usage: null }, () => { throw new Error("log roto"); })).not.toThrow();
  });

  it("gatewayCost lee providerMetadata.gateway.cost si viene", () => {
    expect(gatewayCost({ gateway: { cost: "0.01" } })).toBe("0.01");
    expect(gatewayCost(undefined)).toBeUndefined();
  });
});
