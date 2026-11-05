import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, markDuplicates, nameKey, parseGuestList, parseLine, phoneKey, rowProblem, rowsFromContacts, tooManyRowsMessage } from "./guest-import";

describe("parseLine", () => {
  it.each([
    ["Marta Díaz, 612345678", "Marta Díaz", "612345678"],
    ["Marta Díaz; 612 345 678", "Marta Díaz", "612 345 678"],
    ["Pedro Gil\t+34 699 000 222", "Pedro Gil", "+34 699 000 222"],
    ["Carlos Méndez\t\t699 444 333\tmesa 2", "Carlos Méndez", "699 444 333"],
    ["Rosa y Manolo 655 123 456", "Rosa y Manolo", "655 123 456"],
    ["Hugo +44 7700 900123", "Hugo", "+44 7700 900123"],
    ["   Dani    Araújo    666 777 888   ", "Dani Araújo", "666 777 888"],
    ["- Abuelo Paco", "Abuelo Paco", ""],
    ["2. Elena Ruiz; 0034 611 999 888", "Elena Ruiz", "0034 611 999 888"],
    ["\"Los primos de Albacete\"", "Los primos de Albacete", ""],
    ["García, Ana", "García, Ana", ""],
    ["Vecina del 3.º B, 12", "Vecina del 3.º B, 12", ""],
    ["Juan 2", "Juan 2", ""],
    ["612345678", "", "612345678"],
    ["👰🏽‍♀️ Tía Encarni 699 111 222", "👰🏽‍♀️ Tía Encarni", "699 111 222"],
  ])("%s", (line, name, phone) => {
    expect(parseLine(line)).toEqual({ name, phone });
  });

  it("acorta teléfonos que no caben en 20 caracteres quitando separadores", () => {
    expect(parseLine("Bea, +34 (600) 000 - 000 - 12").phone.length).toBeLessThanOrEqual(20);
  });
});

describe("parseGuestList", () => {
  it("ignora líneas vacías y una cabecera Nombre/Teléfono", () => {
    const rows = parseGuestList("Nombre, Teléfono\r\n\nLucía, 612000111\n   \nAbuelo Paco\n");
    expect(rows).toEqual([{ name: "Lucía", phone: "612000111" }, { name: "Abuelo Paco", phone: "" }]);
  });
  it("no trata como cabecera a un invitado que se llame Nombre en otra línea", () => {
    expect(parseGuestList("Ana\nNombre Teléfono Raro")).toHaveLength(2);
  });
});

describe("rowProblem", () => {
  it("acepta solo nombre, emoji y alfabetos no latinos", () => {
    expect(rowProblem({ name: "Abuela Carmen", phone: "" })).toBeNull();
    expect(rowProblem({ name: "🎉🎉🎉", phone: "" })).toBeNull();
    expect(rowProblem({ name: "Αλέξανδρος", phone: "+30 694 123 4567" })).toBeNull();
  });
  it("marca lo que el servidor rechazaría y la basura", () => {
    expect(rowProblem({ name: "", phone: "612345678" })).toBe("Falta el nombre.");
    expect(rowProblem({ name: "J", phone: "" })).toMatch(/mínimo 2/);
    expect(rowProblem({ name: "x".repeat(121), phone: "" })).toMatch(/demasiado largo/);
    expect(rowProblem({ name: "-----", phone: "" })).toMatch(/no parece un nombre/);
    expect(rowProblem({ name: "Jo", phone: "6" })).toMatch(/teléfono/);
    expect(rowProblem({ name: "Jo", phone: "6".repeat(21) })).toMatch(/teléfono/);
  });
});

describe("markDuplicates", () => {
  const existing = [{ name: "Tía Puri", phone: "645 300 200" }, { name: "Marta Díaz", phone: "+34 612 345 678" }];
  it("mismo nombre normalizado o mismo teléfono en otro formato", () => {
    const marks = markDuplicates([
      { name: "tia  puri", phone: "" },
      { name: "Marta", phone: "0034 612345678" },
      { name: "Nueva", phone: "" },
    ], existing);
    expect(marks[0]).toMatchObject({ kind: "existing", match: "Tía Puri", by: "name" });
    expect(marks[1]).toMatchObject({ kind: "existing", match: "Marta Díaz", by: "phone" });
    expect(marks[2]).toBeNull();
  });
  it("dentro del lote solo desde la segunda aparición", () => {
    const marks = markDuplicates([{ name: "Ana", phone: "600111222" }, { name: "Ana B", phone: "+34 600 111 222" }, { name: "ana", phone: "" }], []);
    expect(marks[0]).toBeNull();
    expect(marks[1]).toMatchObject({ kind: "batch", by: "phone", match: "Ana" });
    expect(marks[2]).toMatchObject({ kind: "batch", by: "name" });
  });
  it("teléfonos cortos no cuentan como repetidos", () => {
    expect(phoneKey("12")).toBeNull();
    expect(markDuplicates([{ name: "A1", phone: "12" }, { name: "B2", phone: "12" }], [])).toEqual([null, null]);
  });
  it("normaliza tildes y signos", () => {
    expect(nameKey("  Íñigo  Etxeberria! ")).toBe("inigo etxeberria");
  });
});

describe("rowsFromContacts", () => {
  it("primer nombre y primer teléfono; sin teléfono sigue siendo válido; vacíos fuera", () => {
    expect(rowsFromContacts([
      { name: ["Lucía"], tel: ["+34 612 000 111", "91 555 00 11"] },
      { name: ["Abuela Carmen"], tel: [] },
      { name: [], tel: [] },
      { name: [" "], tel: ["633 999 000"] },
    ])).toEqual([
      { name: "Lucía", phone: "+34 612 000 111" },
      { name: "Abuela Carmen", phone: "" },
      { name: "", phone: "633 999 000" },
    ]);
  });
});

it("mensaje del tope con separador de miles", () => {
  expect(tooManyRowsMessage(1284)).toContain("1.284");
  expect(tooManyRowsMessage(MAX_IMPORT_ROWS + 1)).toContain(String(MAX_IMPORT_ROWS));
});
