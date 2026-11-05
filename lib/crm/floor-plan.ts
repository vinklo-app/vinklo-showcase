/**
 * Plano del salón (mesas con IA, 9-oct-2026). Puro (cliente y servidor).
 *
 * La pareja sube una foto o captura del plano; un modelo con visión devuelve
 * las mesas (nombre o número, forma, plazas y posición aproximada). Aquí:
 *  - `floorPlanModelSchema`: la salida estructurada que se pide al modelo.
 *    Tolerante a propósito (números sin límites duros): si el modelo se pasa
 *    de rango, se corrige aquí en vez de perder toda la lectura.
 *  - `normalizeFloorPlan`: recorta y corrige (plazas 1–30, posición 0–1,
 *    forma conocida, nombres únicos de hasta 40, como mucho 120 mesas).
 *  - `matchExistingTables`: une cada mesa leída con la que ya tenéis del
 *    mismo nombre («3» = «Mesa 3») para actualizarla en vez de duplicarla.
 *  - `floorPlanRowsError` / `toSaveRows`: validación de la lista revisada
 *    antes de `save_floor_plan` (20261028100000).
 */
import { z } from "zod";
import {
  MAX_TABLES, TABLE_NAME_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, TABLE_SEATS_MIN, TABLE_SHAPES, nextTableName, normalizeTableName,
  type TableShape,
} from "@/lib/crm/seating";

/** Textos de la lectura del plano (es-ES, vosotros; sin jerga). */
export const FLOOR_PLAN_ERRORS = {
  unavailable: "Ahora mismo no podemos leer planos. Añadid las mesas a mano o probad más tarde.",
  rate: "Habéis subido muchos planos seguidos. Esperad un rato y probad de nuevo, o añadid las mesas a mano.",
  busy: "Ahora mismo no podemos leer planos. Añadid las mesas a mano o probad más tarde.",
  file: "Ese archivo no es una imagen válida. Usad una foto o captura en JPG, PNG o WebP.",
  size: "La imagen pesa demasiado. Probad con una captura más pequeña.",
  nothing: "No hemos encontrado mesas en esa imagen. Probad con una foto más nítida y de frente, o añadidlas a mano.",
} as const;

export const floorPlanModelSchema = z.object({
  tables: z.array(z.object({
    label: z.string().describe("Número o nombre de la mesa tal como aparece en el plano («3», «Presidencial»). Vacío si no tiene."),
    shape: z.enum(TABLE_SHAPES).describe("Forma: redonda, rectangular, cuadrada, imperial (mesa larga para muchos) u otra."),
    seats: z.number().nullable().describe("Plazas (sillas o comensales dibujados o escritos), de 1 a 30. null si no se ve."),
    x: z.number().describe("Centro de la mesa en horizontal, de 0 (borde izquierdo de la imagen) a 1 (borde derecho)."),
    y: z.number().describe("Centro de la mesa en vertical, de 0 (borde superior) a 1 (borde inferior)."),
  })).describe("Mesas de comensales del plano. No incluyas pistas de baile, barras, escenarios ni buffets."),
  notes: z.string().describe("Una frase en español de España para la pareja si algo no se ve claro; vacía si todo está claro."),
});
export type FloorPlanModelOutput = z.infer<typeof floorPlanModelSchema>;

export interface DetectedTable {
  /** Clave local de la fila («d1», «d2»…). */
  key: string;
  /** Mesa existente con el mismo nombre (se actualiza en lugar de crear otra). */
  id: string | null;
  name: string;
  shape: TableShape;
  seats: number;
  /** Centro en el plano, 0–1; null = sin posición. */
  x: number | null;
  y: number | null;
}

export interface FloorPlanReading {
  tables: DetectedTable[];
  notes: string;
}

const SHAPE_ALIASES: Record<string, TableShape> = {
  redonda: "redonda", round: "redonda", circular: "redonda", circulo: "redonda", "círculo": "redonda", ovalada: "redonda", oval: "redonda",
  rectangular: "rectangular", rectangle: "rectangular", rectangulo: "rectangular", "rectángulo": "rectangular",
  cuadrada: "cuadrada", square: "cuadrada", cuadrado: "cuadrada",
  imperial: "imperial", larga: "imperial", banquet: "imperial", long: "imperial",
};

export function normalizeShape(value: unknown): TableShape {
  if (typeof value !== "string") return "otra";
  return SHAPE_ALIASES[value.trim().toLocaleLowerCase("es")] ?? "otra";
}

export function clampSeats(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return TABLE_SEATS_DEFAULT;
  return Math.min(TABLE_SEATS_MAX, Math.max(TABLE_SEATS_MIN, Math.round(n)));
}

const unit = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return null;
  // Algunos modelos devuelven porcentajes (0–100): se pasan a 0–1. Un poco
  // por encima de 1 es un desborde y se recorta.
  const scaled = n > 2 && n <= 100 ? n / 100 : n;
  return Math.round(Math.min(1, Math.max(0, scaled)) * 1000) / 1000;
};

/** «3» → «Mesa 3»; recorta espacios y a 40 caracteres; vacío → null. */
export function tableNameFromLabel(label: unknown): string | null {
  const clean = normalizeTableName(typeof label === "string" ? label.replace(/[\u0000-\u001f]/g, " ") : label);
  if (!clean) return null;
  const named = /^\d{1,3}$/.test(clean) ? `Mesa ${Number(clean)}` : /^mesa\s*n?º?\s*(\d{1,3})$/i.test(clean) ? `Mesa ${Number(clean.match(/(\d{1,3})$/)![1])}` : clean;
  return named.slice(0, TABLE_NAME_MAX).trim();
}

const nameKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");

/** Salida del modelo (desconocida) → mesas limpias. Nunca lanza. */
export function normalizeFloorPlan(raw: unknown): FloorPlanReading {
  const parsed = z.object({ tables: z.array(z.unknown()).catch([]), notes: z.unknown().optional() }).catch({ tables: [], notes: "" }).parse(raw ?? {});
  const tables: DetectedTable[] = [];
  const used = new Set<string>();
  for (const item of parsed.tables) {
    if (tables.length >= MAX_TABLES) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    let name = tableNameFromLabel(row.label) ?? nextTableName(tables);
    if (used.has(nameKey(name))) {
      let n = 2;
      const base = name.slice(0, TABLE_NAME_MAX - 4).trim();
      while (used.has(nameKey(`${base} (${n})`))) n += 1;
      name = `${base} (${n})`;
    }
    used.add(nameKey(name));
    const x = unit(row.x), y = unit(row.y);
    tables.push({
      key: `d${tables.length + 1}`, id: null, name, shape: normalizeShape(row.shape), seats: clampSeats(row.seats),
      ...(x === null || y === null ? { x: null, y: null } : { x, y }),
    });
  }
  const notes = typeof parsed.notes === "string" ? parsed.notes.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return { tables, notes };
}

/** Une cada mesa leída con la existente del mismo nombre (sin mayúsculas ni tildes); cada existente, una vez. */
export function matchExistingTables(detected: readonly DetectedTable[], existing: readonly { id: string; name: string }[]): DetectedTable[] {
  const free = new Map(existing.map((table) => [nameKey(table.name), table.id]));
  return detected.map((row) => {
    const id = free.get(nameKey(row.name)) ?? null;
    if (id) free.delete(nameKey(row.name));
    return { ...row, id };
  });
}

/** Error de la lista revisada (o null si se puede guardar). */
export function floorPlanRowsError(rows: readonly DetectedTable[], existing: readonly { id: string; name: string }[]): string | null {
  if (rows.length === 0) return "No hay ninguna mesa que guardar.";
  const keys = new Set<string>();
  for (const row of rows) {
    const name = normalizeTableName(row.name);
    if (!name) return "Poned un nombre a cada mesa.";
    if (name.length > TABLE_NAME_MAX) return `El nombre de una mesa puede tener hasta ${TABLE_NAME_MAX} caracteres.`;
    if (keys.has(nameKey(name))) return `Hay dos mesas llamadas «${name}». Cambiad el nombre de una.`;
    keys.add(nameKey(name));
    if (!Number.isInteger(row.seats) || row.seats < TABLE_SEATS_MIN || row.seats > TABLE_SEATS_MAX) return `Cada mesa tiene de ${TABLE_SEATS_MIN} a ${TABLE_SEATS_MAX} plazas.`;
  }
  // Las mesas que no se tocan siguen ahí: su nombre tampoco puede repetirse.
  const touched = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  const clash = existing.find((table) => !touched.has(table.id) && keys.has(nameKey(table.name)));
  if (clash) return `Ya tenéis una mesa llamada «${clash.name}». Cambiad el nombre o elegid actualizarla.`;
  const created = rows.filter((row) => !row.id).length;
  if (existing.length + created > MAX_TABLES) return `Podéis tener hasta ${MAX_TABLES} mesas.`;
  return null;
}

/** Fila que se envía a `saveFloorPlan` / `save_floor_plan`. */
export interface FloorSaveRow { id: string | null; name: string; seats: number; shape: TableShape | null; x: number | null; y: number | null }
/** Mesa guardada que devuelve `save_floor_plan`. */
export interface SavedFloorTable extends FloorSaveRow { id: string; created: boolean }

/** Filas para `save_floor_plan`. */
export function toSaveRows(rows: readonly DetectedTable[]): FloorSaveRow[] {
  return rows.map((row) => ({ id: row.id, name: normalizeTableName(row.name) ?? row.name, seats: row.seats, shape: row.shape, x: row.x, y: row.y }));
}
