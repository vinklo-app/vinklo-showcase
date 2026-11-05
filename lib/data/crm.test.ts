import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { getCrmFunnel, getGiftSummary, listGifts, listGiftsFor } from "./crm";
import { toGuestCrmFields } from "@/lib/crm/guest-fields";
import type { SupabaseClient } from "@supabase/supabase-js";

const weddingId = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: unknown };
let rpcCalls: Array<{ name: string; args: unknown }>;
function database(replies: Reply[], signedIn = true) {
  const next = () => replies.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = async () => next();
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    from: () => chain,
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const reply = next();
      return Object.assign(Promise.resolve(reply), { maybeSingle: async () => reply });
    },
  };
}
const owner = { data: { id: weddingId }, error: null };
beforeEach(() => { vi.clearAllMocks(); rpcCalls = []; });

describe("embudo", () => {
  it("mapea la fila SQL al contrato", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: {
      added: 7, prepared: 6, sent: "5", opened: 4, responded: 2, yes: 1, no: 1, attendees: 3,
      not_sent: 2, sent_unopened: 1, opened_unanswered: 2, to_remind: 1,
    }, error: null }]));
    expect(await getCrmFunnel()).toEqual({
      reached: { added: 7, prepared: 6, sent: 5, opened: 4, responded: 2 },
      responses: { yes: 1, no: 1 },
      attendees: 3,
      pending: { not_sent: 2, sent_unopened: 1, opened_unanswered: 2 },
      toRemind: 1,
    });
    expect(rpcCalls).toEqual([{ name: "crm_funnel_summary", args: { p_wedding_id: weddingId } }]);
  });
  it("sin sesión, error, boda ajena (0 filas) o forma rara → null", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect(await getCrmFunnel()).toBeNull();
    expect(rpcCalls).toEqual([]);
    for (const reply of [{ data: null, error: { code: "PGRST202" } }, { data: null, error: null }, { data: { added: -1 }, error: null }]) {
      mocks.client.mockResolvedValue(database([owner, reply]));
      expect(await getCrmFunnel()).toBeNull();
    }
  });
});

describe("resumen de regalos", () => {
  it("rellena con ceros los tipos sin regalos", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: {
      gift_count: 3, total_cents: 20000, with_amount: 2, unthanked: 2,
      by_kind: { bizum: { count: 1, totalCents: 15000 }, objeto: { count: 1, totalCents: 0 }, efectivo: { count: 1, totalCents: 5000 } },
      guests_yes: 4, guests_no: 1, guests_unknown: 2,
    }, error: null }]));
    const summary = await getGiftSummary();
    expect(summary).toMatchObject({ count: 3, totalCents: 20000, withAmount: 2, unthanked: 2, guests: { yes: 4, no: 1, unknown: 2 } });
    expect(summary?.byKind).toEqual({
      transferencia: { count: 0, totalCents: 0 }, bizum: { count: 1, totalCents: 15000 }, efectivo: { count: 1, totalCents: 5000 },
      lista: { count: 0, totalCents: 0 }, objeto: { count: 1, totalCents: 0 }, experiencia: { count: 0, totalCents: 0 }, otro: { count: 0, totalCents: 0 },
    });
  });
  it("tipo desconocido en by_kind → null (no se inventa)", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: {
      gift_count: 1, total_cents: 0, with_amount: 0, unthanked: 1, by_kind: { dinero: { count: 1, totalCents: 0 } },
      guests_yes: 1, guests_no: 0, guests_unknown: 0,
    }, error: null }]));
    expect(await getGiftSummary()).toBeNull();
  });
});

describe("lista de regalos", () => {
  const row = {
    id: "33333333-3333-4333-8333-333333333333", kind: "bizum", amount_cents: 15000, description: null, note: "De los dos",
    received_on: "2026-10-04", thanked_at: null, created_at: "2026-10-05T10:00:00Z",
    givers: [{ guestId: "44444444-4444-4444-8444-444444444444", name: "Fran" }, { guestId: "55555555-5555-4555-8555-555555555555", name: "Gema" }],
  };
  it("camelCase con invitados", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: [row], error: null }]));
    expect(await listGifts()).toEqual([{
      id: row.id, kind: "bizum", amountCents: 15000, description: null, note: "De los dos", receivedOn: "2026-10-04",
      thankedAt: null, givers: row.givers, createdAt: row.created_at,
    }]);
    expect(rpcCalls).toEqual([{ name: "wedding_gift_list", args: { p_wedding_id: weddingId } }]);
  });
  it("error → [] en listGifts y null en listGiftsFor", async () => {
    mocks.client.mockResolvedValue(database([owner, { data: null, error: { message: "x" } }]));
    expect(await listGifts()).toEqual([]);
    const supabase = database([{ data: [{ ...row, givers: "x" }], error: null }]) as unknown as SupabaseClient;
    expect(await listGiftsFor(supabase, weddingId)).toBeNull();
  });
  it("regalo anonimizado (sin invitados, 20261026100000) se sigue listando", async () => {
    const supabase = database([{ data: [{ ...row, givers: [], note: null, description: null }], error: null }]) as unknown as SupabaseClient;
    const gifts = await listGiftsFor(supabase, weddingId);
    expect(gifts).toHaveLength(1);
    expect(gifts?.[0].givers).toEqual([]);
    expect(gifts?.[0].amountCents).toBe(row.amount_cents);
  });
});

describe("campos del CRM por invitado", () => {
  it("estado del regalo derivado: regalo > sin regalo > sin indicar", () => {
    expect(toGuestCrmFields({ invitation_opened_at: "2026-10-04T09:00:00Z", gift_none: true, gift_count: 1, gift_unthanked: true }))
      .toEqual({ invitationOpenedAt: "2026-10-04T09:00:00Z", giftState: "yes", giftCount: 1, giftUnthanked: true });
    expect(toGuestCrmFields({ gift_none: true, gift_count: 0, gift_unthanked: false }).giftState).toBe("no");
    expect(toGuestCrmFields({})).toEqual({ invitationOpenedAt: null, giftState: "unknown", giftCount: 0, giftUnthanked: false });
  });
});
