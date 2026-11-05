import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/rsvp", () => ({ submitRsvp: vi.fn() }));

import { RsvpForm, demoThanks } from "./rsvp-form";
import type { RsvpModules } from "@/lib/rsvp-answers";

const TOKEN = "a".repeat(64);
const MODULES: RsvpModules = {
  bus: { stops: [{ id: "p-1", name: "Plaza", time: "17:00" }, { id: "p-2", name: "Estación", time: "17:30" }] },
  lodging: null,
  song: true,
  kids: false,
  menu: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }],
};

describe("RsvpForm: respuesta anterior (§2.5)", () => {
  it("sin respuesta anterior: nada elegido ni aviso", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} modules={MODULES} />);
    expect(html).not.toContain("Ya nos respondiste");
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('id="rsvp-companions"');
  });

  it("reabrir el enlace rellena asistencia y módulos; lo privado no se muestra, solo se avisa (M1)", () => {
    const html = renderToStaticMarkup(
      <RsvpForm
        slug="ana-y-luis"
        invitationToken={TOKEN}
        modules={MODULES}
        previous={{ status: "si", companions: 2, hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true, healthConsentAt: "2026-10-08T10:00:00Z", respondedAt: "2026-10-08T10:00:00Z", answers: { bus: { use: "ambos", stop: "p-2" }, song: "Mediterráneo", menu: { "m-1": 2, "m-2": 1 } } }}
      />,
    );
    expect(html).toContain("Ya nos respondiste el 8 de octubre. Puedes cambiarlo aquí.");
    // «Sí» elegido y acompañantes.
    expect(html).toMatch(/aria-pressed="true"[^>]*>¡Sí, allí estaré!/);
    expect(html).toMatch(/<output id="rsvp-companions"[^>]*data-value="2">2<\/output>/);
    // Nota de salud guardada: plegada tras «Cambiarlo» (ítem 11), sin campo ni texto.
    expect(html).not.toContain('id="rsvp-health"');
    expect(html).toContain("data-rsvp-health-folded");
    expect(html).toContain("Ya nos dijiste algo sobre alergias. Por privacidad, no lo mostramos aquí.");
    expect(html).toContain(">Cambiarlo</button>");
    expect(html).toContain(">Borrarlo</button>");
    // La nota logística, vacía y con su aviso: escribir de nuevo la sustituye.
    expect(html).toMatch(/id="rsvp-notes"[^>]*><\/textarea>/);
    expect(html).toContain("Ya nos dejaste una nota; si quieres cambiarla, escríbela de nuevo.");
    expect(html).toContain("Ya nos diste sus nombres; si quieres cambiarlos, escríbelos de nuevo.");
    // Sin nota nueva no hay casilla de salud que marcar (la guardada conserva su permiso).
    expect(html).not.toContain("Acepto que la pareja conozca");
    // Autobús: la respuesta vale para las 3 personas de la invitación.
    expect(html).toContain("¿Usaréis el autobús las 3 personas de vuestra invitación?");
    // Módulos: autobús ida y vuelta desde Estación, canción y menú.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Ida y vuelta/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Estación · 17:30/);
    expect(html).toMatch(/id="rsvp-song"[^>]*value="Mediterráneo"/);
    // Menú por persona (ítem 21): el reparto guardado (2 Carne, 1 Pescado) vuelve por orden.
    const person = (i: number) => html.slice(html.indexOf(`data-rsvp-person="${i}"`), html.indexOf("</li>", html.indexOf(`data-rsvp-person="${i}"`)));
    expect(person(0)).toMatch(/aria-pressed="true"[^>]*>Carne/);
    expect(person(1)).toMatch(/aria-pressed="true"[^>]*>Carne/);
    expect(person(2)).toMatch(/aria-pressed="true"[^>]*>Pescado/);
    expect(person(0)).toContain(">Tú</p>");
    expect(person(1)).toContain(">Acompañante 1</p>");
    // Nota de salud plegada: en cada persona solo vegetariano y vegano, sin casillas de salud.
    expect(person(0)).toContain(">Vegetariano</button>");
    expect(person(0)).not.toContain(">Celiaquía</button>");
  });

  it("una respuesta «no» sale elegida y sin acompañantes", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ status: "no", companions: 0, hasHealthNote: false, respondedAt: null, answers: {} }} />);
    expect(html).toContain("Ya nos respondiste. Puedes cambiarlo aquí.");
    expect(html).toMatch(/aria-pressed="true"[^>]*>No podré ir/);
    expect(html).not.toContain('id="rsvp-companions"');
    expect(html).not.toContain('type="checkbox"');
    // Con «no» no se piden alergias ni su consentimiento (art. 9 RGPD).
    expect(html).not.toContain('id="rsvp-health"');
    expect(html).not.toContain("Alergias o intolerancias");
    // La nota logística sí sigue disponible.
    expect(html).toContain('id="rsvp-notes"');
  });
  it("sin elegir aún: no se piden alergias hasta decir «sí»", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} />);
    expect(html).not.toContain('id="rsvp-health"');
    expect(html).toContain('id="rsvp-notes"');
  });
});

describe("RsvpForm: saludo y aviso del enlace personal (ítem 11)", () => {
  it("con enlace personal y nombre: «Hola, Carmen.» y «es solo para ti, no lo reenvíes»", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} guestName="Carmen" />);
    expect(html).toContain("Hola, Carmen.");
    expect(html).toContain("Este enlace es tu invitación personal: es solo para ti, no lo reenvíes. Guárdalo para cambiar tu respuesta.");
  });
  it("sin nombre no hay saludo inventado; sin enlace personal ni saludo ni aviso", () => {
    expect(renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} />)).not.toContain("data-rsvp-greeting");
    const demo = renderToStaticMarkup(<RsvpForm slug="demo" demo guestName="Carmen" />);
    expect(demo).not.toContain("Hola, Carmen");
    expect(demo).not.toContain("no lo reenvíes");
  });
});

describe("RsvpForm: alergias y nota logística (P1-5)", () => {
  it("etiquetas separadas; sin nota de salud no hay casilla", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ status: "si", companions: 0, hasHealthNote: false, respondedAt: null, answers: {} }} />);
    expect(html).toContain("Alergias o dieta (opcional)");
    // Casillas por persona (ítem 21), sin texto libre de salud.
    for (const chip of ["Celiaquía", "Lactosa", "Frutos secos", "Vegetariano", "Vegano", "Embarazada", "Otra"]) expect(html).toContain(`>${chip}</button>`);
    expect(html).not.toContain('id="rsvp-health"');
    expect(html).toContain("Algo más que debamos saber (opcional)");
    expect(html).not.toContain("cualquier cosa que deban saber");
    expect(html).not.toContain('type="checkbox"');
  });
  it("solo con nota logística: su aviso, ni casilla ni aviso de salud", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ status: "si", companions: 0, hasHealthNote: false, hasLogisticNote: true, respondedAt: null, answers: {} }} />);
    expect(html).toContain("Ya nos dejaste una nota");
    expect(html).not.toContain("Ya nos dijiste algo sobre alergias");
    expect(html).not.toContain('type="checkbox"');
  });
  it("sin nada guardado: ni avisos ni botones de borrar", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ status: "si", companions: 1, hasHealthNote: false, respondedAt: null, answers: {} }} />);
    expect(html).not.toContain("data-rsvp-kept");
    expect(html).not.toContain("Borrar");
  });
  it("autobús en singular si va una persona", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} modules={MODULES} maxCompanions={0} previous={{ status: "si", companions: 0, hasHealthNote: false, respondedAt: null, answers: {} }} />);
    expect(html).toContain("¿Usarás el autobús?");
  });
});

describe("RsvpForm: tope de acompañantes (§4.2)", () => {
  const yes = { status: "si" as const, companions: 1, hasHealthNote: false, respondedAt: null, answers: {} };
  it("con tope: −/+ que no pasa del tope (ítem 21) y lo dice", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={yes} maxCompanions={2} />);
    expect(html).not.toContain('type="number"');
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Una persona más">\+<\/button>/);
    expect(html).toContain("Hasta 2 acompañantes.");
    const full = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ ...yes, companions: 2 }} maxCompanions={2} />);
    expect(full).toMatch(/<button type="button"[^>]*disabled=""[^>]*aria-label="Una persona más">/);
  });
  it("sin tope: el límite de siempre y ningún aviso", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={yes} />);
    expect(html).toMatch(/<output id="rsvp-companions"[^>]*>1<\/output>/);
    expect(html).not.toContain("Hasta ");
    const ten = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ ...yes, companions: 10 }} />);
    expect(ten).toMatch(/disabled=""[^>]*aria-label="Una persona más"/);
  });
  it("tope 0: sin campo de acompañantes", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={yes} maxCompanions={0} />);
    expect(html).not.toContain('id="rsvp-companions"');
    expect(html).toContain("Tu invitación es solo para ti.");
  });
});

describe("RsvpForm: personas sin menú (P1-6, §4-j)", () => {
  const prev = (menu: Record<string, number>) => ({ status: "si" as const, companions: 2, hasHealthNote: false, respondedAt: null, answers: { menu } });
  it("con menús por elegir, aviso no bloqueante con cuántas faltan", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} modules={MODULES} previous={prev({ "m-1": 1 })} />);
    expect(html).toContain("Falta elegir el menú de 2 personas.");
    expect(html).not.toContain("Llevas");
    // El botón de enviar sigue activo.
    expect(html).not.toMatch(/type="submit" disabled=""/);
  });
  it("con todos elegidos, sin aviso", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} modules={MODULES} previous={prev({ "m-1": 2, "m-2": 1 })} />);
    expect(html).not.toContain("Falta elegir el menú");
  });
  it("una respuesta «no» con nota de salud guardada: ni aviso de alergias ni campo (se borra al enviar)", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="ana-y-luis" invitationToken={TOKEN} previous={{ status: "no", companions: 0, hasHealthNote: true, respondedAt: null, answers: {} }} />);
    expect(html).not.toContain("Ya nos dijiste algo sobre alergias");
    expect(html).not.toContain('id="rsvp-health"');
  });
});

describe("RsvpForm: demo (#9)", () => {
  it("pide el nombre (sin enlace personal) y el envío normal", () => {
    const html = renderToStaticMarkup(<RsvpForm slug="demo" demo />);
    expect(html).toContain('id="rsvp-name"');
    expect(html).toContain("Enviar mi respuesta");
  });
  it("«¡Gracias, Marta!» con el nombre de pila", () => {
    expect(demoThanks("Marta García López")).toBe("¡Gracias, Marta!");
    expect(demoThanks("  Marta ")).toBe("¡Gracias, Marta!");
    expect(demoThanks("")).toBe("¡Gracias!");
  });
});
