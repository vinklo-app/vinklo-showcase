import { describe, expect, it } from "vitest";

import { rsvpDigestHtml } from "@/lib/emails/templates";
import { groupRsvpDigests, rsvpDigestKey, rsvpDigestSentence, rsvpDigestSubject } from "./rsvp-digest";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("groupRsvpDigests", () => {
  it("suma personas en los «sí» (con acompañantes) e invitaciones en los «no», por boda", () => {
    const digests = groupRsvpDigests([
      { wedding_id: A, rsvp_status: "si", rsvp_companions: 2 },
      { wedding_id: A, rsvp_status: "si", rsvp_companions: 0 },
      { wedding_id: A, rsvp_status: "no", rsvp_companions: 0 },
      { wedding_id: B, rsvp_status: "no", rsvp_companions: null },
      { wedding_id: B, rsvp_status: "pendiente", rsvp_companions: 3 },
    ]);
    expect(digests).toEqual([
      { weddingId: A, yesPeople: 4, noGuests: 1 },
      { weddingId: B, yesPeople: 0, noGuests: 1 },
    ]);
  });
  it("sin respuestas, ningún resumen", () => {
    expect(groupRsvpDigests([{ wedding_id: A, rsvp_status: "pendiente", rsvp_companions: 0 }])).toEqual([]);
  });
});

describe("texto del resumen", () => {
  it("plurales y singulares", () => {
    expect(rsvpDigestSentence({ yesPeople: 4, noGuests: 1 })).toBe("En las últimas 24 horas, 4 personas han confirmado y 1 invitado no podrá ir.");
    expect(rsvpDigestSentence({ yesPeople: 1, noGuests: 0 })).toBe("En las últimas 24 horas, 1 persona ha confirmado.");
    expect(rsvpDigestSentence({ yesPeople: 0, noGuests: 3 })).toBe("En las últimas 24 horas, 3 invitados no podrán ir.");
    expect(rsvpDigestSubject({ yesPeople: 2, noGuests: 2 })).toBe("Nuevas respuestas: 2 personas han confirmado y 2 invitados no podrán ir");
  });
  it("clave por boda y día", () => {
    expect(rsvpDigestKey(A, "2026-10-21")).toBe(`${A}:2026-10-21`);
  });
});

describe("rsvpDigestHtml", () => {
  const html = rsvpDigestHtml({
    sentence: rsvpDigestSentence({ yesPeople: 4, noGuests: 1 }),
    totalConfirmed: 37,
    panelUrl: "https://vinklo.es/panel/invitados",
    settingsUrl: "https://vinklo.es/panel/ajustes#avisos",
  });
  it("diseño v8: logo, botón arcilla redondeado y la frase", () => {
    expect(html).toContain('<img src="https://vinklo.es/email/vinklo-mark.png"');
    expect(html).toMatch(/background-color:#573B62;border-radius:10px;/);
    expect(html).toContain('href="https://vinklo.es/panel/invitados"');
    expect(html).toContain("4 personas han confirmado y 1 invitado no podrá ir.");
    expect(html).toContain("En total ya vienen 37 personas.");
  });
  it("lleva la baja a Ajustes", () => {
    expect(html).toContain('href="https://vinklo.es/panel/ajustes#avisos"');
    expect(html).toContain("Dejar de recibir este resumen");
  });
  it("sin total, no inventa cifra; escapa el texto", () => {
    const other = rsvpDigestHtml({ sentence: "<b>x</b>", totalConfirmed: null, panelUrl: "https://vinklo.es/panel", settingsUrl: "https://vinklo.es/panel/ajustes" });
    expect(other).not.toContain("En total");
    expect(other).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
