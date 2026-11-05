import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplainGroup, ExplainTable } from "@/lib/crm/seating-explain";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), rateLimit: vi.fn(), capture: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText, Output: { object: (opts: unknown) => ({ kind: "object", ...(opts as object) }) } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.capture }));
import { FLOOR_PLAN_ERRORS, buildExplainPrompt, explainSeatingCore, readFloorPlanCore } from "./seating-ai";

const allow = vi.fn(async () => true);
const ctx = { allow, gatewayUser: "hash" };
const table: ExplainTable = { tableId: "m1", groups: [{ size: 4, tags: ["Amigos de la uni"], side: "p1" }], dominantTags: ["Amigos de la uni"], sides: ["p1"] };

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("VINKLO_AI_SEATING", "");
  mocks.generateText.mockReset();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.capture.mockReset();
  allow.mockClear().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("anonimato de las explicaciones", () => {
  it("el tipo no admite nombres, notas ni alergias", () => {
    // @ts-expect-error: un grupo no lleva nombre.
    const withName: ExplainGroup = { size: 1, tags: [], side: null, name: "Ana López" };
    // @ts-expect-error: una mesa no lleva notas ni alergias.
    const withNotes: ExplainTable = { ...table, notes: "Celíaca" };
    expect(withName && withNotes).toBeTruthy();
  });
  it("el prompt rechaza en tiempo de ejecución cualquier campo de más (nombre, notas, alergias, id real)", () => {
    const leaks: unknown[] = [
      [{ ...table, groups: [{ ...table.groups[0], name: "Ana López" }] }],
      [{ ...table, groups: [{ ...table.groups[0], notes: "Celíaca" }] }],
      [{ ...table, groups: [{ ...table.groups[0], allergies: "Marisco" }] }],
      [{ ...table, name: "Mesa de los primos" }],
      [{ ...table, tableId: "00000000-0000-4000-9000-000000000001" }],
      [{ ...table, groups: [{ ...table.groups[0], guests: [{ name: "Ana" }] }] }],
    ];
    for (const input of leaks) expect(() => buildExplainPrompt(input)).toThrow();
    const prompt = buildExplainPrompt([table]);
    expect(prompt).toContain("Amigos de la uni");
    expect(prompt).not.toMatch(/name|notes|allerg/i);
  });
  it("las etiquetas de salud, dieta o discapacidad nunca llegan al prompt", () => {
    const sensitive = ["Alérgicos", "CELÍACOS", "Intolerantes a la lactosa", "Vegana", "Vegetarianos", "Diabética", "Embarazada", "Sin gluten", "Medicación", "Enfermos", "Discapacidad", "alergia marisco"];
    const prompt = buildExplainPrompt([{ ...table, groups: [{ size: 3, tags: [...sensitive.slice(0, 6), "Amigos de la uni"], side: "p1" }, { size: 2, tags: sensitive.slice(6), side: null }], dominantTags: ["Celíacos", "Amigos de la uni"] }]);
    expect(prompt).toContain("Amigos de la uni");
    for (const tag of sensitive) expect(prompt.toLowerCase()).not.toContain(tag.toLowerCase());
    expect(JSON.parse(prompt.split("\n")[1]!)[0].dominantTags).toEqual(["Amigos de la uni"]);
  });
  it("con datos con nombre no llama a la IA", async () => {
    const result = await explainSeatingCore([{ ...table, groups: [{ ...table.groups[0], name: "Ana López" }] }], ctx);
    expect(result).toEqual({ ok: false });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});

describe("explainSeatingCore", () => {
  it("devuelve una frase por alias conocido, limpia y sin nombres de la pareja", async () => {
    mocks.generateText.mockResolvedValue({
      output: { tables: [
        { tableId: "m1", text: "Juntamos a «Amigos de la uni», invitados de {p1}." },
        { tableId: "m9", text: "Alias que no existe." },
        { tableId: "m1", text: "Repetida." },
      ] },
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const result = await explainSeatingCore([table], ctx);
    expect(result).toEqual({ ok: true, explanations: { m1: "Juntamos a «Amigos de la uni», invitados de {p1}." } });
    const call = mocks.generateText.mock.calls[0]![0] as { prompt: string; model: string; timeout: number };
    expect(call.prompt).toContain('"tableId":"m1"');
    expect(call.model).toBe("google/gemini-2.5-flash-lite");
  });
  it("sin IA, limitada o con error: ok false (la interfaz se queda con la plantilla)", async () => {
    vi.stubEnv("VINKLO_AI_SEATING", "off");
    expect(await explainSeatingCore([table], ctx)).toEqual({ ok: false });
    vi.stubEnv("VINKLO_AI_SEATING", "");
    allow.mockResolvedValueOnce(false);
    expect(await explainSeatingCore([table], ctx)).toEqual({ ok: false });
    mocks.rateLimit.mockResolvedValueOnce(false);
    expect(await explainSeatingCore([table], ctx)).toEqual({ ok: false });
    expect(mocks.generateText).not.toHaveBeenCalled();
    mocks.generateText.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 429 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await explainSeatingCore([table], ctx)).toEqual({ ok: false });
    expect(mocks.capture).toHaveBeenCalledWith("ai seating-explain failed", { level: "warning", extra: { name: "Error", status: 429 } });
    error.mockRestore();
  });
});

describe("readFloorPlanCore", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x42]);
  const file = (type = "image/jpeg", size = bytes.length) => ({ type, size, bytes: vi.fn(async () => bytes) });

  it("envía la imagen en memoria al modelo de visión y normaliza lo que vuelve", async () => {
    mocks.generateText.mockResolvedValue({
      output: { tables: [{ label: "1", shape: "redonda", seats: 50, x: 0.5, y: 1.2 }, { label: "Novios", shape: "imperial", seats: 6, x: 0.5, y: 0.1 }], notes: "" },
      usage: { inputTokens: 1000, outputTokens: 100 },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await readFloorPlanCore(file(), ctx);
    expect(result).toEqual({ ok: true, reading: { notes: "", tables: [
      { key: "d1", id: null, name: "Mesa 1", shape: "redonda", seats: 30, x: 0.5, y: 1 },
      { key: "d2", id: null, name: "Novios", shape: "imperial", seats: 6, x: 0.5, y: 0.1 },
    ] } });
    const call = mocks.generateText.mock.calls[0]![0] as { messages: Array<{ content: Array<{ type: string; mediaType?: string; data?: unknown }> }>; timeout: number; model: string };
    expect(call.timeout).toBe(30_000);
    expect(call.model).toBe("google/gemini-2.5-flash");
    expect(call.messages[0]!.content[1]).toEqual({ type: "file", mediaType: "image/jpeg", data: bytes });
    // El log de coste no lleva la imagen ni lo leído.
    const logged = info.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain('"feature":"floor-plan"');
    expect(logged).not.toMatch(/Novios|255,216/);
    info.mockRestore();
  });
  it("rechaza tipos y tamaños sin llamar al modelo ni leer la imagen", async () => {
    const pdf = file("application/pdf");
    expect(await readFloorPlanCore(pdf, ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.file });
    expect(await readFloorPlanCore(file("image/png", 5 * 1024 * 1024), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.size });
    expect(await readFloorPlanCore(file("image/png", 0), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.file });
    expect(pdf.bytes).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it("límites por pareja y global, y sin IA", async () => {
    allow.mockResolvedValueOnce(false);
    expect(await readFloorPlanCore(file(), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.rate });
    mocks.rateLimit.mockResolvedValueOnce(false);
    expect(await readFloorPlanCore(file(), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.busy });
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-floor-global-d", "all", 200, 86_400);
    vi.stubEnv("VINKLO_AI_SEATING", "off");
    expect(await readFloorPlanCore(file(), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.unavailable });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it("sin mesas o con error del modelo, un mensaje claro", async () => {
    mocks.generateText.mockResolvedValueOnce({ output: { tables: [], notes: "" }, usage: {} });
    expect(await readFloorPlanCore(file(), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.nothing });
    mocks.generateText.mockRejectedValueOnce(new Error("timeout"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readFloorPlanCore(file(), ctx)).toEqual({ ok: false, error: FLOOR_PLAN_ERRORS.unavailable });
    error.mockRestore();
  });
});
