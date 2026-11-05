/**
 * DATOS DE EJEMPLO del borrador del panel (solo desarrollo). Nombres
 * ficticios. Cuatro juegos detrás del selector `?datos=`:
 *  - demo: 12 invitados en estados variados (el de siempre).
 *  - peor: peor caso realista (break-ui) — nombres al límite del esquema
 *    (120), emoji con ZWJ y tono de piel, griego, una sola letra, notas con
 *    URL sin espacios, 10 acompañantes, teléfono de 20 caracteres.
 *  - mil: 1.000 invitados (la página real pagina de 100 en 100).
 *  - rechazo: todos han dicho que no.
 * CRM (2026-10-05): aperturas del enlace personal y regalos anotados por la
 * pareja (`giftsFor`), con su embudo y su resumen calculados aquí igual que
 * `getCrmFunnel` / `getGiftSummary` (solo para el borrador).
 */
import type { GuestRow } from "@/components/panel/guest-list";
import type { AttendanceSummary, GuestFilterCounts } from "@/lib/data/attendance";
import type { ReminderPerson } from "@/components/panel/reminder-queue";
import { sortInvitationQueue, splitInvitationQueue, type InvitationQueueItem } from "@/lib/messages/invitation-series";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { deliveredAt, isReminderDue, selectReminders, type ReminderPeriod } from "@/lib/messages/reminder-rules";
import { CRM_GUEST_FILTERS, GUEST_FILTERS, type GuestListFilter } from "@/lib/messages/filters";
import { FUNNEL_STAGES, GIFT_KINDS, type CrmFunnelSummary, type CrmGiftSummary, type FunnelStage, type Gift, type GiftKind } from "@/lib/crm/contract";
import type { GroupFilter, GuestGroupSummary } from "@/lib/crm/groups";
import type { GuestSide, GuestTagSummary, SideFilter } from "@/lib/crm/tags";

export const DATASETS = ["demo", "peor", "mil", "rechazo"] as const;
export type Dataset = (typeof DATASETS)[number];
export const DATASET_LABELS: Record<Dataset, string> = { demo: "Demo", peor: "Peor caso", mil: "1.000", rechazo: "Todos no" };

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`;
/** Hace N días desde ahora (la ventana de 3 días de los recordatorios es relativa a hoy). */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
/** Ids con forma de UUID (la fila de recordatorios solo acepta UUID en la URL). */
function uid(n: number): string { return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; }
const NO_REMINDERS = { last_reminder_at: null, reminder_count: 0, reminders_opt_out: false } as const;

const DEMO: GuestRow[] = [
  { id: uid(1), name: "Marta Díaz", phone: "612 345 678", rsvp_status: "si", rsvp_companions: 1, rsvp_notes: null, source: "couple", invitation_prepared_at: at(20), invitation_sent_at: at(20), ...NO_REMINDERS },
  { id: uid(2), name: "Javier Ortega Ruiz", phone: "+34 677 112 233", rsvp_status: "si", rsvp_companions: 0, rsvp_notes: "Sin gluten, por favor.", source: "couple", invitation_prepared_at: at(20), invitation_sent_at: at(21), ...NO_REMINDERS },
  { id: uid(3), name: "Abuela Carmen", phone: null, rsvp_status: "si", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(4), name: "Lucas y Andrea", phone: "655 000 111", rsvp_status: "si", rsvp_companions: 2, rsvp_notes: "Vamos con los peques.", source: "couple", invitation_prepared_at: at(22), invitation_sent_at: at(22), ...NO_REMINDERS },
  { id: uid(5), name: "Nerea Sáez", phone: "699 888 777", rsvp_status: "no", rsvp_companions: 0, rsvp_notes: "Estaré fuera ese fin de semana. ¡Mucha suerte!", source: "rsvp", invitation_prepared_at: at(22), invitation_sent_at: at(22), ...NO_REMINDERS },
  { id: uid(6), name: "Pablo Ferreiro", phone: "611 222 333", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(25), invitation_sent_at: at(25), ...NO_REMINDERS },
  { id: uid(7), name: "Inés Carvajal de la Torre y Montenegro", phone: "622 333 444", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(25), invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(8), name: "Tío Ramón", phone: "+34 91 555 66 77", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(9), name: "Clara Benítez", phone: "633 444 555", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(10), name: "Hugo", phone: "0044 7700 900123", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(28), invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(11), name: "Sofía Lamas", phone: "644 555 666", rsvp_status: "no", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(28), invitation_sent_at: at(28), ...NO_REMINDERS },
  { id: uid(12), name: "Daniel Araújo", phone: "666 777 888", rsvp_status: "si", rsvp_companions: 1, rsvp_notes: null, source: "rsvp", invitation_prepared_at: at(29), invitation_sent_at: at(29), ...NO_REMINDERS },
  // Esperando respuesta, con recordatorios variados (fila: 4 personas).
  { id: uid(13), name: "Rocío Valverde", phone: "634 120 987", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(18), invitation_sent_at: at(18), last_reminder_at: ago(9), reminder_count: 1, reminders_opt_out: false },
  { id: uid(14), name: "Íñigo Etxeberria", phone: "+34 688 001 122", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(19), invitation_sent_at: at(19), ...NO_REMINDERS },
  { id: uid(15), name: "Tía Puri", phone: "645 300 200", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(16), invitation_sent_at: at(16), last_reminder_at: ago(1), reminder_count: 2, reminders_opt_out: false },
  { id: uid(16), name: "Carlos Méndez", phone: "699 444 333", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(17), invitation_sent_at: at(17), last_reminder_at: ago(12), reminder_count: 1, reminders_opt_out: true },
  { id: uid(17), name: "Alba Moreno", phone: "622 818 181", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(24), invitation_sent_at: at(24), ...NO_REMINDERS },
];

const WORST: GuestRow[] = [
  // 120 caracteres: el máximo de `GuestInput.name` y del input.
  { id: uid(101), name: "María de los Ángeles Fernández-Villaverde de la Concepción y Montenegro-Sotomayor, hermana de la novia (y su pareja Paco)", phone: "+34 600 000 000 1234", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(25), invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(102), name: "Jo", phone: "6", rsvp_status: "si", rsvp_companions: 10, rsvp_notes: "Vamos todo el equipo de la oficina, ¿hay sitio para aparcar la furgoneta? https://www.google.com/maps/place/Calle+de+Alcal%C3%A1,+28014+Madrid/@40.4189,-3.6919,17z", source: "rsvp", invitation_prepared_at: at(20), invitation_sent_at: at(20), ...NO_REMINDERS },
  { id: uid(103), name: "👰🏽‍♀️ Tía Encarni", phone: "699 111 222", rsvp_status: "si", rsvp_companions: 1, rsvp_notes: null, source: "couple", invitation_prepared_at: at(21), invitation_sent_at: at(21), ...NO_REMINDERS },
  { id: uid(104), name: "lospadrinosdelanovia.cuentaoficial.boda2027", phone: null, rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: null, invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(105), name: "Αλέξανδρος Παπαδόπουλος", phone: "+30 694 123 4567", rsvp_status: "no", rsvp_companions: 0, rsvp_notes: "Λυπάμαι πολύ, δεν θα μπορέσω να έρθω. ¡Que viva la novia!", source: "rsvp", invitation_prepared_at: at(22), invitation_sent_at: at(22), ...NO_REMINDERS },
  { id: uid(106), name: "Ñoño Iñárritu Özdemir", phone: "611 222 333", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(26), invitation_sent_at: at(26), ...NO_REMINDERS },
  { id: uid(107), name: "🎉🎉🎉", phone: "622 000 999", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(27), invitation_sent_at: null, ...NO_REMINDERS },
  { id: uid(108), name: "Familia García-Pérez (abuelos, tíos y primos de Albacete)", phone: "967 000 000", rsvp_status: "si", rsvp_companions: 9, rsvp_notes: "Somos diez en total contando a la abuela, que irá en silla de ruedas: ¿hay rampa en la finca o subimos por la escalera de la entrada principal?", source: "couple", invitation_prepared_at: at(23), invitation_sent_at: at(23), ...NO_REMINDERS },
  // Recordatorios al límite: muchos, uno sin teléfono válido, uno que pidió no recibirlos.
  { id: uid(109), name: "Bartolomé Fitzgerald-Ruiz de Alarcón y Santisteban (compañero de Erasmus en Dublín)", phone: "+353 87 123 4567", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(2), invitation_sent_at: at(2), last_reminder_at: ago(30), reminder_count: 12, reminders_opt_out: false },
  { id: uid(110), name: "Jo", phone: "+34 600 111 222", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(3), invitation_sent_at: at(3), ...NO_REMINDERS },
  { id: uid(111), name: "Vecina del 3.º B", phone: "12", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple", invitation_prepared_at: at(3), invitation_sent_at: at(3), ...NO_REMINDERS },
];

const FIRST = ["Lucía", "Hugo", "Martina", "Mateo", "Sofía", "Leo", "Julia", "Daniel", "Paula", "Álvaro", "Carmen", "Pablo", "Noa", "Manuel", "Valeria", "Javier", "Inés", "Diego", "Elena", "Adrián"];
const LAST = ["García", "Fernández", "González", "Rodríguez", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín", "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Muñoz", "Álvarez", "Romero", "Alonso", "Gutiérrez"];

function thousand(): GuestRow[] {
  return Array.from({ length: 1000 }, (_, i) => {
    const r = (i * 37) % 10;
    const status = r < 5 ? "pendiente" : r < 8 ? "si" : "no";
    const prepared = i % 4 !== 0 ? at(1 + (i % 28)) : null;
    return {
      id: uid(1000 + i),
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${LAST[(i * 3 + 5) % LAST.length]}`,
      phone: i % 9 === 0 ? null : `6${String(10_000_000 + i * 7919).slice(0, 8)}`,
      rsvp_status: status,
      rsvp_companions: status === "si" ? i % 3 : 0,
      rsvp_notes: null,
      source: i % 11 === 0 ? "rsvp" : "couple",
      invitation_prepared_at: prepared,
      invitation_sent_at: prepared && i % 3 !== 0 ? prepared : null,
      last_reminder_at: i % 5 === 0 ? ago(i % 7) : null,
      reminder_count: i % 5 === 0 ? 1 + (i % 3) : 0,
      reminders_opt_out: i % 47 === 0,
    } satisfies GuestRow;
  });
}

/* ---------------------------------------------------------------------------
 * Grupos (2026-10-06). Por número de uid; el resto, sin grupo.
 * ------------------------------------------------------------------------- */
const DEMO_GROUPS: Record<number, string> = {
  1: "Amigos de Marcos", 2: "Trabajo", 3: "Familia de Elena", 4: "Amigos de Marcos", 5: "Trabajo",
  6: "Amigos de Marcos", 7: "Familia de Elena", 8: "Familia de Elena", 11: "Trabajo", 12: "Amigos de Marcos",
  13: "Vecinos", 15: "Familia de Elena", 16: "Trabajo", 17: "Vecinos",
};
/** Peor caso: 40 caracteres (el máximo), emoji, griego y uno de una letra. */
const WORST_GROUPS: Record<number, string> = {
  101: "Familia de la novia (rama de Albacete) 1", 102: "Oficina 🎉", 103: "Familia de la novia (rama de Albacete) 1",
  105: "Φίλοι από την Αθήνα", 108: "Familia de la novia (rama de Albacete) 1", 109: "E", 110: "Oficina 🎉",
};
const MIL_GROUPS = ["Familia de Elena", "Familia de Marcos", "Amigos de Elena", "Amigos de Marcos", "Trabajo", "Universidad", "Vecinos", "Pádel"];

function withGroups(guests: GuestRow[], groups: Record<number, string>): GuestRow[] {
  return guests.map((guest) => ({ ...guest, group_name: groups[Number(guest.id.slice(-12))] ?? null }));
}

/* ---------------------------------------------------------------------------
 * Etiquetas y lado (2026-10-08). Por número de uid; el resto, sin etiquetas.
 * La pareja de muestra es Lucía (p1) y Juan (p2).
 * ------------------------------------------------------------------------- */
const DEMO_TAGS: Record<number, { tags: string[]; side: GuestSide | null }> = {
  1: { tags: ["Amigos de la uni"], side: "p2" }, 2: { tags: ["Trabajo de Juan"], side: "p2" },
  3: { tags: ["Familia de Lucía"], side: "p1" }, 4: { tags: ["Amigos de la uni", "Pueblo"], side: "ambos" },
  5: { tags: ["Trabajo de Juan"], side: "p2" }, 6: { tags: ["Amigos de la uni"], side: "p2" },
  7: { tags: ["Familia de Lucía"], side: "p1" }, 8: { tags: ["Familia de Lucía", "Pueblo"], side: "p1" },
  11: { tags: ["Trabajo de Juan"], side: null }, 12: { tags: ["Amigos de la uni", "Pádel", "Pueblo"], side: "ambos" },
  13: { tags: [], side: "p1" }, 15: { tags: ["Familia de Lucía"], side: "p1" }, 17: { tags: ["Pueblo"], side: null },
};
/** Peor caso: 30 caracteres (el máximo), 8 etiquetas en una persona, emoji y griego. */
const WORST_TAGS: Record<number, { tags: string[]; side: GuestSide | null }> = {
  101: { tags: ["Familia de la novia (Albacete)", "Amigos del colegio de Lucía 1", "Pueblo", "Pádel", "Trabajo", "Erasmus", "Coro", "Vecinos"], side: "p1" },
  102: { tags: ["Oficina 🎉"], side: "p2" }, 103: { tags: ["Familia de la novia (Albacete)"], side: "p1" },
  105: { tags: ["Φίλοι από την Αθήνα"], side: "ambos" }, 108: { tags: ["Familia de la novia (Albacete)"], side: "p1" },
};
const MIL_TAGS = ["Amigos de la uni", "Trabajo de Juan", "Trabajo de Lucía", "Familia de Lucía", "Familia de Juan", "Pueblo", "Pádel"];
const MIL_SIDES: Array<GuestSide | null> = ["p1", "p2", "ambos", null];

function withTags(guests: GuestRow[], tags: Record<number, { tags: string[]; side: GuestSide | null }>): GuestRow[] {
  return guests.map((guest) => {
    const entry = tags[Number(guest.id.slice(-12))];
    return { ...guest, tags: entry?.tags ?? [], side: entry?.side ?? null };
  });
}

const DECLINED: GuestRow[] = withTags(withGroups(DEMO, DEMO_GROUPS), DEMO_TAGS).slice(0, 8).map((guest) => ({ ...guest, rsvp_status: "no", rsvp_companions: 0 }));

export function guestsFor(dataset: Dataset): GuestRow[] {
  switch (dataset) {
    case "peor": return withTags(withGroups(WORST, WORST_GROUPS), WORST_TAGS);
    case "mil": return thousand().map((guest, i) => ({
      ...guest, group_name: i % 11 === 0 ? null : MIL_GROUPS[(i * 5) % MIL_GROUPS.length],
      tags: i % 6 === 0 ? [] : [MIL_TAGS[(i * 3) % MIL_TAGS.length]], side: MIL_SIDES[i % 4],
    }));
    case "rechazo": return DECLINED;
    default: return withTags(withGroups(DEMO, DEMO_GROUPS), DEMO_TAGS);
  }
}

/** Copia en TS de los filtros `p_tag` y `p_side` de `guest_page`. */
export function inTagAndSide(guest: GuestRow, tag: string | null | undefined, side: SideFilter | undefined): boolean {
  if (tag && !(guest.tags ?? []).includes(tag)) return false;
  if (side === "none") return !guest.side;
  return !side || guest.side === side;
}

/** Lo que devolvería `guest_tag_summary`: una fila por etiqueta, alfabético. */
export function tagSummary(guests: GuestRow[]): GuestTagSummary[] {
  const by = new Map<string, GuestTagSummary>();
  for (const guest of guests) {
    for (const tag of guest.tags ?? []) {
      const row = by.get(tag) ?? { tag, guests: 0, confirmed: 0, attendees: 0 };
      row.guests += 1;
      if (guest.rsvp_status === "si") { row.confirmed += 1; row.attendees += 1 + guest.rsvp_companions; }
      by.set(tag, row);
    }
  }
  return [...by.values()].sort((a, b) => a.tag.toLocaleLowerCase("es").localeCompare(b.tag.toLocaleLowerCase("es")));
}

/** Copia en TS del filtro `p_group` de `guest_page`. */
export function inGroup(guest: GuestRow, group: GroupFilter | undefined): boolean {
  if (!group || group.kind === "all") return true;
  return group.kind === "none" ? !guest.group_name : guest.group_name === group.name;
}

/** Lo que devolvería `guest_group_summary`: alfabético, «sin grupo» al final. */
export function groupSummary(guests: GuestRow[]): GuestGroupSummary[] {
  const by = new Map<string | null, GuestGroupSummary>();
  for (const guest of guests) {
    const name = guest.group_name ?? null;
    const row = by.get(name) ?? { name, guests: 0, confirmed: 0, declined: 0, pending: 0, attendees: 0 };
    row.guests += 1;
    if (guest.rsvp_status === "si") { row.confirmed += 1; row.attendees += 1 + guest.rsvp_companions; }
    else if (guest.rsvp_status === "no") row.declined += 1;
    else row.pending += 1;
    by.set(name, row);
  }
  return [...by.values()].sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.toLocaleLowerCase("es").localeCompare(b.name.toLocaleLowerCase("es"))));
}

export function isDataset(value: unknown): value is Dataset {
  return typeof value === "string" && (DATASETS as readonly string[]).includes(value);
}

/** Lo que devolvería `attendance_summary` para esa lista. */
export function summarize(guests: GuestRow[]): AttendanceSummary {
  const confirmed = guests.filter((guest) => guest.rsvp_status === "si");
  const companions = confirmed.reduce((sum, guest) => sum + guest.rsvp_companions, 0);
  return {
    total: guests.length,
    pending: guests.filter((guest) => guest.rsvp_status === "pendiente").length,
    confirmed: confirmed.length,
    declined: guests.filter((guest) => guest.rsvp_status === "no").length,
    companions,
    attendees: confirmed.length + companions,
    prepared: guests.filter((guest) => guest.invitation_prepared_at !== null).length,
    sent: guests.filter((guest) => guest.invitation_sent_at !== null).length,
  };
}

/** El borrador no tiene fecha límite: plazo abierto sin fecha. */
const OPEN_PERIOD: ReminderPeriod = { status: "open", deadline: null, daysLeft: null, soon: false };

/** Copia en TS de `public.guest_in_filter` (solo para el borrador). «Para recordar» = las reglas de TS, como el SQL desde 20261101120000. */
export function inFilter(guest: GuestRow, filter: GuestListFilter, now = Date.now()): boolean {
  const waiting = guest.rsvp_status === "pendiente" && guest.invitation_sent_at !== null;
  switch (filter) {
    case "todos": return true;
    case "sin_enviar": return guest.rsvp_status === "pendiente" && guest.invitation_sent_at === null;
    case "esperando": return waiting;
    case "para_recordar":
      return isReminderDue({ ...guest, invitation_opened_at: guest.crm?.invitationOpenedAt ?? null }, OPEN_PERIOD, new Date(now));
    case "vienen": return guest.rsvp_status === "si";
    case "no_vienen": return guest.rsvp_status === "no";
    case "sin_telefono": return whatsappNumber(guest.phone) === null;
    case "con_notas": return Boolean(guest.rsvp_notes?.trim());
    case "sin_respuesta": return guest.rsvp_status === "pendiente";
    case "enviada_sin_abrir": return guest.rsvp_status === "pendiente" && guest.invitation_sent_at !== null && !guest.crm?.invitationOpenedAt;
    case "abierta_sin_responder": return guest.rsvp_status === "pendiente" && Boolean(guest.crm?.invitationOpenedAt);
    case "con_regalo": return guest.crm?.giftState === "yes";
    case "regalo_sin_indicar": return (guest.crm?.giftState ?? "unknown") === "unknown";
    case "sin_regalo": return guest.crm?.giftState === "no";
    case "sin_agradecer": return Boolean(guest.crm?.giftUnthanked);
  }
}

/** Lo que devolvería `guest_filter_counts`. */
export function countFilters(guests: GuestRow[]): GuestFilterCounts {
  const counts = Object.fromEntries([...GUEST_FILTERS, ...CRM_GUEST_FILTERS, "sin_respuesta" as const].map((key) => [key, guests.filter((guest) => inFilter(guest, key)).length]));
  return counts as GuestFilterCounts;
}

/** Candidatos a recordatorio con las mismas reglas que `getReminderCandidates` (lib/messages/reminder-rules.ts). */
function remindable(guests: GuestRow[], now: number) {
  return selectReminders(guests.map((guest) => ({ ...guest, invitation_opened_at: guest.crm?.invitationOpenedAt ?? null })), OPEN_PERIOD, new Date(now));
}

/** Lo que devolvería `getReminderCandidates`: menos recientemente contactado primero. */
export function reminderQueueFor(guests: GuestRow[], now = Date.now()): ReminderPerson[] {
  return remindable(guests, now).map((guest) => ({
    id: guest.id, name: guest.name, phone: guest.phone,
    invitation_sent_at: deliveredAt(guest) as string, delivered_by: guest.invitation_sent_at ? "sent" as const : "opened" as const,
    last_reminder_at: guest.last_reminder_at, reminder_count: guest.reminder_count,
  }));
}

/** Envío en serie (`?vista=enviar`): sin el envío confirmado, sin abrir ni responder, con móvil válido, por grupo. */
export function invitationQueueFor(guests: GuestRow[]): { items: InvitationQueueItem[]; withoutPhone: number } {
  const { items, withoutPhone } = splitInvitationQueue(guests
    .filter((guest) => !guest.invitation_sent_at)
    .map((guest) => ({ id: guest.id, name: guest.name, phone: guest.phone, rsvp_status: guest.rsvp_status, invitation_prepared_at: guest.invitation_prepared_at, invitation_opened_at: guest.crm?.invitationOpenedAt ?? null, group_name: guest.group_name ?? null, tags: guest.tags ?? [], side: guest.side ?? null })));
  return { items: sortInvitationQueue(items), withoutPhone };
}

/* ---------------------------------------------------------------------------
 * Importación masiva (break-ui). `?vista=invitados&nuevo=varios&pegar=…`
 * abre «Añadir varios» con este texto ya pegado; `&contactos=1` simula el
 * selector de contactos de Android (navigator.contacts) con CONTACTS_DEMO.
 * ------------------------------------------------------------------------- */
export const PASTES = ["demo", "peor", "tope"] as const;
export type Paste = (typeof PASTES)[number];

/** Lo que copia una pareja de sus Notas: formatos mezclados y 2 que ya están en la lista demo. */
const PASTE_DEMO = [
  "Nombre, Teléfono",
  "Lucía Fernández, 612 000 111",
  "Pedro Gil\t+34 699 000 222",
  "Rosa y Manolo 655 123 456",
  "- Abuelo Paco",
  "2. Elena Ruiz Ortega; 0034 611 999 888",
  "",
  "Marta Díaz, +34 612 345 678",
  "Tia Puri",
  "Andrés Molina 644 777 000",
  "Familia Ortiz (los de Cuenca)",
  "Julia Sanz, 633 222 111",
].join("\n");

/** 300 líneas que intentan romperlo todo (y un par de vacías que no cuentan). */
function pastePeor(): string {
  const special = [
    "María de los Ángeles Fernández-Villaverde de la Concepción y Montenegro-Sotomayor, hermana de la novia (y su pareja Paco y los niños), 600 000 000",
    "👰🏽‍♀️ Tía Encarni 699 111 222",
    "🎉🎉🎉",
    "Jo",
    "J",
    "612345678",
    "-----",
    "=== MESA 4 ===",
    "Αλέξανδρος Παπαδόπουλος\t+30 694 123 4567",
    "Ñoño Iñárritu Özdemir, 611 222 333",
    "ñoño iñarritu ozdemir",
    "Bartolomé Fitzgerald-Ruiz de Alarcón y Santisteban +353 87 123 4567",
    "Vecina del 3.º B, 12",
    "\"Los primos de Albacete\"",
    "Carlos Méndez\t\t699 444 333\tmesa 2",
    "   Dani    Araújo    666 777 888   ",
    "Hugo +44 7700 900123 456 789 012",
    "李小龙 138 0013 8000",
    "محمد علي, 0097 150 123 4567",
    "Jo, 6",
  ];
  const first = ["Lucía", "Hugo", "Martina", "Pablo", "Sara", "Álvaro", "Noa", "Iker", "Vera", "Mateo", "Ainhoa", "Bruno"];
  const last = ["García", "Pérez", "Etxeberria", "Núñez", "Ibáñez", "Castro", "Vidal", "Ferrer", "Lago", "Ruiz"];
  const lines: string[] = [...special];
  for (let i = 0; lines.length < 300; i++) {
    const name = `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]} ${last[(Math.floor(i / (first.length * last.length)) + i) % last.length]}`;
    // Cada 25 un teléfono repetido (mismo número con otro formato); cada 40, sin teléfono.
    const phone = i % 40 === 0 ? "" : i % 25 === 0 ? "+34 600 111 222" : `6${String(10000000 + i * 7919).slice(-8)}`;
    lines.push(phone ? `${name}, ${phone}` : name);
    if (i % 60 === 0) lines.push("", "   ");
  }
  return lines.join("\n");
}

export function pasteFor(value: unknown): string | undefined {
  if (value === "demo") return PASTE_DEMO;
  if (value === "peor") return pastePeor();
  if (value === "tope") return Array.from({ length: 412 }, (_, i) => `Invitado número ${i + 1}, 6${String(20000000 + i).slice(-8)}`).join("\n");
  return undefined;
}

/** Lo que devolvería navigator.contacts.select(): varios teléfonos, uno sin teléfono, uno sin nombre. */
export const CONTACTS_DEMO: Array<{ name?: string[]; tel?: string[] }> = [
  { name: ["Lucía Fernández"], tel: ["+34 612 000 111", "91 555 00 11"] },
  { name: ["Abuela Carmen"], tel: [] },
  { name: [], tel: ["633 999 000"] },
  { name: ["Pablo Ferreiro"], tel: ["611222333"] },
  { name: ["Nacho (trabajo)"], tel: ["+34 644 010 203"] },
];

/* ---------------------------------------------------------------------------
 * CRM: aperturas y regalos (break-ui en `peor` y `mil`).
 * ------------------------------------------------------------------------- */

/** Invitados (por número de uid) que han abierto su enlace personal, y cuándo. */
const OPENED: Partial<Record<Dataset, Record<number, number>>> = {
  demo: { 1: 19, 2: 20, 4: 21, 5: 21, 6: 8, 11: 27, 12: 28, 13: 17, 14: 6, 15: 15 },
  peor: { 102: 19, 103: 20, 105: 21, 106: 5, 108: 22, 109: 1 },
};
const NO_GIFT: Partial<Record<Dataset, number[]>> = { demo: [11], peor: [105] };

function gift(n: number, kind: GiftKind, givers: GuestRow[], extra: Partial<Gift> = {}): Gift {
  return {
    id: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
    kind, amountCents: null, description: null, note: null, receivedOn: null, thankedAt: null,
    givers: givers.map((guest) => ({ guestId: guest.id, name: guest.name })),
    createdAt: at(Math.min(28, 10 + (n % 18))),
    ...extra,
  };
}

/** Regalos anotados por la pareja para cada juego de datos. */
export function giftsFor(dataset: Dataset, guests: GuestRow[]): Gift[] {
  const by = (n: number) => guests.filter((guest) => guest.id === uid(n));
  if (dataset === "demo") {
    return [
      gift(1, "transferencia", by(1), { amountCents: 15000, receivedOn: "2026-09-28", thankedAt: at(29) }),
      gift(2, "bizum", by(2), { amountCents: 5000, receivedOn: "2026-10-01" }),
      gift(3, "lista", [...by(4), ...by(12)], { description: "Robot de cocina de la lista", note: "Lo compraron entre los dos." }),
      gift(4, "efectivo", by(3), { amountCents: 30000, note: "En la tarjeta: «para el viaje»", thankedAt: at(25) }),
      gift(5, "objeto", by(5), { description: "Juego de copas de cristal" }),
      gift(6, "experiencia", by(12), { description: "Cena en un restaurante de Cercedilla", receivedOn: "2026-09-30" }),
    ];
  }
  if (dataset === "peor") {
    return [
      gift(101, "transferencia", by(102), { amountCents: 10_000_000, description: "Todo el equipo de la oficina".padEnd(200, "."), note: "N".repeat(500) }),
      gift(102, "efectivo", guests.slice(0, 11), { amountCents: 123_456 }),
      gift(103, "lista", by(103), { description: "🎁 Vajilla completa de 48 piezas (la de la lista de El Corte Inglés, color «arena»)" }),
      gift(104, "otro", by(108), {}),
      gift(105, "bizum", by(108), { amountCents: 1 }),
      gift(106, "efectivo", by(106), { thankedAt: ago(2) }),
    ];
  }
  if (dataset === "mil") {
    return guests.filter((_, i) => i % 3 === 0).map((guest, i) => gift(5000 + i, GIFT_KINDS[i % GIFT_KINDS.length], [guest], {
      amountCents: i % GIFT_KINDS.length < 3 ? 5000 + (i % 7) * 2500 : null,
      description: i % GIFT_KINDS.length >= 3 ? "Regalo de la lista" : null,
      thankedAt: i % 4 === 0 ? null : ago(i % 20),
    }));
  }
  return [];
}

/** Lo que devolvería el helper de lib/data/crm.ts por invitado, a partir de las aperturas y los regalos. */
export function withCrm(dataset: Dataset, guests: GuestRow[], gifts: Gift[], noGift: ReadonlySet<string> = new Set(NO_GIFT[dataset]?.map(uid) ?? [])): GuestRow[] {
  const opened = OPENED[dataset] ?? {};
  return guests.map((guest, index) => {
    const n = Number(guest.id.slice(-12));
    const openedDay = opened[n] ?? (dataset === "mil" && guest.invitation_sent_at && index % 2 === 0 ? 1 + (index % 28) : undefined);
    const own = gifts.filter((item) => item.givers.some((giver) => giver.guestId === guest.id));
    return {
      ...guest,
      crm: {
        invitationOpenedAt: openedDay ? ago(openedDay) : guest.crm?.invitationOpenedAt ?? null,
        giftState: own.length > 0 ? "yes" : noGift.has(guest.id) ? "no" : "unknown",
        giftCount: own.length,
        giftUnthanked: own.some((item) => !item.thankedAt),
      },
    };
  });
}

export function noGiftFor(dataset: Dataset): Set<string> {
  return new Set(NO_GIFT[dataset]?.map(uid) ?? []);
}

/** Lo que devolvería `getCrmFunnel`. */
export function crmFunnel(guests: GuestRow[], now = Date.now()): CrmFunnelSummary {
  const stageOf = (guest: GuestRow): FunnelStage =>
    guest.rsvp_status !== "pendiente" ? "responded"
      : guest.crm?.invitationOpenedAt ? "opened"
        : guest.invitation_sent_at ? "sent"
          : guest.invitation_prepared_at ? "prepared" : "added";
  const reached = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, 0])) as Record<FunnelStage, number>;
  for (const guest of guests) {
    const index = FUNNEL_STAGES.indexOf(stageOf(guest));
    for (const stage of FUNNEL_STAGES.slice(0, index + 1)) reached[stage] += 1;
  }
  const yes = guests.filter((guest) => guest.rsvp_status === "si");
  const pendingGuests = guests.filter((guest) => guest.rsvp_status === "pendiente");
  return {
    reached,
    responses: { yes: yes.length, no: guests.filter((guest) => guest.rsvp_status === "no").length },
    attendees: yes.reduce((sum, guest) => sum + 1 + guest.rsvp_companions, 0),
    pending: {
      not_sent: pendingGuests.filter((guest) => !guest.invitation_sent_at && !guest.crm?.invitationOpenedAt).length,
      sent_unopened: pendingGuests.filter((guest) => guest.invitation_sent_at && !guest.crm?.invitationOpenedAt).length,
      opened_unanswered: pendingGuests.filter((guest) => guest.crm?.invitationOpenedAt).length,
    },
    toRemind: remindable(guests, now).length,
  };
}

/** Lo que devolvería `getGiftSummary`. */
export function giftSummary(gifts: Gift[], guests: GuestRow[]): CrmGiftSummary {
  const byKind = Object.fromEntries(GIFT_KINDS.map((kind) => [kind, { count: 0, totalCents: 0 }])) as CrmGiftSummary["byKind"];
  for (const item of gifts) {
    byKind[item.kind].count += 1;
    byKind[item.kind].totalCents += item.amountCents ?? 0;
  }
  return {
    count: gifts.length,
    totalCents: gifts.reduce((sum, item) => sum + (item.amountCents ?? 0), 0),
    withAmount: gifts.filter((item) => item.amountCents !== null).length,
    byKind,
    unthanked: gifts.filter((item) => !item.thankedAt).length,
    guests: {
      yes: guests.filter((guest) => guest.crm?.giftState === "yes").length,
      no: guests.filter((guest) => guest.crm?.giftState === "no").length,
      unknown: guests.filter((guest) => (guest.crm?.giftState ?? "unknown") === "unknown").length,
    },
  };
}
