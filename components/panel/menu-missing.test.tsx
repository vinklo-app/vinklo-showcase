import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// print.css no se carga en Node.
vi.mock("@/components/panel/print.css", () => ({}));

import { ModuleSummary } from "./module-summary";
import { DayPrintView } from "./print-views";
import { NO_MODULES, type RsvpModules } from "@/lib/rsvp-answers";

const MODULES: RsvpModules = { ...NO_MODULES, menu: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }] };
const LABELS = { stops: {}, hotels: {}, menu: { "m-1": "Carne", "m-2": "Pescado" } };
// Elena 3 con menú; Marta 2 y Jorge 1 sin elegir → 3 personas sin menú.
const ROWS = [
  { id: "1", name: "Elena", companions: 2, answers: { menu: { "m-1": 2, "m-2": 1 } } },
  { id: "2", name: "Marta", companions: 1, answers: { song: "Mediterráneo" } },
  { id: "3", name: "Jorge", companions: 0, answers: null },
];

describe("Personas sin menú en el resumen de módulos y la hoja del catering (P1-6)", () => {
  it("la tarjeta Menú dice cuántas personas faltan", () => {
    const html = renderToStaticMarkup(<ModuleSummary rows={ROWS} modules={MODULES} labels={LABELS} />);
    expect(html).toContain("3 personas sin menú.");
    // Quien no contestó módulos no cuenta como «respuesta con estos datos».
    expect(html).toContain("2 respuestas con estos datos");
  });
  it("sin nadie por elegir, ni rastro del aviso", () => {
    const html = renderToStaticMarkup(<ModuleSummary rows={[ROWS[0]!]} modules={MODULES} labels={LABELS} />);
    expect(html).not.toContain("sin menú");
  });
  it("la hoja del catering avisa con el total, también de quien no contestó nada", () => {
    const html = renderToStaticMarkup(
      <DayPrintView wedding={{ names: "Ana y Luis", date: null }} agenda={[]} plan={null} back={{ href: "/panel/dia", label: "El día" }}
        modules={MODULES} labels={LABELS} guests={ROWS.map((r) => ({ ...r, notes: null }))} />,
    );
    expect(html).toContain("Aviso: 3 personas sin menú.");
    const noMenu = renderToStaticMarkup(
      <DayPrintView wedding={{ names: "Ana y Luis", date: null }} agenda={[]} plan={null} back={{ href: "/panel/dia", label: "El día" }}
        modules={NO_MODULES} labels={LABELS} guests={ROWS.map((r) => ({ ...r, notes: null }))} />,
    );
    expect(noMenu).not.toContain("sin menú");
  });
});

describe("«Sin menú» contra los menús publicados (fix 1)", () => {
  it("si la web publicada no pregunta menú, el borrador no genera «sin menú»", () => {
    expect(renderToStaticMarkup(<ModuleSummary rows={ROWS} modules={MODULES} labels={LABELS} menuModules={{ menu: [] }} />)).not.toContain("sin menú");
    expect(renderToStaticMarkup(<ModuleSummary rows={ROWS} modules={MODULES} labels={LABELS} menuModules={null} />)).not.toContain("sin menú");
  });
});

describe("Hoja del catering: alergias y dietas marcadas (ítem 21)", () => {
  it("«3 sin gluten · 2 vegetarianos» de las casillas; las notas escritas a mano se avisan, no se cuentan", () => {
    const guests = [
      { id: "1", name: "Elena", companions: 2, notes: "Tú: celiaquía; Pablo: celiaquía", answers: { diet: { vegetariano: 1 } } },
      { id: "2", name: "Marta", companions: 1, notes: "Tú: celiaquía", answers: { diet: { vegetariano: 1 } } },
      { id: "3", name: "Jorge", companions: 0, notes: "Soy alérgico al marisco", answers: null },
    ];
    const html = renderToStaticMarkup(
      <DayPrintView wedding={{ names: "Ana y Luis", date: null }} agenda={[]} plan={null} back={{ href: "/panel/dia", label: "El día" }}
        modules={NO_MODULES} labels={LABELS} guests={guests} />,
    );
    expect(html).toContain("<b>Alergias y dietas marcadas:</b> 3 sin gluten · 2 vegetarianos.");
    expect(html).toContain("1 nota con más detalles: leedla en la tabla.");
    // La fila de cada invitación lleva su preferencia junto a la nota.
    expect(html).toContain("Tú: celiaquía · 1 vegetariano");
  });
  it("sin nada marcado no hay línea de resumen", () => {
    const html = renderToStaticMarkup(
      <DayPrintView wedding={{ names: "Ana y Luis", date: null }} agenda={[]} plan={null} back={{ href: "/panel/dia", label: "El día" }}
        modules={NO_MODULES} labels={LABELS} guests={[{ id: "1", name: "Elena", companions: 0, notes: null, answers: null }]} />,
    );
    expect(html).not.toContain("data-diet-summary");
    expect(html).not.toContain("data-diet-details");
  });
});
