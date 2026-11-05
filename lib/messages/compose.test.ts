import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSE_ERRORS, COMPOSE_MAX_LENGTH, composeIssue, restoreLink, templateFromText, textToTemplate } from "./compose";
import { buildMessage, buildThanksMessage, DEFAULT_TEMPLATES, firstName, renderTemplate, TEMPLATE_ERRORS } from "./templates";
import { DEFAULT_THANKS_TEMPLATE } from "@/lib/crm/contract";

const link = "https://vinklo.es/b/ana-y-luis-2027-06-12?invitacion=" + "a".repeat(64);
const context = { novios: "Ana y Luis", fecha: "sábado, 12 de junio" };
const varsFor = (name: string, ctx = context) => ({ nombre: firstName(name), enlace: link, novios: ctx.novios, fecha: ctx.fecha });

describe("mensaje de un envío (punto 15)", () => {
  it("sin tocar, el texto relleno vuelve exactamente a la plantilla de Vinklo", () => {
    for (const kind of ["invitation", "reminder"] as const) {
      const text = buildMessage(kind, null, "Marta López", link, context);
      expect(textToTemplate(text, varsFor("Marta López"), kind)).toBe(DEFAULT_TEMPLATES[kind]);
    }
  });
  it("el nombre del invitado dentro de «vuestros nombres» no se confunde ({novios} va antes)", () => {
    const text = buildMessage("invitation", null, "Ana Pérez", link, context);
    const body = textToTemplate(text, varsFor("Ana Pérez"), "invitation");
    expect(body).toBe(DEFAULT_TEMPLATES.invitation);
    expect(body).toContain("Un abrazo, {novios}");
  });
  it("el nombre solo se sustituye como palabra completa", () => {
    const body = textToTemplate(`¡Hola, Ana! Te esperamos con Mariana y Anabel.\n${link}`, varsFor("Ana"), "invitation");
    expect(body).toBe("¡Hola, {nombre}! Te esperamos con Mariana y Anabel.\n{enlace}");
  });
  it("lo que la pareja añade se conserva y se guarda como plantilla válida", () => {
    const text = buildMessage("reminder", null, "Marta López", link, context).replace("¿Podrás", "¡Te echamos de menos! ¿Podrás");
    const saved = templateFromText(text, varsFor("Marta López"), "reminder");
    expect(saved).toEqual({ ok: true, body: DEFAULT_TEMPLATES.reminder.replace("¿Podrás", "¡Te echamos de menos! ¿Podrás") });
    // Y al volver a rellenarla para otra persona, sale su nombre.
    if (saved.ok) expect(buildMessage("reminder", saved.body, "Pablo Gil", link, context)).toContain("¡Hola, Pablo! ¡Te echamos de menos!");
  });
  it("boda sin fecha: la frase de la fecha ya no estaba y la plantilla tampoco la lleva", () => {
    const noDate = { novios: "Ana y Luis", fecha: "" };
    const text = buildMessage("invitation", null, "Marta", link, noDate);
    const body = textToTemplate(text, varsFor("Marta", noDate), "invitation");
    expect(body).not.toContain("{fecha}");
    expect(renderTemplate(body, { nombre: "Pablo", enlace: link, novios: "Ana y Luis" })).toContain("¡Hola, Pablo!");
  });
  it("sin el enlace o con llaves sueltas no se puede guardar como plantilla", () => {
    expect(templateFromText("¡Hola, Marta! Os esperamos.", varsFor("Marta"), "invitation")).toEqual({ ok: false, error: TEMPLATE_ERRORS.missingLink });
    expect(templateFromText(`Hola {apodo} ${link}`, varsFor("Marta"), "invitation")).toEqual({ ok: false, error: TEMPLATE_ERRORS.unknownVariable });
  });
  it("el agradecimiento solo vuelve a {nombre} y {novios} (sin enlace ni fecha)", () => {
    const text = buildThanksMessage(null, "Marta López", context);
    expect(textToTemplate(text, { nombre: "Marta", novios: "Ana y Luis", enlace: "x", fecha: "sábado" }, "thanks")).toBe(DEFAULT_THANKS_TEMPLATE);
    expect(templateFromText(`${text} Nos vemos el sábado.`, { nombre: "Marta", novios: "Ana y Luis", fecha: "sábado" }, "thanks").ok).toBe(true);
  });
});

describe("¿se puede abrir WhatsApp con este texto?", () => {
  it("vacío, demasiado largo o sin su enlace personal: no", () => {
    expect(composeIssue("   ", "invitation", link)).toBe(COMPOSE_ERRORS.empty);
    expect(composeIssue(`${"a".repeat(COMPOSE_MAX_LENGTH)} ${link}`, "invitation", link)).toBe(COMPOSE_ERRORS.tooLong);
    expect(composeIssue("¡Hola, Marta!", "invitation", link)).toBe(COMPOSE_ERRORS.missingLink);
    expect(composeIssue("¡Hola, Marta!", "reminder", link)).toBe(COMPOSE_ERRORS.missingLink);
  });
  it("con su enlace o en el agradecimiento (sin enlace): sí", () => {
    expect(composeIssue(`Cualquier texto ${link}`, "invitation", link)).toBeNull();
    expect(composeIssue("¡Gracias, Marta!", "thanks", null)).toBeNull();
  });
  it("«Volver a poner el enlace» lo añade al final, en su línea", () => {
    expect(restoreLink("¡Hola, Marta!  \n", link)).toBe(`¡Hola, Marta!\n${link}`);
    expect(restoreLink("", link)).toBe(link);
    expect(composeIssue(restoreLink("¡Hola!", link), "invitation", link)).toBeNull();
  });
});

/**
 * Una sola puerta a WhatsApp: el panel solo construye enlaces de wa.me desde
 * la hoja común (components/panel/whatsapp-compose.tsx), para que la pareja
 * siempre vea el mensaje antes de abrirlo.
 */
describe("todos los WhatsApp del panel pasan por la hoja del mensaje", () => {
  const root = join(__dirname, "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(relative(root, path));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir));
  const using = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(join(root, file), "utf8"))).sort();

  it("wa.me solo aparece en el helper", () => {
    // whatsapp-number.ts: el chat con número (panel vía whatsappMessageUrl y «Pedir mi invitación» de la web pública).
    expect(using(/https:\/\/wa\.me/)).toEqual(["lib/invitation-sharing.ts", "lib/whatsapp-number.ts"]);
  });
  it("las URLs de WhatsApp solo se montan en la hoja común", () => {
    expect(using(/whatsapp(Message|Invitation)Url\(/)).toEqual(["components/panel/whatsapp-compose.tsx", "lib/invitation-sharing.ts"]);
  });
  it("el chat con número (whatsappChatUrl) solo lo monta el helper y «Pedir mi invitación»", () => {
    expect(using(/whatsappChatUrl\(/)).toEqual(["components/invitation/scenes/rsvp.tsx", "lib/invitation-sharing.ts", "lib/whatsapp-number.ts"]);
  });
  it("nadie abre WhatsApp con window.open saltándose la hoja", () => {
    expect(using(/window\.open\(/)).toEqual([]);
  });
});
