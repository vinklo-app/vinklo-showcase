import { sampleDocument } from "@/components/landing/landing-lovable-sample";
import { BUILDER_TEMPLATES } from "@/lib/templates";
import type { SceneImage, SiteDocument, SitePaletteId, SiteThemeId } from "@/lib/site-document";

/**
 * Boda de demostración completa (6-oct-2026, referencia cordially.io/demo):
 * la web «Como una web» con portada a sangre, collage, historia por
 * capítulos, fecha, lugar, programa, detalles, preguntas y asistencia.
 * La usan /demo (pública) y /borrador/web?v2=1.
 *
 * Fotos: Unsplash, copiadas en public/demo/ (licencia Unsplash: uso libre, también comercial, sin
 * atribución obligatoria). Son de ejemplo y nunca se mezclan con las de una
 * pareja real. Datos ficticios.
 */

/** Copias locales en public/demo/ (la CSP solo admite imágenes propias y de Supabase). */
const u = (id: string, _w: number, width: number, height: number, alt: string, caption?: string): SceneImage => ({
  url: `/demo/${id}.webp`,
  alt,
  width,
  height,
  ...(caption ? { caption } : {}),
});

export const DEMO_COVER = u("1729257973345-91a99bd19e9b", 2400, 2400, 1600, "Lucía y Juan en un valle verde entre montañas");

const GALLERY: SceneImage[] = [
  u("1494774157365-9e04c6720e47", 1000, 1100, 733, "Los dos a contraluz al atardecer"),
  u("1460978812857-470ed1c77af0", 900, 1100, 641, "Un beso en blanco y negro"),
  u("1754966447282-b56909233452", 1400, 1400, 933, "Abrazados en la montaña, entre la niebla"),
  u("1516589178581-6cd7833ae3b2", 900, 1100, 1650, "Un corazón con las manos al sol"),
  u("1501901609772-df0848060b33", 1000, 1100, 733, "Lucía a hombros de Juan, riendo"),
];

/** Las tres plantillas de la landing: estilo, paleta y foto de portada. */
type DemoExtras = { styleLabel: string; description: string; cover: SceneImage; position?: string };
const DEMO_EXTRAS: Record<string, DemoExtras> = {
  origen: { styleLabel: "Editorial", description: "Editorial y cinematográfica, alrededor de la historia que os trajo hasta aquí.", cover: DEMO_COVER },
  "hora-dorada": { styleLabel: "Caligráfica", description: "Cálida y nostálgica, con la suavidad de vuestra foto favorita.", cover: u("1519379169146-d4b170447caa", 1600, 1600, 1067, "Lucía y Juan en un campo al atardecer"), position: "62% 85%" },
  vinedo: { styleLabel: "Serena", description: "Lo mejor de las dos: foto a sangre y mosaico que se cierra, con caligrafía y arcos.", cover: u("1509331019631-b8f9bda9f91b", 1600, 1600, 1199, "Lucía y Juan paseando entre viñedos") },
};
export const DEMO_TEMPLATES: ReadonlyArray<{ id: string; name: string; styleLabel: string; description: string; themeId: SiteThemeId; palette: SitePaletteId; cover: SceneImage; position?: string }> = BUILDER_TEMPLATES.map((t) => ({ ...t, ...DEMO_EXTRAS[t.id] }));

/**
 * Solo la portada (y la asistencia, que el contrato exige), sin sobre: para
 * los móviles de la landing, que nunca se desplazan. Montar la web entera ahí costaba
 * decenas de fotos y efectos de scroll que nadie ve (lento en el móvil).
 */
export function demoCoverDocument(templateId?: string): SiteDocument {
  const doc = demoWeddingDocument(templateId);
  return { ...doc, opening: "ninguno", scenes: doc.scenes.filter((s) => s.type === "cover" || s.type === "rsvp") };
}

export function demoWeddingDocument(templateId?: string): SiteDocument {
  const template = DEMO_TEMPLATES.find((t) => t.id === templateId);
  const doc = demoBase();
  if (!template) return doc;
  return { ...doc, themeId: template.themeId, palette: template.palette, scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: template.cover } } : s)) };
}

function demoBase(): SiteDocument {
  const base = sampleDocument("editorial", true);
  const scenes = base.scenes.map((scene) =>
    scene.type === "cover"
      ? { ...scene, props: { ...scene.props, image: DEMO_COVER, welcomeMessage: "Te invitamos a formar parte de la historia que estamos construyendo juntos." } }
      : scene,
  );
  const cover = scenes.filter((s) => s.type === "cover");
  const middle = scenes.filter((s) => s.type === "venue" || s.type === "agenda");
  const rest = scenes.filter((s) => !["cover", "venue", "agenda"].includes(s.type));
  const gallery: SiteDocument["scenes"][number] = { id: "fotos", type: "gallery", enabled: true, props: { title: "", images: GALLERY } };
  const story: SiteDocument["scenes"][number] = {
    id: "historia",
    type: "story",
    enabled: true,
    props: {
      title: "Nuestra historia",
      intro: "",
      chapters: [
        { id: "c1", title: "cómo nos conocimos", body: "Nos conocimos en la universidad, nos hicimos amigos enseguida y acabamos dándonos cuenta de que lo mejor de cada semana eran los ratos que pasábamos juntos.", images: [u("1501901609772-df0848060b33", 1000, 1100, 733, "Primer año en el campus", "Primer año en el campus"), u("1516589178581-6cd7833ae3b2", 1000, 1100, 1650, "Café entre clases", "Café entre clases")] },
        { id: "c2", title: "enamorarnos", body: "Madrid se convirtió en nuestra base: cenas tarde, paseos de fin de semana y todas las pequeñas rutinas que hicieron la vida más grande.", images: [u("1494774157365-9e04c6720e47", 1000, 1100, 733, "Nuestra esquina favorita", "Nuestra esquina favorita"), u("1520854221256-17451cc331bf", 1000, 1000, 667, "Fines de semana", "Fines de semana"), u("1507525428034-b723cf961d3e", 1000, 1000, 665, "Nuestro ritual", "Nuestro ritual")] },
        { id: "c3", title: "el siguiente paso", body: "Un viaje, una pregunta, un sí facilísimo, y de pronto el futuro que imaginábamos se convirtió en algo a lo que invitaros a todos.", images: [u("1465495976277-4387d4b0b4c6", 1000, 1000, 667, "Justo después del sí", "Justo después del sí"), u("1606800052052-a08af7148866", 1000, 1000, 667, "Los anillos", "Los anillos")] },
      ],
    },
  };
  const details: SiteDocument["scenes"][number] = {
    id: "detalles",
    type: "details",
    enabled: true,
    props: {
      title: "Y ahora, algunos detalles más…",
      intro: "Las personas, los sitios y lo práctico para que el fin de semana sea fácil.",
      cards: [
        { id: "d1", title: "Viaje y alojamiento", teaser: "Cómo llegar y dónde dormir.", body: "Hay autobuses desde Plaza de Castilla a las 11:45 y de vuelta a la 01:00. Tenemos habitaciones reservadas cerca de la finca con el código «LUCIAYJUAN».", linkLabel: "" },
        { id: "d2", title: "Dress code", teaser: "Fiesta de verano en el jardín.", body: "Colores claros, lino y flores son bienvenidos. Calzado cómodo para pasear (¡y bailar!).", linkLabel: "" },
        { id: "d3", title: "Menú", teaser: "Un vistazo a lo que vamos a servir.", body: "Cóctel en el jardín y banquete en la carpa. Cuéntanos tus alergias o intolerancias al confirmar.", linkLabel: "" },
        { id: "d4", title: "Música", teaser: "Listas del cóctel y de la fiesta.", body: "Si hay una canción que no puede faltar, cuéntanosla al confirmar.", linkLabel: "" },
      ],
    },
  };
  const faq: SiteDocument["scenes"][number] = {
    id: "preguntas",
    type: "faq",
    enabled: true,
    props: {
      title: "Preguntas y respuestas",
      contact: "¿No encuentras la respuesta? Escribe a Lucía o a Juan.",
      items: [
        { id: "q1", question: "¿Hasta cuándo puedo confirmar?", answer: "Hasta el 1 de mayo de 2027, por favor." },
        { id: "q2", question: "¿Hay un código de vestimenta?", answer: "Sí: fiesta de verano en el jardín. Vestidos de té o largos; camisas y trajes de lino." },
        { id: "q3", question: "¿La boda es al aire libre?", answer: "La ceremonia es en la ermita y el cóctel en el jardín. Si cambia el tiempo, la carpa está lista." },
        { id: "q4", question: "¿Puedo llevar acompañante o niños?", answer: "Lo indica tu invitación. Si tienes dudas, pregúntanos." },
      ],
    },
  };
  // /demo abre con el sobre lacrado, como la web de cada pareja.
  return { ...base, layout: "web", opening: "sobre", scenes: [...cover, gallery, story, ...middle, details, faq, ...rest] };
}
