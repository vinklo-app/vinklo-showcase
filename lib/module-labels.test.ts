import { describe, expect, it } from "vitest";

import { guestMenuModules, moduleLabelsForAnswers } from "./module-labels";
import { parseSiteDocument, type SiteDocument } from "./site-document";

function doc(stops: Array<{ id: string; name: string; time?: string }>, hotels: Array<{ id: string; name: string }>, menu: Array<{ id: string; label: string }>): SiteDocument {
  const parsed = parseSiteDocument({
    schemaVersion: 1, templateId: "papel-calido", templateVersion: 1,
    scenes: [
      { id: "portada", type: "cover", props: {} },
      { id: "autobuses", type: "transport", props: { stops } },
      { id: "alojamiento", type: "stay", props: { hotels } },
      { id: "asistencia", type: "rsvp", props: { menuOptions: menu } },
    ],
  });
  if (!parsed.ok) throw new Error("fixture inválido");
  return parsed.document;
}

describe("moduleLabelsForAnswers (5.8)", () => {
  const published = doc([{ id: "p-1", name: "Madrid", time: "11:45" }], [{ id: "h-1", name: "Los Olivos" }], [{ id: "m-1", label: "Carne" }]);
  // Borrador sin publicar: parada renombrada, hotel quitado y uno nuevo.
  const draft = doc([{ id: "p-1", name: "Madrid Atocha", time: "12:00" }, { id: "p-2", name: "Segovia" }], [{ id: "h-2", name: "El Molino" }], [{ id: "m-1", label: "Ternera" }]);

  it("sin revisión publicada usa el borrador", () => {
    expect(moduleLabelsForAnswers(draft, null)).toEqual({
      stops: { "p-1": "Madrid Atocha (12:00)", "p-2": "Segovia" },
      hotels: { "h-2": "El Molino" },
      menu: { "m-1": "Ternera" },
    });
  });
  it("con revisión publicada manda la publicada y el borrador rellena huecos", () => {
    expect(moduleLabelsForAnswers(draft, published)).toEqual({
      stops: { "p-1": "Madrid (11:45)", "p-2": "Segovia" },
      hotels: { "h-1": "Los Olivos", "h-2": "El Molino" },
      menu: { "m-1": "Carne" },
    });
  });
});

describe("guestMenuModules (P1-6, fix 1)", () => {
  const draft = doc([], [], [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }]);
  it("con web publicada, solo cuentan los menús publicados (los del borrador aún no se pueden elegir)", () => {
    expect(guestMenuModules(draft, doc([], [], []), "rev-1")).toEqual({ menu: [] });
    expect(guestMenuModules(draft, doc([], [], [{ id: "m-1", label: "Carne" }]), "rev-1")).toEqual({ menu: [{ id: "m-1", label: "Carne" }] });
  });
  it("nunca publicada: la web en vivo es el borrador", () => {
    expect(guestMenuModules(draft, null, null)?.menu).toHaveLength(2);
  });
  it("publicada pero ilegible: null (no se cuenta a ciegas)", () => {
    expect(guestMenuModules(draft, null, "rev-1")).toBeNull();
  });
});
