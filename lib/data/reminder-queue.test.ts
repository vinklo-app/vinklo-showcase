import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReminderCandidates } from "./reminder-queue";

const weddingId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-14T10:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
type Reply = { data: unknown; error: unknown };

/** Respuestas por tabla (y por RPC), en orden; registra cada llamada. */
function db(replies: Record<string, Reply[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const next = (key: string) => replies[key]?.shift() ?? { data: null, error: null };
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "contains", "order", "limit", "update"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => next(table);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next(table)).then(resolve);
    return chain;
  };
  const supabase = {
    from: chainFor,
    rpc(name: string, args: unknown) { calls.push({ table: "rpc", method: name, args: [args] }); return Promise.resolve(next(`rpc:${name}`)); },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

const dates = (rsvp_deadline: string | null, wedding_date = "2027-06-12") => ({ data: { wedding_date, rsvp_deadline }, error: null });
const sentRow = (id: string, sentDaysAgo: number, over: Record<string, unknown> = {}) => ({
  id, name: `Persona ${id}`, phone: "612345678", invitation_sent_at: daysAgo(sentDaysAgo), last_reminder_at: null,
  reminder_count: 0, total_count: 1, group_name: null, tags: [], ...over,
});
/** Con 20261101120000 la RPC devuelve también a quien abrió: entrega = apertura y delivered_by «opened». */
const openedRow = (id: string, openedDaysAgo: number) => sentRow(id, openedDaysAgo, { delivered_by: "opened" });

describe("getReminderCandidates", () => {
  it("una sola lectura (la RPC): quien abrió sin «Sí, enviada» llega como «opened»; margen de 3 días", async () => {
    const { supabase, calls } = db({
      weddings: [dates(null)],
      "rpc:reminder_queue": [{ data: [sentRow("vieja", 6), openedRow("abrio", 4), sentRow("reciente", 1), openedRow("abrio-hoy", 0)], error: null }],
    });
    const result = await getReminderCandidates(supabase, weddingId, { now });
    expect(result?.items.map((item) => [item.id, item.delivered_by])).toEqual([["vieja", "sent"], ["abrio", "opened"]]);
    expect(result?.total).toBe(2);
    // Para quien abrió, la fecha que se enseña es la de la apertura.
    expect(result?.items[1]?.invitation_sent_at).toBe(daysAgo(4));
    // Nada de lecturas ni escrituras directas en la ficha: no se fecha el envío con la apertura (F3).
    expect(calls.some((c) => c.table === "wedding_guests")).toBe(false);
    expect(calls).toContainEqual({ table: "rpc", method: "reminder_queue", args: [{ p_wedding_id: weddingId, p_limit: 1000 }] });
  });

  it("RPC anterior a 20261101120000 (sin delivered_by): todo cuenta como envío", async () => {
    const { supabase } = db({ weddings: [dates(null)], "rpc:reminder_queue": [{ data: [sentRow("a", 9)], error: null }] });
    const result = await getReminderCandidates(supabase, weddingId, { now });
    expect(result?.items[0]?.delivered_by).toBe("sent");
  });

  it("plazo cerrado: nadie, sin leer la fila", async () => {
    const { supabase, calls } = db({ weddings: [dates("2026-10-10")] });
    const result = await getReminderCandidates(supabase, weddingId, { now });
    expect(result).toMatchObject({ items: [], total: 0, period: { status: "closed" } });
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
  });

  it("plazo a 2 días: también quien recibió la invitación ayer", async () => {
    const { supabase } = db({
      weddings: [dates("2026-10-16")],
      "rpc:reminder_queue": [{ data: [sentRow("ayer", 1)], error: null }],
    });
    const result = await getReminderCandidates(supabase, weddingId, { now });
    expect(result?.items.map((item) => item.id)).toEqual(["ayer"]);
    expect(result?.period).toMatchObject({ status: "open", soon: true, daysLeft: 2 });
  });

  it("grupo y etiqueta van a la RPC; `limit` recorta los items pero no el total", async () => {
    const { supabase, calls } = db({
      weddings: [dates(null)],
      "rpc:reminder_queue": [{ data: [sentRow("a", 9), sentRow("b", 8), openedRow("c", 7)], error: null }],
    });
    const result = await getReminderCandidates(supabase, weddingId, { group: "Familia", tag: "Uni", limit: 1, now });
    expect(result?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result?.total).toBe(3);
    expect(calls).toContainEqual({ table: "rpc", method: "reminder_queue", args: [{ p_wedding_id: weddingId, p_limit: 1000, p_group: "Familia", p_tag: "Uni" }] });
  });

  it("si falla la RPC → null", async () => {
    expect(await getReminderCandidates(db({ weddings: [dates(null)], "rpc:reminder_queue": [{ data: null, error: { message: "x" } }] }).supabase, weddingId, { now })).toBeNull();
  });

  it("si no se puede leer el plazo, se sigue como abierto sin fecha (con el margen de 3 días)", async () => {
    const result = await getReminderCandidates(db({
      weddings: [{ data: null, error: { message: "x" } }],
      "rpc:reminder_queue": [{ data: [sentRow("a", 9), sentRow("b", 1)], error: null }],
    }).supabase, weddingId, { now });
    expect(result?.items.map((item) => item.id)).toEqual(["a"]);
  });
});
