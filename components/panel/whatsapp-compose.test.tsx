import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsAppCompose, type ComposeRequest } from "./whatsapp-compose";
import { buildMessage, firstName } from "@/lib/messages/templates";

const link = "https://vinklo.es/b/ana-y-luis?invitacion=abc123";
const context = { novios: "Ana y Luis", fecha: "sábado, 12 de junio" };
const request = (over: Partial<ComposeRequest> = {}): ComposeRequest => ({
  kind: "invitation", name: "Marta López", phone: "612 345 678",
  text: buildMessage("invitation", null, "Marta López", link, context),
  vars: { nombre: firstName("Marta López"), enlace: link, novios: context.novios, fecha: context.fecha },
  ...over,
});
const render = (req: ComposeRequest | null, save = true) => renderToStaticMarkup(
  <WhatsAppCompose request={req} onClose={() => {}} saveTemplate={save ? async () => ({ ok: true }) : undefined} />,
);
const decode = (html: string) => html.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");

describe("hoja «Mensaje para…» antes de abrir WhatsApp (punto 15)", () => {
  it("enseña el mensaje exacto en un campo editable y abre WhatsApp con ese mismo texto", () => {
    const req = request();
    const html = decode(render(req));
    expect(html).toContain("Mensaje para Marta");
    expect(html).toMatch(/<textarea[^>]*>/);
    expect(html).toContain(req.text);
    expect(html).toContain(`href="https://wa.me/34612345678?text=${encodeURIComponent(req.text)}"`);
    expect(html).toContain("Abrir WhatsApp");
    expect(html).toContain("Cancelar");
    // Abrir WhatsApp no acredita el envío.
    expect(html).toContain("no lo envía ni lo marca como enviado");
  });
  it("sin cambios no se ofrece «Guardar como plantilla» (los cambios son solo para este envío)", () => {
    const html = render(request());
    expect(html).toContain("Los cambios valen solo para este mensaje.");
    expect(html).not.toContain("Guardar como plantilla");
  });
  it("si el texto ha perdido su enlace personal, no deja abrir WhatsApp y ofrece reponerlo", () => {
    const html = render(request({ text: "¡Hola, Marta! Os esperamos." }));
    expect(html).not.toContain("wa.me");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Abrir WhatsApp/);
    expect(html).toContain("Falta su enlace personal");
    expect(html).toContain("Volver a poner el enlace");
  });
  it("el agradecimiento no necesita enlace", () => {
    const html = decode(render(request({ kind: "thanks", text: "¡Gracias, Marta! Un abrazo, Ana y Luis.", vars: { nombre: "Marta", novios: "Ana y Luis" } })));
    expect(html).toContain("https://wa.me/34612345678?text=");
    expect(html).not.toContain("Falta su enlace personal");
  });
  it("cerrada no pinta nada del mensaje", () => {
    const html = render(null);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("wa.me");
  });
});
