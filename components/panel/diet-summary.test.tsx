import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DietSummary } from "./diet-summary";

describe("Alergias y dietas en /panel/dia", () => {
  it("cuenta las casillas como la hoja del catering y avisa de las notas libres", () => {
    const html = renderToStaticMarkup(
      <DietSummary
        guests={[
          { notes: "Tú: celiaquía; Pablo: celiaquía, alergia a los frutos secos", answers: { diet: { vegetariano: 1 } } },
          { notes: "Sin marisco, por favor", answers: null },
          { notes: null, answers: { diet: { vegano: 2 } } },
        ]}
      />,
    );
    expect(html).toContain("<span>Celiaquía</span><b class=\"pn-tnum\">2</b>");
    expect(html).toContain("<span>Frutos secos</span><b class=\"pn-tnum\">1</b>");
    expect(html).toContain("<span>Vegetariano</span><b class=\"pn-tnum\">1</b>");
    expect(html).toContain("<span>Vegano</span><b class=\"pn-tnum\">2</b>");
    expect(html).not.toContain("Lactosa");
    expect(html).toContain("1 nota con más detalles: leedla en la hoja del catering.");
    expect(html).toContain('href="/panel/dia/imprimir"');
  });

  it("solo con notas libres no dice que haya casillas marcadas", () => {
    const html = renderToStaticMarkup(<DietSummary guests={[{ notes: "Sin marisco, por favor", answers: null }]} />);
    expect(html).toContain("Todavía no hay totales que contar, pero sí notas que leer.");
    expect(html).not.toContain("con cada casilla marcada");
    expect(html).toContain("1 nota con más detalles");
  });

  it("sin nada marcado lo dice y no pinta la tarjeta", () => {
    const html = renderToStaticMarkup(<DietSummary guests={[{ notes: null, answers: null }]} />);
    expect(html).toContain("Nadie que venga ha marcado alergias ni dietas todavía.");
    expect(html).not.toContain("data-diet-card");
  });
});
