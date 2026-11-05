import { documentFromLegacy, type SiteDocument } from "@/lib/site-document";
import type { BuilderDraft } from "@/lib/wedding-builder";

/**
 * Boda de ejemplo de la landing (módulo compartido servidor/cliente): la
 * usan el móvil del hero (isla cliente) y los tres móviles de estilos (RSC).
 */

/** Boda de ejemplo. Datos ficticios, fijos. */
const SAMPLE = {
  partner_name_1: "Lucía",
  partner_name_2: "Juan",
  wedding_date: "2027-06-12",
  cover_image_url: null,
  welcomeMessage: "Nos casamos en la sierra y queremos celebrarlo contigo, con calma y sin prisas.",
  venue: "Finca La Alquería",
  address: "Cercedilla, Madrid",
  time: "13:00",
} as const;

const SAMPLE_AGENDA = [
  { id: "a1", title: "Autobuses de ida", time_label: "11:45", place: "Plaza de Castilla", address: null, notes: null },
  { id: "a2", title: "Ceremonia", time_label: "13:00", place: "Ermita de San Lorenzo", address: null, notes: null },
  { id: "a3", title: "Cóctel", time_label: "14:15", place: "Jardín de la Alquería", address: null, notes: null },
  { id: "a4", title: "Banquete", time_label: "16:00", place: "Carpa principal", address: null, notes: null },
  { id: "a5", title: "Autobuses de vuelta", time_label: "01:00", place: "Puerta de la finca", address: null, notes: null },
];

/** Orden de la demo: portada → lugar → el día → «¿Nos acompañas?» (el cierre). */
const SCENE_ORDER = ["cover", "venue", "agenda", "rsvp"] as const;

/**
 * `sealed`: la apertura «sobre» (`opening: "sobre"`, lib/site-document.ts).
 * La landing la enseña solo donde quiere (el móvil del hero, mientras no se
 * ha escrito nada); en el resto guarda "ninguno", porque un documento sin
 * `opening` abre con el sobre.
 */
export function sampleDocument(style: BuilderDraft["style"], withAgenda = true, sealed = false): SiteDocument {
  const doc = documentFromLegacy({
    partner_name_1: SAMPLE.partner_name_1,
    partner_name_2: SAMPLE.partner_name_2,
    wedding_date: SAMPLE.wedding_date,
    cover_image_url: null,
    page_config: { style, welcomeMessage: SAMPLE.welcomeMessage, venue: SAMPLE.venue, address: SAMPLE.address, time: SAMPLE.time },
    agenda: withAgenda ? SAMPLE_AGENDA : [],
  });
  const rank = (type: string) => SCENE_ORDER.indexOf(type as (typeof SCENE_ORDER)[number]);
  // Sin sobre explícito: un documento sin `opening` abre con el sobre (resolveOpening).
  return { ...doc, opening: sealed ? "sobre" : "ninguno", scenes: [...doc.scenes].sort((a, b) => rank(a.type) - rank(b.type)) };
}

