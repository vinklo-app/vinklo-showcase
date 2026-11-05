/**
 * Etiquetas de los módulos (paradas de autobús, hoteles, menús) para leer las
 * respuestas de los invitados (plan maestro §5, 5.8 · D5). Las respuestas se
 * validaron contra la web PUBLICADA (submitRsvp): sus ids son los de esa
 * revisión. Si la pareja renombra o quita una parada en el borrador sin
 * publicar, el resumen debe seguir diciendo lo que eligió el invitado.
 * Manda la publicada; el borrador solo rellena huecos (sin revisión
 * publicada, todo sale del borrador). Puro (cliente y servidor).
 */
import { moduleLabelsFromDocument, rsvpModulesFromDocument, type ModuleLabels, type RsvpModules } from "@/lib/rsvp-answers";
import type { SiteDocument } from "@/lib/site-document";

export function moduleLabelsForAnswers(draft: SiteDocument, published: SiteDocument | null): ModuleLabels {
  const fromDraft = moduleLabelsFromDocument(draft);
  if (!published) return fromDraft;
  const fromPublished = moduleLabelsFromDocument(published);
  return {
    stops: { ...fromDraft.stops, ...fromPublished.stops },
    hotels: { ...fromDraft.hotels, ...fromPublished.hotels },
    menu: { ...fromDraft.menu, ...fromPublished.menu },
  };
}

/**
 * Menús entre los que de verdad pueden elegir los invitados (P1-6): los de la
 * web PUBLICADA; solo si nunca se publicó (la web en vivo es el borrador), los
 * del borrador. Publicada pero ilegible → null: no contamos «sin menú» a ciegas.
 */
export function guestMenuModules(draft: SiteDocument, published: SiteDocument | null, publishedRevisionId: string | null): Pick<RsvpModules, "menu"> | null {
  if (!publishedRevisionId) return { menu: rsvpModulesFromDocument(draft).menu };
  return published ? { menu: rsvpModulesFromDocument(published).menu } : null;
}
