/**
 * Datos de muestra del plan de mesas para /borrador/panel (solo desarrollo).
 * Sin "use client": lo usan la página (servidor, línea de «Lo que toca hoy»)
 * y la vista de mesas (cliente).
 */
import type { GuestRow } from "@/components/panel/guest-list";
import { sortGuests, withVisitors, type SeatCompanion, type SeatGuest, type SeatingPlan, type SeatTable } from "@/lib/crm/seating";

export const tid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
/** Ids de acompañantes de muestra. */
export const cid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

/** Acompañantes con nombre de muestra (§4.3): los peques de Lucas y Andrea y el +1 de Marta. */
export const SAMPLE_COMPANIONS: Record<string, Omit<SeatCompanion, "table_id">[]> = {
  "Lucas y Andrea": [{ id: cid(1), name: "Hugo", is_kid: true }, { id: cid(2), name: "Vera", is_kid: true }],
  "Marta Díaz": [{ id: cid(3), name: "Pedro Gil", is_kid: false }],
  "Daniel Araújo": [{ id: cid(4), name: "Leo", is_kid: true }],
};

function toSeat(guest: GuestRow): SeatGuest {
  const companionList = (SAMPLE_COMPANIONS[guest.name] ?? []).map((companion) => ({ ...companion, table_id: null }));
  return {
    id: guest.id, name: guest.name, rsvp_status: guest.rsvp_status as SeatGuest["rsvp_status"], companions: guest.rsvp_companions, notes: guest.rsvp_notes,
    group_name: guest.group_name ?? null, tags: guest.tags ?? [], side: guest.side ?? null,
    kids: companionList.filter((companion) => companion.is_kid).length, companion_list: companionList,
  };
}

/** «No sentar con…» de muestra: dos invitados de la lista que no deben compartir mesa. */
function sampleApart(people: SeatGuest[]): Array<[string, string]> {
  const a = people.find((guest) => guest.name === "Tío Ramón");
  const b = people.find((guest) => guest.name === "Nerea Sáez");
  return a && b ? [[a.id < b.id ? a.id : b.id, a.id < b.id ? b.id : a.id]] : [];
}

/**
 * Lectura de muestra del plano del salón (lo que devolvería el modelo de
 * visión, ya normalizado): la Presidencial y la Mesa 1 coinciden con las del
 * demo y se actualizan; el resto son nuevas. Una sin posición.
 */
export const SAMPLE_FLOOR_READING = {
  notes: "No se leen bien las plazas de la mesa del fondo a la derecha: revisadlas.",
  tables: [
    { label: "Presidencial", shape: "imperial", seats: 6, x: 0.5, y: 0.1 },
    { label: "1", shape: "redonda", seats: 10, x: 0.2, y: 0.38 },
    { label: "2", shape: "redonda", seats: 10, x: 0.5, y: 0.42 },
    { label: "3", shape: "redonda", seats: 10, x: 0.8, y: 0.38 },
    { label: "4", shape: "redonda", seats: 8, x: 0.25, y: 0.75 },
    { label: "5", shape: "rectangular", seats: 12, x: 0.75, y: 0.78 },
    { label: "Mesa infantil", shape: "cuadrada", seats: 8, x: null, y: null },
  ],
};

/** Frases de muestra «de la IA» para la vista previa (con {p1}/{p2}, como el modelo). */
export function sampleExplanation(table: { groups: Array<{ size: number; tags: string[] }>; dominantTags: string[]; sides: string[] }): string {
  const tag = table.dominantTags[0];
  const people = table.groups.reduce((sum, group) => sum + group.size, 0);
  if (tag) return `${people === 1 ? "Una persona" : `${people} personas`} que se conocen de «${tag}»: estarán a gusto juntas y con conversación asegurada.`;
  if (table.sides.length === 1) return `Invitados de ${table.sides[0] === "p1" ? "{p1}" : table.sides[0] === "p2" ? "{p2}" : "los dos"} sin etiqueta: los juntamos para que compartan mesa con conocidos.`;
  return "Cada grupo va entero; completamos la mesa con quien tenía sitio libre.";
}

/** Demo: Presidencial pasada de plazas, Mesa 1 con la familia, Mesa 2 vacía y el resto sin mesa. Otros datos: mesas de 10 llenas por grupo hasta ~60 %. */
export function samplePlan(guests: GuestRow[], demo: boolean, empty: boolean): SeatingPlan {
  const people = guests.map(toSeat);
  const apart = sampleApart(people);
  if (empty) return { tables: [], unseated: sortGuests(people), apart };
  if (demo) {
    const pick = (...names: string[]) => people.filter((guest) => names.includes(guest.name));
    const tables: SeatTable[] = [
      { id: tid(1), name: "Presidencial", seats: 4, position: 1, guests: sortGuests(pick("Marta Díaz", "Javier Ortega Ruiz", "Daniel Araújo")) },
      { id: tid(2), name: "Mesa 1", seats: 10, position: 2, guests: sortGuests(pick("Abuela Carmen", "Inés Carvajal de la Torre y Montenegro", "Tío Ramón", "Nerea Sáez")) },
      { id: tid(3), name: "Mesa 2", seats: 10, position: 3, guests: [] },
    ];
    // Leo (hijo de Daniel) ya está en la mesa infantil; Mesa 1 es la mesa fija de la familia.
    tables.push({ id: tid(4), name: "Mesa infantil", seats: 8, position: 4, guests: [] });
    tables[1].pinned_group = tables[1].guests.find((guest) => guest.group_name)?.group_name ?? null;
    const withKid = people.map((guest) => (guest.name === "Daniel Araújo" ? { ...guest, companion_list: guest.companion_list?.map((companion) => ({ ...companion, table_id: tid(4) })) } : guest));
    const byId = new Map(withKid.map((guest) => [guest.id, guest]));
    const placed = tables.map((table) => ({ ...table, guests: table.guests.map((guest) => byId.get(guest.id) ?? guest) }));
    const seated = new Set(placed.flatMap((table) => table.guests.map((guest) => guest.id)));
    return withVisitors({ tables: placed, unseated: sortGuests(withKid.filter((guest) => !seated.has(guest.id))), apart });
  }
  const ordered = sortGuests(people.filter((guest) => guest.rsvp_status !== "no"));
  const target = Math.floor(ordered.length * 0.6);
  const tables: SeatTable[] = [];
  let current: SeatTable | null = null;
  let used = 0;
  const seated = new Set<string>();
  for (const guest of ordered.slice(0, target)) {
    const size = Math.max(1, guest.rsvp_status === "si" ? 1 + guest.companions : 1);
    if (!current || used + size > current.seats) {
      current = { id: tid(tables.length + 1), name: `Mesa ${tables.length + 1}`, seats: 10, position: tables.length + 1, guests: [] };
      tables.push(current); used = 0;
    }
    current.guests.push(guest); used += size; seated.add(guest.id);
  }
  return withVisitors({ tables: tables.map((table) => ({ ...table, guests: sortGuests(table.guests) })), unseated: sortGuests(people.filter((guest) => !seated.has(guest.id))), apart });
}

