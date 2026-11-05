import { describe, expect, it } from "vitest";
import { filterGuests, summarizeRsvpGuests, type AttendanceGuest } from "./guests";
const guests: AttendanceGuest[] = [
  { name: "María Pérez", phone: "600 123 456", rsvp_status: "si", rsvp_companions: 2 },
  { name: "Luis", phone: null, rsvp_status: "no", rsvp_companions: 4 },
  { name: "Ana", phone: null, rsvp_status: "pendiente", rsvp_companions: 1 },
];
describe("CRM de asistencia", () => {
  it("cuenta personas solo entre respuestas afirmativas, incluso con acompañantes antiguos en filas negativas", () => {
    expect(summarizeRsvpGuests(guests)).toEqual({ total: 3, pending: 1, confirmed: 1, declined: 1, companions: 2, attendees: 3 });
  });
  it("muestra ceros sin invitados", () => {
    expect(summarizeRsvpGuests([])).toEqual({ total: 0, pending: 0, confirmed: 0, declined: 0, companions: 0, attendees: 0 });
  });
  it("combina búsqueda sin acentos con filtro de asistencia", () => {
    expect(filterGuests(guests, "maria", "si")).toEqual([guests[0]]);
    expect(filterGuests(guests, "maria", "no")).toEqual([]);
    expect(filterGuests(guests, "123", "todos")).toEqual([guests[0]]);
  });
});
