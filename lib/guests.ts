/** Valores compartidos: el estado de asistencia es independiente del regalo. */
export const GIFT_STATUSES = ["pendiente", "enlace", "bizum", "efectivo", "transferencia"] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];
export const RSVP_STATUSES = ["pendiente", "si", "no"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const RSVP_LABELS: Record<RsvpStatus, string> = { pendiente: "Sin respuesta", si: "Asiste", no: "No asiste" };
export interface AttendanceGuest {
  name: string;
  phone: string | null;
  rsvp_status: RsvpStatus;
  rsvp_companions: number;
}
export function attendanceSummary(guests: AttendanceGuest[]) {
  return guests.reduce((summary, guest) => {
    summary.total += 1;
    summary[guest.rsvp_status] += 1;
    if (guest.rsvp_status === "si") summary.people += 1 + guest.rsvp_companions;
    return summary;
  }, { total: 0, pendiente: 0, si: 0, no: 0, people: 0 });
}
export function filterGuests<T extends AttendanceGuest>(guests: T[], query: string, status: RsvpStatus | "todos"): T[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = normalize(query.trim());
  return guests.filter((guest) => (status === "todos" || guest.rsvp_status === status) && normalize(`${guest.name} ${guest.phone ?? ""}`).includes(needle));
}

export function summarizeRsvpGuests(guests: Pick<AttendanceGuest, "rsvp_status" | "rsvp_companions">[]) {
  return guests.reduce((summary, guest) => {
    summary.total += 1;
    if (guest.rsvp_status === "pendiente") summary.pending += 1;
    if (guest.rsvp_status === "no") summary.declined += 1;
    if (guest.rsvp_status === "si") {
      summary.confirmed += 1;
      summary.companions += guest.rsvp_companions;
      summary.attendees += 1 + guest.rsvp_companions;
    }
    return summary;
  }, { total: 0, pending: 0, confirmed: 0, declined: 0, companions: 0, attendees: 0 });
}
