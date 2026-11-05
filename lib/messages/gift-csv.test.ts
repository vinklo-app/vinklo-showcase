import { describe, expect, it } from "vitest";
import { buildGiftCsv, GIFT_CSV_HEADER, type GiftCsvRow } from "./gift-csv";

const gift = (over: Partial<GiftCsvRow> = {}): GiftCsvRow => ({
  kind: "bizum", amountCents: 15000, description: null, note: null, receivedOn: "2026-05-01",
  thankedAt: "2026-05-10T10:00:00+00:00", createdAt: "2026-05-02T09:00:00+00:00",
  givers: [{ guestId: "g1", name: "Tía Puri" }, { guestId: "g2", name: "Tío Pepe" }],
  ...over,
});

const lines = (csv: string) => csv.split("\r\n");

describe("buildGiftCsv", () => {
  it("vacío: solo la cabecera, con «;» y CRLF final", () => {
    const csv = buildGiftCsv([]);
    expect(csv).toBe(`${GIFT_CSV_HEADER.join(";")}\r\n`);
    expect(csv.startsWith("﻿")).toBe(false);
  });

  it("columnas: fecha, quién, tipo, importe, descripción, notas, agradecido y fechas", () => {
    expect(GIFT_CSV_HEADER).toEqual([
      "Fecha del regalo", "De parte de", "Tipo", "Importe (€)", "Descripción", "Notas",
      "Agradecido", "Fecha del agradecimiento", "Anotado el",
    ]);
    const [, first] = lines(buildGiftCsv([gift({ note: "Para el viaje" })]));
    expect(first).toBe("2026-05-01;\"Tía Puri · Tío Pepe\";\"Bizum\";150,00;\"\";\"Para el viaje\";Sí;2026-05-10;2026-05-02");
    expect(first.split(";")).toHaveLength(GIFT_CSV_HEADER.length);
  });

  it("sin agradecer, sin importe y sin fecha", () => {
    const [, first] = lines(buildGiftCsv([gift({ kind: "objeto", amountCents: null, receivedOn: null, thankedAt: null, description: "Vajilla" })]));
    expect(first).toBe(";\"Tía Puri · Tío Pepe\";\"Un regalo\";;\"Vajilla\";\"\";No;;2026-05-02");
  });

  it("importe 0 se escribe; regalo ya anonimizado sale sin quién", () => {
    const [, first] = lines(buildGiftCsv([gift({ amountCents: 0, givers: [] })]));
    expect(first.split(";").slice(1, 4)).toEqual(["\"\"", "\"Bizum\"", "0,00"]);
  });

  it("escapa «;», comillas y saltos de línea, y desactiva fórmulas", () => {
    const csv = buildGiftCsv([gift({
      givers: [{ guestId: "g1", name: "=HYPERLINK(\"x\")" }],
      note: "Gracias; \"mil\"\nde verdad",
      description: "+34 600",
    })]);
    const body = csv.slice(csv.indexOf("\r\n") + 2);
    expect(body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(body).toContain(`"Gracias; ""mil""\nde verdad"`);
    expect(body).toContain(";\"'+34 600\";");
  });
});
