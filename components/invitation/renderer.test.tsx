import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { documentFromBuilderDraft, documentFromLegacy, type SiteDocument } from "@/lib/site-document";
import { EMPTY_DRAFT, composeBuilderDocument } from "@/lib/wedding-builder";

// El formulario real es un client component que arrastra la server action de
// RSVP (Supabase). Aquí solo importa que el renderer lo monte con sus props.
vi.mock("@/components/guest/rsvp-form", () => ({
  RsvpForm: ({ slug, invitationToken }: { slug: string; invitationToken?: string }) => (
    <form data-testid="rsvp-form" data-slug={slug} data-token={invitationToken ?? ""} />
  ),
}));

import { InvitationRenderer } from "./renderer";
import { WebAgenda, WebDatePoster, WebHero, WebLayout } from "./web-layout";

const NOW = new Date("2027-05-01T10:00:00Z");

function legacyDocument(overrides: Partial<Parameters<typeof documentFromLegacy>[0]> = {}): SiteDocument {
  return documentFromLegacy({
    partner_name_1: "María",
    partner_name_2: "Jorge",
    wedding_date: "2027-09-04",
    cover_image_url: null,
    page_config: { style: "editorial", welcomeMessage: "Qué ganas de veros.", venue: "La Finca", address: "Camino 1", time: "17:30" },
    agenda: [
      { id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000001", title: "Ceremonia", time_label: "17:30", place: "Jardín", address: "https://maps.example/finca", notes: "Llegad con tiempo." },
    ],
    ...overrides,
  });
}

function render(ui: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(ui);
}

describe("InvitationRenderer (público)", () => {
  it("pinta portada, lugar, agenda, RSVP y pie de marca en plan free", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />,
    );
    expect(html).toContain("<main");
    expect(html).toContain('data-wedding-style="editorial"');
    expect(html).toContain("María");
    expect(html).toContain("Jorge");
    expect(html).toContain("sábado, 4 de septiembre de 2027");
    expect(html).toContain("¡Nos casamos!");
    expect(html).toContain("Qué ganas de veros.");
    expect(html).toContain("La Finca");
    expect(html).toContain("Te esperamos a las 17:30");
    // Con hora de ceremonia (17:30), la cuenta atrás llega a horas y minutos (Madrid).
    expect(html).toContain("días, 5 horas y 30 minutos para el sí");
    expect(html).toContain("El día de la boda");
    expect(html).toContain("Ceremonia");
    expect(html).toContain('href="https://maps.example/finca"');
    expect(html).toContain("Cómo llegar");
    expect(html).toContain("Confirma tu asistencia");
    expect(html).toContain('data-testid="rsvp-form"');
    expect(html).toContain('data-token="tok"');
    expect(html).toContain("vuestra web de boda");
    expect(html).toContain("utm_source=guest");
    // Monograma sin foto.
    expect(html).toContain("M·J");
  });

  it("el lugar es una escena propia justo detrás de la portada (Story)", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="premium" now={NOW} />);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).not.toContain("La Finca");
    expect(html).toContain('<section aria-labelledby="lugar-title"');
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("La Finca"));
    expect(html.indexOf("La Finca")).toBeLessThan(html.indexOf("Confirma tu asistencia"));
  });

  it("no pinta el pie de marca en plan premium", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="premium" now={NOW} />);
    expect(html).not.toContain("Hecho con");
    expect(html).not.toContain("utm_source=guest");
  });

  it("sin token y con RSVP_MVP muestra el aviso en lugar del formulario", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} />,
    );
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).toContain("necesitas tu enlace personal");
    // Sin RSVP_MVP el formulario vuelve a ser abierto.
    const open = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: false }} />,
    );
    expect(open).toContain('data-testid="rsvp-form"');
    expect(open).toContain('data-slug="maria-y-jorge"');
  });

  it("omite la cuenta atrás cuando la boda ya ha pasado y usa la foto de portada si existe", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument({ cover_image_url: "https://example.com/foto.jpg" })} mode="public" plan="free" now={new Date("2028-01-01T10:00:00Z")} />,
    );
    expect(html).not.toContain("días para el sí");
    expect(html).toContain("<img");
    expect(html).toContain("https://example.com/foto.jpg");
    expect(html).not.toContain("M·J");
  });

  it("pinta el hueco afterCover justo detrás de la portada", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="premium" now={NOW} afterCover={<div data-testid="sobre" />} />,
    );
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf('data-testid="sobre"'));
    expect(html.indexOf('data-testid="sobre"')).toBeLessThan(html.indexOf("Confirma tu asistencia"));
  });
});

describe("InvitationRenderer (preview)", () => {
  it("muestra el placeholder del formulario y no navega", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} />);
    expect(html).not.toContain("<main");
    expect(html).toContain('data-invitation-mode="preview"');
    expect(html).toContain("Aquí vuestros invitados confirmarán su asistencia, con acompañantes y alergias.");
    expect(html).not.toContain('data-testid="rsvp-form"');
    expect(html).not.toContain("<a ");
    expect(html).toContain("Cómo llegar");
    expect(html).toContain("vuestra web de boda");
  });

  it("acepta el borrador del wizard", () => {
    const doc = documentFromBuilderDraft({ ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", style: "clasico" });
    const html = render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} />);
    expect(html).toContain("Marta");
    expect(html).toContain('data-wedding-style="clasico"');
    expect(html).toContain("sábado, 12 de junio de 2027");
    expect(html).toContain(EMPTY_DRAFT.welcomeMessage);
  });
});

describe("InvitationRenderer (documento)", () => {
  it("no pinta escenas deshabilitadas", () => {
    const doc = legacyDocument();
    const disabled: SiteDocument = { ...doc, scenes: doc.scenes.map((s) => (s.type === "agenda" || s.type === "venue" ? { ...s, enabled: false } : s)) } as SiteDocument;
    const html = render(<InvitationRenderer document={disabled} mode="public" plan="free" now={NOW} />);
    expect(html).not.toContain("El día de la boda");
    expect(html).not.toContain("La Finca");
    expect(html).toContain("Confirma tu asistencia");
  });

  it("aplica el tema natural y sus variables", () => {
    const doc = legacyDocument({ page_config: { style: "natural" } });
    const html = render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} />);
    expect(html).toContain('data-wedding-style="natural"');
    expect(html).toContain("--papel:#f4f5ec");
    expect(html).toContain("--cava:#52734c");
    expect(html).toContain("font-serif");
  });

  it("solo enlaza «Cómo llegar» con https://; http y textos sueltos se muestran como texto", () => {
    const agenda = [
      { id: "a1", title: "Ceremonia", time_label: null, place: null, address: "http://maps.example/inseguro", notes: null },
      { id: "a2", title: "Cóctel", time_label: null, place: null, address: "http foo", notes: null },
      { id: "a3", title: "Cena", time_label: null, place: null, address: "javascript:alert(1)", notes: null },
    ];
    const html = render(<InvitationRenderer document={legacyDocument({ agenda })} mode="public" plan="free" now={NOW} />);
    expect(html).not.toContain("Cómo llegar");
    expect(html).not.toContain("href=\"http://maps.example/inseguro\"");
    expect(html).not.toContain("href=\"javascript:");
    expect(html).toContain("http://maps.example/inseguro");
    expect(html).toContain("http foo");
  });

  it("pinta un lugar como sección propia si no sigue a la portada", () => {
    const doc = legacyDocument();
    // portada, asistencia, lugar, programa
    const reordered: SiteDocument = { ...doc, scenes: [doc.scenes[0], doc.scenes[3], doc.scenes[1], doc.scenes[2]] };
    const html = render(<InvitationRenderer document={reordered} mode="public" plan="free" now={NOW} />);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).not.toContain("La Finca");
    expect(html).toContain("Lugar de la celebración");
    expect(html.indexOf("Confirma tu asistencia")).toBeLessThan(html.indexOf("La Finca"));
  });
});

describe("InvitationRenderer (Story)", () => {
  it("el HTML del servidor contiene todas las escenas apiladas, sin cromo activado ni inert", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />,
    );
    expect(html).toContain('<div class="sp" data-view="all">');
    expect(html).not.toContain("data-hydrated");
    expect(html).not.toContain(" inert");
    const ids = [...html.matchAll(/data-scene-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["portada", "lugar", "programa", "asistencia"]);
    const types = [...html.matchAll(/data-scene-type="([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(["cover", "venue", "agenda", "rsvp"]);
  });

  it("la barra de progreso tiene un segmento por escena habilitada", () => {
    const four = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />);
    expect(four.match(/data-segment="\d+"/g)?.length).toBe(4);
    // Sin agenda ni lugar quedan portada y asistencia.
    const two = render(<InvitationRenderer document={legacyDocument({ agenda: [], page_config: { style: "editorial" } })} mode="public" plan="free" now={NOW} />);
    expect(two.match(/data-segment="\d+"/g)?.length).toBe(2);
    expect(two.match(/class="sp-scene"/g)?.length).toBe(2);
  });

  it("controles manuales accesibles: Anterior, Siguiente, «Ver todos los detalles», aria-live", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />);
    expect(html).toMatch(/<button type="button" class="sp-btn" aria-label="Anterior" disabled=""><svg[\s\S]*?<\/svg><span class="sp-btn-label">Anterior<\/span><\/button>/);
    expect(html).toContain('<button type="button" class="sp-btn sp-btn-text"><span class="sp-btn-ellipsis">Ver todos los detalles</span></button>');
    expect(html).toContain('<span class="sp-btn-label">Siguiente</span>');
    expect(html).toContain('aria-label="Siguiente"');
    expect(html).toContain('<p class="sr-only" aria-live="polite" aria-atomic="true"></p>');
    // Autoavance (13-oct-2026): en la web pública hay botón de pausa; la
    // escena actual se llena con el reloj (data-timed) en vez de estar llena.
    expect(html).toContain('class="sp-autoplay" aria-label="Pausar el avance automático"');
    expect(html).not.toMatch(/class="sp-autoplay"[^>]*aria-disabled/);
    expect(html).toContain('data-segment="1" data-filled="false" data-timed="true"');
  });

  it("en el preview (creador, editor) no hay autoavance: ni pausa ni reloj", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} />);
    expect(html).not.toContain("sp-autoplay");
    expect(html).not.toContain("data-timed");
    expect(html).toContain('data-segment="1" data-filled="true"');
  });

  it("en una Story de una sola escena el botón de pausa sale deshabilitado, no desaparece", () => {
    const html = render(<InvitationRenderer document={{ ...legacyDocument({ agenda: [], page_config: { style: "editorial" } }), scenes: legacyDocument().scenes.filter((scene) => scene.type === "cover") }} mode="public" plan="free" now={NOW} />);
    expect(html).toMatch(/class="sp-autoplay"[^>]*aria-disabled="true"/);
    expect(html).not.toContain("data-timed");
  });

  it("solo la escena actual lleva reloj; las demás arrancan vacías", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />);
    expect(html.match(/data-timed/g)?.length).toBe(1);
    expect(html.match(/data-filled="false"/g)?.length).toBe(4);
  });

  it("afterCover es una pantalla más (tipo extra) tras portada y lugar", () => {
    const html = render(
      <InvitationRenderer document={legacyDocument()} mode="public" plan="premium" now={NOW} afterCover={<div data-testid="sobre" />} />,
    );
    const types = [...html.matchAll(/data-scene-type="([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(["cover", "venue", "extra", "agenda", "rsvp"]);
    expect(html.match(/data-segment="\d+"/g)?.length).toBe(5);
  });

  it("preview: ocupa el marco del padre (sp-shell-preview) y conserva el cromo", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} />);
    expect(html).toMatch(/^<div class="sp-shell sp-shell-preview bg-papel text-tinta"/);
    expect(html.match(/data-segment="\d+"/g)?.length).toBe(4);
    expect(html).toContain("Ver todos los detalles");
    expect(html).not.toContain("<a ");
  });

  it("activeSceneId es opcional y no cambia el HTML del servidor (todas las escenas apiladas)", () => {
    const doc = legacyDocument();
    const venueId = doc.scenes.find((s) => s.type === "venue")!.id;
    const base = render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} />);
    expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} activeSceneId={venueId} />)).toBe(base);
    expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} activeSceneId="no-existe" />)).toBe(base);
  });

  it("preview: los nombres van en h2 (la página que lo contiene tiene su h1); público en h1", () => {
    const doc = legacyDocument();
    expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} />)).not.toContain("<h1");
    expect(render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} />).match(/<h1 /g)?.length).toBe(1);
  });
});

describe("InvitationRenderer (V2: paletas, foto protagonista, acciones)", () => {
  it("sin `palette` usa la del tema; con `palette` cambia solo los colores", () => {
    const base = legacyDocument({ page_config: { style: "clasico" } });
    const plain = render(<InvitationRenderer document={base} mode="public" plan="free" now={NOW} />);
    expect(plain).toContain('data-palette="clasico"');
    expect(plain).toContain("--papel:#fffdf8");
    const rosa = render(<InvitationRenderer document={{ ...base, palette: "rosa" }} mode="public" plan="free" now={NOW} />);
    expect(rosa).toContain('data-palette="rosa"');
    expect(rosa).toContain("--papel:#faf1ef");
    expect(rosa).toContain("--cava:#9a3d55");
    // La tipografía sigue al tema.
    expect(rosa).toContain('data-wedding-style="clasico"');
    expect(rosa).toMatch(/<h1 class="font-script /);
  });

  it("foto: portada a sangre (data-photo), velo, una sola imagen prioritaria y cuenta atrás compacta", () => {
    const html = render(<InvitationRenderer document={legacyDocument({ cover_image_url: "https://example.com/foto.jpg" })} mode="public" plan="free" now={NOW} />);
    expect(html).toContain('<header class="sp-cover flex flex-col" data-photo=""');
    expect(html).toContain('class="sp-cover-scrim"');
    expect(html).toContain('data-tone="photo"');
    expect(html.match(/<img /g)?.length).toBe(1);
    expect(html.match(/rel="preload" as="image"/g)?.length).toBe(1);
    expect(html).toContain('class="sp-count-inline tabular"');
    expect(html).not.toContain("sp-monogram");
  });

  it("foto panorámica (> 2:1) → banda; sin dimensiones → a sangre", () => {
    const doc = legacyDocument();
    const withImage = (w?: number, h?: number): SiteDocument => ({
      ...doc,
      scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: { url: "https://example.com/p.jpg", alt: "", width: w, height: h } } } : s)),
    });
    expect(render(<InvitationRenderer document={withImage(1600, 360)} mode="public" plan="free" now={NOW} />)).toContain('data-photo-fit="band"');
    expect(render(<InvitationRenderer document={withImage(1600, 1067)} mode="public" plan="free" now={NOW} />)).not.toContain("data-photo-fit");
    expect(render(<InvitationRenderer document={withImage()} mode="public" plan="free" now={NOW} />)).not.toContain("data-photo-fit");
  });

  it("previewCoverImage: solo en preview, sin tocar el documento", () => {
    const blob = { url: "blob:http://localhost/abc", alt: "Foto", width: 800, height: 1000 };
    const preview = render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} previewCoverImage={blob} />);
    expect(preview).toContain('src="blob:http://localhost/abc"');
    const pub = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} previewCoverImage={blob} />);
    expect(pub).not.toContain("blob:");
    expect(pub).toContain("M·J");
  });

  it("lugar: «Añadir al calendario» (.ics) y «Ver en el mapa» con datos del documento", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />);
    expect(html).toMatch(/<a class="sp-action" data-action="calendar" href="data:text\/calendar;charset=utf-8,[^"]+" download="boda-maria-y-jorge\.ics">/);
    expect(decodeURIComponent(html.match(/href="data:text\/calendar;charset=utf-8,([^"]+)"/)![1])).toContain("DTSTART:20270904T153000Z");
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=La%20Finca%2C%20Camino%201"');
    expect(html).toContain("Ver en el mapa");
  });

  it("web pública con slug: «Añadir al calendario» abre /b/[slug]/calendario.ics (inline, sin data: ni download) (#13)", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />);
    expect(html).toContain('<a class="sp-action" data-action="calendar" href="/b/maria-y-jorge/calendario.ics">');
    expect(html).not.toContain("data:text/calendar");
    // Google Calendar con el mismo fin que el .ics (+8 h desde las 17:30).
    expect(html).toContain("dates=20270904T173000%2F20270905T013000");
  });

  it("sin lugar, el calendario va en la portada; preview sin enlaces", () => {
    const noVenue = legacyDocument({ page_config: { style: "editorial", venue: "", address: "", time: "" } });
    const html = render(<InvitationRenderer document={noVenue} mode="public" plan="free" now={NOW} />);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('data-action="calendar"');
    expect(header).toContain("DATE%3A20270904");
    expect(html).not.toContain("Ver en el mapa");
    const preview = render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} />);
    expect(preview).toContain('<span class="sp-action" data-action="calendar" aria-disabled="true">');
    expect(preview).not.toContain("<a ");
  });

  it("sin fecha no hay calendario; nombres largos marcan data-long", () => {
    const html = render(
      <InvitationRenderer
        document={legacyDocument({ wedding_date: null, partner_name_1: "María de los Ángeles Fernández", partner_name_2: "Jorge" })}
        mode="public"
        plan="free"
        now={NOW}
      />,
    );
    expect(html).not.toContain('data-action="calendar"');
    expect(html).toContain("Ver en el mapa");
    expect(html).toMatch(/<h1 class="font-display sp-h1 [^"]*" data-long="">/);
  });

  it("nombres muy largos (> 48 grafemas) → data-long=\"xl\"; cortos sin atributo", () => {
    const xl = render(
      <InvitationRenderer
        document={legacyDocument({ partner_name_1: "María de los Ángeles Fernández-Villaverde 🌿", partner_name_2: "محمد عبد الرحمن بن الحسين" })}
        mode="preview"
        plan="free"
        now={NOW}
      />,
    );
    expect(xl).toContain('data-long="xl"');
    expect(xl).toContain("محمد عبد الرحمن بن الحسين");
    expect(render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />)).not.toContain("data-long");
  });
});

describe("InvitationRenderer — apertura «sobre»", () => {
  it("sin `opening` abre con el sobre floral (lo que promete la landing; regresión 8-oct-2026)", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} />);
    expect(html).toContain("sp-seal");
    expect(html).toContain('data-variant="floral"');
    expect(html).toMatch(/M<tspan class="wax-amp">&amp;<\/tspan>J<\/text>/);
  });
  it("con opening=ninguno (elección «Directa») no hay sobre", () => {
    const html = render(<InvitationRenderer document={{ ...legacyDocument(), opening: "ninguno" }} mode="public" plan="free" now={NOW} />);
    expect(html).not.toContain("sp-seal");
  });
  it("con opening=sobre-liso pinta el sobre liso", () => {
    const html = render(<InvitationRenderer document={{ ...legacyDocument(), opening: "sobre-liso" }} mode="public" plan="free" now={NOW} />);
    expect(html).toContain('data-variant="liso"');
  });
  it("con opening=sobre pinta el sobre lacrado con iniciales y nombres, y la portada debajo", () => {
    const html = render(<InvitationRenderer document={{ ...legacyDocument(), opening: "sobre" }} mode="public" plan="free" now={NOW} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Abrir la invitación");
    expect(html).toContain("wax-initials");
    expect(html).toMatch(/M<tspan class="wax-amp">&amp;<\/tspan>J<\/text>/);
    // Sin JS el sobre se oculta y la web sigue siendo usable (nada inert en el HTML del servidor).
    expect(html).toContain("<noscript>");
    expect(html).not.toContain("inert");
    expect(html).toContain("María");
  });
});

describe("InvitationRenderer — maqueta «web» (layout: web)", () => {
  const web = (overrides: Partial<SiteDocument> = {}): SiteDocument => ({ ...legacyDocument(), layout: "web", ...overrides });

  it("sin layout sigue siendo la Story de siempre", () => {
    const html = render(<InvitationRenderer document={legacyDocument()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />);
    expect(html).toContain('data-layout="historia"');
    expect(html).toContain("Ver todos los detalles");
    expect(html).not.toContain('class="wl"');
  });

  it("pinta las mismas escenas como una web: portada, fecha, lugar, programa y asistencia al final", () => {
    const html = render(<InvitationRenderer document={web()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />);
    expect(html).toContain('data-layout="web"');
    expect(html).toContain('class="wl"');
    // Sin cromo de la Story.
    expect(html).not.toContain("Ver todos los detalles");
    expect(html).not.toContain("sp-progress");
    // Portada con los nombres como h1 y la bienvenida de la pareja.
    expect(html).toMatch(/<h1[^>]*wl-names[^>]*>.*María.*Jorge.*<\/h1>/);
    expect(html).toContain("Qué ganas de veros.");
    // La fecha como cartel con la cuenta atrás de siempre.
    expect(html).toContain('dateTime="2027-09-04"');
    expect(html).toContain("sábado");
    expect(html).toContain("septiembre de 2027");
    expect(html).toContain("días para el sí");
    // Lugar con sus acciones; programa con su enlace; asistencia con el formulario.
    expect(html).toContain("La Finca");
    expect(html).toContain("Añadir al calendario");
    expect(html).toContain("Ver en el mapa");
    expect(html).toContain('href="https://maps.example/finca"');
    expect(html).toContain('data-testid="rsvp-form"');
    // Navegación: «Confirmar asistencia» es un ancla real al bloque de asistencia.
    expect(html).toContain('href="#asistencia"');
    expect(html).toContain('Confirmar<span class="wl-nav-cta-long">asistencia</span>');
    expect(html).toContain('id="asistencia"');
    // Orden de lectura: (nav) → portada → fecha → lugar → programa → asistencia → pie.
    const order = ["wl-names", "wl-date-poster", "wl-venue-name", "wl-rail", "Confirma tu asistencia", "vuestra web de boda"].map((s) => html.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("enlace general sin token (#10): el botón de la navegación dice «Asistencia», no promete confirmar", () => {
    const html = render(<InvitationRenderer document={web()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} />);
    expect(html).toContain('href="#asistencia"');
    expect(html).toMatch(/wl-nav-cta[^>]*>Asistencia</);
    expect(html).not.toContain('Confirmar<span class="wl-nav-cta-long">asistencia</span>');
    expect(html).toContain("necesitas tu enlace personal");
  });

  it.each([
    ["enlace no válido", { linkInvalid: true }],
    ["enlace cerrado", { linkClosed: true }],
    ["plazo cerrado", { window: { status: "closed", reason: "deadline", deadline: "2027-08-01" } as const }],
  ])("%s: tampoco promete confirmar", (_label, extra) => {
    const html = render(<InvitationRenderer document={web()} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true, ...extra }} />);
    expect(html).toMatch(/wl-nav-cta[^>]*>Asistencia</);
  });

  it("el HTML del servidor se lee entero y quieto: nada oculto ni desplazado antes de montar", () => {
    const html = render(<InvitationRenderer document={web()} mode="public" plan="free" now={NOW} />);
    expect(html).not.toContain("data-motion");
    expect(html).not.toMatch(/style="[^"]*opacity:\s*0/);
    expect(html).not.toMatch(/style="[^"]*transform/);
  });

  it("con foto, la portada es la foto a sangre; sin foto, papel con monograma", () => {
    const photo = render(
      <InvitationRenderer document={web()} mode="public" plan="free" now={NOW} previewCoverImage={undefined} />,
    );
    expect(photo).toContain("wl-hero-mono");
    const withImage = web({
      scenes: legacyDocument().scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: { url: "https://x.supabase.co/storage/v1/object/public/wedding-photos/a.jpg", alt: "María y Jorge", width: 1200, height: 1600 } } } : s)),
    });
    const html = render(<InvitationRenderer document={withImage} mode="public" plan="free" now={NOW} />);
    expect(html).toContain("wl-hero-media");
    expect(html).toContain('alt="María y Jorge"');
    expect(html).not.toContain("wl-hero-mono");
  });

  it("en el preview no hay enlaces que naveguen y los títulos bajan a h2", () => {
    const html = render(<InvitationRenderer document={web()} mode="preview" plan="free" now={NOW} />);
    expect(html).not.toContain("<h1");
    expect(html).not.toContain('href="#asistencia"');
    expect(html).toMatch(/<button[^>]*wl-nav-cta[^>]*>Confirmar<span class="wl-nav-cta-long">asistencia<\/span><\/button>/);
    expect(html).toContain('data-mode="preview"');
  });

  it("enlace personal con nombre: «Para Carmen» en el sobre; sin nombre o en el preview, nada (ítem 11)", () => {
    const withName = render(<InvitationRenderer document={web({ opening: "sobre" })} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true, guestName: "Carmen" }} />);
    expect(withName).toContain('<p class="sp-seal-eyebrow"><span class="sp-seal-for" data-seal-for="">Para Carmen</span>Tienes una invitación</p>');
    const without = render(<InvitationRenderer document={web({ opening: "sobre" })} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", invitationToken: "tok", rsvpMvp: true }} />);
    expect(without).not.toContain("data-seal-for");
    expect(without).toContain('<p class="sp-seal-eyebrow">Tienes una invitación</p>');
    const preview = render(<InvitationRenderer document={web({ opening: "sobre" })} mode="preview" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true, guestName: "Carmen" }} />);
    expect(preview).not.toContain("Para Carmen");
  });

  it("la apertura «sobre» va delante también de la web", () => {
    const html = render(<InvitationRenderer document={web({ opening: "sobre" })} mode="public" plan="free" now={NOW} />);
    expect(html).toContain("data-sealed");
    expect(html.indexOf("sp-seal-content")).toBeLessThan(html.indexOf('class="wl"'));
  });

  it("sin lugar, «Añadir al calendario» acompaña a la fecha", () => {
    const doc = web({ scenes: legacyDocument().scenes.map((s) => (s.type === "venue" ? { ...s, enabled: false } : s)) });
    const html = render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} />);
    expect(html).not.toContain("La Finca");
    expect(html).toContain("Añadir al calendario");
    expect(html).not.toContain(">Lugar<");
  });
});

describe("WebLayout — movimiento", () => {
  const hero = (
    <WebHero partnerName1="Ana" partnerName2="Luis" eyebrow="" themeId="editorial" image={{ url: "https://example.com/a.jpg", alt: "Ana y Luis" }} initials="A·L" headingLevel={1} />
  );

  it("con movimiento completo, la portada lleva parallax (transform) ligado al scroll", () => {
    const html = render(<WebLayout mode="public" initials="A·L" links={[]} forcedMotion="full">{hero}</WebLayout>);
    expect(html).toContain('data-motion="full"');
    expect(html).toMatch(/class="wl-hero-media"[^>]*style="[^"]*transform/);
  });

  it("con prefers-reduced-motion: sin parallax ni desplazamientos, solo fundidos", () => {
    const html = render(
      <WebLayout mode="public" initials="A·L" links={[]} forcedMotion="reduce">
        {hero}
        <WebDatePoster id="fecha" weddingDate="2027-06-12" showCountdown ceremonyTime={null} initialNow={Date.parse("2027-06-02T10:00:00Z")} />
        <WebAgenda id="programa" title="El día" items={[{ id: "m-1", title: "Ceremonia", timeLabel: "13:00", place: "", address: "", notes: "" }]} />
      </WebLayout>,
    );
    expect(html).toContain('data-motion="reduce"');
    // Ningún transform en línea (parallax, raíl, cifra de la fecha)…
    expect(html).not.toMatch(/style="[^"]*transform/);
    // …y las secciones siguen marcadas para el fundido (CSS: solo opacidad en "reduce").
    expect(html).toContain("data-reveal");
  });
});

describe("escenas v2 (historia, galería, detalles, preguntas)", () => {
  const photo = (n: number, caption?: string) => ({ url: `https://cdn.test/foto-${n}.jpg`, alt: `Foto ${n}`, width: 1200, height: 1500, ...(caption ? { caption } : {}) });
  function v2Document(layout?: "web"): SiteDocument {
    const doc = legacyDocument();
    return {
      ...doc,
      ...(layout ? { layout } : {}),
      scenes: [
        doc.scenes[0]!,
        { id: "fotos", type: "gallery", enabled: true, props: { title: "Os invitamos a celebrar nuestra historia", images: [photo(1, "Primer viaje"), photo(2), photo(3)] } },
        { id: "historia", type: "story", enabled: true, props: { title: "Nuestra historia", intro: "", chapters: [{ id: "c1", title: "Cómo nos conocimos", body: "En la universidad.", images: [photo(4, "Café entre clases"), photo(5)] }] } },
        ...doc.scenes.slice(1),
        { id: "detalles", type: "details", enabled: true, props: { title: "Algunos detalles más", intro: "Lo práctico.", cards: [{ id: "d1", title: "Dress code", teaser: "Fiesta en el jardín", body: "Colores claros.", link: "https://ejemplo.test/dress", linkLabel: "Ver ideas" }] } },
        { id: "preguntas", type: "faq", enabled: true, props: { title: "Preguntas y respuestas", contact: "¿Otra duda? Escribidnos.", items: [{ id: "q1", question: "¿Hay aparcamiento?", answer: "Sí, en la finca." }] } },
      ],
    };
  }

  it("web: pinta collage, capítulos, tarjetas y preguntas con sus anclas en la navegación", () => {
    const html = render(<InvitationRenderer document={v2Document("web")} mode="public" plan="free" now={NOW} rsvp={{ slug: "x", rsvpMvp: true }} />);
    expect(html).toContain('data-layout="web"');
    expect(html).toContain("Os invitamos a celebrar nuestra historia");
    expect(html).toContain("Primer viaje");
    expect(html).toContain("Capítulo uno");
    expect(html).toContain("Cómo nos conocimos");
    expect(html).toContain("Café entre clases");
    expect(html).toContain("Dress code");
    expect(html).toContain('href="https://ejemplo.test/dress"');
    expect(html).toContain("¿Hay aparcamiento?");
    expect(html).toContain("Nos encantaría contar contigo…");
    for (const label of ["Nuestra historia", "Detalles", "Preguntas", "La fecha", "Lugar", "Programa"]) expect(html).toContain(`>${label}<`);
    // El reloj en directo no se pinta en el servidor (hidratación).
    expect(html).not.toContain("wl-clock");
    // Orden: historia y galería antes de la fecha; la fecha justo antes del lugar.
    const order = ["wl-gallery", "wl-story", "wl-date", "wl-venue", "wl-agenda", "wl-details", "wl-faq"].map((c) => html.indexOf(c));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("story: cada escena v2 es una pantalla; en preview los enlaces de tarjeta no navegan", () => {
    const html = render(<InvitationRenderer document={v2Document()} mode="preview" plan="free" now={NOW} />);
    for (const type of ["gallery", "story", "details", "faq"]) expect(html).toContain(`data-scene-type="${type}"`);
    expect(html).toContain("Capítulo uno: Cómo nos conocimos");
    expect(html).toContain('aria-disabled="true" class="sp-card-link"');
    expect(html).not.toContain('href="https://ejemplo.test/dress"');
  });

  it("escenas v2 vacías no aparecen en ninguna maqueta", () => {
    const doc = legacyDocument();
    const empty: SiteDocument = { ...doc, layout: "web", scenes: [...doc.scenes, { id: "hh", type: "story", enabled: true, props: { title: "Nuestra historia", intro: "", chapters: [] } }, { id: "pp", type: "faq", enabled: true, props: { title: "Preguntas", contact: "", items: [] } }] };
    const html = render(<InvitationRenderer document={empty} mode="public" plan="free" now={NOW} rsvp={{ slug: "x", rsvpMvp: true }} />);
    expect(html).not.toContain("wl-story");
    expect(html).not.toContain("wl-faq");
    expect(html).not.toContain(">Nuestra historia<");
  });
});

describe("InvitationRenderer — plantillas del creador sin rellenar (8-oct-2026)", () => {
  const draft = { ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", guestCount: "80" };
  for (const layout of ["web", null] as const) {
    it(`no enseña al invitado preguntas sin respuesta ni tarjetas vacías (${layout ?? "historia"})`, () => {
      const html = render(<InvitationRenderer document={composeBuilderDocument({ ...draft, layout })} mode="public" plan="free" now={NOW} />);
      expect(html).toContain("¿Puedo avisar de alergias o intolerancias?");
      expect(html).not.toContain("¿Hay aparcamiento?");
      expect(html).not.toContain("Dress code");
      expect(html).not.toContain("Nuestra historia");
    });
  }
});

describe("InvitationRenderer — autobuses sin hora (8-oct-2026)", () => {
  it("una parada sin hora no pinta «—»", () => {
    for (const layout of ["web", null] as const) {
      const doc = composeBuilderDocument({ ...EMPTY_DRAFT, layout, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-06-12", modules: ["bus"], busStops: [{ name: "Plaza de Castilla", time: "", place: "" }] });
      const html = render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} />);
      expect(html).toContain("Plaza de Castilla");
      expect(html).not.toContain("—");
    }
  });
});

describe("Marcas de «Seleccionar» (editor)", () => {
  const faq = (doc: SiteDocument): SiteDocument => ({ ...doc, scenes: [...doc.scenes, { id: "preguntas", type: "faq", enabled: true, props: { title: "Preguntas", contact: "", items: [{ id: "q-1", question: "¿Hay aparcamiento?", answer: "Sí." }] } }] });

  it("la web pública y el preview normal no llevan ninguna marca (HTML igual)", () => {
    for (const layout of [undefined, "web" as const]) {
      const doc = { ...faq(legacyDocument()), ...(layout ? { layout } : {}) };
      const pub = render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} />);
      const preview = render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} />);
      expect(pub).not.toContain("data-edit-");
      expect(preview).not.toContain("data-edit-");
      // editTargets en la web pública no hace nada.
      expect(render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} editTargets />)).toBe(pub);
    }
  });

  it("el preview del editor marca secciones y textos en las dos maquetas", () => {
    for (const layout of [undefined, "web" as const]) {
      const doc = { ...faq(legacyDocument()), ...(layout ? { layout } : {}) };
      const html = render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} editTargets />);
      expect(html).toContain('data-edit-scene="portada"');
      expect(html).toContain('data-edit-path="portada/welcomeMessage"');
      expect(html).toContain('data-edit-scene="preguntas"');
      expect(html).toContain('data-edit-path="preguntas/items/q-1/question"');
      expect(html).toContain('data-edit-path="preguntas/title"');
    }
  });

  it("sin fecha, solo el creador (marcas activas) pinta su hueco en la portada", () => {
    for (const layout of [undefined, "web" as const]) {
      const base = legacyDocument();
      const doc = { ...base, ...(layout ? { layout } : {}), scenes: base.scenes.map((scene) => (scene.type === "cover" ? { ...scene, props: { ...scene.props, weddingDate: "" } } : scene)) } as typeof base;
      expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} editTargets />)).toContain('data-edit-path="portada/weddingDate"');
      expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} />)).not.toContain("Vuestra fecha");
      expect(render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} editTargets />)).not.toContain("Vuestra fecha");
    }
    // Con fecha, nunca hay hueco.
    expect(render(<InvitationRenderer document={legacyDocument()} mode="preview" plan="free" now={NOW} editTargets />)).not.toContain("Vuestra fecha");
  });

  it("con fecha, la fecha real lleva su ruta para tocarla en el editor (y nunca en la web pública)", () => {
    for (const layout of [undefined, "web" as const]) {
      const doc = { ...legacyDocument(), ...(layout ? { layout } : {}) };
      expect(render(<InvitationRenderer document={doc} mode="preview" plan="free" now={NOW} editTargets />)).toContain('data-edit-path="portada/weddingDate"');
      expect(render(<InvitationRenderer document={doc} mode="public" plan="free" now={NOW} rsvp={{ slug: "maria-y-jorge", rsvpMvp: true }} editTargets />)).not.toContain("data-edit-");
    }
  });
});

describe("cuenta atrás (punto 7 del backlog: real, en Madrid)", () => {
  // 13-oct-2026, 15:00 en Madrid; boda el 17-oct.
  const now = new Date("2026-10-13T13:00:00Z");
  const noTime = () => legacyDocument({ wedding_date: "2026-10-17", page_config: { style: "editorial", venue: "La Finca", address: "", time: "" }, agenda: [] });

  it("sin hora de ceremonia, en la Story: «4 días» (días de calendario de Madrid)", () => {
    const html = render(<InvitationRenderer document={noTime()} mode="public" plan="free" now={now} />);
    expect(html).toMatch(/>4<\/p>/);
    expect(html).toContain("4 días para el sí");
    expect(html).not.toContain("horas y");
  });

  it("sin hora de ceremonia, en la web: cuenta hasta las 00:00 de Madrid del día de la boda (3 d 9 h → «3 días»)", () => {
    const html = render(<InvitationRenderer document={{ ...noTime(), layout: "web" }} mode="public" plan="free" now={now} />);
    expect(html).toMatch(/class="wl-count-num tabular">3<\/span> días para el sí/);
  });

  it("con la hora del programa (sin la del lugar): días, horas y minutos hasta ella", () => {
    const doc = legacyDocument({ wedding_date: "2026-10-17", page_config: { style: "editorial", venue: "La Finca", address: "", time: "" }, agenda: [{ id: "6f1d2c3b-aaaa-4bbb-8ccc-000000000002", title: "Ceremonia", time_label: "18:30", place: "", address: "", notes: "" }] });
    const html = render(<InvitationRenderer document={doc} mode="public" plan="free" now={now} />);
    expect(html).toContain("4 días, 3 horas y 30 minutos para el sí");
  });

  it("pasada la boda no se enseña (nunca negativa)", () => {
    const html = render(<InvitationRenderer document={noTime()} mode="public" plan="free" now={new Date("2026-10-18T10:00:00Z")} />);
    expect(html).not.toContain("para el sí");
  });
});
