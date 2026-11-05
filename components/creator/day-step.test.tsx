import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DayStep } from "./day-step";
import { EMPTY_DRAFT, materializeDay, type BuilderDraft } from "@/lib/wedding-builder";
import { SITE_MAX_DETAIL_CARDS } from "@/lib/site-document";

/** «Vuestro día» (punto 9): más momentos, módulos con un toque, detalles y preguntas. */
const base: BuilderDraft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12" };
const render = (draft: BuilderDraft) => renderToStaticMarkup(<DayStep draft={draft} onPatch={() => {}} />);

describe("Paso «Vuestro día» con más secciones", () => {
  it("sin nada añadido: los tres momentos, los botones de añadir y los módulos apagados", () => {
    const html = render(base);
    for (const text of ["Ceremonia", "Cóctel", "Banquete", "Añadir otro momento", "Añadir un detalle", "Añadir una pregunta", "Añadid más secciones"]) expect(html).toContain(text);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Autobuses</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Alojamiento</);
    // Sin autobús no hay salida ni «otra salida».
    expect(html).not.toContain("Salida del autobús");
    expect(html).not.toContain("Añadir otra salida");
  });

  it("los momentos a mano se editan con hora, sitio, notas y se pueden subir, bajar y quitar", () => {
    const html = render({ ...base, dayMoments: [{ id: "m-p1", title: "Fiesta", timeLabel: "Al anochecer", place: "", address: "", notes: "Con DJ" }, { id: "m-p2", title: "", timeLabel: "01:00", place: "", address: "", notes: "" }] });
    expect(html).toContain('value="Fiesta"');
    expect(html).toContain("Con DJ");
    // Una hora en texto libre (de la IA) no se mete en el campo de hora.
    expect(html).not.toContain('value="Al anochecer"');
    expect(html).toContain('value="01:00"');
    expect(html).toContain('aria-label="Subir «Fiesta»"');
    expect(html).toContain('aria-label="Quitar el momento 2"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Subir «Fiesta»"|<button[^>]*aria-label="Subir «Fiesta»"[^>]*disabled=""/);
    expect(html).toContain("En la invitación van por hora");
  });

  it("con autobuses: salida, otras salidas, vuelta y «Añadir otra salida»; con alojamiento, sus hoteles", () => {
    const html = render({ ...base, modules: ["bus", "hotels"], busStops: [{ name: "Madrid", time: "10:00", place: "" }, { name: "Toledo", time: "10:30", place: "" }] });
    expect(html).toContain("Salida del autobús");
    expect(html).toContain('value="Toledo"');
    expect(html).toContain("Vuelta en autobús");
    expect(html).toContain("Añadir otra salida");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Autobuses</);
    expect(html).toContain("Hoteles");
  });

  it("sin sitio para más tarjetas, el botón se desactiva y lo dice", () => {
    const cards = Array.from({ length: SITE_MAX_DETAIL_CARDS }, (_, i) => ({ id: `d-p${i + 1}`, title: `Tarjeta ${i + 1}`, teaser: "", body: "", linkLabel: "" }));
    const html = render({ ...base, dayCards: cards });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?Añadir un detalle/);
    expect(html).toContain("Ya no caben más tarjetas de detalles.");
  });

  it("las tarjetas y preguntas de plantilla son filas normales, con lo que dice la plantilla ahora", () => {
    const opened = materializeDay({ ...base, modules: ["kids"] });
    const html = render(opened);
    for (const text of ['value="¿Hay aparcamiento?"', 'value="Dress code"', 'aria-label="Quitar «¿Hay aparcamiento?»"', "Sí. Al confirmar tu asistencia, dinos cuántos niños vienen contigo."]) expect(html).toContain(text);
    // Sin la pregunta de niños, esa fila «auto» enseña la respuesta vacía (como la invitación).
    expect(render({ ...opened, modules: [] })).not.toContain("dinos cuántos niños");
  });
});
