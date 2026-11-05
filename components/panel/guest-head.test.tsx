import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GuestFilters, moreFiltersActive, type GuestFilterParams } from "./guest-filters";
import { GuestSummaryLine } from "./guest-summary-line";
import { ReminderCallout } from "./reminder-callout";
import { SeriesCallout } from "./series-callout";
import { GUEST_STATUS_HINTS } from "./guest-status";
import { ALL_GROUPS, type GuestGroupSummary } from "@/lib/crm/groups";
import type { AttendanceSummary } from "@/lib/data/attendance";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const summary = (over: Partial<AttendanceSummary>) => ({ total: 20, attendees: 9, prepared: 14, sent: 12, ...over }) as AttendanceSummary;

describe("Cabecera de Invitados (revisión Jobs #11, #17)", () => {
  it("el lead es una línea de estados, con «por vosotros» y sin el aviso de WhatsApp", () => {
    expect(text(renderToStaticMarkup(<GuestSummaryLine summary={summary({})} />))).toBe("9 vienen · 14 preparadas · 12 enviadas por vosotros");
    expect(text(renderToStaticMarkup(<GuestSummaryLine summary={summary({ attendees: 1, prepared: 1, sent: 1 })} />))).toBe("1 viene · 1 preparada · 1 enviada por vosotros");
  });
  it("la frase de WhatsApp pasa a la ayuda del estado «Enviada»", () => {
    expect(GUEST_STATUS_HINTS.sent).toContain("WhatsApp no confirma la entrega a Vinklo.");
  });
  it("los avisos son una línea cada uno, con la acción en un enlace; a cero no se pintan", () => {
    const send = renderToStaticMarkup(<SeriesCallout count={4} href="/panel/invitados/enviar" />);
    expect(text(send)).toBe("4 sin enviar · Enviar");
    expect(send).toContain('href="/panel/invitados/enviar"');
    expect(send).not.toContain("pn-btn");
    const remind = renderToStaticMarkup(<ReminderCallout count={4} href="/panel/invitados/recordatorios" />);
    expect(text(remind)).toBe("4 para recordar · Recordar");
    expect(remind).toContain('href="/panel/invitados/recordatorios"');
    expect(renderToStaticMarkup(<SeriesCallout count={0} href="/x" />)).toBe("");
    expect(renderToStaticMarkup(<ReminderCallout count={0} href="/x" />)).toBe("");
  });
});

describe("«Filtrar» (revisión Jobs #11)", () => {
  const base: GuestFilterParams = { query: "", filter: "todos", page: 1, group: ALL_GROUPS, tag: null, side: null };
  const groups = [{ name: "Amigos", guests: 3 }, { name: null, guests: 2 }] as unknown as GuestGroupSummary[];
  const render = (current: GuestFilterParams) => renderToStaticMarkup(<GuestFilters current={current} gifts groups={groups} tags={[]} sideLabels={{ p1: "De Lucía", p2: "De Juan", ambos: "De los dos" }} />);

  it("por defecto solo la fila de estados a la vista; el resto, plegado tras «Filtrar»", () => {
    const html = render(base);
    expect(html).toContain('<details class="pn-more-filters">');
    expect(html).toMatch(/<summary class="pn-chip pn-press">.*Filtrar<\/summary>/);
    // Las filas existen dentro del <details> (cerrado), no antes.
    expect(html.indexOf("Filtrar por regalos")).toBeGreaterThan(html.indexOf("<details"));
    expect(html.indexOf("Filtrar por grupo")).toBeGreaterThan(html.indexOf("<details"));
    expect(html.indexOf("Filtrar por lo que queda por hacer")).toBeLessThan(html.indexOf("<details"));
  });
  it("con un filtro de detrás activo llega abierto y lo cuenta", () => {
    const current = { ...base, group: { kind: "named", name: "Amigos" } as const };
    expect(moreFiltersActive(current)).toBe(1);
    expect(render(current)).toContain('<details class="pn-more-filters" open="">');
    expect(moreFiltersActive({ ...base, filter: "sin_agradecer", tag: "Trabajo" })).toBe(2);
  });
  it("sin nada detrás, no hay «Filtrar»", () => {
    expect(renderToStaticMarkup(<GuestFilters current={base} />)).not.toContain("<details");
  });
});

describe("Ficha: estado «Enviada» honesto, a la vista (revisión Jobs #17)", () => {
  it("con el envío confirmado, la ficha dice en texto que WhatsApp no confirma la entrega", async () => {
    const { GuestLinkSection, WHATSAPP_NO_DELIVERY } = await import("./guest-list");
    const guest = { id: "g1", name: "Inés", phone: null, rsvp_status: "pendiente", invitation_prepared_at: "2026-10-01T10:00:00Z", invitation_sent_at: "2026-10-02T10:00:00Z" } as never;
    const html = renderToStaticMarkup(<GuestLinkSection guest={guest} actions={{ createInvitation: async () => ({ ok: false, error: "" }), confirmSent: async () => ({ ok: true }) } as never} />);
    expect(WHATSAPP_NO_DELIVERY).toBe("WhatsApp no confirma la entrega a Vinklo.");
    expect(text(html)).toContain("habéis confirmado el envío. WhatsApp no confirma la entrega a Vinklo.");
  });
});
