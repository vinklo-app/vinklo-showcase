/**
 * Acciones en bloque de la lista de invitados (Bloque 4, 17-oct-2026):
 * «Borrar (n)», «Marcar asistencia…» y «Elegir los N del filtro». Puro (sin
 * React ni Supabase): lo usan la lista, las server actions y los tests.
 */
import { RSVP_LABELS, type RsvpStatus } from "@/lib/guests";
import { plural } from "@/components/panel/guest-status";

/**
 * Tope de invitados por acción en bloque (como «Mover a grupo» y
 * «Etiquetar»): los ids viajan en la URL de PostgREST (`in.(…)`).
 */
export const MAX_GUEST_BULK = 500;

/** Lo que la barra de selección necesita de una persona que no está en esta página. */
export interface BulkGuest {
  id: string;
  name: string;
  rsvp_status: RsvpStatus;
  invitation_prepared_at: string | null;
  invitation_sent_at: string | null;
  /** Como en GuestRow: undefined = sin la migración de grupos / etiquetas. */
  group_name?: string | null;
  tags?: string[];
}

/** Regalos anotados que se borran con los elegidos y los que se quedan con otras personas. */
export interface GiftDeletionImpact { giftsDeleted: number; giftsKept: number }

/**
 * Un regalo se borra si TODOS los que lo hicieron están entre los elegidos
 * (el trigger wedding_gift_givers_drop_orphan lo borra al quedarse sin
 * nadie); si lo hizo también alguien que se queda, sigue con esa persona.
 * Solo cuenta regalos en los que participa algún elegido.
 */
export function giftDeletionImpact(gifts: ReadonlyArray<{ givers: ReadonlyArray<{ guestId: string }> }>, ids: ReadonlySet<string>): GiftDeletionImpact {
  let giftsDeleted = 0, giftsKept = 0;
  for (const gift of gifts) {
    if (!gift.givers.some((giver) => ids.has(giver.guestId))) continue;
    if (gift.givers.every((giver) => ids.has(giver.guestId))) giftsDeleted += 1;
    else giftsKept += 1;
  }
  return { giftsDeleted, giftsKept };
}

/**
 * Texto de la confirmación de «Borrar (n)». Lo mismo que avisa la ficha al
 * borrar a una persona (respuesta, enlace y regalos), en plural, y qué más
 * se va con ella en la base: acompañantes con nombre, mesa y «No sentar con…».
 */
export function deleteConfirmText(count: number, impact: GiftDeletionImpact | null): string[] {
  const one = count === 1;
  const lines = [
    one
      ? "Se borra de vuestra lista con su respuesta, sus acompañantes con nombre y su sitio en las mesas. Su enlace personal dejará de funcionar."
      : `Se borran de vuestra lista con sus respuestas, sus acompañantes con nombre y su sitio en las mesas. Sus enlaces personales dejarán de funcionar.`,
  ];
  if (impact === null) {
    lines.push("No hemos podido comprobar sus regalos: si alguno es solo suyo, también se borrará.");
  } else {
    if (impact.giftsDeleted > 0) lines.push(impact.giftsDeleted === 1 ? "También se borrará el regalo que les habéis anotado." : `También se borrarán los ${impact.giftsDeleted} regalos que les habéis anotado.`);
    if (impact.giftsKept > 0) lines.push(impact.giftsKept === 1 ? "El regalo que hicieron con otras personas se queda con ellas." : `Los ${impact.giftsKept} regalos que hicieron con otras personas se quedan con ellas.`);
  }
  return lines;
}

/** Aviso con «Deshacer» mientras el borrado espera (nada se ha borrado aún). */
export function deletePendingText(count: number): string {
  return `Borrando a ${plural(count, "invitado", "invitados")}…`;
}

/** Segundos para «Deshacer» un borrado en bloque: la llamada al servidor espera a que se cierre el aviso. */
export const DELETE_UNDO_MS = 10_000;

/** Tras guardar el borrado. `missing` = ya no estaban en la lista. */
export function deleteDoneText(deleted: number, missing: number): string {
  const done = plural(deleted, "invitado borrado", "invitados borrados");
  return missing > 0 ? `${done} · ${plural(missing, "ya no estaba", "ya no estaban")} en la lista` : done;
}

/**
 * Explicación de lo que cambia al marcar la asistencia de los elegidos, para
 * la hoja (antes de guardar). Mismo criterio que la ficha: sin «Asiste» no
 * cuentan acompañantes; con «Asiste», quien ya asistía conserva los suyos.
 */
export function statusChangeHelp(status: RsvpStatus): string {
  if (status === "si") return "Quien ya asistía conserva sus acompañantes; el resto cuenta sin acompañantes (podéis añadirlos en su ficha).";
  return "Sus acompañantes dejan de contar.";
}

/** Aviso tras marcar la asistencia («12 invitados marcados como «Asiste»»). */
export function statusDoneText(status: RsvpStatus, changed: number, missing: number): string {
  const done = `${plural(changed, "invitado marcado", "invitados marcados")} como «${RSVP_LABELS[status]}»`;
  return missing > 0 ? `${done} · ${plural(missing, "ya no estaba", "ya no estaban")} en la lista` : done;
}

/**
 * Personas elegidas en orden de la lista: primero las de esta página (con
 * todos sus datos) y después las del resto del filtro («Elegir los N del
 * filtro»). Ids desconocidos se ignoran.
 */
export function selectedGuests(picked: ReadonlySet<string>, page: readonly BulkGuest[], rest: ReadonlyMap<string, BulkGuest> | null): BulkGuest[] {
  const out: BulkGuest[] = page.filter((guest) => picked.has(guest.id));
  if (!rest) return out;
  const seen = new Set(out.map((guest) => guest.id));
  for (const [id, guest] of rest) if (picked.has(id) && !seen.has(id)) out.push(guest);
  return out;
}

/** Quién puede «Marcar enviada»: enlace creado y envío aún sin confirmar. */
export function sendableGuests<T extends Pick<BulkGuest, "invitation_prepared_at" | "invitation_sent_at">>(list: readonly T[]): T[] {
  return list.filter((guest) => guest.invitation_prepared_at !== null && guest.invitation_sent_at === null);
}
