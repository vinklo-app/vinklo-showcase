import { describe, expect, it } from "vitest";
import { activityText, buildActivity, relativeTime } from "./activity-feed";
import { buildNextActions } from "./next-actions";
import type { CrmFunnelSummary } from "@/lib/crm/contract";

const funnel = (over: Partial<CrmFunnelSummary> = {}): CrmFunnelSummary => ({
  reached: { added: 10, prepared: 8, sent: 6, opened: 4, responded: 2 },
  responses: { yes: 2, no: 0 }, attendees: 3,
  pending: { not_sent: 4, sent_unopened: 2, opened_unanswered: 2 }, toRemind: 3, ...over,
} as CrmFunnelSummary);
const counts = { todos: 10, sin_enviar: 4, esperando: 4, para_recordar: 3, vienen: 2, no_vienen: 0, sin_telefono: 1, con_notas: 2, sin_respuesta: 8, enviada_sin_abrir: 2, abierta_sin_responder: 2, con_regalo: 1, sin_regalo: 0, regalo_sin_indicar: 9, sin_agradecer: 1 };

describe("Lo que toca hoy", () => {
  it("ordena por lo que más acerca a tener respuestas y enlaza a la pantalla filtrada", () => {
    const actions = buildNextActions({ funnel: funnel(), counts, toThank: 1, agendaCount: 0 });
    expect(actions.map((a) => a.key)).toEqual(["send", "remind", "opened", "thank", "notes", "phone", "agenda"]);
    expect(actions.find((a) => a.key === "opened")?.href).toBe("/panel/invitados?filtro=abierta_sin_responder");
    expect(actions.find((a) => a.key === "send")?.count).toBe(4);
  });
  it("sin nada pendiente no inventa tareas", () => {
    const quiet = funnel({ pending: { not_sent: 0, sent_unopened: 0, opened_unanswered: 0 }, toRemind: 0 });
    expect(buildNextActions({ funnel: quiet, counts: { ...counts, con_notas: 0, sin_telefono: 0 }, toThank: 0, agendaCount: 3 })).toEqual([]);
  });
});

describe("Lo que toca hoy: mesas", () => {
  it("con mesas, quien viene sin mesa lleva a la propuesta de /panel/mesas; sin mesas (null) o con todos sentados, nada", () => {
    const quiet = funnel({ pending: { not_sent: 0, sent_unopened: 0, opened_unanswered: 0 }, toRemind: 0 });
    const base = { funnel: quiet, counts: { ...counts, con_notas: 0, sin_telefono: 0 }, toThank: 0, agendaCount: 3 };
    expect(buildNextActions({ ...base, unseated: 5 })).toEqual([expect.objectContaining({ key: "seating", count: 5, href: "/panel/mesas?propuesta=1", title: "personas que vienen sin mesa" })]);
    expect(buildNextActions({ ...base, unseated: 1 })[0]?.title).toBe("persona que viene sin mesa");
    expect(buildNextActions({ ...base, unseated: 0 })).toEqual([]);
    expect(buildNextActions({ ...base, unseated: null })).toEqual([]);
  });
});

describe("Lo último", () => {
  it("mezcla aperturas y respuestas por fecha y marca si se puede recordar", () => {
    const events = buildActivity(
      [{ id: "a", name: "Ana", rsvp_status: "pendiente", invitation_opened_at: "2026-10-05T10:00:00Z" }],
      [{ id: "b", name: "Bea", rsvp_status: "si", rsvp_companions: 1, updated_at: "2026-10-05T12:00:00Z" }, { id: "c", name: "Ciro", rsvp_status: "pendiente", rsvp_companions: 0, updated_at: "2026-10-05T13:00:00Z" }],
    );
    expect(events.map((e) => [e.name, e.kind, e.pending])).toEqual([["Bea", "yes", false], ["Ana", "opened", true]]);
    expect(activityText(events[0]!)).toBe("Bea viene, con 1 acompañante");
  });
  it("hora relativa en español", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(relativeTime("2026-10-05T11:59:30Z", now)).toBe("ahora mismo");
    expect(relativeTime("2026-10-05T10:00:00Z", now)).toBe("hace 2 horas");
    expect(relativeTime("2026-10-04T12:00:00Z", now)).toBe("ayer");
  });
});

describe("Lo que toca hoy: tareas", () => {
  it("vencidas y de esta semana llevan a /panel/tareas; sin migración (null) o sin nada, nada", () => {
    const quiet = funnel({ pending: { not_sent: 0, sent_unopened: 0, opened_unanswered: 0 }, toRemind: 0 });
    const base = { funnel: quiet, counts: { ...counts, con_notas: 0, sin_telefono: 0 }, toThank: 0, agendaCount: 3 };
    expect(buildNextActions({ ...base, tasks: { thisWeek: 3, overdue: 2 } })).toEqual([
      expect.objectContaining({ key: "tasks-overdue", count: 2, href: "/panel/tareas", title: "tareas vencidas", tone: "clay" }),
      expect.objectContaining({ key: "tasks-week", count: 3, href: "/panel/tareas", title: "tareas para esta semana" }),
    ]);
    expect(buildNextActions({ ...base, tasks: { thisWeek: 1, overdue: 0 } })[0]?.title).toBe("tarea para esta semana");
    expect(buildNextActions({ ...base, tasks: { thisWeek: 0, overdue: 1 } })[0]?.title).toBe("tarea vencida");
    expect(buildNextActions({ ...base, tasks: { thisWeek: 0, overdue: 0 } })).toEqual([]);
    expect(buildNextActions({ ...base, tasks: null })).toEqual([]);
  });
});
