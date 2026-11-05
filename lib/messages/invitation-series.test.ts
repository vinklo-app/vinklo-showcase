import { describe, expect, it } from "vitest";
import { activeSeriesFilter, filterSeries, hasSeriesFilter, needsInvitation, nextInSeries, parseSeriesFilter, seriesGroups, seriesHref, seriesSides, seriesTags, sortInvitationQueue, splitInvitationQueue, type InvitationQueueItem } from "@/lib/messages/invitation-series";
import { parseQueueState, queueUrl, queueView } from "@/components/panel/reminders";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

const row = (id: string, name: string, phone: string | null, group_name: string | null = null) =>
  ({ id, name, phone, rsvp_status: "pendiente" as const, invitation_prepared_at: null, group_name });

describe("splitInvitationQueue", () => {
  it("solo entran móviles que sirven para WhatsApp; el resto se cuenta aparte", () => {
    const { items, withoutPhone } = splitInvitationQueue([row(A, "Ana", "612 345 678"), row(B, "Bea", null), row(C, "Carlos", "123456"), row(D, "Dani", "+44 7700 900123")]);
    expect(items.map((item) => item.id)).toEqual([A, D]);
    expect(withoutPhone).toBe(2);
  });

  it("quien ya respondió (sí o no) o abrió su enlace no recibe otra invitación (revisión UX P0 #3, P1 #14)", () => {
    const { items, withoutPhone } = splitInvitationQueue([
      row(A, "Ana", "612345678"),
      { ...row(B, "Bea", "612345679"), rsvp_status: "si" as const },
      { ...row(C, "Carlos", null), rsvp_status: "no" as const },
      { ...row(D, "Dani", "612345680"), invitation_opened_at: "2026-10-02T18:30:00Z" },
    ]);
    expect(items.map((item) => item.id)).toEqual([A]);
    expect(withoutPhone).toBe(0);
    expect(items[0]).not.toHaveProperty("invitation_opened_at");
  });

  it("needsInvitation", () => {
    expect(needsInvitation({ rsvp_status: "pendiente" })).toBe(true);
    expect(needsInvitation({ rsvp_status: "pendiente", invitation_opened_at: null })).toBe(true);
    expect(needsInvitation({ rsvp_status: "pendiente", invitation_opened_at: "2026-10-02T18:30:00Z" })).toBe(false);
    expect(needsInvitation({ rsvp_status: "si" })).toBe(false);
    expect(needsInvitation({ rsvp_status: "no" })).toBe(false);
  });

  it("sin la columna de grupos, group_name queda en null", () => {
    const { items } = splitInvitationQueue([{ id: A, name: "Ana", phone: "612345678", rsvp_status: "pendiente", invitation_prepared_at: null }]);
    expect(items[0].group_name).toBeNull();
    expect(items[0].tags).toEqual([]);
    expect(items[0].side).toBeNull();
  });
});

describe("filtros por grupo, etiqueta y lado", () => {
  const item = (id: string, group_name: string | null, tags: string[], side: InvitationQueueItem["side"]): InvitationQueueItem =>
    ({ id, name: id, phone: "612345678", rsvp_status: "pendiente", invitation_prepared_at: null, group_name, tags, side });
  const queue = [
    item("1", "Familia", ["Uni", "Pueblo"], "p1"),
    item("2", "Familia", ["Pueblo"], null),
    item("3", null, ["Uni"], "p2"),
    item("4", null, [], "ambos"),
  ];
  it("lee los mismos parámetros que /panel/invitados (grupo, etiqueta, lado=sin)", () => {
    expect(parseSeriesFilter({ grupo: "Familia", etiqueta: "  Uni ", lado: "sin" })).toEqual({ group: "Familia", tag: "Uni", side: "none" });
    expect(parseSeriesFilter({ lado: "novia", etiqueta: "x".repeat(31) })).toEqual({ group: null, tag: null, side: null });
    expect(hasSeriesFilter(parseSeriesFilter({}))).toBe(false);
  });
  it("se combinan (y); la etiqueta es exacta; «sin indicar» = sin lado", () => {
    expect(filterSeries(queue, { group: null, tag: "Uni", side: null }).map((i) => i.id)).toEqual(["1", "3"]);
    expect(filterSeries(queue, { group: "Familia", tag: "Pueblo", side: "none" }).map((i) => i.id)).toEqual(["2"]);
    expect(filterSeries(queue, { group: null, tag: "uni", side: null })).toEqual([]);
    expect(filterSeries(queue, { group: null, tag: null, side: "ambos" }).map((i) => i.id)).toEqual(["4"]);
  });
  it("recuentos de etiquetas y lados de la fila entera; sin lados, ningún chip de lado", () => {
    expect(seriesTags(queue)).toEqual([["Pueblo", 2], ["Uni", 2]]);
    expect(seriesSides(queue)).toEqual([["p1", 1], ["p2", 1], ["ambos", 1], ["none", 1]]);
    expect(seriesSides([item("5", null, [], null)])).toEqual([]);
  });
  it("un grupo o etiqueta que ya no está en la fila no filtra; el lado, solo si alguien tiene lado", () => {
    expect(activeSeriesFilter(queue, { group: "Trabajo", tag: "Uni", side: "p1" })).toEqual({ group: null, tag: "Uni", side: "p1" });
    expect(activeSeriesFilter([item("5", null, [], null)], { group: null, tag: "Uni", side: "none" })).toEqual({ group: null, tag: null, side: null });
  });
  it("URL con grupo, etiqueta y lado (sin → «sin»), sobre una base con o sin query", () => {
    expect(seriesHref("/panel/invitados/enviar", { group: null, tag: null, side: null })).toBe("/panel/invitados/enviar");
    expect(seriesHref("/panel/invitados/enviar", { group: "Familia de Elena", tag: "Amigos & uni", side: "none" }))
      .toBe("/panel/invitados/enviar?grupo=Familia+de+Elena&etiqueta=Amigos+%26+uni&lado=sin");
    expect(seriesHref("/borrador/panel?vista=enviar&datos=demo", { group: null, tag: "Uni", side: "p2" })).toBe("/borrador/panel?vista=enviar&datos=demo&etiqueta=Uni&lado=p2");
    // Lo que escribe seriesHref lo vuelve a leer parseSeriesFilter.
    const url = new URL(seriesHref("https://x.test/enviar", { group: "Familia", tag: "Uni", side: "ambos" }));
    expect(parseSeriesFilter(Object.fromEntries(url.searchParams))).toEqual({ group: "Familia", tag: "Uni", side: "ambos" });
  });
});

describe("sortInvitationQueue", () => {
  it("por grupo (alfabético, sin tildes que molesten), «sin grupo» al final, estable dentro del grupo", () => {
    const sorted = sortInvitationQueue([
      { id: "1", group_name: null }, { id: "2", group_name: "Trabajo" }, { id: "3", group_name: "Ábuelos" },
      { id: "4", group_name: "Trabajo" }, { id: "5", group_name: null }, { id: "6", group_name: "Amigos" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["3", "6", "2", "4", "1", "5"]);
  });
});

describe("nextInSeries", () => {
  const queue = [{ id: A }, { id: B }, { id: C }, { id: D }];
  it("la siguiente en el orden de la fila", () => {
    expect(nextInSeries(queue, [], A)?.id).toBe(B);
  });
  it("salta a quien se ha saltado", () => {
    expect(nextInSeries(queue, [B, C], A)?.id).toBe(D);
  });
  it("al final vuelve a la primera pendiente; sola, nadie", () => {
    expect(nextInSeries(queue, [], D)?.id).toBe(A);
    expect(nextInSeries([{ id: A }], [], A)).toBeNull();
    expect(nextInSeries(queue, [B, C, D], A)).toBeNull();
  });
});

describe("tanda de envío con el estado de la fila de recordatorios", () => {
  it("diez seguidas sin volver a la lista: cada confirmación saca a la persona y la siguiente toma el relevo", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`);
    let queue = ids.map((id) => ({ id }));
    let state = parseQueueState({});
    for (let sent = 0; sent < 10; sent += 1) {
      const view = queueView(queue, state);
      expect(view.current?.id).toBe(ids[sent]);
      expect(view.position).toBe(sent + 1);
      expect(view.total).toBe(10);
      const next = nextInSeries(queue, state.saltados, ids[sent]);
      // «Sí · Ahora a …»: la confirmada sale de la fila del servidor y la URL apunta a la siguiente.
      queue = queue.filter((item) => item.id !== ids[sent]);
      const url = queueUrl("/panel/invitados/enviar", { ...state, persona: next?.id ?? null, confirmar: Boolean(next), enviados: state.enviados + 1 });
      state = parseQueueState(new URLSearchParams(url.split("?")[1] ?? ""));
    }
    expect(queueView(queue, state).current).toBeNull();
    expect(state.enviados).toBe(10);
  });

  it("la URL conserva el grupo y nunca lleva enlaces", () => {
    const url = queueUrl("/panel/invitados/enviar?grupo=Familia", { persona: A, confirmar: true, enviados: 3, retirados: 0, saltados: [] });
    expect(url).toBe(`/panel/invitados/enviar?grupo=Familia&persona=${A}&paso=confirmar&enviados=3`);
    expect(url).not.toMatch(/invitacion=|wa\.me/);
  });
});

describe("seriesGroups", () => {
  it("cuenta por grupo e ignora «sin grupo»", () => {
    expect(seriesGroups([{ group_name: "Trabajo" }, { group_name: null }, { group_name: "Amigos" }, { group_name: "Trabajo" }])).toEqual([["Amigos", 1], ["Trabajo", 2]]);
  });
});
