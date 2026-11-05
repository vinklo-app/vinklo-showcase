import { describe, expect, it } from "vitest";
import { MAX_SKIPPED, parseQueueState, queueUrl, queueView, reminderSummary, shortDate } from "@/components/panel/reminders";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("parseQueueState / queueUrl", () => {
  it("ida y vuelta por la URL", () => {
    const state = { persona: B, confirmar: true, enviados: 2, retirados: 1, saltados: [A] };
    const url = queueUrl("/panel/invitados/recordatorios", state);
    expect(url).toBe(`/panel/invitados/recordatorios?persona=${B}&paso=confirmar&enviados=2&retirados=1&saltados=${A}`);
    expect(parseQueueState(new URLSearchParams(url.split("?")[1]))).toEqual(state);
  });

  it("conserva otros parámetros (ruta de borrador) y quita los de la fila", () => {
    expect(queueUrl(`/borrador/panel?vista=recordatorios&persona=${A}`, { persona: null, confirmar: false, enviados: 0, retirados: 0, saltados: [] }))
      .toBe("/borrador/panel?vista=recordatorios");
  });

  it("descarta valores raros: ids no UUID, contadores negativos o enormes, duplicados", () => {
    const state = parseQueueState({ persona: "<script>", paso: "confirmar", enviados: "-3", retirados: "99999", saltados: `${A},${A},nada,${B}` });
    expect(state).toEqual({ persona: null, confirmar: false, enviados: 0, retirados: 0, saltados: [A, B] });
  });

  it("limita las saltadas", () => {
    const many = Array.from({ length: MAX_SKIPPED + 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseQueueState({ saltados: many.join(",") }).saltados).toHaveLength(MAX_SKIPPED);
  });
});

describe("queueView", () => {
  const queue = [{ id: A }, { id: B }, { id: C }];
  const base = { persona: null, confirmar: false, enviados: 0, retirados: 0, saltados: [] as string[] };

  it("empieza por la primera: 1 de 3", () => {
    expect(queueView(queue, base)).toMatchObject({ current: { id: A }, position: 1, total: 3, remaining: 3 });
  });

  it("tras confirmar a A, el servidor ya no la trae: 2 de 3", () => {
    expect(queueView([{ id: B }, { id: C }], { ...base, enviados: 1 })).toMatchObject({ current: { id: B }, position: 2, total: 3 });
  });

  it("saltar deja a la persona en la fila del servidor pero avanza", () => {
    expect(queueView(queue, { ...base, saltados: [A] })).toMatchObject({ current: { id: B }, position: 2, total: 3, skippedInQueue: 1 });
  });

  it("persona de la URL que ya no está (respondió): se avisa y sigue la siguiente", () => {
    const view = queueView([{ id: C }], { ...base, persona: B, enviados: 1 });
    expect(view.personaGone).toBe(true);
    expect(view.current).toEqual({ id: C });
  });

  it("tanda terminada", () => {
    expect(queueView([{ id: A }], { ...base, enviados: 4, saltados: [A] })).toMatchObject({ current: null, remaining: 0, total: 5, skippedInQueue: 1 });
  });
});

describe("fechas", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("día y mes en hora de Madrid", () => {
    expect(shortDate("2026-10-03T10:00:00Z", now)).toBe("3 oct");
    // 23:30 UTC del 30 de septiembre ya es 1 de octubre en Madrid.
    expect(shortDate("2026-09-30T23:30:00Z", now)).toBe("1 oct");
    expect(shortDate("2025-12-20T10:00:00Z", now)).toBe("20 dic 2025");
    expect(shortDate(null, now)).toBe("");
    expect(shortDate("no-es-fecha", now)).toBe("");
  });
  it("resumen de recordatorios con plural", () => {
    expect(reminderSummary(0, null, now)).toBe("");
    expect(reminderSummary(1, "2026-10-03T10:00:00Z", now)).toBe("Recordada 1 vez, el 3 oct");
    expect(reminderSummary(3, "2026-09-28T10:00:00Z", now)).toBe("Recordada 3 veces, la última el 28 sept");
  });
});
