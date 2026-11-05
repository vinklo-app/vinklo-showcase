import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storyChapterSchema } from "@/lib/site-document";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), client: vi.fn(), rateLimit: vi.fn(), ip: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText, Output: { object: (opts: unknown) => ({ kind: "object", ...(opts as object) }) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: mocks.ip, keyedHash: (v: string) => createHash("sha256").update(`t${v}`).digest("hex") }));
import { polishStoryAnswers } from "./actions";
import { parseStoryAnswers, storyChaptersFromAnswers, STORY_ERRORS, vetPolishedChapters } from "./story-chapters";

const answers = [
  { question: "¿Cómo os conocisteis?", answer: "En la uni, en 2015, en clase de Física en Granada" },
  { question: "¿Cuándo supisteis que era para siempre?", answer: "en un viaje a Lisboa" },
];

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("VINKLO_AI_EDITOR", "");
  mocks.generateText.mockReset();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.ip.mockReset().mockResolvedValue("203.0.113.9");
  mocks.client.mockReset().mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
});
afterEach(() => vi.unstubAllEnvs());

describe("parseStoryAnswers", () => {
  it("acepta 2–3 respuestas (texto o {question, answer}) e ignora las vacías", () => {
    expect(parseStoryAnswers(["uno", { answer: "dos" }, { answer: "  " }])).toEqual({ ok: true, answers: [{ answer: "uno" }, { answer: "dos" }] });
    expect(parseStoryAnswers(["solo una"])).toEqual({ ok: false, error: STORY_ERRORS.few });
    expect(parseStoryAnswers(["a", "b", "c", "d"])).toEqual({ ok: false, error: STORY_ERRORS.many });
    expect(parseStoryAnswers(["a", "x".repeat(501)])).toEqual({ ok: false, error: STORY_ERRORS.long });
    expect(parseStoryAnswers("no es una lista")).toEqual({ ok: false, error: STORY_ERRORS.few });
  });
});

describe("vetPolishedChapters", () => {
  it("acepta el texto pulido sin datos nuevos y conserva el orden y los ids", () => {
    const { chapters, replaced } = vetPolishedChapters([
      { title: "Entre apuntes", body: "Nos conocimos en 2015 en clase de Física, en Granada." },
      { title: "Para siempre", body: "Lo supimos en un viaje a Lisboa." },
    ], answers);
    expect(replaced).toBe(0);
    expect(chapters.map((c) => [c.id, c.title])).toEqual([["c-1", "Entre apuntes"], ["c-2", "Para siempre"]]);
    for (const c of chapters) expect(storyChapterSchema.safeParse(c).success).toBe(true);
  });

  it("sustituye por el texto de la pareja lo que trae fechas, lugares o nombres inventados", () => {
    const { chapters, replaced } = vetPolishedChapters([
      { title: "Granada, 2016", body: "Nos conocimos en 2016 en la Alhambra." },
      { title: "Lisboa", body: "Lo supimos en Lisboa, junto a Marta." },
    ], answers);
    expect(replaced).toBe(2);
    expect(chapters[0]).toMatchObject({ title: "", body: "En la uni, en 2015, en clase de Física en Granada" });
    expect(chapters[1]).toMatchObject({ title: "Lisboa", body: "en un viaje a Lisboa" });
  });

  it("los nombres de la pareja se pueden nombrar si se pasan como contexto", () => {
    expect(vetPolishedChapters([{ title: "", body: "Ana y Luis se conocieron en Granada." }, { title: "", body: "En Lisboa." }], answers, ["Ana", "Luis"]).replaced).toBe(0);
    expect(vetPolishedChapters([{ title: "", body: "Ana y Luis se conocieron en Granada." }, { title: "", body: "En Lisboa." }], answers).replaced).toBe(1);
  });

  it("si faltan capítulos, se completan con el texto de la pareja; los textos largos se recortan al límite", () => {
    const long = [{ answer: "a ".repeat(240).trim() }, { answer: "b" }];
    const { chapters, replaced } = vetPolishedChapters([{ title: "T".repeat(120), body: "a ".repeat(400).trim() }], long);
    expect(replaced).toBe(1);
    expect(chapters[0]!.title.length).toBeLessThanOrEqual(80);
    expect(chapters[0]!.body.length).toBeLessThanOrEqual(600);
    expect(chapters[1]).toMatchObject({ id: "c-2", title: "", body: "b" });
  });

  it("storyChaptersFromAnswers: capítulos válidos sin IA", () => {
    expect(storyChaptersFromAnswers(answers)).toEqual([
      { id: "c-1", title: "", body: answers[0]!.answer, images: [] },
      { id: "c-2", title: "", body: answers[1]!.answer, images: [] },
    ]);
  });
});

describe("polishStoryAnswers (server action)", () => {
  it("pule con la IA, limita por IP sin sesión y registra el coste", async () => {
    mocks.generateText.mockResolvedValue({ output: { chapters: [{ title: "Entre apuntes", body: "Nos conocimos en la uni, en 2015." }, { title: "Lisboa", body: "Lo supimos en Lisboa." }] }, usage: { inputTokens: 300, outputTokens: 120 } });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await polishStoryAnswers({ answers });
    expect(result).toMatchObject({ ok: true, polished: true, replaced: 0 });
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-story-h", "ip:203.0.113.9", 6, 3600);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-story-global-d:anon", "all", 100, 86_400);
    expect(mocks.rateLimit).not.toHaveBeenCalledWith("ai-story-global-d", "all", expect.anything(), 86_400);
    expect(mocks.generateText.mock.calls[0]![0].model).toBe("google/gemini-2.5-flash-lite");
    expect(mocks.generateText.mock.calls[0]![0].providerOptions.gateway.user).not.toContain("203.0.113.9");
    expect(info.mock.calls.some((c) => String(c[0]).includes('"feature":"story-polish"'))).toBe(true);
    info.mockRestore();
  });

  it("con sesión limita por usuario", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) } });
    mocks.generateText.mockResolvedValue({ output: { chapters: [] } });
    await polishStoryAnswers({ answers });
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-story-h", "user:user-a", 6, 3600);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-story-global-d", "all", 300, 86_400);
    expect(mocks.ip).not.toHaveBeenCalled();
  });

  it("sin IA, sin cuota o si falla: devuelve el texto de la pareja tal cual (nunca bloquea)", async () => {
    const plain = { ok: true, chapters: storyChaptersFromAnswers(answers), polished: false, replaced: 0 };
    mocks.rateLimit.mockResolvedValue(false);
    expect(await polishStoryAnswers({ answers })).toEqual(plain);
    mocks.rateLimit.mockResolvedValue(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateText.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    expect(await polishStoryAnswers({ answers })).toEqual(plain);
    error.mockRestore();
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL", "");
    expect(await polishStoryAnswers({ answers })).toEqual(plain);
  });

  it("entrada no válida: error sin llamar al modelo", async () => {
    expect(await polishStoryAnswers({ answers: ["solo una"] })).toEqual({ ok: false, error: STORY_ERRORS.few });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
