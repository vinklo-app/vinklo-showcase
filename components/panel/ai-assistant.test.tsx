import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiAssistantComposer, AiAssistantConversation, AiAssistantProposal } from "./ai-assistant";

const noop = () => undefined;

describe("Asistente del panel: revisar antes de aplicar", () => {
  it("muestra los datos del invitado y una acción explícita sin ejecutar escrituras al renderizar", () => {
    const apply = vi.fn();
    const html = renderToStaticMarkup(<AiAssistantProposal proposal={{ kind: "add-guest", name: "María del Carmen", companions: 2 }} onApply={apply} onCopy={noop} />);
    expect(html).toContain("María del Carmen");
    expect(html).toContain("2 acompañantes");
    expect(html).toContain("Añadir invitado");
    expect(html).toContain("Revisad antes de añadir");
    expect(apply).not.toHaveBeenCalled();
  });

  it("un borrador solo ofrece copiar y nunca aplicar ni enviar a WhatsApp", () => {
    const html = renderToStaticMarkup(<AiAssistantProposal proposal={{ kind: "draft-message", text: "¿Nos confirmas si vienes?" }} onApply={noop} onCopy={noop} />);
    expect(html).toContain("¿Nos confirmas si vienes?");
    expect(html).toContain("Copiar mensaje");
    expect(html).toContain("Vosotros decidís cuándo y a quién enviarlo");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("Añadir invitado");
  });

  it("deshabilita aplicar mientras guarda y conserva el resultado cuando se ha aplicado", () => {
    const proposal = { kind: "add-task", title: "Llamar al catering" } as const;
    const pending = renderToStaticMarkup(<AiAssistantProposal proposal={proposal} pending onApply={noop} onCopy={noop} />);
    expect(pending).toMatch(/<button[^>]+disabled/);
    expect(pending).toContain("Añadiendo…");
    const done = renderToStaticMarkup(<AiAssistantProposal proposal={proposal} applied="Tarea añadida" onApply={noop} onCopy={noop} />);
    expect(done).toContain("Tarea añadida");
    expect(done).not.toContain("<button");
  });

  it("anuncia espera y errores sin borrar las peticiones anteriores", () => {
    const html = renderToStaticMarkup(<AiAssistantConversation turns={[
      { id: "1", message: "¿Qué queda?", result: { ok: true, answer: "Tenéis tres tareas pendientes." } },
      { id: "2", message: "Añadid una tarea", result: { ok: false, error: "Ahora no está disponible. Volved a intentarlo." } },
    ]} pending onApply={noop} onCopy={noop} />);
    expect(html).toContain("¿Qué queda?");
    expect(html).toContain("Tenéis tres tareas pendientes.");
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Consultando vuestra boda…");
  });

  it("el compositor tiene etiqueta visible, límite y bloqueo durante la consulta", () => {
    const html = renderToStaticMarkup(<AiAssistantComposer value="" onChange={noop} onSubmit={noop} pending />);
    expect(html).toContain("Pedid ayuda con vuestra boda");
    expect(html).toContain('maxLength="1200"');
    expect(html).toMatch(/<button[^>]+disabled/);
    expect(html).toContain("Consultando…");
  });
});
