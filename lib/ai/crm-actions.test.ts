import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), summary: vi.fn(), generate: vi.fn(), limit: vi.fn(), guest: vi.fn(), task: vi.fn(), from: vi.fn(), eq: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (value: unknown) => value } }));
vi.mock("@/lib/data/current-wedding", () => ({ getCurrentWeddingFresh: mocks.current }));
vi.mock("@/lib/data/attendance", () => ({ getAttendanceSummary: mocks.summary }));
vi.mock("@/lib/actions/guests", () => ({ addGuest: mocks.guest }));
vi.mock("@/lib/actions/tasks", () => ({ createTask: mocks.task }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit, keyedHash: (s: string) => createHash("sha256").update(s).digest("hex") }));
import { askCrmAssistant, applyCrmAssistantProposal } from "./crm-actions";
import type { CrmProposal } from "./crm-contract";
const context = (id = "boda-a", userId = "usuario-a") => ({ userId, wedding: { id, slug: "boda-privada" }, supabase: { from: mocks.from } });
const taskProposal: CrmProposal = { kind: "add-task", title: "Confirmar el autobús" };
const guestProposal: CrmProposal = { kind: "add-guest", name: "María José García", companions: 2 };
const output = (proposal: CrmProposal | null = null, link: unknown = null) => ({ output: { answer: "Esta es vuestra propuesta.", proposal, link }, usage: { inputTokens: 20, outputTokens: 10 } });
const prepare = async (proposal: CrmProposal = taskProposal) => {
  mocks.generate.mockResolvedValue(output(proposal));
  const reply = await askCrmAssistant("Añadid una tarea para confirmar el autobús");
  expect(reply.ok && reply.receipt).toEqual(expect.any(String));
  if (!reply.ok || !reply.receipt) throw new Error("missing receipt");
  return reply.receipt;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VINKLO_AI_PROVIDER", "anthropic");
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-key");
  vi.stubEnv("RATE_LIMIT_SECRET", "test-only-local-signature-secret");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("VINKLO_AI_EDITOR", "");
  mocks.current.mockImplementation(async () => context());
  mocks.summary.mockResolvedValue({ total: 20, pending: 8, confirmed: 10, declined: 2, companions: 3, attendees: 13, prepared: 15, sent: 14, phone: "never-to-model", rsvp_notes: "health-private", token: "private-token" });
  mocks.eq.mockReturnValue({ eq: mocks.eq, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 2, error: null }).then(resolve) });
  mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq: mocks.eq })) });
  mocks.limit.mockResolvedValue(true);
  mocks.generate.mockResolvedValue(output());
  mocks.guest.mockResolvedValue({ ok: true });
  mocks.task.mockResolvedValue({ ok: true, id: "new-task" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("consulta CRM", () => {
  it("exige sesión y pertenencia antes de leer o llamar al modelo", async () => {
    mocks.current.mockResolvedValue(null);
    expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("valida entradas, longitud y apagado antes de llamar al modelo", async () => {
    for (const message of [null, 123, "", "   ", "x".repeat(1201)]) expect(await askCrmAssistant(message as string)).toMatchObject({ ok: false });
    vi.stubEnv("VINKLO_AI_CRM", "off");
    expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("Anthropic sin clave falla aunque el gateway esté configurado", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-fake");
    expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("aplica límites por usuario/hora/día y global; sin permiso no lee datos", async () => {
    await askCrmAssistant("Resumen");
    expect(mocks.limit).toHaveBeenCalledWith("ai-crm-h", "usuario-a", 20, 3600);
    expect(mocks.limit).toHaveBeenCalledWith("ai-crm-d", "usuario-a", 60, 86400);
    expect(mocks.limit).toHaveBeenCalledWith("ai-crm-global-d", "all", 300, 86400);
    mocks.generate.mockClear(); mocks.summary.mockClear(); mocks.limit.mockResolvedValue(false);
    expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("solo envía recuentos de la boda actual, sin datos personales ni identificadores; consultar no escribe", async () => {
    const result = await askCrmAssistant("¿Cuántos quedan por responder?");
    expect(result).toEqual({ ok: true, answer: "Esta es vuestra propuesta." });
    const call = mocks.generate.mock.calls[0]![0];
    expect(call.model.modelId).toBe("claude-haiku-5-5");
    expect(call.prompt).toContain('"pending":8');
    for (const secret of ["never-to-model", "health-private", "private-token", "boda-a", "usuario-a", "boda-privada"]) expect(call.prompt).not.toContain(secret);
    expect(call.maxOutputTokens).toBe(1200); expect(call.timeout).toBe(20000);
    expect(call.tools).toBeUndefined(); expect(call.providerOptions).toBeUndefined();
    expect(mocks.summary).toHaveBeenCalledWith(context().supabase, "boda-a");
    expect(mocks.eq).toHaveBeenCalledWith("wedding_id", "boda-a");
    expect(mocks.guest).not.toHaveBeenCalled(); expect(mocks.task).not.toHaveBeenCalled();
  });

  it("con una propuesta de alta no deja que el modelo afirme haberla guardado", async () => {
    mocks.generate.mockResolvedValue({ output: { answer: "Claro, he añadido la tarea.", proposal: taskProposal, link: null }, usage: { inputTokens: 20, outputTokens: 10 } });
    const reply = await askCrmAssistant("Añade una tarea");
    expect(reply).toMatchObject({ ok: true, answer: "Os proponemos esta tarea. Revisadla y pulsad «Añadir tarea» para guardarla." });
  });
  it("una lectura fallida no se convierte en cero ni inventa recuentos", async () => {
    mocks.summary.mockResolvedValue(null);
    expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rechaza salida malformada, campos extra, propuestas arbitrarias y rutas no permitidas", async () => {
    for (const bad of [null, { answer: "" }, { answer: "Texto", proposal: { kind: "delete-all" }, link: null }, { answer: "Texto", proposal: { ...guestProposal, weddingId: "boda-ajena" }, link: null }, { answer: "Texto", proposal: null, link: { label: "Abrir", href: "https://evil.example" } }, { answer: "Texto", proposal: null, link: { label: "Abrir", href: "/panel/invitados?token=secret" } }, { answer: "Texto", proposal: null, link: null, sql: "delete" }]) {
      mocks.generate.mockResolvedValue({ output: bad });
      expect(await askCrmAssistant("Resumen")).toMatchObject({ ok: false });
    }
    expect(mocks.guest).not.toHaveBeenCalled(); expect(mocks.task).not.toHaveBeenCalled();
  });
  it("acepta un enlace local fijo y devuelve una propuesta firmada sin escribir", async () => {
    mocks.generate.mockResolvedValue(output(guestProposal, { label: "Ver invitados", href: "/panel/invitados" }));
    expect(await askCrmAssistant("Añadid a María José García con dos acompañantes")).toMatchObject({ ok: true, proposal: guestProposal, receipt: expect.any(String), link: { href: "/panel/invitados" } });
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it("sin secreto no prepara una propuesta aplicable; redactar sigue disponible sin envío", async () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    mocks.generate.mockResolvedValue(output(taskProposal));
    expect(await askCrmAssistant("Añadid una tarea")).toMatchObject({ ok: false });
    mocks.generate.mockResolvedValue(output({ kind: "draft-message", text: "¿Podéis confirmar vuestra asistencia?" }));
    expect(await askCrmAssistant("Redactad un mensaje")).toMatchObject({ ok: true, proposal: { kind: "draft-message" } });
    expect(mocks.guest).not.toHaveBeenCalled(); expect(mocks.task).not.toHaveBeenCalled();
  });
});

describe("aplicación explícita CRM", () => {
  it("reconsulta sesión y aplica tarea mediante la acción existente", async () => {
    const receipt = await prepare();
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: true });
    expect(mocks.current).toHaveBeenCalledTimes(2);
    expect(mocks.task).toHaveBeenCalledWith({ title: taskProposal.title });
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it("añade invitado pendiente sin falsificar su asistencia y con tope de acompañantes", async () => {
    const receipt = await prepare(guestProposal);
    expect(await applyCrmAssistantProposal(guestProposal, receipt)).toMatchObject({ ok: true });
    expect(mocks.guest).toHaveBeenCalledWith({ name: guestProposal.name, phone: "", status: "pendiente", companions: 0, maxCompanions: 2, notes: "" });
  });
  it("rechaza sesión ausente, boda distinta, usuario distinto, firma ausente y propuesta manipulada", async () => {
    const receipt = await prepare();
    expect(await applyCrmAssistantProposal(taskProposal, "")).toMatchObject({ ok: false });
    expect(await applyCrmAssistantProposal({ ...taskProposal, title: "Otra" }, receipt)).toMatchObject({ ok: false });
    for (const next of [null, context("otra-boda"), context("boda-a", "otra-persona")]) {
      mocks.current.mockResolvedValue(next);
      expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: false });
    }
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("rechaza propuestas inválidas, extras y recibos caducados; nunca ejecuta SQL o borradores", async () => {
    const receipt = await prepare();
    for (const bad of [null, { kind: "delete-all" }, { ...taskProposal, weddingId: "otra" }, { ...guestProposal, companions: -1 }, { ...guestProposal, companions: 11 }, { ...guestProposal, companions: 1.5 }, { kind: "draft-message", text: "Hola" }]) expect(await applyCrmAssistantProposal(bad as CrmProposal, receipt)).toMatchObject({ ok: false });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: false });
    expect(mocks.task).not.toHaveBeenCalled(); expect(mocks.guest).not.toHaveBeenCalled();
  });
  it("una propuesta solo puede intentarse una vez, incluso al reintentar desde otra pestaña", async () => {
    const receipt = await prepare();
    let consumed = false;
    mocks.limit.mockImplementation(async (namespace: string) => {
      if (namespace !== "ai-crm-receipt") return true;
      if (consumed) return false;
      consumed = true; return true;
    });
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: true });
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: false });
    expect(mocks.task).toHaveBeenCalledTimes(1);
  });
  it("se limita y transmite el fallo de la acción existente sin inventar éxito", async () => {
    const receipt = await prepare();
    mocks.limit.mockResolvedValue(false);
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toMatchObject({ ok: false });
    expect(mocks.task).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValue(true); mocks.task.mockResolvedValue({ ok: false, error: "No disponible" });
    expect(await applyCrmAssistantProposal(taskProposal, receipt)).toEqual({ ok: false, error: "No disponible" });
  });
});
