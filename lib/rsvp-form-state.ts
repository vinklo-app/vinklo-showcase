import type { RsvpAnswersInput } from "./rsvp-answers";
import type { BusUse, LodgingWhere, RsvpModules } from "./rsvp-modules";

/** Parte pura (sin zod) del estado previo del formulario: la importa el cliente. */

/**
 * Respuesta anterior del invitado (plan maestro §2.5): lo que devolvió
 * `guest_rsvp_current` para su enlace personal. Rellena el formulario para
 * que, al volver a enviarlo, no se pisen acompañantes, notas ni módulos.
 * Sin dependencias de servidor: lo usan la página y el formulario.
 */
export interface RsvpPrevious {
  status: "si" | "no";
  companions: number;
  /**
   * Revisión de seguridad M1 (20261101100000): el enlace personal ya no
   * devuelve textos privados, solo si existen. Un enlace reenviado no enseña
   * alergias, notas ni nombres; el invitado puede sustituirlos o borrarlos.
   */
  /** Dejó una nota de alergias o intolerancias (suya, con consentimiento). */
  hasHealthNote: boolean;
  /** Dejó una nota en «Algo más que debamos saber». */
  hasLogisticNote?: boolean;
  /** Escribió nombres de acompañantes (20261023110000). */
  hasCompanionNames?: boolean;
  /** ISO: cuándo aceptó que la pareja conozca su nota de salud; null si no hay. */
  healthConsentAt?: string | null;
  answers: RsvpAnswersInput;
  /** ISO; null en respuestas anteriores a responded_at. */
  respondedAt: string | null;
}

/** Aviso bajo «Alergias» cuando ya dejó una nota (que no se le muestra). */
export const HEALTH_NOTE_KEPT_TEXT = "Ya nos dijiste algo sobre alergias; si quieres cambiarlo, escríbelo de nuevo.";
/** Aviso bajo «Algo más que debamos saber» cuando ya dejó una nota. */
export const LOGISTIC_NOTE_KEPT_TEXT = "Ya nos dejaste una nota; si quieres cambiarla, escríbela de nuevo.";
/** Aviso sobre los nombres de acompañantes cuando ya los escribió. */
export const COMPANION_NAMES_KEPT_TEXT = "Ya nos diste sus nombres; si quieres cambiarlos, escríbelos de nuevo.";
/** Al bajar el número sin escribir nombres: se avisa ANTES de enviar (revisión bloque 1, F4). */
export const COMPANION_NAMES_DROP_TEXT = "Al cambiar el número, escribe de nuevo sus nombres: los que nos diste se borrarán al enviar.";
/** Sin acompañantes, los nombres guardados sobran. */
export const COMPANION_NAMES_DROP_ALL_TEXT = "Sin acompañantes, los nombres que nos diste se borrarán al enviar.";
/** Escribió algún nombre: la lista nueva sustituye entera a la guardada. */
export const COMPANION_NAMES_REPLACE_TEXT = "Los nombres que escribas sustituirán a los que nos diste: escríbelos todos.";

/** «Hasta 2 acompañantes.» */
export function maxCompanionsHint(max: number): string {
  return max === 1 ? "Hasta 1 acompañante." : `Hasta ${max} acompañantes.`;
}

/** Mensaje cuando se pasa del tope (texto del plan, §4.2). */
export function tooManyCompanionsError(max: number): string {
  if (max === 0) return "Tu invitación es solo para ti. Si necesitas cambiarlo, escribe a la pareja.";
  return `Tu invitación es para ti y ${max === 1 ? "1 persona más" : `${max} personas más`}. Si necesitas cambiarlo, escribe a la pareja.`;
}

/**
 * Versión del texto de consentimiento de salud que ve el invitado
 * («Acepto que la pareja conozca estos datos de salud para organizar el
 * menú.»). Se guarda con la fecha (20261030100000); solo cambia si cambia ese texto.
 */
export const HEALTH_CONSENT_VERSION = "2026-10";

/**
 * Aviso no bloqueante bajo el menú: «Falta elegir el menú de 2 personas.»
 * El menú es opcional; null cuando ya están todos (o no hay nadie).
 */
export function menuMissingHint(people: number, chosen: number): string | null {
  const missing = people - Math.max(0, chosen);
  if (missing <= 0) return null;
  return `Falta elegir el menú de ${missing} ${missing === 1 ? "persona" : "personas"}.`;
}

/** Pregunta del autobús: la respuesta vale para toda la invitación (singular si va sola una persona). */
export function busQuestion(people: number): string {
  return people > 1 ? `¿Usaréis el autobús las ${people} personas de vuestra invitación?` : "¿Usarás el autobús?";
}

/**
 * Segunda línea tras confirmar: «Respuesta guardada. Vais 3 personas: tú,
 * Pablo y Leo.» Solo si van acompañantes y todos tienen nombre (si no, la
 * cifra y la lista no cuadrarían). Con enlace personal no sabemos su nombre: «tú».
 */
export function rsvpSavedSummary(companions: number, names: string[]): string | null {
  const named = names.map((name) => name.trim()).filter(Boolean);
  if (companions < 1 || named.length !== companions) return null;
  const list = ["tú", ...named];
  return `Respuesta guardada. Vais ${companions + 1} personas: ${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}.`;
}

/**
 * Primera línea del justificante (ítem 12), siempre con «sí»: la de
 * `rsvpSavedSummary` si todos los acompañantes tienen nombre; si no, cuántos
 * sois sin inventar nombres.
 */
export function rsvpPeopleSummary(companions: number, names: string[]): string {
  const full = rsvpSavedSummary(companions, names);
  if (full) return full;
  if (companions < 1) return "Respuesta guardada. Vienes tú.";
  return `Respuesta guardada. Vais ${companions + 1} personas: tú y ${companions === 1 ? "1 acompañante" : `${companions} acompañantes`}.`;
}

/** Una fila del justificante: «Autobús · Ida y vuelta desde Plaza (17:00)». */
export interface RsvpReceiptRow { key: string; label: string; value: string }

export interface RsvpReceiptInput {
  answers: RsvpAnswersInput;
  modules: RsvpModules;
  /** Nota de salud que se acaba de enviar (compuesta con las casillas); vacía si no. */
  healthNote: string;
  /** Se conservó la nota de salud que ya había (no se enseña: M1). */
  healthKept: boolean;
}

const RECEIPT_BUS: Record<BusUse, string> = { ambos: "Ida y vuelta", ida: "Solo ida", vuelta: "Solo vuelta", no: "No, vas por tu cuenta" };

/**
 * Justificante tras confirmar (ítem 12): lo que se acaba de guardar, con los
 * nombres de la web (paradas con su hora, hoteles, menús). Solo lo respondido.
 */
export function rsvpReceipt({ answers, modules, healthNote, healthKept }: RsvpReceiptInput): RsvpReceiptRow[] {
  const rows: RsvpReceiptRow[] = [];
  if (modules.bus && answers.bus) {
    const stops = modules.bus.stops;
    const goes = answers.bus.use === "ida" || answers.bus.use === "ambos";
    const stop = goes ? (stops.length === 1 ? stops[0] : stops.find((s) => s.id === answers.bus!.stop)) : undefined;
    rows.push({ key: "bus", label: "Autobús", value: `${RECEIPT_BUS[answers.bus.use]}${stop ? ` desde ${stop.name}${stop.time ? ` (${stop.time})` : ""}` : ""}` });
  }
  if (modules.lodging && answers.lodging) {
    const hotels = modules.lodging.hotels;
    const where = answers.lodging.where;
    const hotel = where === "hotel" ? (hotels.length === 1 ? hotels[0] : hotels.find((h) => h.id === answers.lodging!.hotel)) : undefined;
    rows.push({ key: "lodging", label: "Alojamiento", value: where === "hotel" ? hotel?.name ?? "En uno de vuestros hoteles" : where === "otro" ? "En otro sitio" : "No te alojas" });
  }
  if (modules.menu.length > 0 && answers.menu) {
    const chosen = modules.menu.filter((o) => (answers.menu?.[o.id] ?? 0) > 0).map((o) => `${answers.menu![o.id]} ${o.label}`);
    if (chosen.length > 0) rows.push({ key: "menu", label: "Menú", value: chosen.join(", ") });
  }
  const prefs = answers.diet ? [answers.diet.vegetariano ? `${answers.diet.vegetariano} ${answers.diet.vegetariano === 1 ? "vegetariano" : "vegetarianos"}` : "", answers.diet.vegano ? `${answers.diet.vegano} ${answers.diet.vegano === 1 ? "vegano" : "veganos"}` : ""].filter(Boolean) : [];
  if (prefs.length > 0) rows.push({ key: "diet", label: "Dieta", value: prefs.join(", ") });
  if (healthNote.trim()) rows.push({ key: "health", label: "Alergias", value: healthNote.trim() });
  else if (healthKept) rows.push({ key: "health", label: "Alergias", value: "Conservamos lo que ya nos dijiste" });
  if (modules.song && answers.song?.trim()) rows.push({ key: "song", label: "Canción", value: `«${answers.song.trim()}»` });
  return rows;
}

/** «Con este mismo enlace puedes cambiar tu respuesta hasta el 1 de agosto.» (solo con plazo). */
export function rsvpChangeUntilText(deadlineLabel: string): string {
  return `Con este mismo enlace puedes cambiar tu respuesta hasta el ${deadlineLabel}.`;
}

const RESPONDED_DATE = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" });

/** «Ya nos respondiste el 8 de octubre. Puedes cambiarlo aquí.» (sin fecha si no se sabe). */
export function previousResponseText(previous: Pick<RsvpPrevious, "respondedAt">): string {
  const when = previous.respondedAt ? RESPONDED_DATE.format(new Date(previous.respondedAt)) : null;
  return when ? `Ya nos respondiste el ${when}. Puedes cambiarlo aquí.` : "Ya nos respondiste. Puedes cambiarlo aquí.";
}

/** Estado inicial del formulario a partir de la respuesta anterior (puro, testeable). */
export interface RsvpFormInitialState {
  attending: "si" | "no";
  companions: number;
  /** Lo guardado no se muestra: los campos salen vacíos y estas marcas dicen que existe. */
  healthNoteKept: boolean;
  logisticNoteKept: boolean;
  companionNamesKept: boolean;
  busUse: BusUse | null;
  busStop: string | null;
  lodging: LodgingWhere | null;
  hotel: string | null;
  song: string;
  kids: number;
  menu: Record<string, number>;
  /** Vegetarianos / veganos (ítem 21): se reparten por orden entre las personas. */
  diet: Partial<Record<"vegetariano" | "vegano", number>>;
}

export function rsvpFormInitialState(previous: RsvpPrevious): RsvpFormInitialState {
  const a = previous.answers;
  const yes = previous.status === "si";
  return {
    attending: previous.status,
    companions: previous.companions,
    // Con «no» no hay nota de salud ni nombres que conservar.
    healthNoteKept: yes && previous.hasHealthNote,
    logisticNoteKept: Boolean(previous.hasLogisticNote),
    companionNamesKept: yes && previous.companions > 0 && Boolean(previous.hasCompanionNames),
    busUse: a.bus?.use ?? null,
    busStop: a.bus?.stop ?? null,
    lodging: a.lodging?.where ?? null,
    hotel: a.lodging?.hotel ?? null,
    song: a.song ?? "",
    kids: a.kids ?? 0,
    menu: a.menu ? { ...a.menu } : {},
    diet: a.diet ? { ...a.diet } : {},
  };
}

/** Qué hacer con lo guardado al enviar (puro, testeable). */
export interface RsvpKeptFields {
  attending: "si" | "no";
  healthNotes: string;
  healthNoteKept: boolean;
  logisticNotes: string;
  logisticNoteKept: boolean;
  companions: number;
  initialCompanions: number;
  companionNamesKept: boolean;
  /** Escribió algún nombre en esta visita (marcar «Es niño/a» no cuenta). */
  companionNamesTouched: boolean;
}

/**
 * - Nota de salud en blanco y guardada → conservar (keepHealthNote).
 * - Nota logística en blanco y guardada → undefined (la RPC no la toca);
 *   en blanco sin guardar o tras «Borrar» → "" (se borra).
 * - Nombres guardados sin escribir ninguno nuevo, con los mismos acompañantes
 *   o MÁS (siguen valiendo; las plazas nuevas quedan sin nombre) → no se
 *   envían (la RPC no los toca). Con menos acompañantes o algún nombre
 *   escrito se envía lo que hay (sustituye a la lista guardada); el
 *   formulario lo avisa antes (`companionNamesNotice`).
 */
export function rsvpKeptPayload(f: RsvpKeptFields): { keepHealthNote: boolean; notes: string | undefined; keepCompanionNames: boolean } {
  const yes = f.attending === "si";
  return {
    keepHealthNote: yes && f.healthNoteKept && !f.healthNotes.trim(),
    notes: f.logisticNotes.trim() ? f.logisticNotes : f.logisticNoteKept ? undefined : "",
    keepCompanionNames: yes && f.companionNamesKept && !f.companionNamesTouched && f.companions >= f.initialCompanions,
  };
}

/**
 * Qué decir sobre los nombres guardados mientras se rellena (null = nada):
 * que se conservan, o que se borrarán/sustituirán al enviar. Solo con «sí»
 * (con «no» ya no hay acompañantes que nombrar).
 */
export function companionNamesNotice(f: Pick<RsvpKeptFields, "attending" | "companions" | "initialCompanions" | "companionNamesKept" | "companionNamesTouched">): string | null {
  if (f.attending !== "si" || !f.companionNamesKept) return null;
  if (f.companionNamesTouched) return COMPANION_NAMES_REPLACE_TEXT;
  if (f.companions >= f.initialCompanions) return COMPANION_NAMES_KEPT_TEXT;
  return f.companions === 0 ? COMPANION_NAMES_DROP_ALL_TEXT : COMPANION_NAMES_DROP_TEXT;
}
