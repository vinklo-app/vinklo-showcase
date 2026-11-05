import { z } from "zod";

import { PLACE_ID_PATTERN } from "@/lib/places/places";

export const pageConfigSchema = z.object({
  style: z.enum(["editorial", "clasico", "natural"]).default("editorial"),
  welcomeMessage: z.string().trim().max(400, "El mensaje puede tener hasta 400 caracteres.").default(""),
  venue: z.string().trim().max(160, "El lugar puede tener hasta 160 caracteres.").default(""),
  address: z.string().trim().max(240, "La dirección puede tener hasta 240 caracteres.").default(""),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/, "Elegid una hora válida.").default(""),
  /**
   * place_id de Google del lugar elegido entre las sugerencias (8-oct-2026):
   * «Ver en el mapa» abre el sitio exacto. Opcional y sin default (las
   * configuraciones guardadas no cambian); un valor raro se descarta en vez
   * de invalidar el resto.
   */
  placeId: z.string().regex(PLACE_ID_PATTERN).optional().catch(undefined),
});
export type WeddingPageConfig = z.output<typeof pageConfigSchema>;

/** Shared by the builder preview and the published invitation. */
export const WEDDING_PAGE_THEMES = {
  editorial: { paper: "#f6f2ed", ink: "#28221f", accent: "#9e3b22", surface: "#ebe3da" },
  clasico: { paper: "#fffdf8", ink: "#2c3043", accent: "#8a703d", surface: "#f1ede3" },
  natural: { paper: "#f4f5ec", ink: "#293b30", accent: "#52734c", surface: "#e5eadb" },
} as const;

/** Validate the calendar day itself; Date.parse normalizes 31 February. */
export function isValidWeddingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const RSVP_DEADLINE_AFTER_WEDDING = "La fecha límite para confirmar no puede ser posterior a la boda.";
export const RSVP_DEADLINE_IN_PAST = "La fecha límite para confirmar ya ha pasado. Elegid hoy o un día posterior, o dejadla vacía.";

export const weddingSettingsSchema = z.object({
  partnerName1: z.string().trim().min(2, "Escribid el primer nombre (mínimo 2 letras).").max(80),
  partnerName2: z.string().trim().min(2, "Escribid el segundo nombre (mínimo 2 letras).").max(80),
  weddingDate: z.string().refine(isValidWeddingDate, "Elegid una fecha válida."),
  guestCountEst: z.number().int("Indicad un número entero de invitados.").min(1).max(2000),
  pageConfig: pageConfigSchema.optional(),
  /**
   * Último día (incluido, hora de Madrid) para confirmar. Vacío = sin fecha
   * límite (se aceptan respuestas hasta el día después de la boda). Sin la
   * clave, el valor guardado no se toca.
   */
  rsvpDeadline: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidWeddingDate(value), "Elegid una fecha límite válida.")
    .transform((value) => (value === "" ? null : value))
    .optional(),
}).refine(
  // Fechas AAAA-MM-DD válidas: el orden de texto es el orden de calendario.
  (values) => !values.rsvpDeadline || values.rsvpDeadline <= values.weddingDate,
  { message: RSVP_DEADLINE_AFTER_WEDDING, path: ["rsvpDeadline"] },
);

/**
 * «No en el pasado» solo al CAMBIAR la fecha límite: una fecha ya vencida que
 * la pareja no toca no debe impedir guardar otros ajustes después del plazo.
 * Hoy (Madrid) sí vale: se acepta hasta el final del día.
 */
export function rsvpDeadlineIssue(next: string | null, stored: string | null, today: string): string | null {
  if (next === null || next === stored) return null;
  return next < today ? RSVP_DEADLINE_IN_PAST : null;
}

export type WeddingSettingsInput = z.input<typeof weddingSettingsSchema>;
