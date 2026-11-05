import { describe, expect, it } from "vitest";
import { withVisitors, type SeatGuest, type SeatingPlan } from "./seating";
import { computeSignals, nextMemory, parseSeatingMemory, seatingSnapshot, shouldNotify, signalLines, type SeatingMemory } from "./seating-signals";

const g = (id: string, opts: Partial<SeatGuest> = {}): SeatGuest => ({
  id, name: id, rsvp_status: "si", companions: 0, notes: null, group_name: null, tags: [], side: null, kids: 0, companion_list: [], ...opts,
});

function plan(unseated: SeatGuest[], seated: SeatGuest[] = [], seats = 10): SeatingPlan {
  return withVisitors({ tables: [{ id: "t1", name: "Mesa 1", seats, position: 1, guests: seated }], unseated, apart: [] });
}

describe("seatingSnapshot", () => {
  it("cuenta personas confirmadas y etiquetadas (quien no viene no cuenta)", () => {
    const p = plan([g("a", { companions: 2, tags: ["Uni"] }), g("b", { rsvp_status: "pendiente" }), g("c", { rsvp_status: "no" })]);
    expect(seatingSnapshot(p)).toEqual({ confirmed: 3, untagged: 1, tagged: 1 });
  });
});

describe("computeSignals", () => {
  it("sin nada que hacer, sin señales", () => {
    const p = plan([], [g("a", { tags: ["Uni"] })]);
    expect(computeSignals(p, null)).toMatchObject({ signals: [], fingerprint: "" });
  });
  it("invitados que vienen sin mesa", () => {
    const s = computeSignals(plan([g("a", { companions: 1 }), g("b", { rsvp_status: "pendiente" })]), null);
    expect(s.signals).toEqual([{ kind: "unseated", people: 2 }]);
    expect(s.fingerprint).toBe("u2");
  });
  it("mesa por encima de sus plazas", () => {
    const s = computeSignals(plan([], [g("a", { companions: 3 })], 2), null);
    expect(s.signals).toEqual([{ kind: "over", tables: ["t1"] }]);
  });
  it("se ha terminado de etiquetar: solo con una foto anterior con gente sin etiqueta", () => {
    const now = plan([], [g("a", { tags: ["Uni"] }), g("b", { tags: ["Trabajo"] })]);
    expect(computeSignals(now, null).signals).toEqual([]);
    expect(computeSignals(now, { confirmed: 2, untagged: 0, tagged: 2 }).signals).toEqual([]);
    expect(computeSignals(now, { confirmed: 2, untagged: 1, tagged: 1 }).signals).toEqual([{ kind: "tagged", guests: 2 }]);
  });
  it("cambia el número de confirmados", () => {
    const now = plan([], [g("a", { companions: 1 })]);
    expect(computeSignals(now, { confirmed: 2, untagged: 1, tagged: 0 }).signals).toEqual([]);
    expect(computeSignals(now, { confirmed: 1, untagged: 1, tagged: 0 }).signals).toEqual([{ kind: "confirmed", before: 1, now: 2 }]);
  });
  it("es determinista y la huella cambia con cada cambio", () => {
    const a = computeSignals(plan([g("a")]), null);
    expect(computeSignals(plan([g("a")]), null)).toEqual(a);
    expect(computeSignals(plan([g("a"), g("b")]), null).fingerprint).not.toBe(a.fingerprint);
  });
});

describe("aviso una vez por cambio", () => {
  it("sale, se descarta y no vuelve hasta que algo cambia", () => {
    let memory: SeatingMemory | null = null as SeatingMemory | null;
    const first = computeSignals(plan([g("a")]), memory?.snapshot ?? null);
    expect(shouldNotify(first, memory)).toBe(true);
    // Sin verlo: sigue pendiente.
    memory = nextMemory(first, memory, false);
    expect(memory).toBeNull();
    // Descartado.
    memory = nextMemory(first, memory, true);
    const again = computeSignals(plan([g("a")]), memory!.snapshot);
    expect(shouldNotify(again, memory)).toBe(false);
    // Entra otro confirmado: vuelve a salir (sin mesa y confirmados).
    const changed = computeSignals(plan([g("a"), g("b")]), memory!.snapshot);
    expect(changed.signals.map((s) => s.kind)).toEqual(["unseated", "confirmed"]);
    expect(shouldNotify(changed, memory)).toBe(true);
  });
  it("sin aviso, la foto se actualiza en silencio para detectar el siguiente etiquetado", () => {
    const untagged = computeSignals(plan([], [g("a"), g("b", { tags: ["Uni"] })]), null);
    const memory = nextMemory(untagged, null, false)!;
    expect(memory.snapshot.untagged).toBe(1);
    const tagged = computeSignals(plan([], [g("a", { tags: ["Uni"] }), g("b", { tags: ["Uni"] })]), memory.snapshot);
    expect(tagged.signals).toEqual([{ kind: "tagged", guests: 2 }]);
    expect(shouldNotify(tagged, memory)).toBe(true);
  });
  it("lee el recuerdo guardado con tolerancia", () => {
    expect(parseSeatingMemory(null)).toBeNull();
    expect(parseSeatingMemory("{roto")).toBeNull();
    expect(parseSeatingMemory(JSON.stringify({ fingerprint: "u1", snapshot: { confirmed: -1, untagged: 0, tagged: 0 } }))).toBeNull();
    expect(parseSeatingMemory(JSON.stringify({ fingerprint: "u1", snapshot: { confirmed: 3, untagged: 0, tagged: 2 } }))).toEqual({ fingerprint: "u1", snapshot: { confirmed: 3, untagged: 0, tagged: 2 } });
  });
});

describe("signalLines", () => {
  it("frases en español de España", () => {
    expect(signalLines([
      { kind: "tagged", guests: 4 }, { kind: "unseated", people: 12 }, { kind: "over", tables: ["t1"] }, { kind: "confirmed", before: 40, now: 1 },
    ], () => "Mesa 1")).toEqual([
      "Habéis terminado de etiquetar a vuestros invitados.",
      "12 personas que vienen aún no tienen mesa.",
      "Mesa 1 supera sus plazas.",
      "Han cambiado los confirmados: de 40 personas a 1 persona.",
    ]);
  });
});
