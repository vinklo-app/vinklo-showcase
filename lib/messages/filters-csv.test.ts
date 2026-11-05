import { describe, expect, it } from "vitest";
import { CRM_GUEST_FILTERS, CRM_GUEST_FILTER_LABELS, GUEST_FILTERS, GUEST_FILTER_LABELS, isLegacyGuestStatus, normalizeGuestFilter, normalizeGuestListFilter } from "./filters";
import { buildGuestCsv, csvCell, guestMenuCell, GUEST_CSV_HEADER, type GuestCsvRow } from "./guest-csv";

describe("claves de filtro", () => {
  it("acepta las claves nuevas tal cual", () => {
    for (const key of GUEST_FILTERS) expect(normalizeGuestFilter(key)).toBe(key);
    expect(normalizeGuestFilter("sin_respuesta")).toBe("sin_respuesta");
  });
  it("traduce los valores antiguos de ?status=", () => {
    expect(normalizeGuestFilter("pendiente")).toBe("sin_respuesta");
    expect(normalizeGuestFilter("si")).toBe("vienen");
    expect(normalizeGuestFilter("no")).toBe("no_vienen");
    expect(isLegacyGuestStatus("si")).toBe(true);
    expect(isLegacyGuestStatus("vienen")).toBe(false);
  });
  it.each([undefined, null, 3, "", "TODOS", "'; drop table", "__proto__", "toString"])("desconocido %j → todos", (value) => {
    expect(normalizeGuestFilter(value)).toBe("todos");
  });
  it("cada chip tiene etiqueta", () => {
    expect(Object.keys(GUEST_FILTER_LABELS)).toEqual([...GUEST_FILTERS]);
  });
});

const row = (over: Partial<GuestCsvRow> = {}): GuestCsvRow => ({
  name: "Ana", phone: "612345678", rsvp_status: "si", rsvp_companions: 2, rsvp_notes: null,
  invitation_prepared_at: "2026-10-01T10:00:00+00:00", invitation_sent_at: "2026-10-02T10:00:00+00:00",
  last_reminder_at: null, reminder_count: 0, reminders_opt_out: false, ...over,
});

describe("filtros del CRM", () => {
  it("se aceptan sin añadir chips a GUEST_FILTERS", () => {
    for (const key of CRM_GUEST_FILTERS) {
      expect(normalizeGuestListFilter(key)).toBe(key);
      // El normalizador de los chips de siempre no los conoce (no cambia su tipo).
      expect(normalizeGuestFilter(key)).toBe("todos");
    }
    expect(normalizeGuestListFilter("si")).toBe("vienen");
    expect(normalizeGuestListFilter("???")).toBe("todos");
    expect(Object.keys(CRM_GUEST_FILTER_LABELS)).toEqual([...CRM_GUEST_FILTERS]);
    expect(GUEST_FILTERS.some((key) => (CRM_GUEST_FILTERS as readonly string[]).includes(key))).toBe(false);
  });
});

describe("CSV", () => {
  it("añade al final una columna por campo propio del Excel (títulos y valores neutralizados)", () => {
    const lines = buildGuestCsv([
      row({ extra_fields: { Email: "ana@ejemplo.es", Mesa: "3" } }),
      row({ extra_fields: { Mesa: "=1+1", "Grupo": "Uni" } }),
      row(),
    ]).split("\r\n");
    expect(lines[0].endsWith(`;Otras notas del invitado;"Email";"Mesa";"Grupo (importado)"`)).toBe(true);
    expect(lines[1].endsWith(`;"ana@ejemplo.es";"3";""`)).toBe(true);
    expect(lines[2].endsWith(`;"";"'=1+1";"Uni"`)).toBe(true);
    expect(lines[3].endsWith(`;"";"";""`)).toBe(true);
    // Sin campos propios, el archivo es el de siempre.
    expect(buildGuestCsv([row()]).split("\r\n")[0]).toBe(GUEST_CSV_HEADER.join(";"));
  });
  it("apertura, estado del regalo e importe en euros", () => {
    const csv = buildGuestCsv([
      row({ invitation_opened_at: "2026-10-04T09:00:00+00:00", gift_count: 2, gift_total_cents: 15050, gift_none: false }),
      row({ gift_none: true, group_name: "Familia de Elena" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1].endsWith(";2026-10-04;Sí;150,50;\"\";;\"\";;\"\"")).toBe(true);
    expect(lines[2].endsWith(";;Sin regalo;;\"Familia de Elena\";;\"\";;\"\"")).toBe(true);
  });
  it("lado con los nombres de la pareja y etiquetas separadas por « · » al final", () => {
    expect(GUEST_CSV_HEADER.slice(-4)).toEqual(["Lado", "Etiquetas", "Acompañantes máx.", "Otras notas del invitado"]);
    const csv = buildGuestCsv([row({ side: "p1", tags: ["Uni", "=Trabajo"] }), row({ side: "ambos" }), row({ side: "p2" })], { p1: "De Lucía", p2: "De Juan", ambos: "De los dos" });
    const lines = csv.split("\r\n");
    expect(lines[1].endsWith(";\"De Lucía\";\"Uni · =Trabajo\";;\"\"")).toBe(true);
    expect(lines[2].endsWith(";\"De los dos\";\"\";;\"\"")).toBe(true);
    expect(lines[3].endsWith(";\"De Juan\";\"\";;\"\"")).toBe(true);
    // Una etiqueta que empieza por fórmula al principio de la celda se neutraliza.
    expect(buildGuestCsv([row({ tags: ["=1+1"] })]).split("\r\n")[1].endsWith(";\"'=1+1\";;\"\"")).toBe(true);
  });
  it("tope de acompañantes en la penúltima columna: número, 0 = solo esa persona, vacío = sin límite", () => {
    const lines = buildGuestCsv([row({ max_companions: 2 }), row({ max_companions: 0 }), row({ max_companions: null }), row()]).split("\r\n");
    expect(lines[1].endsWith(";2;\"\"")).toBe(true);
    expect(lines[2].endsWith(";0;\"\"")).toBe(true);
    expect(lines[3].endsWith(";\"\";;\"\"")).toBe(true);
    expect(lines[4].endsWith(";\"\";;\"\"")).toBe(true);
  });
  it("nota logística del invitado en la última columna (20261030100000), neutralizada como el resto", () => {
    const lines = buildGuestCsv([row({ rsvp_logistic_notes: "Vamos con carrito" }), row({ rsvp_logistic_notes: "=1+1" }), row()]).split("\r\n");
    expect(lines[1].endsWith(";\"Vamos con carrito\"")).toBe(true);
    expect(lines[2].endsWith(";\"'=1+1\"")).toBe(true);
    expect(lines[3].endsWith(";\"\"")).toBe(true);
  });
  it("con menú en la web, columna «Menú» al final con lo elegido o «Aviso: sin menú» (P1-6)", () => {
    const labels = { stops: {}, hotels: {}, menu: { "m-1": "Carne", "m-2": "Pescado" } };
    const lines = buildGuestCsv([
      row({ rsvp_answers: { menu: { "m-1": 2, "m-2": 1 } } }),
      row({ rsvp_answers: null }),
      row({ rsvp_answers: { menu: { "m-1": 2 } } }),
      row({ rsvp_status: "no", rsvp_answers: null }),
      row({ rsvp_status: "pendiente" }),
    ], undefined, labels).split("\r\n");
    expect(lines[0]).toBe([...GUEST_CSV_HEADER, "Menú"].join(";"));
    expect(lines[1].endsWith(";\"2 Carne, 1 Pescado\"")).toBe(true);
    expect(lines[2].endsWith(";\"Aviso: sin menú\"")).toBe(true);
    expect(lines[3].endsWith(";\"2 Carne · Aviso: falta el menú de 1 persona\"")).toBe(true);
    // Quien no viene (o no ha respondido) no come: celda vacía, sin aviso.
    expect(lines[4].endsWith(";\"\"")).toBe(true);
    expect(lines[5].endsWith(";\"\"")).toBe(true);
    expect(guestMenuCell({ rsvp_status: "si", rsvp_companions: 0 }, labels)).toBe("Aviso: sin menú");
  });
  it("alergias y dietas marcadas (ítem 21): columna solo si alguien marcó algo; quien no viene, vacía", () => {
    const lines = buildGuestCsv([
      row({ rsvp_status: "si", rsvp_companions: 1, rsvp_notes: "Tú: celiaquía; Pablo: celiaquía", rsvp_answers: { diet: { vegetariano: 1 } } }),
      row({ rsvp_status: "si", rsvp_notes: "Soy celíaca" }),
      row({ rsvp_status: "no", rsvp_notes: "Tú: celiaquía" }),
    ]).split("\r\n");
    expect(lines[0]).toBe([...GUEST_CSV_HEADER, "Alergias y dietas marcadas"].join(";"));
    expect(lines[1].endsWith(';"2 sin gluten · 1 vegetariano"')).toBe(true);
    // Una nota escrita a mano no se interpreta: la celda va vacía (la nota sigue en su columna).
    expect(lines[2].endsWith(';""')).toBe(true);
    expect(lines[3].endsWith(';""')).toBe(true);
    expect(buildGuestCsv([row({ rsvp_status: "si", rsvp_notes: "Soy celíaca" })]).split("\r\n")[0]).toBe(GUEST_CSV_HEADER.join(";"));
  });
  it("sin menú en la web, el archivo no cambia (sin columna «Menú»)", () => {
    const csv = buildGuestCsv([row({ rsvp_answers: null })]);
    expect(csv.split("\r\n")[0]).toBe(GUEST_CSV_HEADER.join(";"));
    expect(csv).not.toContain("Aviso: sin menú");
  });
  it.each([["=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\""], ["+34 612", "\"'+34 612\""], ["-1", "\"'-1\""], ["@SUM(A1)", "\"'@SUM(A1)\""], ["\tx", "\"'\tx\""], ["Ana; Luis", "\"Ana; Luis\""], ["normal", "\"normal\""], ["di \"hola\"", "\"di \"\"hola\"\"\""], ["", "\"\""]])("neutraliza %j", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
  it("cabecera, filas, separador ; y fin de línea CRLF; sin tokens", () => {
    const csv = buildGuestCsv([row(), row({ name: "=cmd|' /C calc'!A0", rsvp_status: "no", rsvp_companions: 3, rsvp_notes: "Sin gluten\ny sin lactosa", reminders_opt_out: true, reminder_count: 2, last_reminder_at: "2026-10-03T08:00:00+00:00" })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(GUEST_CSV_HEADER.join(";"));
    expect(lines[1]).toBe("\"Ana\";\"612345678\";\"Asiste\";2;\"\";2026-10-01;2026-10-02;;0;No;;Sin indicar;;\"\";;\"\";;\"\"");
    expect(csv).toContain("\"'=cmd|' /C calc'!A0\";\"612345678\";\"No asiste\";0;\"Sin gluten\ny sin lactosa\";2026-10-01;2026-10-02;2026-10-03;2;Sí;;Sin indicar;;\"\";;\"\";;\"\"");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/invitacion=|token/i);
  });
});
