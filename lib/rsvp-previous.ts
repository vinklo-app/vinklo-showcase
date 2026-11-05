import { z } from "zod";

import { rsvpAnswersInputSchema } from "./rsvp-answers";
import { parseCompanionList } from "./rsvp-companions";
import type { RsvpPrevious } from "./rsvp-form-state";

export {
  busQuestion,
  COMPANION_NAMES_DROP_ALL_TEXT,
  COMPANION_NAMES_DROP_TEXT,
  COMPANION_NAMES_KEPT_TEXT,
  COMPANION_NAMES_REPLACE_TEXT,
  companionNamesNotice,
  HEALTH_CONSENT_VERSION,
  HEALTH_NOTE_KEPT_TEXT,
  LOGISTIC_NOTE_KEPT_TEXT,
  maxCompanionsHint,
  menuMissingHint,
  previousResponseText,
  rsvpFormInitialState,
  rsvpKeptPayload,
  rsvpSavedSummary,
  tooManyCompanionsError,
  type RsvpFormInitialState,
  type RsvpPrevious,
} from "./rsvp-form-state";

const rowSchema = z.object({
  status: z.enum(["si", "no"]),
  companions: z.number().int().min(0).max(10).catch(0),
  // 20261101100000 (paso 1) los añade; tras 20261101110000 (paso 2), solo booleanos.
  has_health_note: z.boolean().nullable().catch(null).optional(),
  has_logistic_note: z.boolean().nullable().catch(null).optional(),
  has_companion_names: z.boolean().nullable().catch(null).optional(),
  health_consent_at: z.string().nullable().catch(null).optional(),
  // Hasta 20261101110000 (paso 2) la RPC aún manda los textos: solo se mira si
  // existen y se descartan aquí (no llegan a la página ni al HTML).
  notes: z.string().nullable().catch(null).optional(),
  logistic_notes: z.string().nullable().catch(null).optional(),
  companion_list: z.unknown().optional(),
  answers: z.unknown(),
  responded_at: z.string().nullable().catch(null),
});

/**
 * Forma del jsonb de la RPC → estado del formulario. Lo que no encaje se
 * descarta (unas respuestas de módulos con forma vieja dejan el formulario
 * sin módulos, no lo rompen). null si no hay respuesta válida.
 */
export function parseRsvpPrevious(raw: unknown): RsvpPrevious | null {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  const answers = row.answers == null ? null : rsvpAnswersInputSchema.safeParse(row.answers);
  const respondedAt = row.responded_at && !Number.isNaN(Date.parse(row.responded_at)) ? row.responded_at : null;
  const yes = row.status === "si";
  const hasHealthNote = row.has_health_note ?? Boolean(row.notes?.trim());
  return {
    status: row.status,
    companions: yes ? row.companions : 0,
    hasHealthNote,
    hasLogisticNote: row.has_logistic_note ?? Boolean(row.logistic_notes?.trim()),
    hasCompanionNames: yes && (row.has_companion_names ?? parseCompanionList(row.companion_list).length > 0),
    healthConsentAt: hasHealthNote && row.health_consent_at && !Number.isNaN(Date.parse(row.health_consent_at)) ? row.health_consent_at : null,
    answers: answers?.success ? answers.data : {},
    respondedAt,
  };
}

/** Lo que la página necesita del enlace: la respuesta anterior y el tope de acompañantes (§4.2). */
export interface GuestRsvpCurrent {
  previous: RsvpPrevious | null;
  /** Máximo de acompañantes de la invitación; null = libre hasta 10. */
  maxCompanions: number | null;
  /**
   * Nombre de la ficha del titular del enlace (20261101130000), completo: SOLO
   * para el servidor. La página pasa al HTML su nombre de pila (firstName).
   * null sin la migración o sin nombre.
   */
  guestName: string | null;
}

const maxSchema = z.object({
  max_companions: z.number().int().min(0).max(10).nullable().catch(null).optional(),
  guest_name: z.string().max(200).nullable().catch(null).optional(),
});

/** jsonb de guest_rsvp_current (con o sin la migración 20261021110000). null si no es un objeto. */
export function parseGuestRsvpCurrent(raw: unknown): GuestRsvpCurrent | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const max = maxSchema.safeParse(raw);
  const maxCompanions = max.success ? (max.data.max_companions ?? null) : null;
  const guestName = max.success ? max.data.guest_name?.trim() || null : null;
  const previous = parseRsvpPrevious(raw);
  // Una respuesta guardada antes de fijar el tope no puede saltárselo al reenviarla.
  if (previous && maxCompanions !== null && previous.companions > maxCompanions) {
    previous.companions = maxCompanions;
    // Sus nombres guardados ya no cuadran con el tope: al reenviar se sustituyen.
    previous.hasCompanionNames = false;
  }
  return { previous, maxCompanions, guestName };
}
