/**
 * CSV de regalos y agradecimientos (puro). Mismas convenciones que el CSV de
 * invitados (guest-csv.ts): separador «;», CRLF, celdas con csvCell (comillas
 * y protección contra fórmulas); el BOM lo añade quien crea el Blob.
 *
 * Es lo que la pareja se lleva antes de la retención de 12 meses
 * (20261026100000): después, los regalos se quedan sin «quién» ni notas.
 */
import { CSV_TAG_SEPARATOR, csvCell } from "@/lib/messages/guest-csv";
import { GIFT_KIND_LABELS, type Gift } from "@/lib/crm/contract";
import { centsToDecimalComma } from "@/lib/format/money";

export type GiftCsvRow = Pick<Gift, "kind" | "amountCents" | "description" | "note" | "receivedOn" | "thankedAt" | "givers" | "createdAt">;

export type GiftCsvResult = { ok: true; csv: string; filename: string; rows: number } | { ok: false; error: string };

export const GIFT_CSV_FILENAME = "regalos-y-agradecimientos-vinklo.csv";

export const GIFT_CSV_HEADER = [
  "Fecha del regalo", "De parte de", "Tipo", "Importe (€)", "Descripción", "Notas",
  "Agradecido", "Fecha del agradecimiento", "Anotado el",
] as const;

/** 15000 → «150,00»; sin importe, celda vacía (0 € se escribe). */
function euros(cents: number | null): string {
  return typeof cents === "number" ? centsToDecimalComma(cents) : "";
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function buildGiftCsv(gifts: GiftCsvRow[]): string {
  const lines = gifts.map((gift) => [
    day(gift.receivedOn),
    csvCell(gift.givers.map((giver) => giver.name).join(CSV_TAG_SEPARATOR)),
    csvCell(GIFT_KIND_LABELS[gift.kind] ?? gift.kind),
    euros(gift.amountCents),
    csvCell(gift.description ?? ""),
    csvCell(gift.note ?? ""),
    gift.thankedAt ? "Sí" : "No",
    day(gift.thankedAt),
    day(gift.createdAt),
  ].join(";"));
  return `${[GIFT_CSV_HEADER.join(";"), ...lines].join("\r\n")}\r\n`;
}
