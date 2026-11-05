import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NextActions, STARTER_LINE, buildNextActions } from "./next-actions";
import type { CrmFunnelSummary } from "@/lib/crm/contract";

const funnel = (over: Partial<CrmFunnelSummary> = {}): CrmFunnelSummary => ({
  reached: { added: 10, prepared: 8, sent: 6, opened: 4, responded: 2 },
  responses: { yes: 2, no: 0 }, attendees: 3,
  pending: { not_sent: 0, sent_unopened: 0, opened_unanswered: 0 }, toRemind: 0, ...over,
} as CrmFunnelSummary);
const counts = { todos: 10, sin_enviar: 0, esperando: 0, para_recordar: 0, vienen: 2, no_vienen: 0, sin_telefono: 0, con_notas: 0, sin_respuesta: 0, enviada_sin_abrir: 0, abierta_sin_responder: 0, con_regalo: 0, sin_regalo: 0, regalo_sin_indicar: 0, sin_agradecer: 0 };
const base = { funnel: funnel(), counts, toThank: 0, agendaCount: 3 };

describe("Personas sin menú en «Lo que toca hoy» (P1-6)", () => {
  it("con menú en la web y gente sin elegir, ítem que lleva a /panel/dia; null o 0, nada", () => {
    expect(buildNextActions({ ...base, menuMissing: 8 })).toEqual([expect.objectContaining({ key: "menu", count: 8, title: "personas sin menú", href: "/panel/dia" })]);
    expect(buildNextActions({ ...base, menuMissing: 1 })[0]?.title).toBe("persona sin menú");
    expect(buildNextActions({ ...base, menuMissing: 0 })).toEqual([]);
    expect(buildNextActions({ ...base, menuMissing: null })).toEqual([]);
    expect(buildNextActions(base)).toEqual([]);
  });
});

describe("Orden de «Lo que toca hoy» (P1-7)", () => {
  it("las tareas vencidas van antes que los agradecimientos", () => {
    const keys = buildNextActions({ ...base, toThank: 4, tasks: { overdue: 2, thisWeek: 5 }, menuMissing: 3, unseated: 9 }).map((a) => a.key);
    expect(keys.indexOf("tasks-overdue")).toBeLessThan(keys.indexOf("thank"));
  });
  it("orden completo: respuestas, vencidas, menú, regalos, semana, mesas; luego lo informativo", () => {
    const actions = buildNextActions({
      funnel: funnel({ pending: { not_sent: 1, sent_unopened: 0, opened_unanswered: 1 }, toRemind: 1 }),
      counts: { ...counts, con_notas: 2, sin_telefono: 1 }, toThank: 1, agendaCount: 0,
      tasks: { overdue: 1, thisWeek: 1 }, menuMissing: 1, unseated: 1,
    });
    expect(actions.map((a) => a.key)).toEqual(["send", "remind", "opened", "tasks-overdue", "menu", "thank", "tasks-week", "seating", "notes", "phone", "agenda"]);
  });
});

describe("NextActions: render", () => {
  it("con tarjetas no hay línea «Esta semana»: las tarjetas ya lo dicen (revisión Jobs #12)", () => {
    const actions = buildNextActions({ ...base, funnel: funnel({ pending: { not_sent: 12, sent_unopened: 0, opened_unanswered: 0 } }), menuMissing: 8, unseated: 3 });
    const html = renderToStaticMarkup(<NextActions actions={actions} />);
    expect(html).not.toContain("Esta semana:");
    expect(html).not.toContain("pn-week");
    expect(html.match(/class="pn-todo-item/g)).toHaveLength(3);
  });
  it("con todo al día no hay línea ni se inventa nada", () => {
    const html = renderToStaticMarkup(<NextActions actions={[]} />);
    expect(html).not.toContain("Esta semana:");
    expect(html).toContain("No hay nada pendiente ahora mismo.");
  });
  it("sin invitados: la línea de inicio enlaza a añadir y no dice «todo al día»", () => {
    const html = renderToStaticMarkup(<NextActions actions={buildNextActions({ ...base, funnel: null, counts: null, agendaCount: 0 })} hasGuests={false} />);
    expect(html).toContain(STARTER_LINE);
    expect(html).toContain('href="/panel/invitados?nuevo=1"');
    expect(html).not.toContain("Todo <em>al día");
    expect(html).not.toContain("No hay nada pendiente");
    expect(html).not.toContain("Esta semana:");
    // El programa del día sigue en la lista.
    expect(html).toContain("Añadid el programa del día");
    expect(renderToStaticMarkup(<NextActions actions={[]} hasGuests={false} />)).not.toContain("No hay nada pendiente");
  });
});

describe("«Personas para recordar» con el recuento de la fila", () => {
  it("el total de getReminderCandidates manda sobre el SQL (plazo, margen de 3 días y aperturas)", () => {
    const sqlSays = { ...base, funnel: funnel({ toRemind: 5 }) };
    expect(buildNextActions({ ...sqlSays, toRemind: 0 }).some((a) => a.key === "remind")).toBe(false);
    expect(buildNextActions({ ...sqlSays, toRemind: 2 }).find((a) => a.key === "remind")?.count).toBe(2);
    // Si la fila no se pudo leer (null), se usa el recuento SQL de siempre.
    expect(buildNextActions({ ...sqlSays, toRemind: null }).find((a) => a.key === "remind")?.count).toBe(5);
  });
});
