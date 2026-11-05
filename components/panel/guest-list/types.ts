import type { GuestActionResult, GuestInput } from "@/lib/actions/guests";
import type { RsvpStatus } from "@/lib/guests";
import type { MessageContext, TemplateKind } from "@/lib/messages/templates";
import type { SaveTemplateResult } from "@/components/panel/whatsapp-compose";
import type { GuestExtrasActions } from "@/components/panel/guest-extras";
import type { BulkImportActions } from "@/components/panel/guest-bulk-import";
import type { CrmActions, GuestCrmFields } from "@/lib/crm/contract";
import type { GuestSide } from "@/lib/crm/tags";
import type { ExcelImportActions } from "@/components/panel/guest-excel-import";
import type { BulkGuest, GiftDeletionImpact } from "@/lib/crm/guest-bulk";

export interface GuestRow {
  id: string; name: string; phone: string | null;
  rsvp_status: RsvpStatus; rsvp_companions: number; rsvp_notes: string | null;
  /** «Algo más que debamos saber» del invitado (20261030100000); undefined = no hay o sin la migración. */
  rsvp_logistic_notes?: string | null;
  source: "couple" | "rsvp";
  invitation_prepared_at: string | null; invitation_sent_at: string | null;
  /** Último recordatorio confirmado por la pareja, cuántos y «No enviarle recordatorios». */
  last_reminder_at: string | null; reminder_count: number; reminders_opt_out: boolean;
  /** CRM (lib/crm/contract.ts): apertura del enlace personal y regalo. Sin ellos la fila es la de siempre. */
  crm?: GuestCrmFields;
  /** Grupo (20261012100000). undefined/null = sin grupo. */
  group_name?: string | null;
  /** Etiquetas y lado (20261020100000). undefined = sin la migración. */
  tags?: string[];
  side?: GuestSide | null;
  /** Tope de acompañantes (20261021110000). null = sin límite; undefined = no se ha podido leer. */
  max_companions?: number | null;
  /** Respuestas de los módulos en una línea (autobús, alojamiento, menú…). */
  answers_text?: string;
  /** Campos propios importados de un Excel (20261031100000). undefined = no hay o sin la migración. */
  extra_fields?: Record<string, string> | null;
}

type LinkResult = { ok: true; path: string } | { ok: false; error: string };

/** Texto de invitación de la pareja (plantilla guardada o null = el de Vinklo) para abrir WhatsApp. */
export interface InvitationMessage { template: string | null; context: MessageContext }

/** Acciones inyectadas: en producción son las server actions de lib/actions/guests.ts. */
export interface GuestActions {
  add(input: GuestInput): Promise<GuestActionResult>;
  update(guestId: string, input: GuestInput): Promise<GuestActionResult>;
  remove(guestId: string): Promise<GuestActionResult>;
  /** «Enlace nuevo»: revoca los enlaces anteriores y quita la marca de enviada (createGuestInvitation). */
  createInvitation(guestId: string): Promise<LinkResult>;
  /**
   * «Reenviar» (createReminderLink): AÑADE un enlace sin revocar el que ya
   * tiene y sin tocar «enviada». Solo vale con el envío ya confirmado. Sin
   * ella, reenviar a quien ya la recibió pasa por «Enlace nuevo» en su ficha.
   */
  createReminderLink?(guestId: string): Promise<LinkResult>;
  confirmSent(guestId: string): Promise<GuestActionResult>;
  /** «Guardar como plantilla» desde la hoja del mensaje (saveMessageTemplate); sin ella no se ofrece. */
  saveTemplate?(kind: TemplateKind, body: string): Promise<SaveTemplateResult>;
  setRemindersOptOut(guestId: string, optOut: boolean): Promise<GuestActionResult>;
  /** Importación masiva («Añadir varios» / «Importar contactos»); sin ella no se ofrece. */
  bulkCreate?: BulkImportActions["bulkCreate"];
  listContacts?: BulkImportActions["listContacts"];
  /** Regalos y agradecimientos (lib/actions/gifts.ts); sin ellos la hoja no ofrece «Regalo». */
  gifts?: CrmActions;
  /** Buscar personas por nombre para los regalos de grupo (R05; searchGuestDirectory). */
  searchGuests?(query: string): Promise<{ id: string; name: string }[]>;
  /** «Mover a grupo…» de la selección múltiple (setGuestsGroup); group "" = quitar el grupo. */
  setGroup?(guestIds: string[], group: string): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }>;
  /** «Etiquetar…» de la selección múltiple (setGuestsTags) y su lado (setGuestsSide). */
  setTags?(guestIds: string[], change: { add?: string[]; remove?: string[] }): Promise<{ ok: true; changed: number } | { ok: false; error: string }>;
  setSide?(guestIds: string[], side: GuestSide | null): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }>;
  /** «Acompañantes máximos…» de la selección múltiple (setGuestsMaxCompanions); null = sin límite. */
  setMaxCompanions?(guestIds: string[], max: number | null): Promise<{ ok: true; moved: number; missing: number } | { ok: false; error: string }>;
  /** «Gestionar etiquetas»: renombrar en todos o quitar a todos (to ""). */
  renameTag?(from: string, to: string): Promise<{ ok: true; changed: number } | { ok: false; error: string }>;
  /** Acompañantes con nombre y «No sentar con…» en la ficha (lib/actions/companions.ts). */
  extras?: GuestExtrasActions;
  /** «Importar desde Excel» (importGuestsFromExcel); sin ella no se ofrece. Usa también listContacts. */
  importExcel?: ExcelImportActions["importGuests"];
  /** «Borrar (n)» de la selección (deleteGuests); sin ella no se ofrece. */
  removeMany?(guestIds: string[]): Promise<{ ok: true; deleted: number; missing: number } | { ok: false; error: string }>;
  /** Regalos que se irían con los elegidos (previewGuestsDeletion), para la confirmación de «Borrar (n)». */
  previewRemove?(guestIds: string[]): Promise<({ ok: true } & GiftDeletionImpact) | { ok: false; error: string }>;
  /** «Asistencia…» de la selección (setGuestsStatus); sin ella no se ofrece. */
  setStatus?(guestIds: string[], status: RsvpStatus): Promise<{ ok: true; changed: number; missing: number } | { ok: false; error: string }>;
  /** «Elegir los N del filtro»: todas las personas del filtro activo (listGuestsInFilter); sin ella, solo la página. */
  listFilter?(): Promise<{ ok: true; guests: BulkGuest[] } | { ok: false; error: string }>;
}
