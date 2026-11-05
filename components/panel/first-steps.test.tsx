import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ADD_GUESTS_HREF, FirstSteps, buildFirstSteps, firstStepsComplete } from "./first-steps";
import { NextActions, STARTER_LINE, buildNextActions } from "./next-actions";

const fresh = { visibility: "published", guests: 0, sent: 0, replies: 0, slug: "ana-y-pablo" } as const;
const add = (html: string) => html.split(`href="${ADD_GUESTS_HREF}"`).length - 1;

describe("«Primeros pasos» del panel (revisión UX, ítem 8)", () => {
  it("recién creada y publicada: web hecha, invitados es el siguiente paso; nada de «Revisad los datos»", () => {
    const steps = buildFirstSteps(fresh);
    expect(steps.map((s) => [s.key, s.done])).toEqual([["web", true], ["guests", false], ["send", false], ["reply", false]]);
    expect(steps[0]).toMatchObject({ title: "Vuestra web está publicada", href: "/b/ana-y-pablo" });
    expect(steps[1]).toMatchObject({ title: "Añadid a vuestros primeros invitados", href: ADD_GUESTS_HREF });
    const html = renderToStaticMarkup(<FirstSteps steps={steps} />);
    expect(html).toContain("1 de 4 hechos");
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("Revisad los datos");
  });
  it("en vivo sin publicar (I-5, siteVisibility «live»): ya se ve; publicar trae la foto y los colores", () => {
    const steps = buildFirstSteps({ ...fresh, visibility: "live" });
    expect(steps[0]).toMatchObject({ key: "web", done: false, href: "/panel/ajustes", title: "Publicad vuestra web" });
    expect(steps[0]!.detail).toContain("Ya se ve");
    expect(steps[0]!.detail).not.toContain("sin publicar");
    expect(renderToStaticMarkup(<FirstSteps steps={steps} />)).toMatch(/aria-current="step"[^>]*>.*Publicad vuestra web/);
  });
  it("retirada (I-5): «Volved a publicar», nunca «guardada, pero sin publicar»", () => {
    const steps = buildFirstSteps({ ...fresh, visibility: "withdrawn" });
    expect(steps[0]).toMatchObject({ key: "web", done: false, href: "/panel/ajustes", title: "Volved a publicar vuestra web" });
    expect(steps[0]!.detail).toContain("retirada");
  });
  it("publicada: la web se abre en otra pestaña (no se sale del panel) y lo dice", () => {
    const html = renderToStaticMarkup(<FirstSteps steps={buildFirstSteps(fresh)} />);
    expect(html).toContain('target="_blank" rel="noopener noreferrer" href="/b/ana-y-pablo"');
    expect(html).toContain("(se abre en otra pestaña)");
  });
  it("estado de la web desconocido: ese paso no se enseña (no se adivina)", () => {
    expect(buildFirstSteps({ ...fresh, visibility: null }).map((s) => s.key)).toEqual(["guests", "send", "reply"]);
  });
  it("cada dato marca su paso: invitados, primer envío, primera respuesta; con todo, completa", () => {
    expect(buildFirstSteps({ ...fresh, guests: 3 }).map((s) => s.done)).toEqual([true, true, false, false]);
    expect(buildFirstSteps({ ...fresh, guests: 3, sent: 1 }).map((s) => s.done)).toEqual([true, true, true, false]);
    const all = buildFirstSteps({ ...fresh, guests: 3, sent: 1, replies: 1 });
    expect(firstStepsComplete(all)).toBe(true);
    expect(firstStepsComplete(buildFirstSteps(fresh))).toBe(false);
  });
  it("los pasos hechos lo dicen también al lector de pantalla", () => {
    expect(renderToStaticMarkup(<FirstSteps steps={buildFirstSteps(fresh)} />)).toContain('<span class="sr-only">Hecho: </span>Vuestra web está publicada');
  });
  it("sin invitados, una sola llamada a añadir en la zona: los pasos sustituyen a la línea de arranque", () => {
    const actions = buildNextActions({ funnel: null, counts: null, toThank: 0, agendaCount: 0 });
    const html = renderToStaticMarkup(<NextActions actions={actions} hasGuests={false} progress={<FirstSteps steps={buildFirstSteps(fresh)} />} />);
    expect(html).not.toContain(STARTER_LINE);
    expect(add(html)).toBe(1);
    // El programa del día sigue como paso propio (antes «Añadid lugares y horarios»).
    expect(html).toContain("Añadid el programa del día");
  });
  it("I-7: con invitados también se ven mientras falte alguno (p. ej. sin respuestas aún)", () => {
    const steps = buildFirstSteps({ ...fresh, guests: 3, sent: 2 });
    expect(firstStepsComplete(steps)).toBe(false);
    const html = renderToStaticMarkup(<NextActions actions={[]} progress={<FirstSteps steps={steps} />} />);
    expect(html).toContain("3 de 4 hechos");
    expect(html).toContain("Primera invitación enviada");
    expect(html).toContain("siguientes pasos");
  });
  it("sin pasos que enseñar, NextActions sigue como antes (línea de arranque)", () => {
    expect(renderToStaticMarkup(<NextActions actions={[]} hasGuests={false} />)).toContain(STARTER_LINE);
  });
});
