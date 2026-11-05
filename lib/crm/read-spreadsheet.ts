/**
 * Lee un Excel/ODS/CSV en el navegador y lo devuelve como hojas de texto
 * (lo que se ve en cada celda). El lector (@e965/xlsx, SheetJS 0.20.3,
 * Apache-2.0: xlsx, xls, ods y csv) se carga con import() SOLO al elegir un
 * archivo: no entra en el paquete de ninguna página. El archivo nunca sale
 * del navegador; al servidor solo llegan las invitaciones confirmadas.
 */
import { EXCEL_MAX_BYTES, EXCEL_MAX_ROWS, type RawSheet } from "@/lib/crm/guest-excel-import";

export type ReadResult = { ok: true; sheets: RawSheet[] } | { ok: false; error: string };

const TEXT_TYPES = /\.(csv|tsv|txt)$/i;
const SHEET_TYPES = /\.(xlsx|xlsm|xls|ods|csv|tsv|txt)$/i;
/** Margen para títulos y filas vacías por encima del tope de invitaciones. */
const ROW_LIMIT = EXCEL_MAX_ROWS + 200;

/**
 * Texto de un CSV: UTF-8 (con o sin BOM) y, si no lo es, Windows-1252 (el
 * «CSV (delimitado por comas)» de Excel en español guarda así las tildes).
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Celdas → texto, sin filas finales vacías. */
function cleanRows(rows: unknown[][]): string[][] {
  const out = rows.map((row) => (Array.isArray(row) ? row.map((value) => (value === null || value === undefined ? "" : String(value))) : []));
  while (out.length > 0 && out[out.length - 1].every((value) => value.trim() === "")) out.pop();
  return out;
}

export async function readSpreadsheet(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ReadResult> {
  if (!SHEET_TYPES.test(file.name)) return { ok: false, error: "Elegid un Excel (.xlsx o .xls), una hoja de LibreOffice (.ods) o un CSV." };
  if (file.size === 0) return { ok: false, error: "El archivo está vacío." };
  if (file.size > EXCEL_MAX_BYTES) return { ok: false, error: "El archivo pesa más de 5 MB. Quitad las hojas que no sean de invitados o guardadlo como CSV." };
  let XLSX: typeof import("@e965/xlsx");
  try {
    XLSX = await import("@e965/xlsx");
  } catch {
    return { ok: false, error: "No hemos podido preparar el lector de Excel. Comprobad la conexión y probad de nuevo." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const workbook = TEXT_TYPES.test(file.name)
      ? XLSX.read(decodeText(bytes), { type: "string", raw: true, sheetRows: ROW_LIMIT + 1 })
      : XLSX.read(bytes, { type: "array", sheetRows: ROW_LIMIT + 1 });
    const sheets: RawSheet[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      // raw: false = el texto que se ve (teléfonos sin «6.12E+08», fechas como en la hoja).
      const rows = cleanRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true }));
      if (rows.length > ROW_LIMIT) return { ok: false, error: `La hoja «${name}» tiene más de ${EXCEL_MAX_ROWS.toLocaleString("es-ES")} filas. Importadla en varias partes.` };
      if (rows.some((row) => row.some((value) => value.trim() !== ""))) sheets.push({ name, rows });
    }
    if (sheets.length === 0) return { ok: false, error: "No hemos encontrado datos en el archivo." };
    return { ok: true, sheets };
  } catch {
    return { ok: false, error: "No hemos podido leer el archivo. Si tiene contraseña, quitádsela; si no, guardadlo de nuevo como .xlsx o CSV." };
  }
}
