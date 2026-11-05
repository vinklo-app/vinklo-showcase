import { z } from "zod";

/*
 * Proveedores de la boda: agenda de contactos de la pareja. SIN DINERO.
 * Vinklo no cobra, no factura ni calcula importes aquí; `paymentNote` es un
 * texto libre que escribe la pareja. Independiente de la tabla legada
 * `vendors` (dormida). Mismas claves y límites que los CHECK de
 * supabase/migrations/20261005100000_wedding_vendor_contacts.sql.
 * Módulo puro: lo usan servidor y cliente.
 */

export const VENDOR_STATUSES = ["por_contactar", "contactado", "en_conversacion", "contratado", "descartado"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  por_contactar: "Por contactar",
  contactado: "Contactado",
  en_conversacion: "En conversación",
  contratado: "Contratado",
  descartado: "Descartado",
};

export const VENDOR_CATEGORIES = [
  "lugar", "catering", "fotografia", "video", "musica", "flores", "decoracion",
  "vestuario", "belleza", "tarta", "transporte", "papeleria", "otro",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  lugar: "Lugar",
  catering: "Catering",
  fotografia: "Fotografía",
  video: "Vídeo",
  musica: "Música",
  flores: "Flores",
  decoracion: "Decoración",
  vestuario: "Vestuario",
  belleza: "Peluquería y maquillaje",
  tarta: "Tarta",
  transporte: "Transporte",
  papeleria: "Papelería",
  otro: "Otro",
};

export const VENDOR_LIMITS = { name: 120, contactName: 120, phone: 20, email: 254, paymentNote: 300, notes: 1000 } as const;
/** Tope de proveedores por boda que lee la lista (holgado: una boda tiene ~10–30). */
export const VENDOR_LIST_LIMIT = 500;

export function isVendorStatus(value: unknown): value is VendorStatus {
  return typeof value === "string" && (VENDOR_STATUSES as readonly string[]).includes(value);
}
export function isVendorCategory(value: unknown): value is VendorCategory {
  return typeof value === "string" && (VENDOR_CATEGORIES as readonly string[]).includes(value);
}

const optionalText = (max: number, message: string) => z.string().trim().max(max, message).optional().default("");

export const vendorContactSchema = z.object({
  name: z.string().trim().min(1, "Escribid el nombre del proveedor.").max(VENDOR_LIMITS.name, `El nombre admite hasta ${VENDOR_LIMITS.name} caracteres.`),
  category: z.enum(VENDOR_CATEGORIES, "Elegid un tipo de proveedor de la lista.").optional().default("otro"),
  contactName: optionalText(VENDOR_LIMITS.contactName, `La persona de contacto admite hasta ${VENDOR_LIMITS.contactName} caracteres.`),
  phone: z.string().trim().max(VENDOR_LIMITS.phone, "Revisad el teléfono: máximo 20 caracteres.")
    .refine((value) => value === "" || value.length >= 6, "Revisad el teléfono: mínimo 6 caracteres.")
    .optional().default(""),
  email: z.string().trim().max(VENDOR_LIMITS.email, "Revisad el email.")
    .refine((value) => value === "" || z.email().safeParse(value).success, "Revisad el email: no parece válido.")
    .optional().default(""),
  status: z.enum(VENDOR_STATUSES, "Elegid un estado de la lista.").optional().default("por_contactar"),
  paymentNote: optionalText(VENDOR_LIMITS.paymentNote, `La nota de pagos admite hasta ${VENDOR_LIMITS.paymentNote} caracteres.`),
  notes: optionalText(VENDOR_LIMITS.notes, `Las notas admiten hasta ${VENDOR_LIMITS.notes} caracteres.`),
});
/** Lo que envía el formulario. Vacío ("") = sin dato. */
export type VendorContactInput = z.input<typeof vendorContactSchema>;
export type VendorContactValues = z.output<typeof vendorContactSchema>;

/** Valores validados → columnas de la tabla ("" → null). */
export function vendorContactColumns(values: VendorContactValues) {
  return {
    name: values.name,
    category: values.category,
    contact_name: values.contactName || null,
    phone: values.phone || null,
    email: values.email ? values.email.toLowerCase() : null,
    status: values.status,
    payment_note: values.paymentNote || null,
    notes: values.notes || null,
  };
}

/** Fila tal como la lee la UI (camelCase). */
export type VendorContact = {
  id: string;
  name: string;
  category: VendorCategory;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  status: VendorStatus;
  paymentNote: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export const VENDOR_CONTACT_COLUMNS = "id, name, category, contact_name, phone, email, status, payment_note, notes, created_at, updated_at";

const rowSchema = z.object({
  id: z.string(), name: z.string(), category: z.enum(VENDOR_CATEGORIES),
  contact_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(),
  status: z.enum(VENDOR_STATUSES), payment_note: z.string().nullable(), notes: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});

/** Filas de la base → VendorContact[]; null si la forma no es la esperada. */
export function parseVendorRows(data: unknown): VendorContact[] | null {
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id, name: row.name, category: row.category, contactName: row.contact_name, phone: row.phone,
    email: row.email, status: row.status, paymentNote: row.payment_note, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}
