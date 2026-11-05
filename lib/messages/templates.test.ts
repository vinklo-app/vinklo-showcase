import { describe, expect, it } from "vitest";
import {
  buildMessage, coupleNames, DEFAULT_TEMPLATES, firstName, formatWeddingDate, renderTemplate,
  TEMPLATE_ERRORS, TEMPLATE_MAX_LENGTH, validateTemplate, buildThanksMessage, defaultTemplate, isMessageKind, isTemplateKind,
} from "./templates";
import { whatsappMessageUrl } from "../invitation-sharing";
import { DEFAULT_THANKS_TEMPLATE } from "@/lib/crm/contract";

const link = "https://vinklo.es/b/ana-y-luis-2027-06-12?invitacion=" + "a".repeat(64);
const context = { novios: "Ana y Luis", fecha: "sábado, 12 de junio" };

describe("textos por defecto", () => {
  it("la invitación sin plantilla es un único mensaje cuidado, con el enlace en su línea", () => {
    // Sin contexto: sigue invitando, con el enlace solo y sin punto detrás.
    expect(renderTemplate(DEFAULT_TEMPLATES.invitation, { enlace: link }))
      .toBe(`Nos casamos y nos haría mucha ilusión que vinieras. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:\n${link}`);
    // Con nombre y sin fecha: solo cae «Será el {fecha}.»
    expect(buildMessage("invitation", null, "Marta López", link, { novios: "Ana y Luis", fecha: "" }))
      .toBe(`¡Hola, Marta! Nos casamos y nos haría mucha ilusión que vinieras. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:\n${link}\n\nUn abrazo, Ana y Luis`);
    expect(buildMessage("invitation", null, "Marta López", link, context))
      .toBe(`¡Hola, Marta! Nos casamos y nos haría mucha ilusión que vinieras. Será el sábado, 12 de junio. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:\n${link}\n\nUn abrazo, Ana y Luis`);
  });
  it("el recordatorio usa nombre, fecha, enlace y novios", () => {
    expect(buildMessage("reminder", undefined, "Marta López", link, context)).toBe(
      `¡Hola, Marta! ¿Podrás acompañarnos el sábado, 12 de junio? Nos ayuda mucho saberlo para organizarlo todo. Puedes responder aquí: ${link} — Ana y Luis`,
    );
  });
  it("los textos por defecto pasan su propia validación", () => {
    for (const body of Object.values(DEFAULT_TEMPLATES)) expect(validateTemplate(body).ok).toBe(true);
  });
});

describe("validación", () => {
  it.each([
    ["", TEMPLATE_ERRORS.empty],
    ["   \n ", TEMPLATE_ERRORS.empty],
    ["Hola {nombre}", TEMPLATE_ERRORS.missingLink],
    ["{enlace} {apellido}", TEMPLATE_ERRORS.unknownVariable],
    ["{enlace} {Nombre}", TEMPLATE_ERRORS.unknownVariable],
    ["{enlace} }", TEMPLATE_ERRORS.unknownVariable],
    ["{ enlace } {enlace}", TEMPLATE_ERRORS.unknownVariable],
    ["{enlace}" + "x".repeat(TEMPLATE_MAX_LENGTH - 7), TEMPLATE_ERRORS.tooLong],
  ])("rechaza %j", (body, error) => {
    expect(validateTemplate(body)).toEqual({ ok: false, error });
  });
  it("rechaza lo que no es texto", () => {
    expect(validateTemplate(42).ok).toBe(false);
    expect(validateTemplate(null).ok).toBe(false);
  });
  it("acepta el máximo exacto y normaliza saltos de línea y bordes", () => {
    expect(validateTemplate("{enlace}" + "x".repeat(TEMPLATE_MAX_LENGTH - 8)).ok).toBe(true);
    expect(validateTemplate("  Hola {nombre}\r\n{enlace}  ")).toEqual({ ok: true, body: "Hola {nombre}\n{enlace}" });
  });
  it("una plantilla guardada inválida cae al texto por defecto", () => {
    expect(buildMessage("invitation", "sin enlace", "Ana", link, context)).toContain(link);
  });
});

describe("relleno", () => {
  it("sin fecha quita la frase entera, conserva la puntuación de las demás", () => {
    expect(buildMessage("reminder", null, "Marta", link, { novios: "Ana y Luis", fecha: "" })).toBe(
      `¡Hola, Marta! Nos ayuda mucho saberlo para organizarlo todo. Puedes responder aquí: ${link} — Ana y Luis`,
    );
  });
  it("nunca quita la frase que lleva el enlace; quita solo la variable vacía", () => {
    expect(renderTemplate("El {fecha} os esperamos aquí: {enlace}", { enlace: link })).toBe(`El os esperamos aquí: ${link}`);
    expect(renderTemplate("Tu invitación: {enlace} — {novios}", { enlace: link })).toBe(`Tu invitación: ${link}`);
  });
  it("respeta saltos de línea y limpia espacios dobles", () => {
    expect(renderTemplate("Hola  {nombre} !\n\n\n\nEntra:   {enlace}", { nombre: "Ana", enlace: link })).toBe(`Hola Ana!\n\nEntra: ${link}`);
  });
  it("no interpreta valores como variables ni patrones de reemplazo", () => {
    expect(renderTemplate("{nombre}: {enlace}", { nombre: "$& {enlace}", enlace: link })).toBe(`$& {enlace}: ${link}`);
  });
  it("las URLs con puntos e interrogantes no se parten como frases", () => {
    expect(renderTemplate("¿Vienes el {fecha}? Mira {enlace}. Gracias.", { enlace: "https://x.test/b/a?invitacion=1", fecha: "" }))
      .toBe("Mira https://x.test/b/a?invitacion=1. Gracias.");
  });
});

describe("datos auxiliares", () => {
  it("primer nombre", () => {
    expect(firstName("  María José  Pérez ")).toBe("María José");
    expect(firstName(null)).toBe("");
    expect(firstName("Tía Carmen")).toBe("Tía Carmen");
    expect(firstName("Abuela Carmen")).toBe("Abuela Carmen");
    expect(firstName("Familia Pérez Soler")).toBe("Familia Pérez");
    expect(firstName("Javier Ortega y Alba López")).toBe("Javier y Alba");
    expect(firstName("Lucas y Andrea")).toBe("Lucas y Andrea");
    expect(firstName("Tía")).toBe("Tía");
  });
  it("novios", () => {
    expect(coupleNames("Ana", "Luis")).toBe("Ana y Luis");
    expect(coupleNames("Ana", "")).toBe("Ana");
  });
  it.each([
    ["2027-06-12", "sábado, 12 de junio"],
    ["2026-01-01", "jueves, 1 de enero"],
    [null, ""], ["", ""], ["2027-02-30", ""], ["12/06/2027", ""],
  ])("fecha %s → %j", (input, expected) => {
    expect(formatWeddingDate(input)).toBe(expected);
  });
});

describe("longitud del enlace de WhatsApp", () => {
  // El texto viaja codificado en la URL de wa.me. Presupuesto: 8 KB, holgado
  // para los navegadores móviles actuales; el plan original pedía 700
  // caracteres por miedo a ~2000 bytes (ver datos.md, decisión 700 → 1000).
  it("una plantilla al máximo con acentos y datos largos cabe en el presupuesto", () => {
    const body = "{enlace} {nombre} {novios} {fecha} " + "ñ".repeat(TEMPLATE_MAX_LENGTH - 35);
    expect(validateTemplate(body).ok).toBe(true);
    const text = buildMessage("invitation", body, "N".repeat(120), link, { novios: `${"A".repeat(80)} y ${"B".repeat(80)}`, fecha: "miércoles, 30 de septiembre" });
    const url = whatsappMessageUrl("612345678", text)!;
    expect(url.length).toBeLessThan(8000);
    expect(new URL(url).searchParams.get("text")).toBe(text);
  });
});

describe("plantilla de agradecimiento («thanks»)", () => {
  it("no exige {enlace} y solo admite {nombre} y {novios}", () => {
    expect(validateTemplate(DEFAULT_THANKS_TEMPLATE, "thanks").ok).toBe(true);
    expect(validateTemplate("Gracias", "thanks")).toEqual({ ok: true, body: "Gracias" });
    expect(validateTemplate("Gracias {enlace}", "thanks")).toEqual({ ok: false, error: TEMPLATE_ERRORS.unknownThanksVariable });
    expect(validateTemplate("Gracias {fecha}", "thanks").ok).toBe(false);
    expect(validateTemplate("", "thanks")).toEqual({ ok: false, error: TEMPLATE_ERRORS.empty });
    // Sin kind se mantiene la regla de siempre.
    expect(validateTemplate("Gracias")).toEqual({ ok: false, error: TEMPLATE_ERRORS.missingLink });
    expect(isTemplateKind("thanks") && !isMessageKind("thanks")).toBe(true);
    expect(defaultTemplate("thanks")).toBe(DEFAULT_THANKS_TEMPLATE);
  });
  it("buildThanksMessage: nombre de pila y novios; plantilla inválida → la de Vinklo", () => {
    expect(buildThanksMessage("¡Gracias, {nombre}! {novios}", "María José Pérez", { novios: "Ana y Luis" })).toBe("¡Gracias, María José! Ana y Luis");
    expect(buildThanksMessage("Gracias {enlace}", "Pepe", { novios: "Ana y Luis" })).toContain("¡Hola, Pepe! Muchísimas gracias");
  });
});
