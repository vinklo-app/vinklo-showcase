import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InvitationRenderer } from "@/components/invitation/renderer";
import type { RsvpWindowState } from "@/components/invitation/types";
import { initialInvitePhase, inviteThemeColor } from "@/lib/invite-theme-color";
import { documentFromLegacy, SITE_PALETTES, STORY_SECONDS_MAX, STORY_SECONDS_MIN, type SiteDocument, type SitePaletteId } from "@/lib/site-document";

const PLAZOS: Record<string, RsvpWindowState> = {
  abierto: { status: "open", deadline: "2027-05-01" },
  cerrado: { status: "closed", reason: "deadline", deadline: "2026-10-01" },
  "boda-pasada": { status: "closed", reason: "wedding_over", weddingDate: "2026-09-26" },
};

/**
 * Ruta de desarrollo del reproductor Story — SOLO en desarrollo (404 en
 * producción, nunca indexable). Pinta `InvitationRenderer` en mode="public"
 * con documentos de ejemplo fijos (DATOS DE EJEMPLO, sin base de datos).
 *
 * Parámetros:
 * - `?muestra=foto` (por defecto) · `?muestra=sin-foto`
 * - `?paleta=<id>` (cualquiera de SITE_PALETTES) · `?tema=editorial|clasico|natural`
 * - `?caso=extremo`: peor caso realista (break-ui): nombres de 80 caracteres
 *   con emoji y escritura árabe, sin lugar, 40 momentos, foto panorámica
 *   (`&muestra=sin-foto` → el mismo peor caso con monograma).
 * - `?caso=limites`: textos al máximo del contrato, enlace sin espacios en la
 *   bienvenida, un solo momento y una foto que da 404.
 * - `?premium=1` quita el pie de marca · `?captura=1` oculta el selector.
 * - `?nombres=Maximiliano,Bartholomew`: sustituye los nombres de la portada
 *   de la muestra elegida (escala de la portada con palabras largas).
 * - `?modo=preview`: mode="preview" dentro de un marco de 338×620 (el del
 *   creador) para comprobar el cromo y la portada en el marco estrecho.
 * - `?segundos=3`: segundos por escena del autoavance (3–15; por defecto 6).
 * - `?plazo=abierto|cerrado|boda-pasada`: estado del plazo de respuesta
 *   (fecha límite 1 de mayo de 2027; cerrado el 1 de octubre de 2026).
 *
 * La foto de muestra vive en `public/muestras/` (CSP `img-src 'self'`). El
 * contrato solo admite `https:`, así que se asigna tras construir el
 * documento: solo es válido en esta ruta de desarrollo.
 * Ver docs/handoffs/2026-10-03-v2/invitacion.md.
 */
export const metadata: Metadata = {
  title: "Borrador · invitación (Story)",
  robots: { index: false, follow: false },
};

const THEMES = ["editorial", "clasico", "natural"] as const;

interface Props {
  searchParams: Promise<{ muestra?: string; paleta?: string; tema?: string; caso?: string; premium?: string; captura?: string; modo?: string; apertura?: string; nombres?: string; plazo?: string; segundos?: string }>;
}

function sampleWithPhoto(tema: (typeof THEMES)[number]): SiteDocument {
  const doc = documentFromLegacy({
    partner_name_1: "Lucía",
    partner_name_2: "Juan",
    wedding_date: "2027-06-12",
    cover_image_url: null,
    page_config: {
      style: tema,
      welcomeMessage: "Después de once años juntos, por fin nos casamos. Nos encantaría celebrarlo contigo en la sierra, con calma y sin prisas.",
      venue: "Finca La Alquería",
      address: "Camino de la Dehesa, 14 · Cercedilla, Madrid",
      time: "13:00",
    },
    agenda: [
      { id: "a1", title: "Autobuses de ida", time_label: "11:45", place: "Plaza de Castilla (dársena 7)", address: "Salida puntual. Avisad si venís en coche.", notes: null },
      { id: "a2", title: "Ceremonia", time_label: "13:00", place: "Ermita de San Lorenzo", address: "https://maps.google.com/?q=Ermita+de+San+Lorenzo+Cercedilla", notes: "Ceremonia civil al aire libre. Si hace sol, traed sombrero." },
      { id: "a3", title: "Cóctel", time_label: "14:15", place: "Jardín de la Alquería", address: null, notes: null },
      { id: "a4", title: "Banquete", time_label: "16:00", place: "Carpa principal", address: null, notes: "Avisadnos de alergias o intolerancias en el formulario de asistencia." },
      { id: "a5", title: "Baile", time_label: "20:30", place: "Carpa principal", address: null, notes: null },
      { id: "a6", title: "Autobuses de vuelta", time_label: "01:00", place: "Puerta de la finca", address: "https://maps.google.com/?q=Finca+La+Alqueria+Cercedilla", notes: "Dos salidas: 1:00 y 3:00." },
    ],
  });
  return withCoverImage(doc, { url: "/muestras/pareja.jpg", alt: "Lucía y Juan con el ramo, a contraluz", width: 1600, height: 1067 });
}

function sampleWithoutPhoto(tema: (typeof THEMES)[number]): SiteDocument {
  return documentFromLegacy({
    partner_name_1: "Marta",
    partner_name_2: "Jorge",
    wedding_date: "2027-09-18",
    cover_image_url: null,
    page_config: {
      style: tema,
      welcomeMessage: "Nos casamos en Toledo y nos falta lo más importante: que estés allí.",
      venue: "Cigarral del Ángel",
      address: "Carretera de la Puebla de Montalbán, km 3 · Toledo",
      time: "18:30",
    },
    agenda: [
      { id: "b1", title: "Ceremonia", time_label: "18:30", place: "Jardín del cigarral", address: null, notes: null },
      { id: "b2", title: "Cena", time_label: "20:30", place: "Terraza", address: null, notes: null },
      { id: "b3", title: "Fiesta", time_label: "23:00", place: "Salón", address: null, notes: "Hasta que el cuerpo aguante." },
    ],
  });
}

/** Peor caso realista (break-ui): límites reales del contrato. */
function sampleWorstCase(tema: (typeof THEMES)[number], photo = true): SiteDocument {
  const moments = ["Llegada de invitados", "Ceremonia religiosa en la ermita", "Fotos de familia", "Cóctel en el jardín de los olivos", "Banquete", "Primer baile", "Barra libre"];
  const agenda = Array.from({ length: 40 }, (_, i) => ({
    id: `w${i + 1}`,
    title: `${moments[i % moments.length]}${i >= moments.length ? ` (${Math.floor(i / moments.length) + 1}.ª parte)` : ""}`,
    time_label: `${String(10 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
    place: i % 3 === 0 ? "Salón principal de la Hacienda de San Juan de los Caballeros Hospitalarios" : null,
    address: i % 5 === 0 ? "https://maps.google.com/?q=Hacienda+San+Juan" : null,
    notes: i % 4 === 0 ? "Recordad que el aparcamiento está a unos 400 metros, junto al camino de tierra; hay lanzadera cada diez minutos." : null,
  }));
  const doc = documentFromLegacy({
    partner_name_1: "María de los Ángeles Fernández-Villaverde de la Concepción 🌿💍",
    partner_name_2: "محمد عبد الرحمن بن الحسين",
    wedding_date: "2027-03-28",
    cover_image_url: null,
    page_config: {
      style: tema,
      welcomeMessage:
        "Queridos todos: después de muchos años, dos países, tres mudanzas y un perro que nos eligió a nosotros, por fin nos casamos. Nos haría muchísima ilusión que vinieseis a celebrarlo con nosotros en Sevilla. Habrá comida de las dos familias, música hasta tarde y sitio para los niños. Si tenéis cualquier duda, escribidnos por WhatsApp.",
      venue: "",
      address: "",
      time: "",
    },
    agenda,
  });
  return photo ? withCoverImage(doc, { url: "/muestras/pareja-panoramica.jpg", alt: "", width: 1600, height: 360 }) : doc;
}

/**
 * Límites del contrato (break-ui, 2.ª tanda): eyebrow 60, bienvenida 400 con
 * un enlace sin espacios, lugar 160, dirección 240, un solo momento, foto que
 * ya no existe en el almacenamiento (404).
 */
function sampleLimits(tema: (typeof THEMES)[number]): SiteDocument {
  const doc = documentFromLegacy({
    partner_name_1: "Jo",
    partner_name_2: "Bartholomew",
    wedding_date: "2027-12-31",
    cover_image_url: null,
    page_config: {
      style: tema,
      welcomeMessage:
        "¡Nos casamos! Toda la información del alojamiento está en https://www.hoteles-cerca-de-la-finca-ejemplo.es/reservas/grupos/boda-jo-y-bartholomew-2027?codigo=JOBART2027 y si tenéis dudas escribidnos. Habrá autobús desde Madrid y desde Toledo; os lo confirmamos en noviembre.",
      venue: "Real Monasterio de Santa María de la Asunción y Antiguo Palacio de los Condes de Fuensalida, Salón de los Espejos y Jardines del Claustro Mayor (edificio norte)",
      address:
        "Carretera Comarcal CM-4000 de Toledo a la Puebla de Montalbán, kilómetro 23,5, desvío a la derecha pasado el puente romano, camino sin asfaltar de unos 800 metros hasta la verja verde con el escudo, 45000 Toledo (Toledo), España",
      time: "12:00",
    },
    agenda: [{ id: "l1", title: "Ceremonia", time_label: "12:00", place: null, address: null, notes: null }],
  });
  return {
    ...withCoverImage(doc, { url: "/muestras/no-existe.jpg", alt: "Jo y Bartholomew", width: 1200, height: 1600 }),
    scenes: withCoverImage(doc, { url: "/muestras/no-existe.jpg", alt: "Jo y Bartholomew", width: 1200, height: 1600 }).scenes.map((sc) =>
      sc.type === "cover" ? { ...sc, props: { ...sc.props, eyebrow: "Con muchísima ilusión, por fin, después de tanto tiempo…" } } : sc,
    ),
  };
}

/** `?nombres=Uno,Dos`: solo la portada (desarrollo); el resto de la muestra no cambia. */
function withPartnerNames(doc: SiteDocument, nombres: string): SiteDocument {
  const [partnerName1 = "", partnerName2 = ""] = nombres.split(",").map((n) => n.trim().slice(0, 80));
  if (!partnerName1 || !partnerName2) return doc;
  return {
    ...doc,
    scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, partnerName1, partnerName2 } } : s)),
  };
}

function withCoverImage(doc: SiteDocument, image: { url: string; alt: string; width: number; height: number }): SiteDocument {
  return {
    ...doc,
    scenes: doc.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image } } : s)),
  };
}

type StoryQuery = Awaited<Props["searchParams"]>;

function buildDocument(query: StoryQuery) {
  const tema = THEMES.find((t) => t === query.tema) ?? "editorial";
  const muestra = query.caso === "limites" ? "limites" : query.caso === "extremo" ? "extremo" : query.muestra === "sin-foto" ? "sin-foto" : "foto";
  const paleta = SITE_PALETTES.find((p) => p.id === query.paleta)?.id as SitePaletteId | undefined;

  const base = muestra === "limites" ? sampleLimits(tema) : muestra === "extremo" ? sampleWorstCase(tema, query.muestra !== "sin-foto") : muestra === "sin-foto" ? sampleWithoutPhoto(tema) : sampleWithPhoto(tema);
  const withPalette: SiteDocument = paleta ? { ...base, palette: paleta } : base;
  const withNames = query.nombres ? withPartnerNames(withPalette, query.nombres) : withPalette;
  const opened: SiteDocument = { ...withNames, opening: query.apertura === "sobre" ? "sobre" : "ninguno" };
  // `?segundos=3`: ritmo del autoavance (storySeconds); fuera del contrato se ignora.
  const seconds = Number(query.segundos);
  const document: SiteDocument = Number.isInteger(seconds) && seconds >= STORY_SECONDS_MIN && seconds <= STORY_SECONDS_MAX ? { ...opened, storySeconds: seconds } : opened;
  return { document, muestra, paleta };
}

/** theme-color como en /b/[slug]: papel con sobre; tinta si la Story abre con foto a sangre. */
export async function generateViewport({ searchParams }: Props): Promise<Viewport> {
  const { document } = buildDocument(await searchParams);
  return { themeColor: inviteThemeColor(document, initialInvitePhase(document)) };
}

export default async function BorradorStoryPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const { document, muestra, paleta } = buildDocument(query);

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const caseParam = muestra === "extremo" || muestra === "limites" ? muestra : undefined;
    const merged = { muestra: caseParam ? undefined : muestra, caso: caseParam, paleta, tema: query.tema, premium: query.premium, nombres: query.nombres, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/borrador/story${qs ? `?${qs}` : ""}`;
  };

  const plazo = query.plazo ? PLAZOS[query.plazo] : undefined;
  const rsvp = { slug: "lucia-y-juan", invitationToken: "demo", rsvpMvp: true, window: plazo };

  if (query.modo === "preview") {
    return (
      <main className="grid min-h-svh place-items-center bg-paper-2 p-4">
        <div className="h-[620px] w-[338px] overflow-hidden border border-line-strong">
          <InvitationRenderer document={document} mode="preview" plan="free" rsvp={plazo ? rsvp : undefined} />
        </div>
      </main>
    );
  }

  return (
    <>
      <InvitationRenderer
        document={document}
        mode="public"
        plan={query.premium ? "premium" : "free"}
        rsvp={rsvp}
      />
      {!query.captura && (
        <details className="fixed top-6 right-4 z-50 max-w-[17rem] border border-line-strong bg-paper text-ink text-xs shadow-sm">
          <summary className="cursor-pointer px-3 py-2 font-mono tracking-[0.12em] uppercase">Muestra (dev)</summary>
          <div className="space-y-3 px-3 pb-3">
            <p className="flex flex-wrap gap-2">
              <Link className="underline" href={href({ muestra: "foto", caso: undefined })}>Con foto</Link>
              <Link className="underline" href={href({ muestra: "sin-foto", caso: undefined })}>Sin foto</Link>
              <Link className="underline" href={href({ muestra: undefined, caso: "extremo" })}>Peor caso</Link>
              <Link className="underline" href={href({ muestra: undefined, caso: "limites" })}>Límites</Link>
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
