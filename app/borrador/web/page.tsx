import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InvitationRenderer } from "@/components/invitation/renderer";
import { sampleDocument } from "@/components/landing/landing-lovable-sample";
import { demoWeddingDocument } from "@/components/landing/demo-wedding";
import { SITE_PALETTES, type SiteDocument, type SitePaletteId } from "@/lib/site-document";

/**
 * Ruta de desarrollo de la maqueta «Como una web» (`layout: "web"`) — SOLO
 * en desarrollo (404 en producción, nunca indexable). Pinta
 * `InvitationRenderer` con la boda de ejemplo de la landing
 * (components/landing/landing-lovable-sample.ts, DATOS DE EJEMPLO).
 *
 * Parámetros:
 * - `?muestra=foto` (por defecto) · `?muestra=sin-foto` (papel y monograma)
 * - `?paleta=<id>` (SITE_PALETTES) · `?tema=editorial|clasico|natural`
 * - `?apertura=sobre`: la apertura con sobre delante de la web
 * - `?modo=preview`: mode="preview" dentro de un marco de 338×620 (el del creador)
 * - `?premium=1` quita el pie de marca · `?captura=1` oculta el selector
 * - `?general=1`: enlace general (sin token), sin formulario · `&whatsapp=1`
 *   con el móvil de la pareja: «Pedir mi invitación»
 *
 * La foto es la textura de la landing (`public/landing/portada-contraluz.webp`,
 * sin personas). El contrato solo admite `https:`, así que se asigna tras
 * construir el documento: solo es válido en esta ruta de desarrollo.
 */
export const metadata: Metadata = {
  title: "Borrador · invitación (web)",
  robots: { index: false, follow: false },
};

const THEMES = ["editorial", "clasico", "natural"] as const;

interface Props {
  searchParams: Promise<{ muestra?: string; paleta?: string; tema?: string; apertura?: string; modo?: string; premium?: string; captura?: string; v2?: string; modulos?: string; maqueta?: string; general?: string; whatsapp?: string }>;
}

function withPhoto(doc: SiteDocument): SiteDocument {
  const image = { url: "/landing/portada-contraluz.webp", alt: "Luz cálida a contraluz", width: 900, height: 1600 };
  return { ...doc, scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image } } : s)) };
}

/**
 * `?v2=1`: las escenas v2 (galería, historia, detalles, preguntas) con
 * textos de ejemplo y la misma textura como foto. Orden como en
 * cordially.io/demo: galería → historia → fecha → lugar → programa →
 * detalles → preguntas → asistencia.
 */
function withV2(doc: SiteDocument, photos: boolean): SiteDocument {
  const img = (caption?: string, landscape = false) => ({ url: "/landing/portada-contraluz.webp", alt: "Luz cálida a contraluz", width: landscape ? 1600 : 900, height: landscape ? 1000 : 1600, ...(caption ? { caption } : {}) });
  const story: SiteDocument["scenes"][number] = {
    id: "historia", type: "story", enabled: true,
    props: {
      title: "Nuestra historia", intro: "Os invitamos a celebrar la historia de…",
      chapters: [
        { id: "c1", title: "Cómo nos conocimos", body: "Nos conocimos en la universidad, nos hicimos amigos enseguida y acabamos dándonos cuenta de que lo mejor de cada semana eran los ratos que pasábamos juntos.", images: photos ? [img("Primer año en el campus"), img("Café entre clases", true)] : [] },
        { id: "c2", title: "Enamorarnos", body: "Madrid se convirtió en nuestra base: cenas tarde, paseos de fin de semana y todas las pequeñas rutinas que hicieron la vida más grande.", images: photos ? [img("Una esquina favorita", true), img("Fines de semana"), img("Nuestro ritual")] : [] },
        { id: "c3", title: "El siguiente paso", body: "Un viaje, una pregunta, un sí facilísimo, y de pronto el futuro que imaginábamos se convirtió en algo a lo que invitaros a todos.", images: photos ? [img("La escapada", true), img("Justo después del sí")] : [] },
      ],
    },
  };
  const gallery: SiteDocument["scenes"][number] = { id: "fotos", type: "gallery", enabled: true, props: { title: "Os invitamos a celebrar la historia de…", images: photos ? [img(), img(undefined, true), img(), img(), img(undefined, true), img()] : [] } };
  const details: SiteDocument["scenes"][number] = {
    id: "detalles", type: "details", enabled: true,
    props: {
      title: "Y ahora, algunos detalles más…", intro: "Las personas, los sitios y lo práctico para que el fin de semana sea fácil.",
      cards: [
        { id: "d1", title: "Viaje y alojamiento", teaser: "Cómo llegar y dónde dormir.", body: "Hay autobuses desde Plaza de Castilla a las 11:45 y de vuelta a la 01:00. Tenemos habitaciones reservadas en el Parador de Cercedilla con el código «LUCIAYJUAN».", link: "https://maps.google.com", linkLabel: "Ver el mapa" },
        { id: "d2", title: "Dress code", teaser: "Fiesta de verano en el jardín.", body: "Colores claros, lino y flores son bienvenidos. Calzado cómodo para pasear (¡y bailar!).", linkLabel: "" },
        { id: "d3", title: "Menú", teaser: "Un vistazo a lo que vamos a servir.", body: "Cóctel en el jardín y banquete en la carpa. Decidnos alergias e intolerancias al confirmar.", linkLabel: "" },
        { id: "d4", title: "Música", teaser: "Listas del cóctel y de la fiesta.", body: "Si hay una canción que no puede faltar, contádnosla al confirmar.", linkLabel: "" },
      ],
    },
  };
  const faq: SiteDocument["scenes"][number] = {
    id: "preguntas", type: "faq", enabled: true,
    props: {
      title: "Preguntas y respuestas", contact: "¿No encontráis la respuesta? Escribid a Lucía o a Juan.",
      items: [
        { id: "q1", question: "¿Hasta cuándo podemos confirmar?", answer: "Hasta el 1 de mayo de 2027, por favor." },
        { id: "q2", question: "¿Hay un código de vestimenta?", answer: "Sí: fiesta de verano en el jardín. Vestidos de té o largos; camisas y trajes de lino." },
        { id: "q3", question: "¿La boda es al aire libre?", answer: "La ceremonia es en la ermita y el cóctel en el jardín. Si cambia el tiempo, la carpa está lista." },
        { id: "q4", question: "¿Podemos llevar acompañante o niños?", answer: "Lo indica vuestra invitación. Si tenéis dudas, preguntadnos." },
      ],
    },
  };
  const scenes = doc.scenes;
  const cover = scenes.filter((s) => s.type === "cover");
  const middle = scenes.filter((s) => s.type === "venue" || s.type === "agenda");
  const rest = scenes.filter((s) => !["cover", "venue", "agenda"].includes(s.type));
  return { ...doc, scenes: [...cover, gallery, story, ...middle, details, faq, ...rest] };
}

/** `?modulos=1`: autobuses, alojamiento y las preguntas extra del formulario (8-oct-2026). */
function withModules(doc: SiteDocument): SiteDocument {
  const transport: SiteDocument["scenes"][number] = {
    id: "autobuses", type: "transport", enabled: true,
    props: { title: "Autobuses", intro: "Ponemos autobuses para que nadie tenga que conducir.", stops: [
      { id: "p-1", name: "Madrid, Plaza de Castilla", time: "11:45", place: "Frente a la salida 3 del metro" },
      { id: "p-2", name: "Segovia, Acueducto", time: "12:10", place: "" },
    ], returnNote: "A la 01:00 y a las 03:30 desde la finca, con paradas en los mismos sitios.", ask: true },
  };
  const stay: SiteDocument["scenes"][number] = {
    id: "alojamiento", type: "stay", enabled: true,
    props: { title: "Dónde alojarse", intro: "Hemos hablado con estos hoteles para que os salga mejor.", hotels: [
      { id: "h-1", name: "Hotel Los Arcos", note: "A 5 minutos de la finca. Llamad y decid que venís a la boda.", code: "LUCIAYJUAN", bookBy: "2027-04-15", link: "https://example.com" },
      { id: "h-2", name: "Parador de Cercedilla", note: "Con piscina y desayuno incluido.", code: "", bookBy: "", link: "https://example.com" },
    ], ask: true },
  };
  const scenes = doc.scenes.flatMap((s): SiteDocument["scenes"] => (s.type === "rsvp"
    ? [transport, stay, { ...s, props: { ...s.props, song: true, kids: true, menuOptions: [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }, { id: "m-3", label: "Vegetariano" }] } }]
    : [s]));
  return { ...doc, scenes };
}

export default async function BorradorWebPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const tema = THEMES.find((t) => t === query.tema) ?? "editorial";
  const paleta = SITE_PALETTES.find((p) => p.id === query.paleta)?.id as SitePaletteId | undefined;
  const conFoto = query.muestra !== "sin-foto";

  const base: SiteDocument = { ...sampleDocument(tema, true, query.apertura === "sobre"), layout: "web" };
  const withPalette: SiteDocument = paleta ? { ...base, palette: paleta } : base;
  const withContent = query.v2 ? withV2(withPalette, conFoto) : withPalette;
  const composed = query.v2 === "demo" ? { ...demoWeddingDocument(), ...(paleta ? { palette: paleta } : {}) } : conFoto ? withPhoto(withContent) : withContent;
  const withMods = query.modulos ? withModules(composed) : composed;
  const withLayout: SiteDocument = query.maqueta === "historia" ? { ...withMods, layout: "historia" } : withMods;
  const document: SiteDocument = query.whatsapp
    ? { ...withLayout, scenes: withLayout.scenes.map((scene) => (scene.type === "rsvp" ? { ...scene, props: { ...scene.props, whatsapp: "612 345 678" } } : scene)) }
    : withLayout;
  const rsvp = { slug: "lucia-y-juan", invitationToken: query.general ? undefined : "demo", rsvpMvp: true, window: { status: "open", deadline: "2027-05-01" } as const };

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { muestra: conFoto ? undefined : "sin-foto", paleta, tema: query.tema, apertura: query.apertura, premium: query.premium, v2: query.v2, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/borrador/web${qs ? `?${qs}` : ""}`;
  };

  if (query.modo === "preview") {
    return (
      <main className="grid min-h-svh place-items-center bg-paper-2 p-4">
        <div className="h-[620px] w-[338px] overflow-hidden border border-line-strong">
          <InvitationRenderer document={document} mode="preview" plan="free" rsvp={rsvp} />
        </div>
      </main>
    );
  }

  return (
    <>
      <InvitationRenderer document={document} mode="public" plan={query.premium ? "premium" : "free"} rsvp={rsvp} />
      {!query.captura && (
        <details className="fixed right-4 bottom-4 z-50 max-w-[17rem] border border-line-strong bg-paper text-ink text-xs shadow-sm">
          <summary className="cursor-pointer px-3 py-2 font-mono tracking-[0.12em] uppercase">Muestra (dev)</summary>
          <div className="space-y-3 px-3 pb-3">
            <p className="flex flex-wrap gap-2">
              <Link className="underline" href={href({ muestra: undefined })}>Con foto</Link>
              <Link className="underline" href={href({ muestra: "sin-foto" })}>Sin foto</Link>
              <Link className="underline" href={href({ apertura: query.apertura === "sobre" ? undefined : "sobre" })}>{query.apertura === "sobre" ? "Sin sobre" : "Con sobre"}</Link>
              <Link className="underline" href={href({ modo: "preview" })}>Marco del creador</Link>
              <Link className="underline" href={href({ v2: query.v2 ? undefined : "1" })}>{query.v2 ? "Sin escenas v2" : "Con escenas v2"}</Link>
            </p>
            <p className="flex flex-wrap gap-1.5">
              <Link className="underline" href={href({ paleta: undefined })}>Tema</Link>
              {SITE_PALETTES.map((p) => (
                <Link key={p.id} href={href({ paleta: p.id })} aria-current={p.id === paleta ? "true" : undefined} className="inline-flex items-center gap-1 underline aria-[current]:font-bold">
                  <span aria-hidden="true" className="inline-block size-3 border border-line-strong" style={{ background: p.accent }} />
                  {p.label}
                </Link>
              ))}
            </p>
          </div>
        </details>
      )}
    </>
  );
}
