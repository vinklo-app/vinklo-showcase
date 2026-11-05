/** Server-only provider boundary. A Claude ID never goes through AI Gateway. */
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";

export type AiProvider = "anthropic" | "gateway";
export type AiFeature = "site-editor" | "idea-reader" | "story-polish" | "floor-plan" | "seating-explain" | "crm-assistant";
const MODELS: Record<AiFeature, { env: string; anthropic: string; gateway: string }> = {
  "site-editor": { env: "VINKLO_AI_EDITOR_MODEL", anthropic: "claude-sonnet-5-5", gateway: "google/gemini-2.5-flash" },
  "idea-reader": { env: "VINKLO_AI_IDEA_MODEL", anthropic: "claude-haiku-5-5", gateway: "google/gemini-2.5-flash-lite" },
  "story-polish": { env: "VINKLO_AI_STORY_MODEL", anthropic: "claude-haiku-5-5", gateway: "google/gemini-2.5-flash-lite" },
  "floor-plan": { env: "VINKLO_AI_VISION_MODEL", anthropic: "claude-sonnet-5-5", gateway: "google/gemini-2.5-flash" },
  "seating-explain": { env: "VINKLO_AI_SEATING_MODEL", anthropic: "claude-haiku-5-5", gateway: "google/gemini-2.5-flash-lite" },
  "crm-assistant": { env: "VINKLO_AI_CRM_MODEL", anthropic: "claude-haiku-5-5", gateway: "google/gemini-2.5-flash-lite" },
};

export function aiProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const selected = env.VINKLO_AI_PROVIDER?.trim();
  if (selected === "anthropic" || selected === "gateway") return selected;
  if (selected) throw new Error("Invalid AI provider configuration");
  return env.ANTHROPIC_API_KEY?.trim() ? "anthropic" : "gateway";
}

export function isAiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VINKLO_AI_EDITOR === "off") return false;
  try {
    return aiProvider(env) === "anthropic"
      ? Boolean(env.ANTHROPIC_API_KEY?.trim())
      : Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || env.VERCEL === "1");
  } catch { return false; }
}

/** Legacy provider/model overrides cannot select another billing path. */
export function aiModelId(feature: AiFeature, env: Record<string, string | undefined> = process.env): string {
  const provider = aiProvider(env);
  const defaults = MODELS[feature];
  const custom = env[defaults.env]?.trim();
  if (provider === "anthropic") {
    return custom && /^claude-[a-z0-9.-]+$/i.test(custom) ? custom : defaults.anthropic;
  }
  return custom && /^[a-z0-9-]+\/[a-z0-9.-]+$/i.test(custom) ? custom : defaults.gateway;
}

export function resolveAiModel(feature: AiFeature, env: Record<string, string | undefined> = process.env, fetch?: typeof globalThis.fetch) {
  if (!isAiConfigured(env)) throw new Error("AI provider is not configured");
  const provider = aiProvider(env);
  const modelId = aiModelId(feature, env);
  const model = provider === "anthropic"
    ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY!.trim(), ...(fetch ? { fetch } : {}) })(modelId)
    : modelId;
  return {
    provider,
    modelId,
    model,
    // Hashed attribution is gateway-only; direct Anthropic receives no account IDs.
    options: (user: string, surface: string) => provider === "gateway"
      ? { gateway: { user, tags: [`feature:${feature}`, `surface:${surface}`] } }
      : undefined,
  };
}
