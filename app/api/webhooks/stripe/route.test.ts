/**
 * H09 — inbox state machine del webhook de Stripe (app/api/webhooks/stripe/route.ts).
 *
 * El hueco original: insert-then-ack. Si el proceso moría entre el insert de
 * la fila de guarda y terminar el handler, un reintento de Stripe chocaba
 * con la unique y recibía 200 "already processed" aunque no se hubiera
 * hecho el trabajo. Estos tests comprueban el reemplazo: processing →
 * processed | failed en el mismo payload jsonb (sin migración), con
 * reclamación por vencimiento de lease en vez de ack ciego.
 *
 * Mismo patrón de mock que tests/fase1/actions-edge.test.ts: cliente falso
 * con una cola de respuestas por tabla, en el orden exacto de las llamadas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ webhooks: { constructEvent: mocks.constructEvent } }) }));

type Reply = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

let calls: Call[];
let queues: Record<string, Reply[]>;
let fakeClient: ReturnType<typeof makeClient>;

function shift(table: string): Reply {
  return queues[table]?.shift() ?? { data: null, error: null };
}

function makeClient() {
  function chainFor(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "insert", "update", "delete", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.single = async () => shift(table);
    chain.maybeSingle = async () => shift(table);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(shift(table)).then(resolve);
    return chain;
  }
  return {
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
    from: (table: string) => chainFor(table),
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient }));

// Importado tras los vi.mock de arriba (hoisted), como en actions-edge.test.ts.
import { POST } from "./route";

const EVENT_ID = "evt_test_123";

function fakeRequest(): Request {
  return new Request("https://vinklo.es/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: "{}",
  });
}

function checkoutCompletedEvent(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    id: EVENT_ID,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        payment_intent: "pi_test_1",
        metadata: { contribution_id: "11111111-1111-4111-8111-111111111111" },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function premiumCompletedEvent(): Stripe.Event {
  return {
    id: EVENT_ID,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_premium",
        payment_status: "paid",
        payment_intent: "pi_test_premium",
        metadata: { type: "premium", wedding_id: "22222222-2222-4222-8222-222222222222" },
      },
    },
  } as unknown as Stripe.Event;
}

const recentIso = () => new Date().toISOString();
const staleIso = () => new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min: pasado el lease de 5 min.

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  calls = [];
  queues = {};
  fakeClient = makeClient();
  mocks.constructEvent.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("gate: redelivery contra una fila ya existente", () => {
  it("processed → 200 sin volver a tocar contributions", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: null, error: { code: "23505", message: "duplicate" } }, // insert inicial choca
      { data: { id: 1, payload: { status: "processed", stripe_event_id: EVENT_ID, type: "checkout.session.completed", claimed_at: recentIso() } }, error: null }, // select de la fila existente
    ];
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("already processed");
    expect(calls.some((c) => c.table === "contributions")).toBe(false);
    expect(calls.filter((c) => c.table === "events" && c.method === "update")).toHaveLength(0);
  });

  it("processing dentro del lease (concurrente de verdad) → no-2xx, no se reprocesa", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: { id: 1, payload: { status: "processing", stripe_event_id: EVENT_ID, type: "checkout.session.completed", claimed_at: recentIso() } }, error: null },
    ];
    const res = await POST(fakeRequest());
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(calls.some((c) => c.table === "contributions")).toBe(false);
  });

  it("processing con lease vencido → reclama y REPROCESA (el hueco original)", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: null, error: { code: "23505", message: "duplicate" } }, // insert inicial choca
      { data: { id: 1, payload: { status: "processing", stripe_event_id: EVENT_ID, type: "checkout.session.completed", claimed_at: staleIso() } }, error: null }, // select
      { data: null, error: null }, // update de reclamación (claim)
      { data: null, error: null }, // update final a "processed"
    ];
    // La contribución ya no está "pending" (p. ej. el intento muerto sí llegó
    // a confirmarla): el handler reprocesado debe encontrarlo y no fallar.
    queues.contributions = [{ data: null, error: null }];
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "contributions" && c.method === "update")).toBe(true);
    const eventsUpdates = calls.filter((c) => c.table === "events" && c.method === "update");
    expect(eventsUpdates).toHaveLength(2); // reclamación + processed
    expect((eventsUpdates[0]!.args[0] as { payload: { status: string } }).payload.status).toBe("processing");
    expect((eventsUpdates[1]!.args[0] as { payload: { status: string } }).payload.status).toBe("processed");
    // Nunca se borra la fila de guarda (comportamiento antiguo): solo updates.
    expect(calls.some((c) => c.table === "events" && c.method === "delete")).toBe(false);
  });

  it("failed → se reclama y reprocesa igual que un lease vencido", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: { id: 1, payload: { status: "failed", stripe_event_id: EVENT_ID, type: "checkout.session.completed", claimed_at: recentIso() } }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];
    queues.contributions = [{ data: null, error: null }];
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "contributions" && c.method === "update")).toBe(true);
  });
});

describe("entrega nueva (sin fila previa)", () => {
  it("éxito → la fila de guarda termina en processed, nunca se borra", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: { id: 42 }, error: null }, // insert inicial .select('id').single()
      { data: null, error: null }, // audit insert contribution_confirmed
      { data: null, error: null }, // update final a "processed"
    ];
    queues.contributions = [
      {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          wedding_id: "22222222-2222-4222-8222-222222222222",
          guest_name: "Marta",
          guest_email: null,
          n_cubiertos: 2,
          total_cents: 5000,
          service_fee_cents: 95,
          message: null,
          method: "card",
          status: "pending",
        },
        error: null,
      },
    ];
    queues.weddings = [
      {
        data: {
          slug: "ana-y-luis",
          partner_name_1: "Ana",
          partner_name_2: "Luis",
          couple_id: "33333333-3333-4333-8333-333333333333",
          plan: "free",
          notify_contribution: "nunca", // evita la rama de email en este test
        },
        error: null,
      },
    ];
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    const eventsUpdates = calls.filter((c) => c.table === "events" && c.method === "update");
    expect(eventsUpdates).toHaveLength(1);
    expect((eventsUpdates[0]!.args[0] as { payload: { status: string } }).payload.status).toBe("processed");
    expect(calls.some((c) => c.table === "events" && c.method === "delete")).toBe(false);
  });

  it("el handler lanza → 500 y la fila de guarda se marca failed (update, no delete)", async () => {
    mocks.constructEvent.mockReturnValue(checkoutCompletedEvent());
    queues.events = [
      { data: { id: 7 }, error: null }, // insert inicial
      { data: null, error: null }, // update final a "failed"
    ];
    // Error real de BD en la confirmación → el handler lanza (ver código).
    queues.contributions = [{ data: null, error: { code: "500", message: "db down" } }];
    const res = await POST(fakeRequest());
    expect(res.status).toBe(500);
    const eventsUpdates = calls.filter((c) => c.table === "events" && c.method === "update");
    expect(eventsUpdates).toHaveLength(1);
    expect((eventsUpdates[0]!.args[0] as { payload: { status: string } }).payload.status).toBe("failed");
    expect(calls.some((c) => c.table === "events" && c.method === "delete")).toBe(false);
  });

  it("Premium Boda: el audit log ya no choca con la clave stripe_event_id de la guarda", async () => {
    mocks.constructEvent.mockReturnValue(premiumCompletedEvent());
    queues.events = [
      { data: { id: 9 }, error: null }, // insert inicial (gate)
      { data: null, error: null }, // insert de auditoría premium_purchased
      { data: null, error: null }, // update final a "processed"
    ];
    queues.weddings = [{ data: null, error: null }]; // update plan=premium
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    const eventsInserts = calls.filter((c) => c.table === "events" && c.method === "insert");
    expect(eventsInserts).toHaveLength(2);
    const auditPayload = (eventsInserts[1]!.args[0] as { payload: Record<string, unknown> }).payload;
    expect(auditPayload).not.toHaveProperty("stripe_event_id");
    expect(auditPayload.source_stripe_event_id).toBe(EVENT_ID);
  });
});
