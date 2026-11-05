/**
 * Proveedores en el panel: reglas puras (sin React) que comparten la lista,
 * el resumen de /panel y el borrador. SIN DINERO: `paymentNote` es un texto
 * de la pareja y aquí no se lee como importe ni se suma nada.
 */
import {
  VENDOR_STATUSES, VENDOR_STATUS_LABELS, VENDOR_CATEGORY_LABELS,
  type VendorContact, type VendorContactInput, type VendorStatus,
} from "@/lib/vendors/contacts";

/** Tono visual de cada estado. Oliva solo para «contratado» (éxito, DESIGN.md §6). */
export type VendorTone = "done" | "talking" | "contacted" | "todo" | "dropped";
export const VENDOR_TONES: Record<VendorStatus, VendorTone> = {
  contratado: "done",
  en_conversacion: "talking",
  contactado: "contacted",
  por_contactar: "todo",
  descartado: "dropped",
};

/** Orden de la barra y de la leyenda: de cerrado a pendiente; descartados al final. */
export const VENDOR_STAGE_ORDER: readonly VendorStatus[] = ["contratado", "en_conversacion", "contactado", "por_contactar", "descartado"];

export type VendorCounts = Record<VendorStatus, number> & { total: number };

/** Lo mismo que `wedding_vendor_summary`, calculado sobre la lista ya cargada. */
export function countVendors(contacts: ReadonlyArray<Pick<VendorContact, "status">>): VendorCounts {
  const counts = Object.fromEntries(VENDOR_STATUSES.map((status) => [status, 0])) as Record<VendorStatus, number>;
  for (const contact of contacts) counts[contact.status] += 1;
  return { ...counts, total: contacts.length };
}

/** Proveedores que siguen en juego (sin los descartados). */
export function activeVendors(counts: VendorCounts): number {
  return counts.total - counts.descartado;
}

/** Ficha → lo que espera `updateVendorContact` (sustituye la fila entera; null → ""). */
export function toVendorInput(contact: VendorContact, patch: Partial<VendorContactInput> = {}): VendorContactInput {
  return {
    name: contact.name,
    category: contact.category,
    contactName: contact.contactName ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    status: contact.status,
    paymentNote: contact.paymentNote ?? "",
    notes: contact.notes ?? "",
    ...patch,
  };
}

/** Línea secundaria de la fila: «Fotografía · Marta Ruiz» (sin guion huérfano si falta la persona). */
export function vendorSubline(contact: Pick<VendorContact, "category" | "contactName">): string {
  const category = VENDOR_CATEGORY_LABELS[contact.category];
  const person = contact.contactName?.trim();
  return person ? `${category} · ${person}` : category;
}

/** Filtros de la lista: «todos» o un estado. */
export type VendorFilter = "todos" | VendorStatus;
export function isVendorFilter(value: unknown): value is VendorFilter {
  return value === "todos" || (typeof value === "string" && (VENDOR_STATUSES as readonly string[]).includes(value));
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-ES");
}

/** Búsqueda sin tildes por nombre, persona de contacto, tipo, teléfono o email. */
export function matchesVendor(contact: VendorContact, filter: VendorFilter, query: string): boolean {
  if (filter !== "todos" && contact.status !== filter) return false;
  const needle = fold(query.trim());
  if (!needle) return true;
  const haystack = [contact.name, contact.contactName, VENDOR_CATEGORY_LABELS[contact.category], contact.phone, contact.email].filter(Boolean).join(" ");
  return fold(haystack).includes(needle);
}

/** «1 proveedor» / «3 proveedores» (singular solo con 1). */
export function vendorsLabel(count: number): string {
  return count === 1 ? "proveedor" : "proveedores";
}

/** Etiqueta de estado en plural para la leyenda: «2 contratados». */
export const VENDOR_STATUS_PLURAL: Record<VendorStatus, [string, string]> = {
  contratado: ["contratado", "contratados"],
  en_conversacion: ["en conversación", "en conversación"],
  contactado: ["contactado", "contactados"],
  por_contactar: ["por contactar", "por contactar"],
  descartado: ["descartado", "descartados"],
};
export function statusCountLabel(status: VendorStatus, count: number): string {
  const [one, many] = VENDOR_STATUS_PLURAL[status];
  return count === 1 ? one : many;
}

export { VENDOR_STATUS_LABELS };
