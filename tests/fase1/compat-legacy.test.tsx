/**
 * QA fase 1 — compatibilidad de bodas existentes (sin fila en `wedding_sites`).
 *
 * La página pública construye el documento con `documentFromLegacy` sobre la
 * fila de `weddings_public` + agenda (lib/data/site-public.ts → getLegacySite)
 * y lo pinta con `InvitationRenderer`. Estos tests comprueban que el HTML
 * resultante conserva los textos y la estructura de la página anterior
 * (referencia: `git show HEAD:app/b/[slug]/page.tsx` + discovery.md §4).
 *
 * Refresh 2026-10-03 (Story): las aserciones sobre clases exactas de la
 * presentación anterior (monograma en doble círculo, caja bg-rubor/.v-pulse,
 * tarjeta blanca del RSVP, lugar anidado en la portada) pasan a comprobar lo
 * mismo en términos semánticos: textos, orden, conteos y atributos. Ver
 * docs/handoffs/2026-10-03-refresh/invitacion.md.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { documentFromLegacy, LEGACY_SCENE_IDS, type LegacyWeddingSource } from "@/lib/site-document";
import { WEDDING_PAGE_THEMES } from "@/lib/wedding-settings";

vi.mock("@/components/guest/rsvp-form", () => ({
  RsvpForm: ({ slug, invitationToken }: { slug: string; invitationToken?: string }) => (
    <form data-testid="rsvp-form" data-slug={slug} data-token={invitationToken ?? ""} />
  ),
}));

import { InvitationRenderer } from "@/components/invitation/renderer";

/** Fila tal como la devuelve `weddings_public` (+ agenda), sin `wedding_sites`. */
const legacyRow: LegacyWeddingSource & { slug: string; plan: "free" | "premium" } = {
  slug: "maria-y-jorge",
  plan: "free",
  partner_name_1: "María",
  partner_name_2: "Jorge",
  wedding_date: "2027-09-04",
  cover_image_url: null,
  page_config: {
    style: "editorial",
    welcomeMessage: "Qué ganas de veros.\nTraed ganas de bailar.",
    venue: "La Finca",
    address: "Camino de los Olivos 1, Toledo",
    time: "17:30",
  },
  agenda: [
    { id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "17:30", place: "Jardín", address: "https://maps.example/finca", notes: "Llegad con tiempo." },
    { id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000002", title: "Cena", time_label: "21:00", place: "Carpa", address: "Calle Mayor 1", notes: null },
  ],
};

/** now fijo: Madrid 2027-05-01 → faltan 126 días para el 4 de septiembre. */
const NOW = new Date("2027-05-01T10:00:00Z");

type Overrides = Partial<typeof legacyRow> & { page_config?: Partial<NonNullable<LegacyWeddingSource["page_config"]>> };

function renderLegacy(overrides: Overrides = {}, opts: { now?: Date; token?: string; rsvpMvp?: boolean; plan?: "free" | "premium" } = {}) {
  const row = { ...legacyRow, ...overrides, page_config: overrides.page_config === null ? null : { ...legacyRow.page_config, ...(overrides.page_config ?? {}) } };
  const document = documentFromLegacy(row);
  return renderToStaticMarkup(
    <InvitationRenderer
      document={document}
      mode="public"
      plan={opts.plan ?? row.plan}
      now={opts.now ?? NOW}
      rsvp={{ slug: row.slug, invitationToken: opts.token, rsvpMvp: opts.rsvpMvp ?? true }}
    />,
  );
}

const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end));

describe("compatibilidad legacy · portada", () => {
  it("pinta los nombres en el h1 con el ampersand decorativo y el eyebrow por defecto", () => {
    const html = renderLegacy();
    expect(html).toContain("<main");
    // Un nombre por línea; el «&» decorativo (cursiva en cava) abre la segunda.
    expect(html).toMatch(
      /<h1 class="[^"]*"><span class="sp-name">María<\/span> <span class="sp-name"><span aria-hidden="true" class="[^"]*text-cava[^"]*">&amp;<\/span> Jorge<\/span><\/h1>/,
    );
    expect(html).toContain(">¡Nos casamos!</p>");
    // Eyebrow mono en versalitas (el tracking amplio vive en `.sp-eyebrow`).
    expect(html).toContain('class="sp-eyebrow font-mono text-[11px] font-medium text-cava-texto uppercase"');
  });

  it("formatea la fecha en es-ES como la página anterior (sábado, 4 de septiembre de 2027)", () => {
    expect(renderLegacy()).toMatch(/<p class="sp-date font-display [^"]*">sábado, 4 de septiembre de 2027<\/p>/);
    expect(renderLegacy({ wedding_date: "2028-02-29" })).toContain("martes, 29 de febrero de 2028");
  });

  it("sin fecha no pinta la línea de fecha ni la cuenta atrás", () => {
    const html = renderLegacy({ wedding_date: null });
    expect(html).not.toContain("sp-date");
    expect(html).not.toContain("para el sí");
    // Una fecha inválida en BD se trata como ausente, no revienta.
    expect(renderLegacy({ wedding_date: "2027-02-31" })).not.toContain("para el sí");
  });

  it("conserva los saltos de línea del mensaje de bienvenida (whitespace-pre-line)", () => {
    const html = renderLegacy();
    expect(html).toMatch(/<p class="[^"]*whitespace-pre-line[^"]*">Qué ganas de veros\.\nTraed ganas de bailar\.<\/p>/);
  });

  it("sin mensaje de bienvenida omite el párrafo", () => {
    expect(renderLegacy({ page_config: { welcomeMessage: "" } })).not.toContain("whitespace-pre-line");
  });

  it("monograma M·J cuando no hay foto (un solo glifo script, decorativo), sin imagen", () => {
    const html = renderLegacy();
    expect(html).toMatch(/<p aria-hidden="true" class="sp-monogram font-script [^"]*">M·J<\/p>/);
    expect(html).not.toContain("<img");
  });

  it("foto de portada cuando hay URL: img con alt descriptivo, prioridad y velo", () => {
    const html = renderLegacy({ cover_image_url: "https://example.com/foto.jpg" });
    expect(html).toContain('class="sp-cover-photo"');
    expect(html).toMatch(/<img[^>]*alt="Foto de María y Jorge"/);
    // Prioridad: next/image emite el preload de la foto de portada.
    expect(html).toContain('<link rel="preload" as="image"');
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/foto\.jpg"/);
    // V2 (2026-10-03): portada a sangre; el velo es de tinta del tema (clase
    // .sp-cover-scrim en story-player.css), no el fundido a papel anterior.
    expect(html).toContain('class="sp-cover-scrim"');
    expect(html).not.toContain("M·J");
  });

  it("una cover_image_url que no es URL se ignora y vuelve el monograma", () => {
    const html = renderLegacy({ cover_image_url: "not a url" });
    expect(html).toContain("M·J");
    expect(html).not.toContain("<img");
  });
});

describe("compatibilidad legacy · lugar", () => {
  // Story (2026-10-03): el lugar es una escena propia justo detrás de la
  // portada (antes iba anidado entre la bienvenida y la cuenta atrás).
  it("escena lugar/dirección/hora detrás de la portada con «Te esperamos a las HH:MM»", () => {
    const html = renderLegacy();
    const venue = between(html, `<section aria-labelledby="${LEGACY_SCENE_IDS.venue}-title"`, "</section>");
    expect(venue).toContain(`<h2 id="${LEGACY_SCENE_IDS.venue}-title"`);
    expect(venue).toContain("Lugar de la celebración");
    expect(venue).toMatch(/<p class="sp-h2 font-display [^"]*">La Finca<\/p>/);
    expect(venue).toMatch(/<p class="[^"]*">Camino de los Olivos 1, Toledo<\/p>/);
    expect(venue).toMatch(/<p class="[^"]*">Te esperamos a las 17:30<\/p>/);
    // Filetes arriba y abajo, nunca tarjeta.
    expect(venue).toContain("sp-rule mt-6 border-y");
    // Orden: portada (bienvenida y cuenta atrás) → lugar → asistencia.
    expect(html.indexOf("Traed ganas de bailar.")).toBeLessThan(html.indexOf("La Finca"));
    expect(html.indexOf("para el sí")).toBeLessThan(html.indexOf("La Finca"));
    expect(html.indexOf("La Finca")).toBeLessThan(html.indexOf("Confirma tu asistencia"));
  });

  it("solo hora: pinta únicamente «Te esperamos a las»", () => {
    const html = renderLegacy({ page_config: { venue: "", address: "", time: "12:00" } });
    const venue = between(html, `<section aria-labelledby="${LEGACY_SCENE_IDS.venue}-title"`, "</section>");
    expect(venue).toContain("Te esperamos a las 12:00");
    expect(venue).not.toContain("sp-h2");
    expect(venue.match(/<p /g)?.length).toBe(1);
  });

  it("sin lugar, dirección ni hora no hay escena de lugar", () => {
    const html = renderLegacy({ page_config: { venue: "", address: "", time: "" } });
    expect(html).not.toContain(`${LEGACY_SCENE_IDS.venue}-title`);
    expect(html).not.toContain("Lugar de la celebración");
    expect(html).not.toContain("Os esperamos");
  });

  it("una hora inválida en page_config no revienta: se cae a la configuración por defecto", () => {
    // pageConfigSchema falla en bloque → documentFromLegacy usa los defaults (igual que el .catch anterior).
    const html = renderLegacy({ page_config: { time: "25:99" } });
    expect(html).not.toContain("Os esperamos");
    expect(html).toContain('data-wedding-style="editorial"');
  });
});

describe("compatibilidad legacy · cuenta atrás", () => {
  // Sin hora de ceremonia (ni en el lugar ni en el programa): solo días de calendario de Madrid.
  const noTime = { page_config: { time: "" }, agenda: [] } satisfies Overrides;

  it("N días → «días para el sí»: cifra display en arcilla, sin caja ni latido", () => {
    const html = renderLegacy(noTime);
    expect(html).toMatch(/<p class="sp-count font-display tabular text-cava-texto" aria-hidden="true">126<\/p>/);
    expect(html).toContain(">días para el sí</p>");
    expect(html).toContain("126 días para el sí");
    expect(html).toContain("Nos encantará celebrar este día contigo");
    expect(html).not.toContain("v-pulse");
    expect(html).not.toContain("bg-rubor");
  });

  it("1 día → singular «día para el sí» (fecha civil de Madrid)", () => {
    const html = renderLegacy(noTime, { now: new Date("2027-09-03T10:00:00Z") });
    expect(html).toMatch(/text-cava-texto" aria-hidden="true">1<\/p>/);
    expect(html).toContain(">día para el sí</p>");
    expect(html).not.toContain("días para el sí");
  });

  it("a las 22:30 UTC del día anterior ya es el día de la boda en Madrid → sin cuenta atrás", () => {
    expect(renderLegacy(noTime, { now: new Date("2027-09-03T22:30:00Z") })).not.toContain("para el sí");
  });

  it("el día de la boda y después no hay bloque de cuenta atrás", () => {
    expect(renderLegacy(noTime, { now: new Date("2027-09-04T08:00:00Z") })).not.toContain("sp-countdown");
    expect(renderLegacy(noTime, { now: new Date("2028-01-01T08:00:00Z") })).not.toContain("sp-countdown");
  });

  it("con hora (17:30 en el lugar): días, horas y minutos hasta la ceremonia en Madrid", () => {
    expect(renderLegacy()).toContain("126 días, 5 horas y 30 minutos para el sí");
    // El mismo día, antes de la ceremonia: las horas que faltan; después, nada.
    expect(renderLegacy({}, { now: new Date("2027-09-04T08:00:00Z") })).toContain("7 horas y 30 minutos para el sí");
    expect(renderLegacy({}, { now: new Date("2027-09-04T15:30:00Z") })).not.toContain("sp-countdown");
  });

  it("boda de noche (20:00 en el lugar): también cuenta horas y minutos", () => {
    expect(renderLegacy({ page_config: { time: "20:00" } })).toContain("126 días y 8 horas para el sí");
  });
});

describe("compatibilidad legacy · agenda", () => {
  it("lista los momentos con hora, lugar y notas; «Cómo llegar» solo para direcciones http", () => {
    const html = renderLegacy();
    expect(html).toMatch(new RegExp(`<h2 id="${LEGACY_SCENE_IDS.agenda}-title" class="sp-h2 font-display [^"]*">El día de la boda</h2>`));
    expect(html).toMatch(/<ol class="sp-timeline[^"]*">/);
    // Línea de tiempo de revista: hora en cursiva del acento (cifras tabulares), luego el título en display.
    expect(html).toMatch(/<p class="sp-time font-script tabular [^"]*">17:30<\/p><div><p class="sp-item-title font-display [^"]*">Ceremonia<\/p>/);
    expect(html).toMatch(/<p class="[^"]*">Jardín<\/p>/);
    expect(html).toMatch(/<a href="https:\/\/maps\.example\/finca" target="_blank" rel="noopener noreferrer" class="[^"]*underline[^"]*">Cómo llegar<\/a>/);
    expect(html).toMatch(/<p class="[^"]*text-xs[^"]*">Llegad con tiempo\.<\/p>/);
    // Dirección en texto plano: párrafo, nunca enlace.
    expect(html).toMatch(/<p class="[^"]*">Calle Mayor 1<\/p>/);
    expect(html).not.toContain('href="Calle Mayor 1"');
    expect(html.match(/Cómo llegar/g)?.length).toBe(1);
    expect(html.match(/<li /g)?.length).toBe(2);
  });

  it("sin agenda no hay sección «El día de la boda»", () => {
    const html = renderLegacy({ agenda: [] });
    expect(html).not.toContain("El día de la boda");
    expect(html).not.toContain(`${LEGACY_SCENE_IDS.agenda}-title`);
  });

  it("campos nulos de la agenda no pintan párrafos vacíos", () => {
    const html = renderLegacy({ agenda: [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000009", title: "Brindis", time_label: null, place: null, address: null, notes: null }] });
    expect(html).toContain("Brindis");
    // Sin hora: la columna queda vacía (span decorativo), nunca un <p> vacío.
    expect(html).not.toContain(`class="sp-time `);
    expect(html).not.toContain("<p></p>");
    expect(html).not.toContain("Cómo llegar");
  });
});

describe("compatibilidad legacy · asistencia", () => {
  it("con token personal monta el formulario con slug y token", () => {
    const html = renderLegacy({}, { token: "tok-123" });
    expect(html).toMatch(new RegExp(`<h2 id="${LEGACY_SCENE_IDS.rsvp}-title" class="sp-h2 font-display [^"]*">Confirma tu asistencia</h2>`));
    expect(html).toContain("Nos ayuda mucho saber cuántos seréis.");
    // Sin tarjeta blanca con sombra: el formulario va sobre el papel.
    expect(html).not.toContain("shadow-[");
    expect(html).not.toContain("bg-white");
    expect(html).toContain('data-testid="rsvp-form" data-slug="maria-y-jorge" data-token="tok-123"');
    expect(html).not.toContain("necesitas tu enlace personal");
  });

  it("sin token (RSVP_MVP) muestra el aviso de invitación personal y no el formulario", () => {
    const html = renderLegacy();
    expect(html).toContain("Para confirmar tu asistencia necesitas tu enlace personal.");
    expect(html).toContain("sirve para ver los detalles, pero no para responder");
    expect(html).not.toContain('data-testid="rsvp-form"');
  });

  it("con rsvpMvp=false el formulario es abierto (sin token)", () => {
    const html = renderLegacy({}, { rsvpMvp: false });
    expect(html).toContain('data-testid="rsvp-form" data-slug="maria-y-jorge" data-token=""');
    expect(html).not.toContain("necesitas tu enlace personal");
  });
});

describe("compatibilidad legacy · marca y tema", () => {
  it("plan free: pie de marca con el enlace utm; premium: sin pie", () => {
    const free = renderLegacy();
    expect(free).toMatch(/<footer class="sp-footer [^"]*">/);
    expect(free.match(/<footer/g)?.length).toBe(1);
    expect(free).toContain('href="/?utm_source=guest&amp;utm_medium=invitacion&amp;utm_campaign=loop"');
    expect(free).toContain("Hecho con ");
    const premium = renderLegacy({}, { plan: "premium" });
    expect(premium).not.toContain("<footer");
    expect(premium).not.toContain("utm_source=guest");
  });

  it.each(["editorial", "clasico", "natural"] as const)("tema %s → data-wedding-style y variables CSS de WEDDING_PAGE_THEMES", (style) => {
    const html = renderLegacy({ page_config: { style } });
    const theme = WEDDING_PAGE_THEMES[style];
    expect(html).toContain(`data-wedding-style="${style}"`);
    expect(html).toContain(`--papel:${theme.paper}`);
    expect(html).toContain(`--tinta:${theme.ink}`);
    expect(html).toContain(`--cava:${theme.accent}`);
    expect(html).toContain(`--cava-texto:${theme.accent}`);
    expect(html).toContain(`--rubor:${theme.surface}`);
    expect(html).toContain(`background-color:${theme.paper}`);
    expect(html).toContain(`color:${theme.ink}`);
  });

  it("la fuente del h1 depende del tema (editorial display, clásico script, natural serif)", () => {
    expect(renderLegacy({ page_config: { style: "editorial" } })).toMatch(/<h1 class="font-display sp-h1 /);
    expect(renderLegacy({ page_config: { style: "clasico" } })).toMatch(/<h1 class="font-script /);
    expect(renderLegacy({ page_config: { style: "natural" } })).toMatch(/<h1 class="font-serif /);
  });

  it("un style desconocido en page_config cae a editorial sin romper", () => {
    expect(renderLegacy({ page_config: { style: "neon" as never } })).toContain('data-wedding-style="editorial"');
  });
});

describe("compatibilidad legacy · estructura global", () => {
  it("orden de bloques: portada → agenda → asistencia → pie, con los ids estables del adaptador", () => {
    const html = renderLegacy();
    const positions = [
      html.indexOf("<header"),
      html.indexOf(`id="${LEGACY_SCENE_IDS.agenda}-title"`),
      html.indexOf(`id="${LEGACY_SCENE_IDS.rsvp}-title"`),
      html.indexOf("<footer"),
    ];
    positions.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // El documento legacy tiene exactamente estas escenas en este orden.
    const doc = documentFromLegacy(legacyRow);
    expect(doc.scenes.map((s) => s.id)).toEqual([LEGACY_SCENE_IDS.cover, LEGACY_SCENE_IDS.venue, LEGACY_SCENE_IDS.agenda, LEGACY_SCENE_IDS.rsvp]);
  });

  it("la raíz es <main class=\"sp-shell bg-papel text-tinta\"> con el tema y no hay escenas duplicadas", () => {
    const html = renderLegacy();
    expect(html).toMatch(/^<main class="sp-shell bg-papel text-tinta" style="/);
    expect(html.match(/<header/g)?.length).toBe(1);
    expect(html.match(/<h1 /g)?.length).toBe(1);
    // lugar + asistencia + agenda (el lugar ya no va anidado en la portada).
    expect(html.match(/<section /g)?.length).toBe(3);
    expect(html.match(/class="sp-scene"/g)?.length).toBe(4);
  });

  it("Story: el HTML del servidor trae todas las escenas apiladas y el cromo sin activar", () => {
    const html = renderLegacy();
    // Vista continua por defecto; el reproductor se activa al hidratar.
    expect(html).toContain('<div class="sp" data-view="all">');
    expect(html).not.toContain("data-hydrated");
    expect(html).not.toContain(" inert");
    // El sobre (por defecto desde el 8-oct-2026) lleva su propio data-state; el reproductor, no.
    const player = html.slice(0, html.indexOf('<div class="sp-seal"'));
    expect(player).not.toContain("data-state=");
    // Un segmento de progreso por escena y los controles manuales.
    expect(html.match(/data-segment="\d+"/g)?.length).toBe(4);
    expect(html).toContain(">Anterior</span>");
    expect(html).toContain(">Siguiente</span>");
    expect(html).toContain(">Ver todos los detalles</span>");
    expect(html).toContain('aria-label="Anterior"');
    expect(html).toContain('aria-label="Siguiente"');
    expect(html).toContain('aria-live="polite"');
  });

  it("no filtra datos privados: ni token en el HTML (salvo en el formulario), ni slug fuera del formulario", () => {
    const html = renderLegacy();
    expect(html).not.toContain("couple_id");
    expect(html).not.toContain("stripe");
    expect(html).not.toContain("invitacion=");
  });
});
