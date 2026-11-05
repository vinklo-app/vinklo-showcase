import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvitationRenderer } from "@/components/invitation/renderer";
import { withCreatorGallery } from "@/components/creator/creator-gallery";
import { DEMO_TEMPLATES } from "@/components/landing/demo-wedding";
import { documentFromLegacy, type SceneImage, type SiteDocument } from "@/lib/site-document";
import { EMPTY_DRAFT, applyBuilderTemplate, composeBuilderDocument, creatorSiteDocument, type BuilderDraft } from "@/lib/wedding-builder";

/**
 * Ruta de desarrollo de «Plantillas fieles» — SOLO en desarrollo (404 en
 * producción, nunca indexable). Pinta lo que publicaría el creador para una
 * pareja de ejemplo que eligió `?plantilla=<id>` en su /demo: el mismo camino
 * que la creación real (composeBuilderDocument → creatorSiteDocument, el
 * saneado del servidor → la foto subida después), en mode="public".
 *
 * Parámetros:
 * - `?plantilla=origen|hora-dorada|vinedo`
 * - `?foto=1`: con foto de portada (la de su demo, como si la pareja la subiera)
 * - `?galeria=1`: con 5 «Más fotos» (las de la galería de la demo)
 * - `?historia=1`: con las tres respuestas de «Vuestra historia»
 * - `?sobre=1`: con el sobre cerrado delante (lo que ve el invitado al entrar)
 *
 * Las fotos son las de public/demo/ (rutas locales): el contrato solo admite
 * https, así que entran después del saneado, solo en esta ruta.
 */
export const metadata: Metadata = { title: "Borrador · plantilla publicada", robots: { index: false, follow: false } };

interface Props {
  searchParams: Promise<{ plantilla?: string; foto?: string; galeria?: string; historia?: string; sobre?: string }>;
}

const DRAFT: BuilderDraft = {
  ...EMPTY_DRAFT,
  partnerName1: "Ana",
  partnerName2: "Pablo",
  weddingDate: "2027-06-12",
  guestCount: "120",
  venue: "Finca El Olivar",
  address: "Camino del Olivar, 3, Toledo",
  time: "18:00",
  step: 9,
  photo: "initials",
  day: { ceremony: { time: "18:00", place: "Finca El Olivar" }, cocktail: { time: "19:30", place: "Jardín de la finca" }, banquet: { time: "21:00", place: "Carpa" } },
};

const STORY = { met: "Nos conocimos en la universidad y nos hicimos inseparables.", proposal: "Un viaje a Lisboa, una pregunta y un sí.", ahead: "Ahora queremos celebrarlo con vosotros." };

const photo = (id: string, width: number, height: number): SceneImage => ({ url: `/demo/${id}.webp`, alt: "Foto de Ana y Pablo", width, height });
const GALLERY: SceneImage[] = [
  photo("1494774157365-9e04c6720e47", 1100, 733),
  photo("1460978812857-470ed1c77af0", 1100, 641),
  photo("1754966447282-b56909233452", 1400, 933),
  photo("1516589178581-6cd7833ae3b2", 1100, 1650),
  photo("1501901609772-df0848060b33", 1100, 733),
];

export default async function BorradorPlantillaPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const template = DEMO_TEMPLATES.find((t) => t.id === query.plantilla) ?? DEMO_TEMPLATES[0]!;
  const draft = applyBuilderTemplate({ ...DRAFT, ...(query.historia ? { story: STORY } : {}) }, template);
  const legacy = documentFromLegacy({ partner_name_1: draft.partnerName1, partner_name_2: draft.partnerName2, wedding_date: draft.weddingDate, cover_image_url: null, page_config: { style: draft.style, welcomeMessage: draft.welcomeMessage, venue: draft.venue, address: draft.address, time: draft.time }, agenda: [] });
  // El mismo saneado que createWeddingFromCreator; después, la foto «subida».
  const created = creatorSiteDocument(composeBuilderDocument(draft), legacy) ?? legacy;
  const withCover: SiteDocument = query.foto ? { ...created, scenes: created.scenes.map((s) => (s.type === "cover" ? { ...s, props: { ...s.props, image: { ...template.cover, alt: "Foto de Ana y Pablo" } } } : s)) } : created;
  const document = withCreatorGallery(withCover, query.galeria ? GALLERY : []);
  const shown: SiteDocument = query.sobre ? document : { ...document, opening: "ninguno" };
  return <InvitationRenderer document={shown} mode="public" plan="free" rsvp={{ slug: "ana-y-pablo", rsvpMvp: true, window: { status: "open", deadline: "2027-05-01" } }} />;
}
