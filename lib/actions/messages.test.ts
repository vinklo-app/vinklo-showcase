import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import {
  confirmReminderSent, exportGuestsCsv, getMessageTemplates, resetMessageTemplate, saveMessageTemplate, setRemindersOptOut,
} from "./messages";
import { DEFAULT_TEMPLATES, TEMPLATE_ERRORS } from "@/lib/messages/templates";
import { DEFAULT_THANKS_TEMPLATE } from "@/lib/crm/contract";

const weddingId = "11111111-1111-4111-8111-111111111111";
const guestId = "22222222-2222-4222-8222-222222222222";
type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "insert", "update", "delete", "not", "upsert", "order", "range", "is"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => next();
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve);
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from: chainFor,
    rpc(name: string, args: unknown) { calls.push({ table: "rpc", method: name, args: [args] }); return chainFor(`rpc:${name}`); },
  };
}
/** getCurrentWedding: la boda por membresía (primera lectura de weddings). */
const member = () => ({ data: { id: weddingId, slug: "ana-y-luis", wedding_members: [{ role: "owner" }] }, error: null });
const owner = (date: string | null = "2027-06-12") => ({ data: { id: weddingId, partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: date }, error: null });
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("autorización", () => {
  it("sin sesión ninguna acción toca tablas ni RPC", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [
      () => getMessageTemplates(), () => saveMessageTemplate("invitation", "Hola {enlace}"), () => resetMessageTemplate("reminder"),
      () => confirmReminderSent(guestId), () => setRemindersOptOut(guestId, true), () => exportGuestsCsv("todos"),
    ]) expect((await action()).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("valida entrada antes de crear cliente", async () => {
    expect(await saveMessageTemplate("invitation", "sin enlace")).toEqual({ ok: false, error: TEMPLATE_ERRORS.missingLink });
    expect(await saveMessageTemplate("invitation", "{enlace} {apellido}")).toEqual({ ok: false, error: TEMPLATE_ERRORS.unknownVariable });
    expect((await saveMessageTemplate("aviso" as "invitation", "{enlace}")).ok).toBe(false);
    expect((await resetMessageTemplate("aviso" as "invitation")).ok).toBe(false);
    expect((await confirmReminderSent("invalid")).ok).toBe(false);
    expect((await setRemindersOptOut("invalid", true)).ok).toBe(false);
    expect((await setRemindersOptOut(guestId, "yes" as unknown as boolean)).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("plantillas", () => {
  it("devuelve guardadas y por defecto, con novios y fecha para la vista previa", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: [
      { kind: "reminder", body: "¿Vienes? {enlace}", updated_at: "2026-10-04T10:00:00Z" },
      { kind: "invitation", body: "corrupta sin enlace", updated_at: "2026-10-04T10:00:00Z" },
    ], error: null }]));
    const result = await getMessageTemplates();
    expect(result).toEqual({
      ok: true,
      templates: {
        invitation: { body: DEFAULT_TEMPLATES.invitation, isDefault: true, updatedAt: null },
        reminder: { body: "¿Vienes? {enlace}", isDefault: false, updatedAt: "2026-10-04T10:00:00Z" },
      },
      thanks: { body: DEFAULT_THANKS_TEMPLATE, isDefault: true, updatedAt: null },
      context: { novios: "Ana y Luis", fecha: "sábado, 12 de junio" },
    });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["wedding_id", weddingId] });
  });
  it("agradecimiento guardado: sin {enlace} es válido para «thanks»", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: [
      { kind: "thanks", body: "Gracias, {nombre}", updated_at: "2026-10-05T10:00:00Z" },
    ], error: null }]));
    const result = await getMessageTemplates();
    expect(result.ok && result.thanks).toEqual({ body: "Gracias, {nombre}", isDefault: false, updatedAt: "2026-10-05T10:00:00Z" });
  });
  it("guardar «thanks»: no exige {enlace} pero rechaza otras variables", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: { kind: "thanks" }, error: null }]));
    expect(await saveMessageTemplate("thanks", "Gracias, {nombre}. {novios}")).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["kind", "thanks"] });
    expect(await saveMessageTemplate("thanks", "Gracias {enlace}")).toEqual({ ok: false, error: TEMPLATE_ERRORS.unknownThanksVariable });
  });
  it("boda sin fecha: fecha vacía", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(null), { data: [], error: null }]));
    const result = await getMessageTemplates();
    expect(result.ok && result.context.fecha).toBe("");
  });
  it("guardar actualiza la fila de la boda propia con el texto normalizado", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: { kind: "invitation" }, error: null }]));
    expect(await saveMessageTemplate("invitation", "  Hola {nombre}: {enlace}  ")).toEqual({ ok: true });
    expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ body: "Hola {nombre}: {enlace}" });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["kind", "invitation"] });
    expect(calls.some(c => c.method === "insert" || c.method === "upsert")).toBe(false);
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("sin fila, inserta solo wedding_id, kind y body (grants por columna)", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: null }, { data: null, error: null }]));
    expect(await saveMessageTemplate("reminder", "{enlace}")).toEqual({ ok: true });
    expect(calls.find(c => c.method === "insert")?.args[0]).toEqual({ wedding_id: weddingId, kind: "reminder", body: "{enlace}" });
  });
  it("carrera de dos pestañas: 23505 al insertar se reintenta como update", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: null }, { data: null, error: { code: "23505" } }, { data: { kind: "reminder" }, error: null }]));
    expect(await saveMessageTemplate("reminder", "{enlace}")).toEqual({ ok: true });
    expect(calls.filter(c => c.method === "update")).toHaveLength(2);
  });
  it("un error de base de datos no se muestra ni refresca", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: { message: "secret detail" } }]));
    const result = await saveMessageTemplate("reminder", "{enlace}");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("volver al texto de Vinklo borra solo esa plantilla de la boda propia", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: null }]));
    expect(await resetMessageTemplate("reminder")).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "delete", args: [] });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_message_templates", method: "eq", args: ["kind", "reminder"] });
  });
});

describe("recordatorios", () => {
  it("confirmar llama a la RPC atómica y devuelve el contador, sin escribir el envío", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: { last_reminder_at: "2026-10-04T10:00:00Z", reminder_count: 2 }, error: null }]));
    expect(await confirmReminderSent(guestId)).toEqual({ ok: true, lastReminderAt: "2026-10-04T10:00:00Z", reminderCount: 2 });
    // La apertura cuenta como entrega en la RPC (20261101120000): nada se fecha en la ficha (F3).
    expect(calls.some((c) => c.method === "update")).toBe(false);
    expect(calls).toContainEqual({ table: "rpc", method: "confirm_guest_reminder", args: [{ p_guest_id: guestId }] });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("0 filas (ajeno, sin invitación entregada) no informa éxito", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: null }]));
    expect((await confirmReminderSent(guestId)).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each([true, false])("opt-out=%s solo en la boda propia", async (value) => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: { id: guestId }, error: null }]));
    expect(await setRemindersOptOut(guestId, value)).toEqual({ ok: true });
    expect(calls.find(c => c.method === "update")?.args[0]).toEqual({ reminders_opt_out: value });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["id", guestId] });
  });
  it("opt-out sobre fila inexistente o ajena falla", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: null }]));
    expect((await setRemindersOptOut(guestId, true)).ok).toBe(false);
  });
});

describe("exportación CSV", () => {
  const guestRow = (n: number, name = `Invitado ${n}`) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, phone: "612345678", rsvp_status: "pendiente",
    rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null,
    last_reminder_at: null, reminder_count: 0, reminders_opt_out: false, created_at: "2026-10-01T10:00:00Z", total_count: 1,
  });
  it("respeta el filtro activo y la búsqueda, y neutraliza fórmulas", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: [guestRow(1, "=HYPERLINK(1)")], error: null }]));
    const result = await exportGuestsCsv("sin_enviar", "  inv ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("invitados-sin-enviar-vinklo.csv");
    expect(result.rows).toBe(1);
    expect(result.csv).toContain("'=HYPERLINK(1)");
    expect(calls).toContainEqual({ table: "rpc", method: "guest_page", args: [{ p_wedding_id: weddingId, p_filter: "sin_enviar", p_search: "inv", p_limit: 1000, p_offset: 0 }] });
  });
  it("traduce el filtro antiguo y descarta claves desconocidas", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: [], error: null }]));
    await exportGuestsCsv("si");
    mocks.client.mockResolvedValue(database([member(), owner(), { data: [], error: null }]));
    await exportGuestsCsv("drop table");
    const filters = calls.filter(c => c.method === "guest_page").map(c => (c.args[0] as { p_filter: string }).p_filter);
    expect(filters).toEqual(["vienen", "todos"]);
  });
  it("pagina en bloques de 1000 hasta agotar", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => guestRow(i + 1));
    mocks.client.mockResolvedValue(database([member(), owner(), { data: full, error: null }, { data: [guestRow(1001)], error: null }]));
    const result = await exportGuestsCsv("todos");
    expect(result.ok && result.rows).toBe(1001);
    expect(calls.filter(c => c.method === "guest_page").map(c => (c.args[0] as { p_offset: number }).p_offset)).toEqual([0, 1000]);
  });
  it("un error a mitad no entrega un archivo parcial", async () => {
    mocks.client.mockResolvedValue(database([member(), owner(), { data: null, error: { message: "boom" } }]));
    expect((await exportGuestsCsv("todos")).ok).toBe(false);
  });
});
