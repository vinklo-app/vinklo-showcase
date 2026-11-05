import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { documentFromLegacy, findScene } from "@/lib/site-document";

vi.mock("@/components/guest/rsvp-form", () => ({
  RsvpForm: ({ slug, demo }: { slug: string; demo?: boolean }) => <form data-testid="rsvp-form" data-slug={slug} data-demo={demo ? "" : undefined} />,
}));

import { InvitationRenderer } from "../renderer";
import { RsvpScene } from "./rsvp";

const NOW = new Date("2027-04-20T10:00:00Z");
const document = documentFromLegacy({
  partner_name_1: "María",
  partner_name_2: "Jorge",
  wedding_date: "2027-06-12",
  cover_image_url: null,
  page_config: { style: "editorial", welcomeMessage: "", venue: "", address: "", time: "" },
  agenda: [],
});
const scene = findScene(document, "rsvp")!;
const base = { slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true };

describe("RsvpScene: enlace personal no válido", () => {
  it("revocado o mal copiado: aviso amable de tú en lugar del formulario; el título de la escena se mantiene", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, linkInvalid: true, window: { status: "open", deadline: null } }} />);
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).toContain("Este enlace ya no es válido; pide a los novios uno nuevo.");
    expect(html).toContain("data-rsvp-link-invalid");
    expect(html).toContain(scene.props.title);
  });
  it("con el plazo cerrado manda el cierre", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, linkInvalid: true, window: { status: "closed", reason: "deadline", deadline: "2027-04-01" } }} />);
    expect(html).not.toContain("Este enlace ya no es válido");
    expect(html).toContain("Confirmaciones cerradas");
  });
  it("cerrado según la RPC (boda sin fechas, enlace caducado): aviso en lugar de un formulario vacío y sin tope", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, linkClosed: true, window: { status: "open", deadline: null } }} />);
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).toContain("Este enlace ya no acepta respuestas.");
    expect(html).toContain('data-rsvp-closed="link_expired"');
  });
  it("la invitación completa se sigue viendo (solo cambia el RSVP)", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="public" plan="free" now={NOW} rsvp={{ ...base, linkInvalid: true }} />);
    expect(html).toContain("María");
    expect(html).toContain("Este enlace ya no es válido; pide a los novios uno nuevo.");
    expect(html).not.toContain('data-testid="rsvp-form"');
  });
});

describe("RsvpScene: plazo de respuesta", () => {
  it("abierta sin plazo: formulario y ninguna fecha", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, window: { status: "open", deadline: null } }} />);
    expect(html).toContain('data-testid="rsvp-form"');
    expect(html).not.toContain("Responde antes");
  });
  it("abierta con plazo: «Puedes responder hasta el 1 de mayo» junto al formulario", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, window: { status: "open", deadline: "2027-05-01" } }} />);
    expect(html).toContain("Puedes responder hasta el 1 de mayo.");
    expect(html).toContain('data-testid="rsvp-form"');
  });
  it("plazo vencido: sin formulario y con mensaje amable", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, window: { status: "closed", reason: "deadline", deadline: "2027-04-01" } }} />);
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).not.toContain("Puedes responder hasta");
    expect(html).toContain("Confirmaciones cerradas");
    expect(html).not.toContain(scene.props.title);
    expect(html).toContain("El plazo para confirmar terminó el 1 de abril. Si necesitas cambiar algo, escribe directamente a la pareja.");
  });
  it("boda celebrada: sin formulario, también sin token (cerrado manda)", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true, window: { status: "closed", reason: "wedding_over", weddingDate: "2027-04-01" } }} />);
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).not.toContain("necesitas tu enlace personal");
    expect(html).toContain("La boda ya se celebró");
  });
  it("sin contexto de plazo (lectura fallida) se comporta como antes", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={base} />);
    expect(html).toContain('data-testid="rsvp-form"');
  });
});

describe("Preview de la pareja: mismo estado que el invitado", () => {
  it("cerrado: el preview muestra el mensaje de cierre", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} rsvp={{ ...base, window: { status: "closed", reason: "deadline", deadline: "2027-04-01" } }} />);
    expect(html).toContain("El plazo para confirmar terminó el 1 de abril.");
    expect(html).not.toContain("Aquí vuestros invitados confirmarán");
    expect(html).not.toContain('data-testid="rsvp-form"');
  });
  it("con plazo abierto: fecha visible y sin formulario real", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} rsvp={{ ...base, window: { status: "open", deadline: "2027-05-01" } }} />);
    expect(html).toContain("Puedes responder hasta el 1 de mayo.");
    expect(html).toContain("Aquí vuestros invitados confirmarán");
    expect(html).not.toContain('data-testid="rsvp-form"');
  });
  it("sin contexto (wizard): como hasta ahora", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} />);
    expect(html).toContain("Aquí vuestros invitados confirmarán");
  });
});

describe("RsvpScene: /demo (#9)", () => {
  it("demo: el formulario de verdad en modo local, sin la nota para la pareja", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} fullPage demoRsvp />);
    expect(html).toMatch(/data-testid="rsvp-form" data-slug="demo" data-demo=""/);
    expect(html).not.toContain("Aquí vuestros invitados confirmarán");
  });
  it("demo con la maqueta «Como una web»: también el formulario", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={{ ...document, layout: "web" }} mode="preview" plan="free" now={NOW} fullPage demoRsvp />);
    expect(html).toMatch(/data-testid="rsvp-form" data-slug="demo" data-demo=""/);
    expect(html).not.toContain("Aquí vuestros invitados confirmarán");
  });
  it("preview a pantalla completa del creador (sin demoRsvp): la nota sigue", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} fullPage />);
    expect(html).toContain("Aquí vuestros invitados confirmarán");
    expect(html).not.toContain('data-testid="rsvp-form"');
  });
  it("editor del panel (editTargets): la nota sigue", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="preview" plan="free" now={NOW} editTargets />);
    expect(html).toContain("Aquí vuestros invitados confirmarán");
  });
  it("público: demoRsvp no tiene efecto (formulario real, sin modo demo)", () => {
    const html = renderToStaticMarkup(<InvitationRenderer document={document} mode="public" plan="free" now={NOW} rsvp={{ ...base, window: { status: "open", deadline: null } }} demoRsvp />);
    expect(html).toMatch(/data-testid="rsvp-form" data-slug="maria-y-jorge"/);
    expect(html).not.toContain("data-demo");
  });
  it("demo con el plazo cerrado: manda el cierre", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="preview" now={NOW} demo rsvp={{ ...base, window: { status: "closed", reason: "deadline", deadline: "2027-04-01" } }} />);
    expect(html).not.toContain('data-testid="rsvp-form"');
  });
});


describe("RsvpScene: respuesta previa desconocida", () => {
  it("muestra Reintentar y conserva la invitación sin permitir enviar un formulario vacío", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={{ ...base, readError: true }} />);
    expect(html).toContain("No hemos podido cargar tu respuesta");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).not.toContain("Este enlace ya no es válido");
  });
});

describe("«Pedir mi invitación» por WhatsApp (18-oct-2026)", () => {
  const withPhone = { ...scene, props: { ...scene.props, whatsapp: "612 345 678" } };
  const general = { slug: "maria-y-jorge", rsvpMvp: true, window: { status: "open", deadline: null } as const };
  it("enlace general con el móvil de la pareja: botón a su WhatsApp con el texto escrito", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={withPhone} mode="public" now={NOW} rsvp={general} />);
    expect(html).toContain("data-rsvp-general-link");
    expect(html).toContain('href="https://wa.me/34612345678?text=Hola%2C%20%C2%BFme%20envi%C3%A1is%20mi%20enlace%20personal');
    expect(html).toContain("Pedir mi invitación");
    expect(html).toContain('target="_blank"');
  });
  it("enlace personal no válido: también puede pedir uno nuevo", () => {
    const html = renderToStaticMarkup(<RsvpScene scene={withPhone} mode="public" now={NOW} rsvp={{ ...base, linkInvalid: true, window: { status: "open", deadline: null } }} />);
    expect(html).toContain("Este enlace ya no es válido");
    expect(html).toContain("Pedir mi invitación");
  });
  it("sin móvil, con enlace personal válido, en el preview o con el plazo cerrado: no hay botón", () => {
    expect(renderToStaticMarkup(<RsvpScene scene={scene} mode="public" now={NOW} rsvp={general} />)).not.toContain("Pedir mi invitación");
    expect(renderToStaticMarkup(<RsvpScene scene={withPhone} mode="public" now={NOW} rsvp={{ ...base, window: { status: "open", deadline: null } }} />)).not.toContain("Pedir mi invitación");
    expect(renderToStaticMarkup(<RsvpScene scene={withPhone} mode="preview" now={NOW} />)).not.toContain("Pedir mi invitación");
    expect(renderToStaticMarkup(<RsvpScene scene={withPhone} mode="public" now={NOW} rsvp={{ ...general, window: { status: "closed", reason: "deadline", deadline: "2027-04-01" } }} />)).not.toContain("Pedir mi invitación");
  });
});
