import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";

import { scrubEvent, stripQuery } from "./sentry-scrub";

describe("scrubEvent", () => {
  it("quita el enlace personal, cookies, cabeceras, cuerpo y usuario", () => {
    const token = "a".repeat(64);
    const event = scrubEvent({
      type: undefined,
      request: { url: `https://vinklo.es/b/ana-y-luis?invitacion=${token}`, query_string: `invitacion=${token}`, cookies: { sb: "x" }, headers: { cookie: "sb=x" }, data: { notes: "Celíaca" } },
      user: { email: "ana@example.com" },
      breadcrumbs: [{ data: { url: `/b/ana-y-luis?invitacion=${token}`, to: `/b/x?invitacion=${token}` } }],
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://vinklo.es/b/ana-y-luis" });
    expect(event.user).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain(token);
    expect(JSON.stringify(event)).not.toContain("Celíaca");
  });
  it("redacta el token en transacción, mensajes, errores y quita los console", () => {
    const token = "b".repeat(64);
    const event = scrubEvent({
      type: undefined,
      transaction: `/b/x?invitacion=${token}`,
      message: `fallo con ${token}`,
      exception: { values: [{ type: "Error", value: `GET /b/x?invitacion=${token} 500` }] },
      breadcrumbs: [{ category: "console", message: "Celíaca" }, { category: "navigation", message: `to /b/x?invitacion=${token}` }],
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain(token);
    expect(JSON.stringify(event)).not.toContain("Celíaca");
    expect(event.breadcrumbs).toHaveLength(1);
  });
  it("no se rompe con barras y comillas junto al token (antes fallaba el JSON.parse)", () => {
    const token = "c".repeat(64);
    const event = scrubEvent({ type: undefined, message: `t=abc\\"x invitacion%3D${token} y \\` } as ErrorEvent);
    expect(event.message).toBeTypeOf("string");
    expect(event.message).not.toContain(token);
    expect(event.message).not.toContain("abc");
  });
  it("redacta el token de proveedor /v/<uuid> en URL de petición, breadcrumbs y mensajes", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const event = scrubEvent({
      type: undefined,
      request: { url: `https://vinklo.es/v/${uuid}` },
      transaction: `/v/${uuid}/presupuesto`,
      breadcrumbs: [{ category: "navigation", data: { to: `/v/${uuid}`, from: `/v/${uuid.toUpperCase()}?x=1`, url: `https://vinklo.es/v/${uuid}` } }],
      message: `fallo en /v/${uuid} y en /v/abc`,
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain(uuid);
    expect(JSON.stringify(event)).not.toContain(uuid.toUpperCase());
    expect(event.request?.url).toBe("https://vinklo.es/v/[redactado]");
    expect(event.breadcrumbs?.[0]?.data?.to).toBe("/v/[redactado]");
    expect(event.transaction).toBe("/v/[redactado]/presupuesto");
    expect(event.message).toBe("fallo en /v/[redactado] y en /v/abc");
  });
  it("deja intactas las URLs sin query", () => {
    expect(stripQuery("https://vinklo.es/panel")).toBe("https://vinklo.es/panel");
    expect(stripQuery("/b/x#rsvp")).toBe("/b/x");
  });
});
