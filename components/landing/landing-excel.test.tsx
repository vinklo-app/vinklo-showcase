import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { COMPOSE_FOOTNOTE, EXCEL_CHAPTERS, EXCEL_SAMPLE, EXCEL_SUMMARY, LandingExcel } from "./landing-excel";
import { readSummary } from "@/lib/crm/guest-excel-import";
import sitemap from "@/app/sitemap";

/** Punto 17: la landing en «vídeo» de Excel → lista → WhatsApp → respuestas. */
const html = renderToStaticMarkup(<LandingExcel />);
const text = html.replace(/<[^>]+>/g, " ");

describe("Landing «Del Excel a WhatsApp»", () => {
  it("hero: h1 sin animación de entrada (LCP) y las dos llamadas", () => {
    expect(html).toMatch(/<h1 id="lx-title" class="lc-display lx-hero-title">Del Excel a WhatsApp/);
    expect(html).not.toMatch(/<h1[^>]*data-reveal/);
    expect(html).toMatch(/<a class="ll-btn-clay[^"]*" href="\/crear">Crear nuestra web/);
    expect(html).toMatch(/<a class="lc-hero-demo[^"]*" href="\/demo">Ver una boda de ejemplo/);
  });

  it("los seis capítulos, en orden", () => {
    expect(EXCEL_CHAPTERS.map((c) => c.id)).toEqual(["subir", "revisar", "lista", "mensaje", "whatsapp", "respuestas"]);
    let at = 0;
    for (const c of EXCEL_CHAPTERS) {
      const i = html.indexOf(c.title, at);
      expect(i, c.title).toBeGreaterThan(at);
      at = i;
    }
    for (const scene of EXCEL_CHAPTERS.map((c) => c.id)) expect(html).toContain(`data-scene="${scene}"`);
  });

  it("la cifra de la revisión es la que escribe el panel", () => {
    expect(readSummary(EXCEL_SAMPLE)).toBe(EXCEL_SUMMARY);
    expect(html).toContain(EXCEL_SUMMARY);
    expect(html).toContain("Importar 98 invitaciones (210 personas)");
  });

  it("copy honesto: el envío es manual y no hay entregado ni leído", () => {
    expect(html).toContain(COMPOSE_FOOTNOTE);
    expect(html).toContain("¿Se la habéis enviado a Marta?");
    expect(html).toContain("WhatsApp no avisa a vinklo");
    expect(text).not.toMatch(/entregad|\bvisto\b/i);
    // «leído» solo para el archivo («Hemos leído 142 filas», «Leído: 142 filas», «Revisad cómo lo hemos leído»), nunca para el mensaje.
    expect(text.replace(/Hemos leído 142|Leído: 142|cómo lo hemos leído/g, "")).not.toMatch(/leíd[oa]/i);
    expect(text).not.toMatch(/autom[aá]tic/i);
    expect(text).not.toMatch(/perfect|mágic|revolucionari|sin esfuerzo|\bCRM\b|recaudar/i);
  });

  it("estado final sin JS: las maquetas son decorativas y las respuestas ya están puestas", () => {
    expect(html.match(/class="lx-screen[^"]*"[^>]*aria-hidden="true"/g)?.length).toBe(6);
    for (const label of ["Confirmada", "No viene", "Pendiente"]) expect(html).toContain(`>${label}<`);
    // El script previo a la pintura marca la raíz (mismo patrón que la landing).
    expect(html).toMatch(/<div class="ll-home lc-home lx-home"><script>\(function\(\)\{var r=document.currentScript/);
  });

  it("enlazada desde el pie de la landing y en el sitemap", () => {
    expect(html).toContain('href="/invitados-desde-excel"');
    expect(sitemap().map((e) => e.url)).toContain("https://vinklo.es/invitados-desde-excel");
  });
});
