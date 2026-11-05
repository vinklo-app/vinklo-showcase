import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GIFT_KINDS, type CrmFunnelSummary, type CrmGiftSummary } from "@/lib/crm/contract";
import { FunnelSteps, GiftSummaryCard, PendingBuckets, showGiftSummary } from "./crm-summary";

const funnel: CrmFunnelSummary = {
  reached: { added: 20, prepared: 16, sent: 12, opened: 9, responded: 6 },
  responses: { yes: 4, no: 2 },
  attendees: 7,
  pending: { not_sent: 8, sent_unopened: 3, opened_unanswered: 3 },
  toRemind: 2,
};

const byKind = Object.fromEntries(GIFT_KINDS.map((kind) => [kind, { count: 0, totalCents: 0 }])) as CrmGiftSummary["byKind"];
const summary: CrmGiftSummary = {
  count: 3, totalCents: 45050, withAmount: 2,
  byKind: { ...byKind, transferencia: { count: 1, totalCents: 15000 }, efectivo: { count: 1, totalCents: 30050 }, objeto: { count: 1, totalCents: 0 } },
  unthanked: 2,
  guests: { yes: 3, no: 1, unknown: 16 },
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("embudo y sin respuesta", () => {
  it("cinco pasos con su conversión y el reparto sí/no", () => {
    const html = text(renderToStaticMarkup(<FunnelSteps funnel={funnel} />));
    for (const label of ["Añadidos", "Invitación preparada", "Enviada", "Abierta", "Respondida"]) expect(html).toContain(label);
    expect(html).toContain("75 % de las preparadas");
    expect(html).toContain("4 vienen");
    expect(html).toContain("2 no vienen");
  });
  it("cada grupo enlaza a la lista con el filtro de los datos", () => {
    const html = renderToStaticMarkup(<PendingBuckets pending={funnel.pending} />);
    expect(html).toContain('href="/panel/invitados?filtro=sin_enviar"');
    expect(html).toContain('href="/panel/invitados?filtro=enviada_sin_abrir"');
    expect(html).toContain('href="/panel/invitados?filtro=abierta_sin_responder"');
    expect(text(html)).toContain("14 personas sin responder");
  });
  it("sin nadie pendiente no pinta nada", () => {
    expect(renderToStaticMarkup(<PendingBuckets pending={{ not_sent: 0, sent_unopened: 0, opened_unanswered: 0 }} />)).toBe("");
  });
});

describe("libro de regalos", () => {
  it("total anotado (no cobrado), tipos presentes y por agradecer", () => {
    const html = renderToStaticMarkup(<GiftSummaryCard summary={summary} />);
    const plain = text(html);
    expect(plain).toContain("450,50 €");
    expect(plain).toContain("anotado por vosotros");
    expect(plain).toContain("Sobre en efectivo");
    expect(plain).not.toContain("Bizum");
    expect(plain).toContain("2 por agradecer");
    expect(plain).toContain("Vinklo no gestiona ni cobra estos regalos");
    expect(html).toContain('href="/panel/invitados?filtro=sin_agradecer"');
    expect(plain).not.toMatch(/recaudad|cobrado|recibido en Vinklo/i);
  });
  it("vacío y error", () => {
    expect(text(renderToStaticMarkup(<GiftSummaryCard summary={{ ...summary, count: 0, totalCents: 0, unthanked: 0 }} />))).toContain("anotadlo desde su ficha");
    expect(renderToStaticMarkup(<GiftSummaryCard summary={null} error />)).toContain('role="alert"');
  });
  it("todo agradecido: lo dice en oliva", () => {
    expect(text(renderToStaticMarkup(<GiftSummaryCard summary={{ ...summary, unthanked: 0 }} />))).toContain("Todos los regalos anotados están agradecidos.");
  });
});

describe("tarjeta de regalos con la lista vacía", () => {
  const empty = { ...summary, count: 0, totalCents: 0, unthanked: 0 };
  it("sin invitados ni regalos no se enseña", () => {
    expect(showGiftSummary({ guests: 0, guestsError: false, summary: empty })).toBe(false);
  });
  it("aparece con el primer invitado", () => {
    expect(showGiftSummary({ guests: 1, guestsError: false, summary: empty })).toBe(true);
  });
  it("se enseña si falla una lectura o si ya hay regalos anotados", () => {
    expect(showGiftSummary({ guests: 0, guestsError: false, summary: null })).toBe(true);
    expect(showGiftSummary({ guests: 0, guestsError: true, summary: empty })).toBe(true);
    expect(showGiftSummary({ guests: 0, guestsError: false, summary })).toBe(true);
  });
});
