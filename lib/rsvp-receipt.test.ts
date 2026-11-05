import { describe, expect, it } from "vitest";

import { rsvpChangeUntilText, rsvpPeopleSummary, rsvpReceipt } from "./rsvp-form-state";
import { NO_MODULES, type RsvpModules } from "./rsvp-modules";

const MODULES: RsvpModules = {
  bus: { stops: [{ id: "p-1", name: "Plaza de España", time: "17:00" }, { id: "p-2", name: "Estación", time: "" }] },
  lodging: { hotels: [{ id: "h-1", name: "Hotel Los Olivos" }, { id: "h-2", name: "El Molino" }] },
  song: true,
  kids: false,
  menu: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }],
};

describe("justificante tras confirmar (ítem 12)", () => {
  it("personas: con todos los nombres, la frase de siempre; si no, cuántos sin inventar nombres", () => {
    expect(rsvpPeopleSummary(2, ["Pablo", "Leo"])).toBe("Respuesta guardada. Vais 3 personas: tú, Pablo y Leo.");
    expect(rsvpPeopleSummary(2, ["Pablo"])).toBe("Respuesta guardada. Vais 3 personas: tú y 2 acompañantes.");
    expect(rsvpPeopleSummary(1, [])).toBe("Respuesta guardada. Vais 2 personas: tú y 1 acompañante.");
    expect(rsvpPeopleSummary(0, [])).toBe("Respuesta guardada. Vienes tú.");
  });
  it("autobús con parada y hora, hotel, menús, dieta, alergias y canción, con los nombres de la web", () => {
    const rows = rsvpReceipt({
      answers: { bus: { use: "ambos", stop: "p-1" }, lodging: { where: "hotel", hotel: "h-2" }, menu: { "m-2": 1, "m-1": 2 }, diet: { vegetariano: 1 }, song: " Mediterráneo " },
      modules: MODULES,
      healthNote: "Tú: celiaquía",
      healthKept: false,
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Autobús", "Ida y vuelta desde Plaza de España (17:00)"],
      ["Alojamiento", "El Molino"],
      ["Menú", "2 Carne, 1 Pescado"],
      ["Dieta", "1 vegetariano"],
      ["Alergias", "Tú: celiaquía"],
      ["Canción", "«Mediterráneo»"],
    ]);
  });
  it("solo vuelta sin parada; parada sin hora; otro sitio; nota guardada sin enseñarla", () => {
    expect(rsvpReceipt({ answers: { bus: { use: "vuelta" } }, modules: MODULES, healthNote: "", healthKept: false })[0]!.value).toBe("Solo vuelta");
    expect(rsvpReceipt({ answers: { bus: { use: "ida", stop: "p-2" } }, modules: MODULES, healthNote: "", healthKept: false })[0]!.value).toBe("Solo ida desde Estación");
    expect(rsvpReceipt({ answers: { bus: { use: "no" }, lodging: { where: "otro" } }, modules: MODULES, healthNote: "", healthKept: true }).map((r) => r.value)).toEqual([
      "No, vas por tu cuenta", "En otro sitio", "Conservamos lo que ya nos dijiste",
    ]);
  });
  it("una sola parada u hotel: el de la web aunque la respuesta no lo nombre", () => {
    const one: RsvpModules = { ...NO_MODULES, bus: { stops: [{ id: "p-1", name: "Plaza", time: "17:00" }] }, lodging: { hotels: [{ id: "h-1", name: "Los Olivos" }] } };
    expect(rsvpReceipt({ answers: { bus: { use: "ida" }, lodging: { where: "hotel" } }, modules: one, healthNote: "", healthKept: false }).map((r) => r.value)).toEqual(["Solo ida desde Plaza (17:00)", "Los Olivos"]);
  });
  it("nada respondido: sin filas (módulos que la web ya no tiene, tampoco)", () => {
    expect(rsvpReceipt({ answers: {}, modules: MODULES, healthNote: "", healthKept: false })).toEqual([]);
    expect(rsvpReceipt({ answers: { bus: { use: "ida" }, song: "x" }, modules: NO_MODULES, healthNote: "", healthKept: false })).toEqual([]);
  });
  it("«hasta el {plazo}»", () => {
    expect(rsvpChangeUntilText("1 de agosto")).toBe("Con este mismo enlace puedes cambiar tu respuesta hasta el 1 de agosto.");
  });
});
