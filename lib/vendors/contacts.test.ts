import { describe, expect, it } from "vitest";
import {
  isVendorCategory, isVendorStatus, parseVendorRows, VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, VENDOR_STATUSES,
  VENDOR_STATUS_LABELS, vendorContactColumns, vendorContactSchema,
} from "./contacts";

describe("vendorContactSchema", () => {
  it("solo el nombre es obligatorio; el resto toma valores por defecto", () => {
    const parsed = vendorContactSchema.parse({ name: "  Finca El Olivar " });
    expect(parsed).toEqual({ name: "Finca El Olivar", category: "otro", contactName: "", phone: "", email: "", status: "por_contactar", paymentNote: "", notes: "" });
    expect(vendorContactColumns(parsed)).toEqual({ name: "Finca El Olivar", category: "otro", contact_name: null, phone: null, email: null, status: "por_contactar", payment_note: null, notes: null });
  });
  it("normaliza el email y conserva la nota de pagos como texto", () => {
    const parsed = vendorContactSchema.parse({ name: "Foto Luz", category: "fotografia", email: " Marta@Example.com ", phone: "612 345 678", status: "contratado", paymentNote: "Señal 30 % antes del 1 de marzo" });
    expect(vendorContactColumns(parsed)).toMatchObject({ email: "marta@example.com", phone: "612 345 678", payment_note: "Señal 30 % antes del 1 de marzo" });
  });
  it.each([
    [{ name: "   " }, "Escribid el nombre del proveedor."],
    [{ name: "x".repeat(121) }, "El nombre admite hasta 120 caracteres."],
    [{ name: "DJ", phone: "123" }, "Revisad el teléfono: mínimo 6 caracteres."],
    [{ name: "DJ", phone: "6".repeat(21) }, "Revisad el teléfono: máximo 20 caracteres."],
    [{ name: "DJ", email: "sin-arroba" }, "Revisad el email: no parece válido."],
    [{ name: "DJ", status: "pagado" }, "Elegid un estado de la lista."],
    [{ name: "DJ", category: "banco" }, "Elegid un tipo de proveedor de la lista."],
    [{ name: "DJ", paymentNote: "x".repeat(301) }, "La nota de pagos admite hasta 300 caracteres."],
    [{ name: "DJ", notes: "x".repeat(1001) }, "Las notas admiten hasta 1000 caracteres."],
  ])("rechaza %o con mensaje en español", (input, message) => {
    const parsed = vendorContactSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(message);
  });
  it("acepta los máximos exactos", () => {
    expect(vendorContactSchema.safeParse({ name: "x".repeat(120), paymentNote: "x".repeat(300), notes: "x".repeat(1000), phone: "6".repeat(20) }).success).toBe(true);
  });
});

describe("constantes y filas", () => {
  it("cada estado y categoría tiene etiqueta; ningún estado habla de pagos", () => {
    expect(Object.keys(VENDOR_STATUS_LABELS)).toEqual([...VENDOR_STATUSES]);
    expect(Object.keys(VENDOR_CATEGORY_LABELS)).toEqual([...VENDOR_CATEGORIES]);
    for (const status of VENDOR_STATUSES) expect(status).not.toMatch(/pag|cobr|factur|abon/);
    expect(isVendorStatus("en_conversacion")).toBe(true);
    expect(isVendorStatus("pagado")).toBe(false);
    expect(isVendorCategory("fotografia")).toBe(true);
    expect(isVendorCategory(3)).toBe(false);
  });
  it("parseVendorRows pasa a camelCase y rechaza formas inesperadas", () => {
    const row = { id: "a", name: "DJ Sol", category: "musica", contact_name: null, phone: null, email: null, status: "contratado", payment_note: "Resto el día de la boda", notes: null, created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T11:00:00Z" };
    expect(parseVendorRows([row])).toEqual([{ id: "a", name: "DJ Sol", category: "musica", contactName: null, phone: null, email: null, status: "contratado", paymentNote: "Resto el día de la boda", notes: null, createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T11:00:00Z" }]);
    expect(parseVendorRows(null)).toEqual([]);
    expect(parseVendorRows([{ ...row, status: "pagado" }])).toBeNull();
  });
});
