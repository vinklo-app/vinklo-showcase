import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAllGuestsForFilter, getGuestFilterCounts, getGuestGroups, getGuestPage, getGuestTags, getReminderQueue, GUEST_PAGE_SIZE } from "./attendance";

const weddingId = "11111111-1111-4111-8111-111111111111";
const row = (n: number, total: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `Invitado ${n}`, phone: null, rsvp_status: "pendiente",
  rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null,
  last_reminder_at: null, reminder_count: 0, reminders_opt_out: false, created_at: "2026-10-01T10:00:00Z", total_count: total,
});
function client(replies: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const reply = replies.shift() ?? { data: null, error: null };
      return Object.assign(Promise.resolve(reply), { maybeSingle: async () => reply });
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe("getGuestPage", () => {
  it("mantiene la forma { data, error, count } y quita total_count de las filas", async () => {
    const { supabase, calls } = client([{ data: [row(1, 7), row(2, 7)], error: null }]);
    const result = await getGuestPage(supabase, weddingId, 2, " ana ", "esperando");
    expect(result.count).toBe(7);
    expect(result.error).toBeNull();
    expect(result.data?.[0]).not.toHaveProperty("total_count");
    expect(calls[0]).toEqual({ name: "guest_page", args: { p_wedding_id: weddingId, p_filter: "esperando", p_search: "ana", p_limit: GUEST_PAGE_SIZE, p_offset: GUEST_PAGE_SIZE } });
  });
  it.each([["pendiente", "sin_respuesta"], ["si", "vienen"], ["no", "no_vienen"], ["todos", "todos"], ["???", "todos"]])("status antiguo %s → %s", async (status, filter) => {
    const { supabase, calls } = client([{ data: [], error: null }]);
    await getGuestPage(supabase, weddingId, 1, "", status);
    expect(calls[0].args.p_filter).toBe(filter);
  });
  it("campos del CRM: se leen si llegan y tienen valor por defecto si no", async () => {
    const crmRow = { ...row(1, 1), invitation_opened_at: "2026-10-04T09:00:00Z", gift_none: false, gift_count: 2, gift_unthanked: true, gift_total_cents: 5000 };
    const withCrm = await getGuestPage(client([{ data: [crmRow], error: null }]).supabase, weddingId, 1, "", "con_regalo");
    expect(withCrm.data?.[0]).toMatchObject({ invitation_opened_at: "2026-10-04T09:00:00Z", gift_count: 2, gift_unthanked: true, gift_total_cents: 5000 });
    const legacy = await getGuestPage(client([{ data: [row(1, 1)], error: null }]).supabase, weddingId, 1, "", "todos");
    expect(legacy.data?.[0]).toMatchObject({ invitation_opened_at: null, gift_none: false, gift_count: 0, gift_unthanked: false, gift_total_cents: 0 });
  });
  it("filtros del CRM llegan tal cual a la RPC", async () => {
    const { supabase, calls } = client([{ data: [], error: null }]);
    await getGuestPage(supabase, weddingId, 1, "", "abierta_sin_responder");
    expect(calls[0].args.p_filter).toBe("abierta_sin_responder");
  });
  it("página fuera de rango: sin filas pero con el total real", async () => {
    const { supabase } = client([{ data: [], error: null }, { data: [row(1, 42)], error: null }]);
    expect(await getGuestPage(supabase, weddingId, 9, "", "todos")).toEqual({ data: [], error: null, count: 42 });
  });
  it("error o forma inesperada → error, sin filas", async () => {
    for (const reply of [{ data: null, error: { message: "x" } }, { data: [{ id: 1 }], error: null }]) {
      const { supabase } = client([reply]);
      const result = await getGuestPage(supabase, weddingId, 1, "", "todos");
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
    }
  });
});

describe("recuentos y fila", () => {
  it("recuentos de chips parseados; boda ajena (0 filas) → null", async () => {
    const counts = { todos: 9, sin_enviar: 2, esperando: 5, para_recordar: 2, vienen: 1, no_vienen: 1, sin_telefono: 2, con_notas: 1, sin_respuesta: 7 };
    const crm = { enviada_sin_abrir: 0, abierta_sin_responder: 0, con_regalo: 0, sin_regalo: 0, regalo_sin_indicar: 0, sin_agradecer: 0 };
    // Sin la migración del CRM: las claves nuevas valen 0.
    expect(await getGuestFilterCounts(client([{ data: counts, error: null }]).supabase, weddingId)).toEqual({ ...counts, ...crm });
    const withCrm = { ...counts, ...crm, con_regalo: 3, sin_agradecer: 1 };
    expect(await getGuestFilterCounts(client([{ data: withCrm, error: null }]).supabase, weddingId)).toEqual(withCrm);
    expect(await getGuestFilterCounts(client([{ data: null, error: null }]).supabase, weddingId)).toBeNull();
  });
  it("fila de recordatorios con total", async () => {
    const item = { id: "a", name: "Ana", phone: "612345678", invitation_sent_at: "2026-10-01T10:00:00Z", last_reminder_at: null, reminder_count: 0, total_count: 3 };
    const { supabase, calls } = client([{ data: [item], error: null }]);
    // Sin delivered_by (RPC anterior a 20261101120000): cuenta como envío.
    const expected = { ...item, group_name: null, tags: [], delivered_by: "sent" } as Partial<typeof item> & { group_name: string | null; tags: string[]; delivered_by: string };
    delete expected.total_count;
    expect(await getReminderQueue(supabase, weddingId)).toEqual({ items: [expected], total: 3 });
    // Sin grupo no se envía p_group: vale con o sin la migración 20261012200000.
    expect(calls[0]).toEqual({ name: "reminder_queue", args: { p_wedding_id: weddingId, p_limit: 200 } });
  });
  it("fila de recordatorios: delivered_by de la RPC (20261101120000)", async () => {
    const item = { id: "a", name: "Ana", phone: "612345678", invitation_sent_at: "2026-10-02T18:30:00Z", last_reminder_at: null, reminder_count: 0, total_count: 1, delivered_by: "opened" };
    const result = await getReminderQueue(client([{ data: [item], error: null }]).supabase, weddingId);
    expect(result?.items[0]?.delivered_by).toBe("opened");
  });
  it("fila de recordatorios de un grupo", async () => {
    const { supabase, calls } = client([{ data: [], error: null }]);
    expect(await getReminderQueue(supabase, weddingId, 200, "Familia de Elena")).toEqual({ items: [], total: 0 });
    expect(calls[0]).toEqual({ name: "reminder_queue", args: { p_wedding_id: weddingId, p_limit: 200, p_group: "Familia de Elena" } });
    expect(await getReminderQueue(client([{ data: null, error: { message: "x" } }]).supabase, weddingId)).toBeNull();
  });
});

describe("grupos", () => {
  it("sin grupo elegido no envía p_group (vale antes de la migración) y group_name tiene valor por defecto", async () => {
    const { supabase, calls } = client([{ data: [row(1, 1)], error: null }]);
    const result = await getGuestPage(supabase, weddingId, 1, "", "todos");
    expect(calls[0].args).not.toHaveProperty("p_group");
    expect(result.data?.[0]).toMatchObject({ group_name: null });
  });
  it("grupo concreto y «sin grupo» ('') llegan a la RPC", async () => {
    const named = client([{ data: [{ ...row(1, 1), group_name: "Trabajo" }], error: null }]);
    const result = await getGuestPage(named.supabase, weddingId, 1, "", "vienen", { kind: "named", name: "Trabajo" });
    expect(named.calls[0].args).toMatchObject({ p_filter: "vienen", p_group: "Trabajo" });
    expect(result.data?.[0]).toMatchObject({ group_name: "Trabajo" });
    const none = client([{ data: [], error: null }]);
    await getGuestPage(none.supabase, weddingId, 1, "", "todos", { kind: "none" });
    expect(none.calls[0].args.p_group).toBe("");
  });
  it("sin la migración, el grupo se ignora y la lista sigue cargando", async () => {
    const { supabase, calls } = client([{ data: null, error: { code: "PGRST202", message: "no function" } }, { data: [row(1, 1)], error: null }]);
    const result = await getGuestPage(supabase, weddingId, 1, "", "todos", { kind: "named", name: "Trabajo" });
    expect(result.count).toBe(1);
    expect(calls[1].args).not.toHaveProperty("p_group");
  });
  it("getGuestGroups: filas → resumen; error o forma rara → null", async () => {
    const { supabase } = client([{ data: [{ group_name: "Trabajo", guests: 2, confirmed: 1, declined: 0, pending: 1, attendees: 1 }, { group_name: null, guests: "1", confirmed: 0, declined: 0, pending: 1, attendees: 0 }], error: null }]);
    expect(await getGuestGroups(supabase, weddingId)).toEqual([
      { name: "Trabajo", guests: 2, confirmed: 1, declined: 0, pending: 1, attendees: 1 },
      { name: null, guests: 1, confirmed: 0, declined: 0, pending: 1, attendees: 0 },
    ]);
    expect(await getGuestGroups(client([{ data: null, error: { code: "PGRST202" } }]).supabase, weddingId)).toBeNull();
    expect(await getGuestGroups(client([{ data: [{ group_name: 1 }], error: null }]).supabase, weddingId)).toBeNull();
  });
});

describe("etiquetas y lado (20261020100000)", () => {
  it("tags y side con valor por defecto si no llegan", async () => {
    const legacy = await getGuestPage(client([{ data: [row(1, 1)], error: null }]).supabase, weddingId, 1, "", "todos");
    expect(legacy.data?.[0]).toMatchObject({ tags: [], side: null });
    const fresh = await getGuestPage(client([{ data: [{ ...row(1, 1), tags: ["Uni"], side: "p2" }], error: null }]).supabase, weddingId, 1, "", "todos");
    expect(fresh.data?.[0]).toMatchObject({ tags: ["Uni"], side: "p2" });
  });
  it("sin etiqueta ni lado no se envían p_tag / p_side", async () => {
    const { supabase, calls } = client([{ data: [], error: null }]);
    await getGuestPage(supabase, weddingId, 1, "", "todos", undefined, { tag: null, side: null });
    expect(calls[0].args).not.toHaveProperty("p_tag");
    expect(calls[0].args).not.toHaveProperty("p_side");
  });
  it("etiqueta, lado y «sin lado» ('') llegan a la RPC junto al grupo", async () => {
    const { supabase, calls } = client([{ data: [], error: null }, { data: [], error: null }]);
    await getGuestPage(supabase, weddingId, 1, "", "vienen", { kind: "named", name: "Familia" }, { tag: "Uni", side: "p1" });
    expect(calls[0].args).toMatchObject({ p_group: "Familia", p_tag: "Uni", p_side: "p1" });
    await getGuestPage(supabase, weddingId, 1, "", "todos", undefined, { side: "none" });
    expect(calls[1].args.p_side).toBe("");
  });
  it("sin la migración: se repite con el grupo y, si tampoco, sin nada", async () => {
    const missing = { data: null, error: { code: "PGRST202", message: "no function" } };
    const a = client([missing, { data: [row(1, 1)], error: null }]);
    expect((await getGuestPage(a.supabase, weddingId, 1, "", "todos", { kind: "named", name: "Familia" }, { tag: "Uni" })).count).toBe(1);
    expect(a.calls[1].args).toMatchObject({ p_group: "Familia" });
    expect(a.calls[1].args).not.toHaveProperty("p_tag");
    const b = client([missing, missing, { data: [row(1, 1)], error: null }]);
    expect((await getGuestPage(b.supabase, weddingId, 1, "", "todos", { kind: "named", name: "Familia" }, { tag: "Uni" })).count).toBe(1);
    expect(b.calls[2].args).not.toHaveProperty("p_group");
    const c = client([missing, { data: [row(1, 1)], error: null }]);
    await getGuestPage(c.supabase, weddingId, 1, "", "todos", undefined, { side: "p2" });
    expect(c.calls[1].args).not.toHaveProperty("p_side");
  });
  it("CSV con etiqueta: si falta la migración falla en vez de exportar a todos", async () => {
    const { supabase, calls } = client([{ data: null, error: { code: "PGRST202" } }]);
    expect(await getAllGuestsForFilter(supabase, weddingId, "todos", "", undefined, { tag: "Uni" })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_tag: "Uni" });
  });
  it("getGuestTags: filas → resumen; error o forma rara → null", async () => {
    const { supabase, calls } = client([{ data: [{ tag: "Uni", guests: 3, confirmed: "2", attendees: 3 }], error: null }]);
    expect(await getGuestTags(supabase, weddingId)).toEqual([{ tag: "Uni", guests: 3, confirmed: 2, attendees: 3 }]);
    expect(calls[0]).toEqual({ name: "guest_tag_summary", args: { p_wedding_id: weddingId } });
    expect(await getGuestTags(client([{ data: null, error: { code: "PGRST202" } }]).supabase, weddingId)).toBeNull();
    expect(await getGuestTags(client([{ data: [{ tag: 1 }], error: null }]).supabase, weddingId)).toBeNull();
  });
  it("fila de recordatorios de una etiqueta", async () => {
    const { supabase, calls } = client([{ data: [], error: null }]);
    await getReminderQueue(supabase, weddingId, 200, null, "Uni");
    expect(calls[0]).toEqual({ name: "reminder_queue", args: { p_wedding_id: weddingId, p_limit: 200, p_tag: "Uni" } });
  });
});
