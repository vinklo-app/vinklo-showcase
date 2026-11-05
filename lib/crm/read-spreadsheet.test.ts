import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { decodeText, readSpreadsheet } from "./read-spreadsheet";
import { analyzeSheet, buildGuests } from "./guest-excel-import";

const asFile = (name: string, data: Uint8Array) => ({ name, size: data.byteLength, arrayBuffer: async () => data.slice().buffer as ArrayBuffer });

function workbook(bookType: XLSX.BookType): Uint8Array {
  const book = XLSX.utils.book_new();
  const guests = XLSX.utils.aoa_to_sheet([
    ["Invitados boda"],
    [],
    ["Nombre", "Móvil", "Asiste", "Mesa"],
    ["Ana y Pablo", 612345678, "sí", 3],
    ["Tía Puri", "+34 699 88 77 66", "", ""],
  ]);
  XLSX.utils.book_append_sheet(book, guests, "Novia");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Nombre"], ["Leo"]]), "Novio");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Vacía");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType }) as ArrayBuffer);
}

describe("lectura de hojas de cálculo", () => {
  for (const [ext, type] of [["xlsx", "xlsx"], ["xls", "biff8"], ["ods", "ods"]] as const) {
    it(`lee .${ext} con todas sus hojas (sin las vacías) y teléfonos numéricos como texto`, async () => {
      const result = await readSpreadsheet(asFile(`lista.${ext}`, workbook(type)));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sheets.map((s) => s.name)).toEqual(["Novia", "Novio"]);
      const built = buildGuests(result.sheets.map((sheet) => analyzeSheet(sheet)), { sheetAsGroup: true });
      expect(built.guests.map((g) => [g.name, g.phone, g.companion_names, g.group])).toEqual([
        ["Ana", "612 345 678", ["Pablo"], "Novia"],
        ["Tía Puri", "+34 699 887 766", [], "Novia"],
        ["Leo", null, [], "Novio"],
      ]);
    });
  }

  it("CSV de Excel en español: punto y coma y Windows-1252", async () => {
    // «Nombre;Teléfono\r\nMaría Núñez;612 345 678» en Windows-1252.
    const text = "Nombre;Teléfono;Alergias\r\nMaría Núñez;612 345 678;Sin lactosa\r\n";
    const bytes = Uint8Array.from([...text].map((ch) => ({ "é": 0xe9, "í": 0xed, "ú": 0xfa, "ñ": 0xf1 } as Record<string, number>)[ch] ?? ch.charCodeAt(0)));
    expect(decodeText(bytes)).toBe(text);
    const result = await readSpreadsheet(asFile("lista.csv", bytes));
    expect(result.ok && result.sheets[0].rows).toEqual([["Nombre", "Teléfono", "Alergias"], ["María Núñez", "612 345 678", "Sin lactosa"]]);
  });

  it("CSV UTF-8 con BOM y comas", async () => {
    const bytes = new TextEncoder().encode("﻿Name,Phone\nJosé,+34 611 222 333\n");
    const result = await readSpreadsheet(asFile("guests.csv", bytes));
    expect(result.ok && result.sheets[0].rows).toEqual([["Name", "Phone"], ["José", "+34 611 222 333"]]);
  });

  it("rechaza tipos, vacíos, archivos grandes y basura", async () => {
    expect(await readSpreadsheet(asFile("foto.jpg", new Uint8Array([1])))).toMatchObject({ ok: false });
    expect(await readSpreadsheet(asFile("lista.xlsx", new Uint8Array()))).toMatchObject({ ok: false, error: expect.stringContaining("vacío") });
    expect(await readSpreadsheet({ name: "lista.xlsx", size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) })).toMatchObject({ ok: false, error: expect.stringContaining("5 MB") });
    expect(await readSpreadsheet(asFile("lista.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])))).toMatchObject({ ok: false });
  });
});
