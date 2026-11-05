/**
 * Estado honesto de cada persona de la lista (PRODUCTO-Y-AGENTES §5/§7):
 * la respuesta manda; si no hay respuesta, cuenta lo que la pareja ha hecho
 * con su invitación (enviada confirmada por ellos > preparada > nada).
 * Puro y sin React: lo usan la lista, el resumen y los tests.
 */
import type { RsvpStatus } from "@/lib/guests";

export type GuestStatusKey = "confirmed" | "declined" | "opened" | "sent" | "prepared" | "pending";

export interface GuestStatusInput {
  rsvp_status: RsvpStatus;
  invitation_prepared_at: string | null;
  invitation_sent_at: string | null;
}

export const GUEST_STATUS_LABELS: Record<GuestStatusKey, string> = {
  confirmed: "Confirmada",
  declined: "No viene",
  opened: "Abierta",
  sent: "Enviada",
  prepared: "Preparada",
  pending: "Pendiente",
};

/** Texto secundario que explica la etiqueta sin prometer entrega ni lectura. */
export const GUEST_STATUS_HINTS: Record<GuestStatusKey, string> = {
  confirmed: "Ha confirmado desde su enlace o lo habéis anotado vosotros.",
  declined: "No asistirá.",
  opened: "Ha abierto su enlace personal · sin respuesta todavía.",
  sent: "Envío confirmado por vosotros · sin respuesta todavía. WhatsApp no confirma la entrega a Vinklo.",
  prepared: "Enlace personal creado · envío sin confirmar.",
  pending: "Sin invitación preparada.",
};

export function guestStatus(guest: GuestStatusInput): GuestStatusKey {
  if (guest.rsvp_status === "si") return "confirmed";
  if (guest.rsvp_status === "no") return "declined";
  if (guest.invitation_sent_at) return "sent";
  if (guest.invitation_prepared_at) return "prepared";
  return "pending";
}

/**
 * «Abierta» refina «Enviada», y también «Preparada»/«Pendiente»: abrir SU
 * enlace prueba que la invitación llegó aunque la pareja no marcase «Sí,
 * enviada» al volver de WhatsApp (revisión UX P0 #3). Así la fila no se
 * queda en «Preparada» y entra en recordatorios (lib/messages/reminder-rules.ts).
 * La respuesta sigue mandando.
 */
export function displayStatus(key: GuestStatusKey, invitationOpenedAt: string | null | undefined): GuestStatusKey {
  return (key === "sent" || key === "prepared" || key === "pending") && invitationOpenedAt ? "opened" : key;
}

/** Primer grafema (emoji con ZWJ o tono de piel incluidos) o, sin Intl.Segmenter, el primer punto de código. */
function firstGrapheme(word: string): string {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    for (const { segment } of new Segmenter("es", { granularity: "grapheme" }).segment(word)) return segment;
    return "";
  }
  return Array.from(word)[0] ?? "";
}

/** Iniciales para el avatar: primer grafema de las dos primeras palabras. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "·";
  const letters = words.slice(0, 2).map(firstGrapheme);
  return letters.join("").toLocaleUpperCase("es-ES");
}

/**
 * Cifras del panel con separador de miles español a mano (DESIGN.md §3:
 * Intl no es fiable en todos los builds): 1000 → «1.000».
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** «1 persona» · «2 personas»: singular solo con exactamente 1. */
export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** «+2 acompañantes» · «+1 acompañante» · "" (solo con asistencia confirmada). */
export function companionsLabel(guest: { rsvp_status: RsvpStatus; rsvp_companions: number }): string {
  if (guest.rsvp_status !== "si" || guest.rsvp_companions <= 0) return "";
  return guest.rsvp_companions === 1 ? "+1 acompañante" : `+${guest.rsvp_companions} acompañantes`;
}
