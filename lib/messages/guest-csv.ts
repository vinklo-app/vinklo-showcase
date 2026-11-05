/**
 * CSV de invitados (puro). Separador «;» para Excel es-ES, como el resto de
 * exportaciones del panel; el BOM lo añade quien crea el Blob (igual que
 * csv-export-button.tsx). Nunca incluye tokens ni enlaces personales.
 */
import { RSVP_LABELS, type RsvpStatus } from "@/lib/guests";
import { guestGiftState } from "@/lib/crm/guest-fields";
import { SIDE_LABELS, type GuestSide } from "@/lib/crm/tags";
import { centsToDecimalComma } from "@/lib/format/money";
import { extraFieldKeys } from "@/lib/crm/guest-view";
import { menuText, rowMenuMissing, type ModuleLabels, type RsvpAnswers } from "@/lib/rsvp-answers";
import { guestDietSummary } from "@/lib/rsvp-diet";

export interface GuestCsvRow {
  name: string;
  phone: string | null;
  rsvp_status: string;
  rsvp_companions: number;
  /** Alergias del invitado (con su consentimiento) o apuntes de la pareja. */
  rsvp_notes: string | null;
  /** «Algo más que debamos saber» (20261030100000). Opcional: sin la migración, celda vacía. */
  rsvp_logistic_notes?: string | null;
  invitation_prepared_at: string | null;
  invitation_sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
  reminders_opt_out: boolean;
  // CRM (20261008100000). Opcionales: filas antiguas o de prueba sin estos campos
  // salen con «Sin indicar» y celdas vacías.
  invitation_opened_at?: string | null;
  gift_none?: boolean;
  gift_count?: number;
  /** Suma de los regalos en los que participa (un regalo compartido cuenta entero para cada uno). */
  gift_total_cents?: number;
  /** Grupo (20261012100000). Opcional: sin la migración la celda va vacía. */
  group_name?: string | null;
  /** Etiquetas y lado (20261020100000). Opcionales: sin la migración las celdas van vacías. */
  tags?: string[];
  side?: GuestSide | null;
  /** Tope de acompañantes (20261021110000). null/undefined = sin límite (celda vacía). */
  max_companions?: number | null;
  /** Respuestas de módulos (20261018100000), para las columnas «Menú» y «Alergias y dietas marcadas». */
  rsvp_answers?: RsvpAnswers | null;
  /** Campos propios importados de un Excel (20261031100000): una columna por clave, al final. */
  extra_fields?: Record<string, string> | null;
}

/** Texto de cada lado en el CSV («De Lucía»…); sin nombres, el genérico. */
export type CsvSideLabels = Record<GuestSide, string>;
const DEFAULT_SIDE_LABELS = SIDE_LABELS(null, null);

const GIFT_STATE_CSV = { yes: "Sí", no: "Sin regalo", unknown: "Sin indicar" } as const;

/** 15000 → «150,00» (coma decimal es-ES; el separador de columnas es «;»). */
function euros(cents: number | undefined): string {
  return cents ? centsToDecimalComma(cents) : "";
}

/**
 * Nombre y notas los escribe un invitado anónimo: si la celda empieza por un
 * carácter de fórmula, Excel la ejecutaría. El apóstrofo inicial fuerza texto.
 * Además toda celda va entre comillas (`"` → `""`): así ningún valor puede
 * cambiar de columna ni de fila aunque lleve «;», saltos de línea o comillas.
 */
export function csvCell(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${defused.replace(/"/g, '""')}"`;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export const GUEST_CSV_HEADER = [
  "Nombre", "Teléfono", "Asistencia", "Acompañantes", "Notas del invitado",
  "Invitación preparada", "Envío confirmado por vosotros", "Último recordatorio (confirmado por vosotros)",
  "Recordatorios", "Sin recordatorios",
  "Abrió su invitación", "Regalo", "Importe de sus regalos (€)", "Grupo", "Lado", "Etiquetas", "Acompañantes máx.",
  "Otras notas del invitado",
] as const;

/** Etiquetas en una celda, separadas por « · ». */
export const CSV_TAG_SEPARATOR = " · ";

export const CSV_MENU_HEADER = "Menú";
/** Resumen de las casillas de alergias y dieta (ítem 21): «2 sin gluten · 1 vegetariano». */
export const CSV_DIET_HEADER = "Alergias y dietas marcadas";
export const CSV_MENU_MISSING = "Aviso: sin menú";

/**
 * Celda «Menú» (P1-6): lo elegido, o el aviso si viene y falta alguien por
 * elegir. Quien no viene, vacía (no come).
 */
export function guestMenuCell(row: Pick<GuestCsvRow, "rsvp_status" | "rsvp_companions" | "rsvp_answers">, labels: ModuleLabels): string {
  if (row.rsvp_status !== "si") return "";
  const answers = row.rsvp_answers ?? null;
  const chosen = answers ? menuText(answers, labels) : "";
  const missing = rowMenuMissing({ companions: row.rsvp_companions, answers });
  if (!chosen) return CSV_MENU_MISSING;
  return missing > 0 ? `${chosen} · Aviso: falta el menú de ${missing} ${missing === 1 ? "persona" : "personas"}` : chosen;
}

/**
 * `menuLabels`: solo si la boda pregunta menú; entonces se añade la columna
 * «Menú» al final (sin menú en la web, el archivo no cambia). Detrás,
 * «Alergias y dietas marcadas» si alguien marcó alguna casilla.
 */
export function buildGuestCsv(rows: GuestCsvRow[], sideLabels: CsvSideLabels = DEFAULT_SIDE_LABELS, menuLabels: ModuleLabels | null = null): string {
  // Alergias y dietas marcadas (ítem 21): solo quien viene; la columna solo
  // aparece si alguien marcó algo (si no, el archivo no cambia).
  const dietOf = (row: GuestCsvRow) => (row.rsvp_status === "si" ? guestDietSummary(row.rsvp_notes, row.rsvp_answers ?? null) : "");
  const withDiet = rows.some((row) => dietOf(row) !== "");
  const base: string[] = [...GUEST_CSV_HEADER, ...(menuLabels ? [CSV_MENU_HEADER] : []), ...(withDiet ? [CSV_DIET_HEADER] : [])];
  // Campos propios al final. Sus títulos vienen del Excel de la pareja: van
  // entre comillas y, si coinciden con una columna de Vinklo, se distinguen.
  const extraKeys = extraFieldKeys(rows.map((row) => row.extra_fields));
  const taken = new Set(base.map((title) => title.toLocaleLowerCase("es")));
  const header = [...base, ...extraKeys.map((key) => csvCell(taken.has(key.toLocaleLowerCase("es")) ? `${key} (importado)` : key))];
  const lines = rows.map((row) => [
    csvCell(row.name),
    csvCell(row.phone ?? ""),
    csvCell(RSVP_LABELS[row.rsvp_status as RsvpStatus] ?? row.rsvp_status),
    String(row.rsvp_status === "si" ? row.rsvp_companions : 0),
    csvCell(row.rsvp_notes ?? ""),
    day(row.invitation_prepared_at),
    day(row.invitation_sent_at),
    day(row.last_reminder_at),
    String(row.reminder_count),
    row.reminders_opt_out ? "Sí" : "No",
    day(row.invitation_opened_at ?? null),
    GIFT_STATE_CSV[guestGiftState(row.gift_count ?? 0, row.gift_none ?? false)],
    euros(row.gift_total_cents),
    csvCell(row.group_name ?? ""),
    row.side ? csvCell(sideLabels[row.side] ?? "") : "",
    csvCell((row.tags ?? []).join(CSV_TAG_SEPARATOR)),
    typeof row.max_companions === "number" ? String(row.max_companions) : "",
    csvCell(row.rsvp_logistic_notes ?? ""),
    ...(menuLabels ? [csvCell(guestMenuCell(row, menuLabels))] : []),
    ...(withDiet ? [csvCell(dietOf(row))] : []),
    ...extraKeys.map((key) => csvCell(row.extra_fields?.[key] ?? "")),
  ].join(";"));
  return `${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}
