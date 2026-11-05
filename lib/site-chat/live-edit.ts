/**
 * Editar desde la vista previa en el ordenador (backlog 13-oct-2026, punto 6):
 * qué hace un clic sobre cada `data-edit-path` de la invitación. Puro y
 * client-safe (lo usan el creador, el editor del panel y los tests).
 *
 *  - «text»: un texto que se edita ahí mismo (mismas reglas que el campo:
 *    `writeEditText`, tope y obligatorio de `describeEditTarget`).
 *  - «field» (creador): abre su editor en la columna con el campo enfocado.
 *  - «focus» (panel): lleva al control de la página que lo cambia.
 *  - «select»: lo demás se selecciona para «Pedid cambios» (nunca un clic muerto).
 */
import { DATE_GAP_FIELD, fieldForEditPath, type CreatorField } from "@/lib/creator-compose";
import { creatorEditTarget, describeEditTarget, parseEditPath, type EditTarget } from "./edit-focus";
import type { SiteDocument } from "@/lib/site-document";

export type LiveTextField = NonNullable<EditTarget["field"]>;

export type LiveEditRoute =
  | { kind: "text"; label: string; field: LiveTextField }
  | { kind: "field"; label: string; field: CreatorField; inputId?: string }
  | { kind: "focus"; label: string; selector: string }
  | { kind: "select"; label: string };

/** Momentos fijos del programa del creador → su campo «Dónde» en «Vuestro día» (components/creator/day-step.tsx). */
const FIXED_MOMENT_INPUT: Record<string, string> = { "m-ceremonia": "wb-day-ceremony-place", "m-coctel": "wb-day-cocktail-place", "m-banquete": "wb-day-banquet-place" };
/** Cómo se nombra cada editor del creador en «Cambiar …». */
const CREATOR_FIELD_LABEL: Partial<Record<CreatorField, string>> = { names: "vuestros nombres", date: "la fecha", venue: "el lugar", welcome: "la bienvenida", photo: "vuestra foto", day: "el programa del día", story: "vuestra historia" };
/** Salida y vuelta del autobús: filas del módulo, sin campo propio que enfocar. */
const BUS_MOMENTS = new Set(["m-salida", "m-vuelta"]);

/** Campo de «Vuestro día» de un elemento de lista (momento, tarjeta o pregunta). */
function dayInput(itemId: string): string | undefined {
  if (BUS_MOMENTS.has(itemId)) return undefined;
  return FIXED_MOMENT_INPUT[itemId] ?? `wb-day-${itemId}-title`;
}

/**
 * Creador (/crear, /onboarding). `chat`: el compositor ya es «Pedid cambios»
 * (con nombres y fecha); antes no hay dónde seleccionar y lo que no tiene
 * editor propio no se marca (null).
 */
export function creatorLiveRoute(doc: SiteDocument, path: string, opts: { cover: string; venue: string; chat: boolean }): LiveEditRoute | null {
  const described = describeEditTarget(doc, path);
  const target = creatorEditTarget(described);
  const label = described?.label ?? "este texto";
  if (target?.field) return { kind: "text", label, field: target.field };

  const parsed = parseEditPath(path);
  if (!parsed) return null;
  const field = fieldForEditPath(path, { cover: opts.cover, venue: opts.venue });
  if (field) {
    const inputId = field === "venue" && parsed.field === "address" ? "wb-address" : undefined;
    return { kind: "field", label: CREATOR_FIELD_LABEL[field] ?? label, field, ...(inputId ? { inputId } : {}) };
  }
  const scene = doc.scenes.find((item) => item.id === parsed.sceneId);
  if (scene?.type === "cover" && parsed.field === "image") return { kind: "field", label: "vuestra foto", field: "photo" };
  if (scene && parsed.list && parsed.itemId && (scene.type === "agenda" || scene.type === "details" || scene.type === "faq")) {
    const inputId = dayInput(parsed.itemId);
    return { kind: "field", label, field: "day", ...(inputId ? { inputId } : {}) };
  }
  if (scene?.type === "story") return { kind: "field", label, field: "story" };
  if (scene?.type === "gallery") return { kind: "field", label, field: "photo" };
  if (scene?.type === "transport" || scene?.type === "stay") return { kind: "field", label, field: "day" };
  return opts.chat && described ? { kind: "select", label } : null;
}

/** Ids de «Los datos» (components/panel/wedding-settings.tsx) y del botón de la foto (site-editor). */
export const PANEL_TARGETS = { name: "ajustes-nombre-1", date: "ajustes-fecha", photo: "#la-foto button" } as const;

/** Editor del panel (Ajustes › Vuestra web). Todo texto con campo se edita ahí mismo. */
export function panelLiveRoute(doc: SiteDocument, path: string): LiveEditRoute | null {
  const described = describeEditTarget(doc, path);
  if (!described) return null;
  if (described.field) return { kind: "text", label: described.label, field: described.field };
  const parsed = parseEditPath(path);
  const scene = parsed ? doc.scenes.find((item) => item.id === parsed.sceneId) : undefined;
  if (scene?.type === "cover" && !parsed?.list) {
    if (parsed?.field === "names") return { kind: "focus", label: "vuestros nombres", selector: `#${PANEL_TARGETS.name}` };
    if (parsed?.field === DATE_GAP_FIELD) return { kind: "focus", label: "la fecha", selector: `#${PANEL_TARGETS.date}` };
    if (parsed?.field === "image") return { kind: "focus", label: "la foto", selector: PANEL_TARGETS.photo };
  }
  return { kind: "select", label: described.label };
}

/** Nombre accesible del elemento marcado en la vista previa. */
export function liveEditLabel(route: LiveEditRoute): string {
  return route.kind === "text" ? `Editar aquí: ${route.label}` : route.kind === "select" ? `Pedir cambios en ${route.label}` : `Cambiar ${route.label}`;
}
