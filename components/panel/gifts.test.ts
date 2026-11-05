import { describe, expect, it } from "vitest";
import { GIFT_MAX_AMOUNT_CENTS, type Gift } from "@/lib/crm/contract";
import {
  centsToInput, coGiversLine, emptyGiftDraft, funnelSteps, giftDraftToInput, giftHeadline, giftsForGuest,
  giftToDraft, percent, rowGiftState,
} from "./gifts";
import { formatEuros } from "@/lib/format/money";

const gift = (over: Partial<Gift> = {}): Gift => ({
  id: "g1", kind: "transferencia", amountCents: 15000, description: null, note: null, receivedOn: null, thankedAt: null,
  givers: [{ guestId: "a", name: "Ana" }], createdAt: "2026-10-01T10:00:00Z", ...over,
});

describe("euros a mano (sin Intl)", () => {
  it("miles con punto, céntimos con coma y solo si hay", () => {
    expect(formatEuros(15000)).toBe("150 €");
    expect(formatEuros(125050)).toBe("1.250,50 €");
    expect(formatEuros(GIFT_MAX_AMOUNT_CENTS)).toBe("100.000 €");
    expect(formatEuros(1)).toBe("0,01 €");
    expect(formatEuros(0)).toBe("0 €");
  });
  it("ida y vuelta del campo de importe", () => {
    expect(centsToInput(125050)).toBe("1250,50");
    expect(centsToInput(15000)).toBe("150");
    expect(centsToInput(null)).toBe("");
  });
});

describe("formulario del regalo", () => {
  const base = { ...emptyGiftDraft("a"), kind: "efectivo" as const };
  it("pide tipo y al menos una persona", () => {
    expect(giftDraftToInput(emptyGiftDraft("a"))).toMatchObject({ ok: false, field: "kind" });
    expect(giftDraftToInput({ ...base, guestIds: [] })).toMatchObject({ ok: false, field: "guestIds" });
  });
  it("importe en es-ES a céntimos; vacío = sin importe", () => {
    expect(giftDraftToInput({ ...base, amount: "1.250,50" })).toMatchObject({ ok: true, input: { amountCents: 125050 } });
    expect(giftDraftToInput({ ...base, amount: "" })).toMatchObject({ ok: true, input: { amountCents: null } });
    expect(giftDraftToInput({ ...base, amount: "mucho" })).toMatchObject({ ok: false, field: "amount" });
    expect(giftDraftToInput({ ...base, amount: "0" })).toMatchObject({ ok: false, field: "amount" });
    expect(giftDraftToInput({ ...base, amount: "100.000,01" })).toMatchObject({ ok: false, field: "amount" });
  });
  it("sin importe en tipos que no son dinero aunque quede texto en el campo", () => {
    expect(giftDraftToInput({ ...base, kind: "objeto", amount: "50" })).toMatchObject({ ok: true, input: { amountCents: null } });
  });
  it("recorta textos, quita repetidos y valida longitudes y fecha", () => {
    const result = giftDraftToInput({ ...base, description: "  Para el viaje ", note: " ", guestIds: ["a", "b", "a"], receivedOn: "2026-10-03" });
    expect(result).toEqual({ ok: true, input: { guestIds: ["a", "b"], kind: "efectivo", amountCents: null, description: "Para el viaje", note: null, receivedOn: "2026-10-03" } });
    expect(giftDraftToInput({ ...base, description: "x".repeat(201) })).toMatchObject({ ok: false, field: "description" });
    expect(giftDraftToInput({ ...base, note: "x".repeat(501) })).toMatchObject({ ok: false, field: "note" });
    expect(giftDraftToInput({ ...base, receivedOn: "03/10/2026" })).toMatchObject({ ok: false, field: "receivedOn" });
  });
  it("editar parte del regalo guardado", () => {
    expect(giftToDraft(gift({ amountCents: 125050, givers: [{ guestId: "a", name: "Ana" }, { guestId: "b", name: "Bea" }] })))
      .toMatchObject({ kind: "transferencia", amount: "1250,50", guestIds: ["a", "b"] });
  });
});

describe("regalos de un invitado", () => {
  it("incluye los de grupo y ordena por recibido / creado", () => {
    const list = [
      gift({ id: "1", receivedOn: "2026-09-01" }),
      gift({ id: "2", givers: [{ guestId: "b", name: "Bea" }] }),
      gift({ id: "3", receivedOn: "2026-10-04", givers: [{ guestId: "b", name: "Bea" }, { guestId: "a", name: "Ana" }] }),
    ];
    expect(giftsForGuest(list, "a").map((item) => item.id)).toEqual(["3", "1"]);
  });
  it("titular y compañeros de regalo", () => {
    expect(giftHeadline(gift())).toBe("150 €");
    expect(giftHeadline(gift({ kind: "objeto", amountCents: null, description: "Copas" }))).toBe("Copas");
    expect(giftHeadline(gift({ kind: "efectivo", amountCents: null }))).toBe("Sin importe anotado");
    const many = gift({ givers: ["a", "b", "c", "d", "e"].map((id) => ({ guestId: id, name: id.toUpperCase() })) });
    expect(coGiversLine(many, "a")).toBe("Junto a B, C y 2 personas más");
    expect(coGiversLine(gift(), "a")).toBe("");
  });
  it("estado de la fila: lo local manda; sin regalos cargados, el del servidor", () => {
    expect(rowGiftState("unknown", [gift()])).toBe("yes");
    expect(rowGiftState("yes", [])).toBe("unknown");
    expect(rowGiftState("no", [])).toBe("no");
    expect(rowGiftState("unknown", [], true)).toBe("no");
    expect(rowGiftState("yes", null)).toBe("yes");
  });
});

describe("embudo", () => {
  it("conversión sobre el paso anterior y barra sobre añadidos", () => {
    const steps = funnelSteps({ reached: { added: 20, prepared: 16, sent: 12, opened: 9, responded: 6 } });
    expect(steps.map((step) => step.conversion)).toEqual([null, 80, 75, 75, 67]);
    expect(steps[4].share).toBeCloseTo(0.3);
  });
  it("sin base no hay porcentaje; nunca pasa de 100", () => {
    expect(percent(3, 0)).toBeNull();
    expect(percent(12, 10)).toBe(100);
    expect(funnelSteps({ reached: { added: 0, prepared: 0, sent: 0, opened: 0, responded: 0 } })[0].share).toBe(0);
  });
});
