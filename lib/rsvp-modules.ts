/**
 * Constantes y tipos puros de los módulos del formulario de asistencia, sin
 * zod ni dependencias: los importa el formulario del invitado (cliente) y no
 * deben arrastrar el esquema al bundle. Las reexporta `rsvp-answers.ts`.
 */

export const BUS_USES = ["no", "ida", "vuelta", "ambos"] as const;
export type BusUse = (typeof BUS_USES)[number];
export const LODGING_WHERE = ["hotel", "otro", "no"] as const;
export type LodgingWhere = (typeof LODGING_WHERE)[number];
export const RSVP_SONG_MAX = 120;

/** Lo que el formulario pregunta, sacado de la web. Solo lo activo. */
export interface RsvpModules {
  bus: { stops: Array<{ id: string; name: string; time: string }> } | null;
  lodging: { hotels: Array<{ id: string; name: string }> } | null;
  song: boolean;
  kids: boolean;
  menu: Array<{ id: string; label: string }>;
}

export const NO_MODULES: RsvpModules = { bus: null, lodging: null, song: false, kids: false, menu: [] };

export function hasModules(m: RsvpModules): boolean {
  return Boolean(m.bus || m.lodging || m.song || m.kids || m.menu.length > 0);
}
