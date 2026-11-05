import { describe, expect, it } from "vitest";
import { firstName } from "./first-name";
import { buildMessage } from "./templates";

const cases = (rows: [string, string][]) => rows.map(([input, expected]) => ({ input, expected }));

describe("firstName · una persona", () => {
  it.each(cases([
    ["Inés Montenegro García", "Inés"],
    ["Carmen", "Carmen"],
    ["  Lucía   Fernández  ", "Lucía"],
    ["ANA GARCÍA", "ANA"],
    ["Begoña Etxeberria Aranguren", "Begoña"],
    ["Jordi Puig i Serra", "Jordi"],
    ["Uxue Agirre", "Uxue"],
  ]))("$input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it.each(cases([
    ["José Luis Martín", "José Luis"],
    ["Jose Luis Martin", "Jose Luis"],
    ["María José Pérez", "María José"],
    ["Juan Carlos Rodríguez Sanz", "Juan Carlos"],
    ["Miguel Ángel Torres", "Miguel Ángel"],
    ["Francisco Javier Gil", "Francisco Javier"],
    ["Mari Carmen López", "Mari Carmen"],
    ["Mª José Ruiz", "Mª José"],
    ["Ana Belén Castro", "Ana Belén"],
    ["José María Aznar López", "José María"],
  ]))("compuesto: $input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it.each(cases([
    ["María de los Ángeles Pérez", "María de los Ángeles"],
    ["María del Carmen Sánchez", "María del Carmen"],
    ["María del Mar Ortiz", "María del Mar"],
    ["María de la O Fernández", "María de la O"],
    ["Juan de Dios Romero", "Juan de Dios"],
  ]))("con partícula: $input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it.each(cases([
    // Partícula de apellido, no de nombre: nunca se arrastra el apellido.
    ["María de la Torre", "María"],
    ["José de la Fuente Martín", "José"],
    ["Juan del Río", "Juan"],
    // Martín es nombre y apellido: sin lista, solo la primera palabra.
    ["José Martín García", "José"],
    ["Ana López", "Ana"],
  ]))("apellido tras el nombre: $input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));
});

describe("firstName · apellidos con «y» (revisión UX P0 #4)", () => {
  it.each(cases([
    ["Inés Carvajal de la Torre y Montenegro", "Inés"],
    ["José Ortega y Gasset", "José"],
    ["Santiago Ramón y Cajal", "Santiago"],
    ["Carmen Pérez de Guzmán y Fernández", "Carmen"],
    ["Luis Fernández y González de la Vega", "Luis"],
  ]))("$input → $expected", ({ input, expected }) => {
    const greeting = firstName(input);
    expect(greeting).toBe(expected);
    expect(greeting).not.toMatch(/ y /);
  });

  it("el mensaje de la ficha de ejemplo ya no saluda a un apellido", () => {
    const text = buildMessage("invitation", null, "Inés Carvajal de la Torre y Montenegro", "https://vinklo.es/b/x?invitacion=1", { novios: "Lucía y Juan", fecha: "" });
    expect(text.startsWith("¡Hola, Inés!")).toBe(true);
    expect(text).not.toContain("Montenegro");
  });
});

describe("firstName · parejas y familias", () => {
  it.each(cases([
    ["Ana y Pablo", "Ana y Pablo"],
    ["Ana García y Pablo Ruiz", "Ana y Pablo"],
    ["Javier Ortega y Alba López", "Javier y Alba"],
    ["Lucas y Andrea", "Lucas y Andrea"],
    ["Pablo e Inés", "Pablo e Inés"],
    ["Pablo y Inés García", "Pablo e Inés"],
    ["Ana y Yolanda", "Ana y Yolanda"],
    ["Ana & Pablo", "Ana y Pablo"],
    ["José Luis Martín y María José Pérez", "José Luis y María José"],
    ["María de los Ángeles Pérez y Pablo Ruiz", "María de los Ángeles y Pablo"],
    ["Ana y Uxue", "Ana y Uxue"],
    ["Ana García y Kevin Smith", "Ana y Kevin"],
    ["Ana, Pablo y Lucía", "Ana, Pablo y Lucía"],
    ["Tía Carmen y Tío Paco", "Tía Carmen y Tío Paco"],
    ["Tía Carmen y Inés", "Tía Carmen e Inés"],
    ["Ana Ruiz y Pablo Ortega y Gasset", "Ana y Pablo"],
  ]))("$input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it.each(cases([
    ["Familia Ortega", "Familia Ortega"],
    ["Familia Pérez Soler", "Familia Pérez"],
    ["Familia Ortega y Gasset", "Familia Ortega"],
    ["familia de la Fuente", "familia de la Fuente"],
    ["Los García", "Los García"],
    ["Tía Carmen", "Tía Carmen"],
    ["Abuela Carmen", "Abuela Carmen"],
    ["Tía María José", "Tía María José"],
    ["Tía", "Tía"],
  ]))("tratamiento: $input → $expected", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it("ante la duda, solo la primera persona (nunca un apellido)", () => {
    expect(firstName("Ana García López y Pablo")).toBe("Ana y Pablo");
    expect(firstName("Ana García López y Montenegro")).toBe("Ana");
  });
});

describe("firstName · formatos de hoja de cálculo y vacíos", () => {
  it.each(cases([
    ["García López, Ana", "Ana"],
    ["Ruiz, José Luis", "José Luis"],
    // «Apellido, Nombre y Nombre» (revisión del bloque 1, F6): nunca el apellido.
    ["Pérez, Ana y Pablo", "Ana y Pablo"],
    ["García López, Ana y Pablo", "Ana y Pablo"],
    ["Fernández, Ana e Inés", "Ana e Inés"],
    ["de la Fuente Pérez, Ana y Pablo", "Ana y Pablo"],
    ["Pérez, Ana, Pablo y Lucía", "Ana, Pablo y Lucía"],
    // Una lista de nombres con coma sigue siendo una lista.
    ["Ana, Pablo y Lucía", "Ana, Pablo y Lucía"],
    ["", ""],
    ["   ", ""],
  ]))("«$input» → «$expected»", ({ input, expected }) => expect(firstName(input)).toBe(expected));

  it("null e undefined", () => {
    expect(firstName(null)).toBe("");
    expect(firstName(undefined)).toBe("");
  });
});
