import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInvitationQueue } from "./invitation-queue";
import { getGuestCompanionLimits } from "./attendance";

const weddingId = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: unknown };

/** Cliente de tabla de mentira: registra cada llamada y responde por orden. */
function table(replies: Reply[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const supabase = {
    from(name: string) {
      calls.push({ method: "from", args: [name] });
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "not", "order", "limit"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ method, args }); return chain; };
      }
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(replies.shift() ?? { data: [], error: null }).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}
const missing = { data: null, error: { code: "42703", message: "column does not exist" } };
const guest = { id: "a", name: "Ana", phone: "612345678", rsvp_status: "pendiente", invitation_prepared_at: null };

describe("getInvitationQueue", () => {
  it("lee grupo, etiquetas y lado de la boda de la sesión", async () => {
    const { supabase, calls } = table([{ data: [{ ...guest, group_name: "Familia", tags: ["Uni"], side: "p1" }], error: null }]);
    const queue = await getInvitationQueue(supabase, weddingId);
    expect(queue?.items[0]).toMatchObject({ group_name: "Familia", tags: ["Uni"], side: "p1" });
    expect(calls).toContainEqual({ method: "eq", args: ["wedding_id", weddingId] });
    expect(calls.find((c) => c.method === "select")?.args[0]).toContain("tags, side");
  });
  it("sin la migración de etiquetas se repite sin ellas, y sin grupos, sin grupo", async () => {
    const { supabase, calls } = table([missing, missing, { data: [guest], error: null }]);
    const queue = await getInvitationQueue(supabase, weddingId);
    expect(queue?.items[0]).toMatchObject({ group_name: null, tags: [], side: null });
    const selects = calls.filter((c) => c.method === "select").map((c) => c.args[0]);
    expect(selects).toHaveLength(3);
    expect(selects[1]).toContain("group_name");
    expect(selects[1]).not.toContain("tags");
    expect(selects[2]).not.toContain("group_name");
  });
  it("excluye en la consulta a quien ya respondió y a quien abrió su enlace", async () => {
    const { supabase, calls } = table([{ data: [guest], error: null }]);
    await getInvitationQueue(supabase, weddingId);
    expect(calls).toContainEqual({ method: "is", args: ["invitation_sent_at", null] });
    expect(calls).toContainEqual({ method: "eq", args: ["rsvp_status", "pendiente"] });
    expect(calls).toContainEqual({ method: "is", args: ["invitation_opened_at", null] });
  });
  it("y lo repite en TS: respondidas (sí o no) y abiertas no entran ni cuentan como «sin teléfono»", async () => {
    const rows = [
      guest,
      { ...guest, id: "si", rsvp_status: "si" },
      { ...guest, id: "no", rsvp_status: "no", phone: null },
      { ...guest, id: "abierta", invitation_opened_at: "2026-10-02T18:30:00Z" },
      { ...guest, id: "sin-movil", phone: null },
    ];
    const queue = await getInvitationQueue(table([{ data: rows, error: null }]).supabase, weddingId);
    expect(queue?.items.map((item) => item.id)).toEqual(["a"]);
    expect(queue?.withoutPhone).toBe(1);
  });
  it("sin la columna de aperturas: se lee sin ese filtro (pero sí sin respondidas)", async () => {
    const { supabase, calls } = table([missing, missing, missing, { data: [guest], error: null }]);
    const queue = await getInvitationQueue(supabase, weddingId);
    expect(queue?.items).toHaveLength(1);
    const selects = calls.filter((c) => c.method === "select").map((c) => c.args[0]);
    expect(selects[3]).not.toContain("invitation_opened_at");
    expect(calls.filter((c) => c.method === "is" && (c.args as unknown[])[0] === "invitation_opened_at")).toHaveLength(3);
    expect(calls.filter((c) => c.method === "eq" && (c.args as unknown[])[0] === "rsvp_status")).toHaveLength(4);
  });
  it("otro error: null", async () => {
    expect(await getInvitationQueue(table([{ data: null, error: { code: "500" } }]).supabase, weddingId)).toBeNull();
  });
});

describe("getGuestCompanionLimits", () => {
  it("con ids: solo esas personas de la boda; devuelve los topes (0 incluido)", async () => {
    const { supabase, calls } = table([{ data: [{ id: "a", max_companions: 2 }, { id: "b", max_companions: null }, { id: "c", max_companions: 0 }], error: null }]);
    const limits = await getGuestCompanionLimits(supabase, weddingId, ["a", "b", "c"]);
    expect(limits && [...limits.entries()]).toEqual([["a", 2], ["c", 0]]);
    expect(calls).toContainEqual({ method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ method: "in", args: ["id", ["a", "b", "c"]] });
  });
  it("sin ids (CSV): solo quien tiene tope", async () => {
    const { supabase, calls } = table([{ data: [{ id: "a", max_companions: 1 }], error: null }]);
    expect((await getGuestCompanionLimits(supabase, weddingId))?.get("a")).toBe(1);
    expect(calls).toContainEqual({ method: "not", args: ["max_companions", "is", null] });
  });
  it("lista vacía no consulta; sin la columna, null", async () => {
    const empty = table([]);
    expect((await getGuestCompanionLimits(empty.supabase, weddingId, []))?.size).toBe(0);
    expect(empty.calls).toEqual([]);
    expect(await getGuestCompanionLimits(table([missing]).supabase, weddingId, ["a"])).toBeNull();
  });
});
