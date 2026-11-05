import { describe, expect, it } from "vitest";
import { collectText, introducesNewFacts, isKnownLiteral, newFacts, urlsIn } from "./fact-guard";

describe("newFacts", () => {
  it("detecta números, horas, meses, días y enlaces nuevos", () => {
    expect(newFacts("Os esperamos el 14 de julio", "Os esperamos")).toEqual(["14", "julio"]);
    expect(newFacts("Salimos el viernes", "")).toEqual(["viernes"]);
    expect(newFacts("Vuelta a las 03:00", "Ida a las 16:00")).toEqual(["time:03:00"]);
    expect(newFacts("Reserva en https://hotel.example.com/a", "")).toEqual(["url:https://hotel.example.com/a"]);
  });

  it("acepta datos que ya están, con otro formato de hora", () => {
    expect(newFacts("Empieza a las 18:30 el sábado", "a las 18.30 del sábado")).toEqual([]);
    expect(newFacts("A las 19:00", "a las 19")).toEqual([]);
    expect(newFacts("Ven a las 19:30", "a las 19")).toEqual(["time:19:30"]);
  });

  it("detecta nombres propios inventados, pero no la mayúscula de inicio de frase", () => {
    expect(newFacts("Hay aparcamiento en el Parking Central.", "¿hay aparcamiento?")).toEqual(["name:parking", "name:central"]);
    expect(newFacts("Sí. Hay sitio. ¡Claro! ¿Vienes?\nPor supuesto", "")).toEqual([]);
    expect(newFacts("Os esperamos en Finca El Olivar", "finca el olivar")).toEqual([]);
    expect(newFacts("«Nos vemos» en Granada", "granada")).toEqual([]);
  });

  it("introducesNewFacts combina varias fuentes permitidas", () => {
    expect(introducesNewFacts("En Lisboa, en 2015", "lisboa", "2015")).toBe(false);
    expect(introducesNewFacts("En Lisboa, en 2016", "lisboa", "2015")).toBe(true);
  });
});

describe("isKnownLiteral", () => {
  it("en la petición o ya en la web; los enlaces se comparan tal cual", () => {
    expect(isKnownLiteral("Hotel Sol", "añadid el hotel sol", "")).toBe(true);
    expect(isKnownLiteral("Hotel Sol", "añadid un hotel", "Hotel Sol, junto a la playa")).toBe(true);
    expect(isKnownLiteral("Hotel Luna", "añadid un hotel", "Hotel Sol")).toBe(false);
    expect(isKnownLiteral("https://a.example.com/x", "el enlace https://a.example.com/x", "")).toBe(true);
    expect(isKnownLiteral("https://a.example.com/y", "el enlace https://a.example.com/x", "")).toBe(false);
    expect(isKnownLiteral("", "algo", "algo")).toBe(false);
  });
});

describe("collectText y urlsIn", () => {
  it("ignora ids y claves técnicas (sus dígitos no justifican datos)", () => {
    expect(collectText({ id: "m-6f1d2c3b", type: "agenda", props: { title: "Cena", items: [{ id: "q-1", place: "Salón" }] } })).toEqual(["Cena", "Salón"]);
  });
  it("saca enlaces sin la puntuación final", () => {
    expect(urlsIn("Mirad https://a.example.com/x, y (https://b.example.com).")).toEqual(["https://a.example.com/x", "https://b.example.com"]);
  });
});
