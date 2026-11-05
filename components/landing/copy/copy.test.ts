import { describe, expect, it } from "vitest";

import { landingCopy } from "@/components/landing/copy";
import { DEMO_GUESTS } from "@/components/landing/demo-guests";
import { DEMO_TEMPLATES } from "@/components/landing/demo-wedding";
import { FAQS } from "@/components/landing/faqs";

const es = landingCopy("es");
const en = landingCopy("en");

describe("textos de la landing por idioma", () => {
  it("español por defecto, con las mismas preguntas que /preguntas", () => {
    expect(landingCopy()).toBe(es);
    expect(es.faq.items).toBe(FAQS);
  });

  it("las listas tienen tantos elementos en inglés como en español", () => {
    expect(en.know.items).toHaveLength(es.know.items.length);
    expect(en.mark).toHaveLength(es.mark.length);
    expect(en.flight.steps).toHaveLength(es.flight.steps.length);
    expect(en.bento.day.agenda).toHaveLength(es.bento.day.agenda.length);
    expect(en.gifts.subs).toHaveLength(es.gifts.subs.length);
  });

  it("hay un nombre por cada invitado de ejemplo", () => {
    expect(es.guests.names).toEqual(DEMO_GUESTS.map((g) => g.name));
    expect(en.guests.names).toHaveLength(DEMO_GUESTS.length);
  });

  it("cada plantilla tiene su texto en inglés", () => {
    for (const t of DEMO_TEMPLATES) expect(en.templates.byId[t.id]).toBeDefined();
  });

  it("la versión inglesa avisa de que el producto sigue en español", () => {
    expect(en.hero.note).toMatch(/Spanish/);
    expect(en.faq.items.at(-1)?.a).toMatch(/Spanish/);
    expect(es.hero.note).toBeNull();
  });

  it("cada versión enlaza a la otra", () => {
    expect(es.nav.language.href).toBe(en.home);
    expect(en.nav.language.href).toBe(es.home);
  });
});
