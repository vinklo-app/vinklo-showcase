/**
 * Coste estimado de cada llamada a la IA en euros (plan 4.6, sin presupuesto
 * en la interfaz todavía). Puro salvo `logAiUsage`, que escribe una línea en
 * el log del servidor SIN datos personales: ni petición, ni documento, ni
 * usuario; solo función, superficie, modelo, tokens y euros.
 *
 * PRECIOS POR VERIFICAR. Precios de lista de Google para Gemini (texto, por
 * millón de tokens, USD), tal como los conocíamos el 8-oct-2026. La AI Gateway
 * de Vercel factura a precio de lista del proveedor, pero confirmadlo en
 * https://vercel.com/ai-gateway/models y en https://ai.google.dev/pricing
 * antes de usar estas cifras para un presupuesto. El razonamiento («thinking»)
 * se cobra como salida: el SDK ya lo incluye en `outputTokens`.
 */

export interface ModelPrice {
  /** USD por millón de tokens de entrada (sin caché). */
  inputUsdPerM: number;
  /** USD por millón de tokens de entrada leídos de caché. */
  cachedInputUsdPerM: number;
  /** USD por millón de tokens de salida (incluye razonamiento). */
  outputUsdPerM: number;
  /** Tarifa de peticiones largas: por encima de `aboveInputTokens` de entrada, toda la llamada va a `price`. */
  longPrompt?: { aboveInputTokens: number; price: Omit<ModelPrice, "longPrompt"> };
}

/**
 * Claude: precios de lista de Anthropic verificados el 25-oct-2026 en
 * https://platform.claude.com/docs/en/about-claude/pricing (caché = «cache hits
 * and refreshes»). Gemini: por verificar (8-oct-2026).
 */
export const AI_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5-5": { inputUsdPerM: 2, cachedInputUsdPerM: 0.1, outputUsdPerM: 10 },
  "claude-haiku-5-5": {
    inputUsdPerM: 0.1, cachedInputUsdPerM: 0.01, outputUsdPerM: 0.5,
    longPrompt: { aboveInputTokens: 100_000, price: { inputUsdPerM: 0.5, cachedInputUsdPerM: 0.05, outputUsdPerM: 2.5 } },
  },
  "google/gemini-2.5-flash": { inputUsdPerM: 0.3, cachedInputUsdPerM: 0.075, outputUsdPerM: 2.5 },
  "google/gemini-2.5-flash-lite": { inputUsdPerM: 0.1, cachedInputUsdPerM: 0.025, outputUsdPerM: 0.4 },
};

/** Modelo desconocido: no se inventa una tarifa (priceKnown: false). */

/** Cambio USD → EUR. Por verificar (8-oct-2026); actualizadlo cuando haya presupuesto (D7). */
export const USD_TO_EUR = 0.86;

/** Lo que nos interesa de `LanguageModelUsage` del AI SDK (todo opcional: algunos proveedores no lo dan). */
export interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}

export interface AiCostEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  usd: number | null;
  eur: number | null;
  /** false = precio desconocido; usd y eur son null. */
  priceKnown: boolean;
}

const count = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function estimateAiCost(model: string, usage: UsageLike | undefined | null): AiCostEstimate {
  const price = AI_MODEL_PRICES[model];
  const inputTokens = count(usage?.inputTokens);
  const p = price?.longPrompt && inputTokens > price.longPrompt.aboveInputTokens ? price.longPrompt.price : price;
  const outputTokens = count(usage?.outputTokens);
  const cachedInputTokens = Math.min(count(usage?.inputTokenDetails?.cacheReadTokens), inputTokens);
  const reasoningTokens = count(usage?.outputTokenDetails?.reasoningTokens);
  const usd = p ? ((inputTokens - cachedInputTokens) * p.inputUsdPerM + cachedInputTokens * p.cachedInputUsdPerM + outputTokens * p.outputUsdPerM) / 1_000_000 : null;
  return { model, inputTokens, outputTokens, reasoningTokens, cachedInputTokens, usd, eur: usd === null ? null : usd * USD_TO_EUR, priceKnown: Boolean(price) };
}

/** Euros con 6 decimales (una llamada cuesta fracciones de céntimo). */
export function estimateAiCostEur(model: string, usage: UsageLike | undefined | null): number | null {
  const eur = estimateAiCost(model, usage).eur;
  return eur === null ? null : Math.round(eur * 1e6) / 1e6;
}

export interface AiUsageLog {
  feature: "site-editor" | "idea-reader" | "story-polish" | "floor-plan" | "seating-explain" | "crm-assistant";
  provider?: "anthropic" | "gateway";
  surface?: string;
  model: string;
  usage: UsageLike | undefined | null;
  /** `providerMetadata.gateway.cost` si la gateway lo devuelve (USD, texto). */
  gatewayCostUsd?: unknown;
}

/** Línea de log estructurada, sin datos personales. Nunca lanza. */
export function logAiUsage(entry: AiUsageLog, log: (line: string) => void = console.info): AiCostEstimate | null {
  try {
    const estimate = estimateAiCost(entry.model, entry.usage);
    const gateway = typeof entry.gatewayCostUsd === "string" || typeof entry.gatewayCostUsd === "number" ? Number(entry.gatewayCostUsd) : undefined;
    log(`[ai] usage ${JSON.stringify({
      feature: entry.feature,
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.surface ? { surface: entry.surface } : {}),
      model: estimate.model,
      in: estimate.inputTokens,
      out: estimate.outputTokens,
      reasoning: estimate.reasoningTokens,
      cached: estimate.cachedInputTokens,
      eur: estimate.eur === null ? null : Math.round(estimate.eur * 1e6) / 1e6,
      priceKnown: estimate.priceKnown,
      ...(gateway !== undefined && Number.isFinite(gateway) ? { gatewayUsd: gateway } : {}),
    })}`);
    return estimate;
  } catch {
    return null;
  }
}

/** Coste devuelto por la gateway en `providerMetadata`, si viene. */
export function gatewayCost(providerMetadata: unknown): unknown {
  const gateway = (providerMetadata as { gateway?: { cost?: unknown } } | null | undefined)?.gateway;
  return gateway?.cost;
}
