import { describe, expect, it } from "vitest";
import { ceremonyTime, countdownSentence, countdownText, madridInstant, parseClock, remainingParts, weddingCountdown } from "./countdown";
import type { SiteDocument } from "./site-document";

describe("parseClock", () => {
  it("lee las formas habituales de una hora", () => {
    expect(parseClock("18:00")).toEqual({ hours: 18, minutes: 0 });
    expect(parseClock("18.30 h")).toEqual({ hours: 18, minutes: 30 });
    expect(parseClock("18 h")).toEqual({ hours: 18, minutes: 0 });
    expect(parseClock("18h")).toEqual({ hours: 18, minutes: 0 });
    expect(parseClock("12:30 h")).toEqual({ hours: 12, minutes: 30 });
    expect(parseClock("A las 9:15")).toEqual({ hours: 9, minutes: 15 });
  });
  it("las horas de la tarde-noche (20–23) también: bodas de noche", () => {
    expect(parseClock("20:00")).toEqual({ hours: 20, minutes: 0 });
    expect(parseClock("21:00")).toEqual({ hours: 21, minutes: 0 });
    expect(parseClock("20.30 h")).toEqual({ hours: 20, minutes: 30 });
    expect(parseClock("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseClock("22 h")).toEqual({ hours: 22, minutes: 0 });
  });
  it("un número suelto o un texto sin hora no es una hora", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock("Por la tarde")).toBeNull();
    expect(parseClock("Mesa 4")).toBeNull();
    expect(parseClock("2026")).toBeNull();
    expect(parseClock("Mesa 4 a las 18:00")).toEqual({ hours: 18, minutes: 0 });
  });
  it("el punto solo separa horas con «h» detrás: «17.10» (fecha) o «Mesa 4.30» no son horas", () => {
    expect(parseClock("18.30")).toBeNull();
    expect(parseClock("17.10")).toBeNull();
    expect(parseClock("Mesa 4.30")).toBeNull();
    expect(parseClock("El 17.10 a las 19:00")).toEqual({ hours: 19, minutes: 0 });
  });
});

describe("madridInstant", () => {
  it("convierte la hora de pared de Madrid a UTC (verano +2, invierno +1)", () => {
    expect(new Date(madridInstant("2026-10-17", { hours: 18, minutes: 0 })!).toISOString()).toBe("2026-10-17T16:00:00.000Z");
    expect(new Date(madridInstant("2026-12-12", { hours: 18, minutes: 0 })!).toISOString()).toBe("2026-12-12T17:00:00.000Z");
  });
  it("respeta el día del cambio de hora (25-oct-2026, a las 03:00 vuelven a ser las 02:00)", () => {
    expect(new Date(madridInstant("2026-10-25", { hours: 12, minutes: 0 })!).toISOString()).toBe("2026-10-25T11:00:00.000Z");
    expect(new Date(madridInstant("2027-03-28", { hours: 12, minutes: 0 })!).toISOString()).toBe("2027-03-28T10:00:00.000Z");
  });
});

describe("weddingCountdown", () => {
  it("el ejemplo del dueño: hoy 13-oct, boda 17-oct → 4 días", () => {
    expect(weddingCountdown("2026-10-17", null, new Date("2026-10-13T10:00:00Z"))).toEqual({ days: 4, hours: null, minutes: null });
    // A última hora del 13 en Madrid sigue siendo 13.
    expect(weddingCountdown("2026-10-17", "", new Date("2026-10-13T21:59:00Z"))?.days).toBe(4);
  });
  it("cuenta en días de Madrid, no en UTC: 23:30Z del 12 ya es día 13 en Madrid", () => {
    expect(weddingCountdown("2026-10-17", null, new Date("2026-10-12T22:30:00Z"))?.days).toBe(4);
  });
  it("sin hora, el día de la boda (y después) no se enseña", () => {
    expect(weddingCountdown("2026-10-17", null, new Date("2026-10-17T08:00:00Z"))).toBeNull();
    expect(weddingCountdown("2026-10-17", null, new Date("2026-10-20T08:00:00Z"))).toBeNull();
  });
  it("con hora, cuenta hasta ese instante en días, horas y minutos", () => {
    // 13-oct 12:00 Madrid → 17-oct 18:00 Madrid = 4 d 6 h 0 min.
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-10-13T10:00:00Z"))).toEqual({ days: 4, hours: 6, minutes: 0 });
    // 13-oct 20:40 Madrid → 3 d 21 h 20 min.
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-10-13T18:40:00Z"))).toEqual({ days: 3, hours: 21, minutes: 20 });
  });
  it("el día de la boda, antes de la ceremonia: 0 días y las horas que faltan", () => {
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-10-17T12:40:00Z"))).toEqual({ days: 0, hours: 3, minutes: 20 });
    // A 30 s: «1 minuto», nunca «0».
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-10-17T15:59:30Z"))).toEqual({ days: 0, hours: 0, minutes: 1 });
  });
  it("nunca negativa: pasada la ceremonia, null", () => {
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-10-17T16:00:00Z"))).toBeNull();
    expect(weddingCountdown("2026-10-17", "18:00", new Date("2026-11-01T00:00:00Z"))).toBeNull();
  });
  it("cambio de hora: días de calendario y horas de reloj de pared (25-oct y 28-mar)", () => {
    // 24-oct 18:00 (+2) → 26-oct 18:00 (+1): 49 h reales, pero «2 días» en el calendario.
    expect(weddingCountdown("2026-10-26", "18:00", new Date("2026-10-24T16:00:00Z"))).toEqual({ days: 2, hours: 0, minutes: 0 });
    // 27-mar 18:00 (+1) → 29-mar 18:00 (+2): 47 h reales, «2 días».
    expect(weddingCountdown("2027-03-29", "18:00", new Date("2027-03-27T17:00:00Z"))).toEqual({ days: 2, hours: 0, minutes: 0 });
    // El mismo día del cambio: 25-oct 01:00 (+2) → 25-oct 18:00 (+1) = 17 h de pared.
    expect(weddingCountdown("2026-10-25", "18:00", new Date("2026-10-24T23:00:00Z"))).toEqual({ days: 0, hours: 17, minutes: 0 });
  });
  it("sin fecha válida, null", () => {
    expect(weddingCountdown("", "18:00", new Date())).toBeNull();
    expect(weddingCountdown("17/10/2026", null, new Date())).toBeNull();
  });
});

describe("countdownText", () => {
  it("solo días", () => {
    expect(countdownText({ days: 4, hours: null, minutes: null })).toEqual({ value: 4, rest: "días para el sí" });
    expect(countdownText({ days: 1, hours: null, minutes: null })).toEqual({ value: 1, rest: "día para el sí" });
  });
  it("días, horas y minutos; las partes a cero no se dicen", () => {
    expect(countdownSentence({ days: 4, hours: 3, minutes: 20 })).toBe("4 días, 3 horas y 20 minutos para el sí");
    expect(countdownSentence({ days: 1, hours: 1, minutes: 1 })).toBe("1 día, 1 hora y 1 minuto para el sí");
    expect(countdownSentence({ days: 4, hours: 0, minutes: 5 })).toBe("4 días y 5 minutos para el sí");
    expect(countdownSentence({ days: 4, hours: 6, minutes: 0 })).toBe("4 días y 6 horas para el sí");
  });
  it("el día de la boda, la cifra son las horas (o los minutos)", () => {
    expect(countdownText({ days: 0, hours: 3, minutes: 20 })).toEqual({ value: 3, rest: "horas y 20 minutos para el sí" });
    expect(countdownText({ days: 0, hours: 0, minutes: 1 })).toEqual({ value: 1, rest: "minuto para el sí" });
  });
});

describe("ceremonyTime", () => {
  const doc = (venueTime: string, items: string[], venueEnabled = true) => ({
    scenes: [
      { id: "lugar", type: "venue", enabled: venueEnabled, props: { venue: "Finca", address: "", time: venueTime } },
      { id: "programa", type: "agenda", enabled: true, props: { title: "El día", items: items.map((timeLabel, i) => ({ id: `m-${i}`, title: "Momento", timeLabel, place: "", address: "", notes: "" })) } },
    ],
  }) as unknown as Pick<SiteDocument, "scenes">;
  it("la hora del lugar manda", () => {
    expect(ceremonyTime(doc("17:30", ["12:00"]))).toBe("17:30");
  });
  it("sin hora del lugar, la del primer momento del programa que la tenga", () => {
    expect(ceremonyTime(doc("", ["Por la tarde", "18.00 h", "21:00"]))).toBe("18.00 h");
    expect(ceremonyTime(doc("17:30", ["12:00"], false))).toBe("12:00");
  });
  it("sin ninguna hora, null (se cuenta hasta el comienzo del día)", () => {
    expect(ceremonyTime(doc("", ["Por la tarde"]))).toBeNull();
    expect(ceremonyTime({ scenes: [] })).toBeNull();
  });
});

describe("remainingParts (reloj vivo de la maqueta web)", () => {
  it("sin hora de ceremonia se cuenta hasta las 00:00 de Madrid del día de la boda", () => {
    // 13-oct 15:00 Madrid → 17-oct 00:00 = 3 d 9 h.
    expect(remainingParts("2026-10-17", "00:00", Date.parse("2026-10-13T13:00:00Z"))).toEqual({ d: 3, h: 9, m: 0, s: 0 });
  });
  it("con hora, hasta ella en reloj de pared, y null cuando ya ha pasado", () => {
    expect(remainingParts("2026-10-26", "18:00", Date.parse("2026-10-24T16:00:30Z"))).toEqual({ d: 1, h: 23, m: 59, s: 30 });
    expect(remainingParts("2026-10-17", "18:00", Date.parse("2026-10-17T16:00:00Z"))).toBeNull();
  });
});
