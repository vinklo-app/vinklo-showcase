import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rate: vi.fn(), cookieGet: vi.fn(), cookieSet: vi.fn(), revalidate: vi.fn(), site: vi.fn(), mvp: true }));
vi.mock("@/lib/product-scope", () => ({ get RSVP_MVP() { return mocks.mvp; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "test-ip", rateLimit: mocks.rate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// Por defecto la web está publicada: las pruebas existentes no comprueban
// esta puerta (auditoría H02, 2026-10-04); una sí la prueba explícitamente.
// mocks.site: la web (o null = retirada / no existe; "unavailable" = fallo de lectura).
vi.mock("@/lib/data/site-public", () => ({
  getPublicSiteResult: async (slug: string) => {
    const site = await mocks.site(slug);
    if (site === "unavailable") return { status: "unavailable" };
    return site ? { status: "ok", site } : { status: "not_found" };
  },
}));
import { submitRsvp } from "./rsvp";
import { parseSiteDocument } from "@/lib/site-document";
function doc(extra: unknown[] = [], rsvpProps: Record<string, unknown> = {}) {
  const parsed = parseSiteDocument({ schemaVersion: 1, templateId: "papel-calido", templateVersion: 1, scenes: [{ id: "portada", type: "cover", props: {} }, ...extra, { id: "asistencia", type: "rsvp", props: rsvpProps }] });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.document;
}
const token = "a".repeat(64);
const input = { slug: "ana-y-luis", name: "Ana", attending: "si" as const, companions: 2, invitationToken: token };
let calls: Array<{ table: string; method: string; args: unknown[] }>;
let rpcResponses: Array<{ data: unknown; error: unknown }>;
function database(responses: Array<{ data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "ilike", "limit", "update", "insert", "is"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      chain.maybeSingle = async () => responses.shift() ?? { data: null, error: null };
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(responses.shift() ?? { data: null, error: null }).then(resolve);
      return chain;
    },
    async rpc(name: string, args: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      return rpcResponses.shift() ?? { data: null, error: null };
    },
  };
}
const respond = (outcome: string) => { rpcResponses = [{ data: outcome, error: null }]; mocks.admin.mockReturnValue(database([])); };
beforeEach(() => { vi.clearAllMocks(); mocks.mvp = true; calls = []; rpcResponses = []; mocks.rate.mockResolvedValue(true); mocks.cookieGet.mockReturnValue({ value: "b".repeat(48) }); mocks.site.mockResolvedValue({ slug: "ana-y-luis", source: "legacy", document: doc() }); });
describe("autorización RSVP", () => {
  it("el MVP exige invitación personal antes de acceder a datos", async () => {
    expect((await submitRsvp({ ...input, invitationToken: undefined })).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("el enlace personal responde en UNA RPC atómica con el hash del token, sin escrituras directas (auditoría H03)", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, healthNotes: "Celíaca", notes: "Llegamos tarde", healthConsent: true })).toEqual({ ok: true });
    const rpcCalls = calls.filter((call) => call.method === "rpc");
    // Sobrecarga de 10 (20261101100000): siempre los diez nombres.
    expect(rpcCalls).toEqual([{ table: "rpc:guest_rsvp_respond", method: "rpc", args: [{
      p_slug: "ana-y-luis", p_token_hash: createHash("sha256").update(token).digest("hex"), p_status: "si", p_companions: 2,
      p_health_notes: "Celíaca", p_logistic_notes: "Llegamos tarde", p_health_consent_version: "2026-10", p_answers: null, p_companion_list: null,
      p_keep_health_notes: false,
    }] }]);
    // Leer el token y escribir el invitado ya no son dos peticiones separadas.
    expect(calls.some((call) => call.table === "wedding_guest_tokens" || call.table === "wedding_guests")).toBe(false);
    expect(JSON.stringify(calls)).not.toContain(token);
    expect(mocks.revalidate).toHaveBeenCalledWith("/panel/invitados");
    expect(mocks.revalidate).toHaveBeenCalledWith("/panel");
  });
  it("los nombres de acompañantes viajan en la misma RPC, limpios y como mucho tantos como acompañantes (§4.3)", async () => {
    respond("ok");
    expect((await submitRsvp({ ...input, companions: 2, companionNames: [{ name: "  Leo ", kid: true }, { name: "Marta", kid: false }, { name: "Sobra", kid: false }] })).ok).toBe(true);
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_companion_list: [{ name: "Leo", kid: true }, { name: "Marta", kid: false }] });
  });
  it("con «no», la lista de nombres va vacía (se borran los que escribió el invitado)", async () => {
    respond("ok");
    expect((await submitRsvp({ ...input, attending: "no", companionNames: [{ name: "Leo", kid: true }] })).ok).toBe(true);
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_status: "no", p_companion_list: [] });
  });
  it("sin la migración 20261030100000 falla cerrado: no reintenta con la firma anterior (guardaría la salud como «legacy»)", async () => {
    rpcResponses = [{ data: null, error: { code: "PGRST202" } }, { data: "ok", error: null }];
    mocks.admin.mockReturnValue(database([]));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await submitRsvp({ ...input, healthNotes: "Celíaca", healthConsent: true })).ok).toBe(false);
    expect(calls.filter((call) => call.method === "rpc")).toHaveLength(1);
    log.mockRestore();
  });
  it("una respuesta negativa envía cero acompañantes", async () => {
    respond("ok");
    expect((await submitRsvp({ ...input, attending: "no" })).ok).toBe(true);
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_status: "no", p_companions: 0, p_health_notes: null, p_health_consent_version: null });
  });
  it.each([
    ["unavailable", "Este enlace ya no es válido; pide a los novios uno nuevo."],
    ["withdrawn", "ya no está disponible"],
    ["closed", "El plazo para confirmar ya terminó"],
    ["rate_limited", "muchas respuestas a la vez"],
    ["invalid", "No hemos podido guardarlo"],
    ["algo-nuevo", "No hemos podido guardarlo"],
  ])("el resultado %s de la RPC no informa éxito ni revalida", async (outcome, message) => {
    respond(outcome);
    const result = await submitRsvp(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("un error de la RPC falla cerrado y solo registra el código, nunca el token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResponses = [{ data: null, error: { code: "PGRST202", message: `fallo ${token}` } }];
    mocks.admin.mockReturnValue(database([]));
    expect((await submitRsvp(input)).ok).toBe(false);
    expect(log).toHaveBeenCalledWith("[rsvp] respond rpc failed", "PGRST202");
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(createHash("sha256").update(token).digest("hex"));
    log.mockRestore();
  });
  it("rechaza tokens malformados antes de acceder a datos", async () => {
    expect((await submitRsvp({ ...input, invitationToken: "bad" })).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("una web retirada (o un fallo de lectura) rechaza la respuesta sin llamar a la RPC (auditoría H02)", async () => {
    mocks.site.mockResolvedValue(null);
    respond("ok");
    const result = await submitRsvp(input);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya no está disponible") });
    expect(calls.some((call) => call.method === "rpc" || call.method === "insert" || call.method === "update")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("un fallo momentáneo de lectura no se presenta como invitación retirada: «Prueba de nuevo»", async () => {
    mocks.site.mockResolvedValue("unavailable");
    respond("ok");
    expect(await submitRsvp(input)).toEqual({ ok: false, error: "No hemos podido guardarlo. Prueba de nuevo." });
    expect(calls.some((call) => call.method === "rpc")).toBe(false);
  });
  it("límites combinados por enlace, IP+boda e IP; el token viaja solo como hash (auditoría H11)", async () => {
    respond("ok");
    await submitRsvp(input);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    expect(mocks.rate.mock.calls).toEqual([
      ["rsvp-token", tokenHash, 10, 3600],
      ["rsvp", "test-ip:ana-y-luis", 60, 3600],
      ["rsvp-ip", "test-ip", 120, 3600],
    ]);
    expect(JSON.stringify(mocks.rate.mock.calls)).not.toContain(token);
  });
  it("superar cualquier límite corta antes de tocar datos", async () => {
    mocks.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    respond("ok");
    const result = await submitRsvp(input);
    expect(result).toEqual({ ok: false, error: "Has enviado varias veces seguidas. Espera un momento, por favor." });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledTimes(2);
  });
  it("sin enlace personal no se guarda nada aunque RSVP_MVP fuese false (el «enlace general» se borró, plan §5.5)", async () => {
    mocks.mvp = false;
    const result = await submitRsvp({ ...input, invitationToken: undefined });
    expect(result).toEqual({ ok: false, error: "Para confirmar, abre la invitación personal que te ha enviado la pareja." });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
describe("módulos del formulario (8-oct-2026)", () => {
  const withBus = () => doc([{ id: "autobuses", type: "transport", props: { stops: [{ id: "p-1", name: "Madrid", time: "11:45" }, { id: "p-2", name: "Segovia", time: "12:10" }] } }], { kids: true });
  it("envía a la RPC solo las respuestas de los módulos que la web publicada tiene", async () => {
    mocks.site.mockResolvedValue({ slug: "ana-y-luis", source: "published", document: withBus() });
    respond("ok");
    expect(await submitRsvp({ ...input, answers: { bus: { use: "ambos", stop: "p-2" }, kids: 1, song: "No está activa" } })).toEqual({ ok: true });
    const args = calls.find((call) => call.method === "rpc")?.args[0] as Record<string, unknown>;
    expect(args.p_answers).toEqual({ bus: { use: "ambos", stop: "p-2" }, kids: 1 });
  });
  it("una respuesta incoherente no llega a la base de datos", async () => {
    mocks.site.mockResolvedValue({ slug: "ana-y-luis", source: "published", document: withBus() });
    respond("ok");
    const result = await submitRsvp({ ...input, answers: { bus: { use: "ida" } } });
    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.method === "rpc")).toBe(false);
  });
});
describe("menú parcial (P1-6, fix 1)", () => {
  const withMenu = () => doc([], { menuOptions: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }] });
  it("elegir solo una parte se guarda; lo que falta lo ve la pareja como «sin menú»", async () => {
    mocks.site.mockResolvedValue({ slug: "ana-y-luis", source: "published", document: withMenu() });
    respond("ok");
    expect(await submitRsvp({ ...input, answers: { menu: { "m-1": 1 } } })).toEqual({ ok: true });
    const args = calls.find((call) => call.method === "rpc")?.args[0] as Record<string, unknown>;
    expect(args.p_answers).toEqual({ menu: { "m-1": 1 } });
  });
  it("más menús que personas no llega a la base de datos", async () => {
    mocks.site.mockResolvedValue({ slug: "ana-y-luis", source: "published", document: withMenu() });
    respond("ok");
    expect(await submitRsvp({ ...input, answers: { menu: { "m-1": 3, "m-2": 1 } } })).toEqual({ ok: false, error: "El menú no puede sumar más de 3 personas (tú y tus acompañantes)." });
    expect(calls.some((call) => call.method === "rpc")).toBe(false);
  });
});
describe("consentimiento de datos de salud (RGPD art. 9)", () => {
  it("rechaza alergias sin la casilla marcada y no toca la base de datos", async () => {
    expect(await submitRsvp({ ...input, healthNotes: "Celíaca" })).toEqual({ ok: false, error: "Marca la casilla para enviar tus alergias o déjalas en blanco." });
    expect(await submitRsvp({ ...input, healthNotes: "Celíaca", healthConsent: false })).toMatchObject({ ok: false });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("acepta alergias con consentimiento y guarda su versión", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, healthNotes: "Celíaca", healthConsent: true })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: "Celíaca", p_health_consent_version: "2026-10" });
  });
  it("la nota logística no pide la casilla ni lleva versión de consentimiento", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, notes: "Vamos con carrito de bebé" })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: null, p_logistic_notes: "Vamos con carrito de bebé", p_health_consent_version: null });
  });
  it("con «no» las alergias se descartan sin pedir la casilla: la RPC recibe null y borra la nota de un «sí» anterior", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, attending: "no", healthNotes: "Celíaca" })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_status: "no", p_health_notes: null, p_health_consent_version: null });
    calls = [];
    respond("ok");
    expect(await submitRsvp({ ...input, attending: "no", healthNotes: "Celíaca", healthConsent: true })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: null, p_health_consent_version: null });
  });
  it("nota guardada que no se le muestra (M1): en blanco con «conservar» viaja como p_keep_health_notes, sin texto ni casilla", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, keepHealthNote: true })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: null, p_health_consent_version: null, p_keep_health_notes: true });
  });
  it("«conservar» no vale con nota nueva (manda la nueva) ni con «no» (se borra)", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, keepHealthNote: true, healthNotes: "Sin lactosa", healthConsent: true })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: "Sin lactosa", p_keep_health_notes: false });
    calls = [];
    respond("ok");
    expect(await submitRsvp({ ...input, attending: "no", keepHealthNote: true })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: null, p_keep_health_notes: false });
  });
  it("nota logística sin enviar (undefined) = no se toca: viaja como NULL, no como ''", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_logistic_notes: null });
  });
  it("sin alergias no hace falta la casilla (los espacios cuentan como vacío); la logística vacía se envía como '' para borrarla", async () => {
    respond("ok");
    expect(await submitRsvp({ ...input, healthNotes: "   ", notes: "  " })).toEqual({ ok: true });
    expect(calls.find((call) => call.method === "rpc")?.args[0]).toMatchObject({ p_health_notes: null, p_logistic_notes: "", p_health_consent_version: null });
  });
});
