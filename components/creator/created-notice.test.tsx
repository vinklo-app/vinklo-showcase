import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CreatedNotice, FIRST_GUESTS_HREF, listoWebState } from "./created-notice";
import { publicWeddingUrl, publishedShareText, whatsappShareUrl } from "@/lib/invitation-sharing";

const url = "https://vinklo.es/b/ana-y-pablo";
const render = (props: Parameters<typeof CreatedNotice>[0]) => renderToStaticMarkup(<CreatedNotice {...props} />);

describe("/onboarding/listo: el momento «¡publicada!» (revisión UX, ítem 8)", () => {
  it("todo bien: celebración con el enlace, Ver, Copiar, WhatsApp, invitados como siguiente paso e «Ir al panel»", () => {
    const html = render({ publicUrl: url });
    expect(html).toContain("¡Vuestra web ya está <em>publicada!</em>");
    expect(html).toContain(url);
    expect(html).toContain(`href="${url}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain("Copiar enlace");
    expect(html).toContain(`href="${whatsappShareUrl(publishedShareText(url)).replace(/&/g, "&amp;")}"`);
    expect(html).toContain(`class="wb-primary" href="${FIRST_GUESTS_HREF}">Añadid a vuestros primeros invitados`);
    expect(html).toContain('class="wb-secondary" href="/panel">Ir al panel');
    // Lo de antes sigue: el lead y «Todo está en su sitio».
    expect(html).toContain("Ya tenéis vuestro enlace y vuestro panel. Quien tenga este enlace ya puede verla.");
    expect(html).toContain("Todo está en su sitio. Podéis seguir desde vuestro panel.");
  });
  it("publicada sin una foto: celebra, pero dice qué falta y dónde", () => {
    const html = render({ publicUrl: url, photo: "la subida no se completó" });
    expect(html).toContain("¡Vuestra web ya está");
    expect(html).toContain("Falta un detalle:");
    expect(html).toContain("No hemos podido añadir vuestra foto:");
    expect(html).toContain("Añadir la foto en Ajustes");
  });
  it("publicada con el estilo base (web=failed): sin «¡publicada!», primero el aviso; el enlace funciona", () => {
    const html = render({ publicUrl: url, web: "failed", gallery: 2 });
    expect(html).not.toContain("¡Vuestra web ya está");
    expect(html).toContain("Vuestra web está <em>creada.</em>");
    expect(html).toContain("La web está publicada con el estilo base");
    expect(html).toContain("2 de vuestras fotos no se han podido subir.");
    expect(html).toContain(url);
  });
  it("sin publicar (live, I-5): sin celebración; el enlace ya la abre, así que se enseña con lo que falta", () => {
    const html = render({ publicUrl: url, web: "live" });
    expect(html).not.toContain("¡Vuestra web ya está");
    expect(html).toContain("Vuestra web todavía no está publicada.");
    expect(html).toContain("«Publicar nuestra web»");
    expect(html).toContain(url);
    expect(html).not.toContain("Todo está en su sitio");
  });
  it("retirada (withdrawn, I-5): sin enlace (no se abre) y «Volver a publicar»", () => {
    const html = render({ publicUrl: null, web: "withdrawn" });
    expect(html).toContain("Vuestra web está retirada:");
    expect(html).toContain("«Volver a publicar»");
    expect(html).not.toContain("Copiar enlace");
  });
});

describe("listoWebState: el estado real de la web manda sobre la URL", () => {
  it("sin publicar o retirada en la base de datos (siteVisibility) → eso, diga lo que diga la URL", () => {
    expect(listoWebState(undefined, "live")).toBe("live");
    expect(listoWebState("failed", "live")).toBe("live");
    expect(listoWebState(undefined, "withdrawn")).toBe("withdrawn");
  });
  it("publicada → se conserva «failed» (estilo base); «draft» ya no aplica", () => {
    expect(listoWebState(undefined, "published")).toBeUndefined();
    expect(listoWebState("draft", "published")).toBeUndefined();
    expect(listoWebState("failed", "published")).toBe("failed");
  });
  it("sin poder leerla, se fía de la URL (una web del creador sin publicar está en vivo)", () => {
    expect(listoWebState("draft", null)).toBe("live");
    expect(listoWebState("failed", null)).toBe("failed");
    expect(listoWebState(undefined, null)).toBeUndefined();
  });
});

describe("Enlace público y texto para compartir", () => {
  it("la misma base que el panel, sin barra doble", () => {
    expect(publicWeddingUrl("ana-y-pablo", "https://vinklo.es/")).toBe(url);
    expect(publicWeddingUrl("ana-y-pablo", "")).toBe("http://localhost:3000/b/ana-y-pablo");
  });
  it("WhatsApp sin destinatario y con el texto codificado", () => {
    expect(whatsappShareUrl(publishedShareText(url))).toBe(`https://wa.me/?text=${encodeURIComponent(`Ya tenemos la web de nuestra boda: ${url}`)}`);
  });
});
