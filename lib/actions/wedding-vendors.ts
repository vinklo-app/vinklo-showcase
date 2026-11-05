"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import {
  parseVendorRows, VENDOR_CONTACT_COLUMNS, VENDOR_LIST_LIMIT, vendorContactColumns, vendorContactSchema,
  type VendorContact, type VendorContactInput,
} from "@/lib/vendors/contacts";

/*
 * Proveedores de la boda (agenda de contactos). SIN DINERO: aquí no se cobra,
 * no se factura ni se calcula ningún importe. Tabla `wedding_vendor_contacts`
 * (no la legada `vendors`). Constantes, schema y tipos: lib/vendors/contacts.ts
 * (en un archivo "use server" cada export es un endpoint).
 */

export type VendorActionResult = { ok: true } | { ok: false; error: string };
export type AddVendorContactResult = { ok: true; id: string } | { ok: false; error: string };
export type ListVendorContactsResult = { ok: true; contacts: VendorContact[] } | { ok: false; error: string };

const GENERIC_ERROR = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";
const SESSION_ERROR = "Volved a entrar para gestionar vuestra boda.";
const LOAD_ERROR = "No hemos podido cargar los proveedores. Probad de nuevo.";
const GONE_ERROR = "No se ha guardado: el proveedor ya no está disponible.";

/** La boda de la sesión: un único sitio (lib/data/current-wedding, R06). */
async function ownWedding() {
  const current = await getCurrentWedding();
  return current ? { supabase: current.supabase, wedding: { id: current.wedding.id } } : null;
}
function refresh() { revalidatePath("/panel/proveedores"); revalidatePath("/panel"); }
function invalid(error: z.ZodError) { return { ok: false as const, error: error.issues[0]?.message ?? GENERIC_ERROR }; }

/** Proveedores de la boda de la sesión, en orden de alta (created_at, id). */
export async function listVendorContacts(): Promise<ListVendorContactsResult> {
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_vendor_contacts")
      .select(VENDOR_CONTACT_COLUMNS).eq("wedding_id", context.wedding.id)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(VENDOR_LIST_LIMIT);
    if (error) return { ok: false, error: LOAD_ERROR };
    const contacts = parseVendorRows(data);
    return contacts ? { ok: true, contacts } : { ok: false, error: LOAD_ERROR };
  } catch { return { ok: false, error: LOAD_ERROR }; }
}

export async function addVendorContact(input: VendorContactInput): Promise<AddVendorContactResult> {
  const parsed = vendorContactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_vendor_contacts")
      .insert({ wedding_id: context.wedding.id, ...vendorContactColumns(parsed.data) }).select("id").maybeSingle();
    const row = data as { id: string } | null;
    if (error || !row) return { ok: false, error: GENERIC_ERROR };
    refresh();
    return { ok: true, id: row.id };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

/** Sustituye todos los campos editables (el formulario envía la ficha entera). */
export async function updateVendorContact(id: string, input: VendorContactInput): Promise<VendorActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  const parsed = vendorContactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_vendor_contacts")
      .update(vendorContactColumns(parsed.data))
      .eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: GONE_ERROR };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}

export async function removeVendorContact(id: string): Promise<VendorActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: GENERIC_ERROR };
  try {
    const context = await ownWedding();
    if (!context) return { ok: false, error: SESSION_ERROR };
    const { data, error } = await context.supabase.from("wedding_vendor_contacts")
      .delete().eq("id", id).eq("wedding_id", context.wedding.id).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "No se ha eliminado: el proveedor ya no está disponible." };
    refresh();
    return { ok: true };
  } catch { return { ok: false, error: GENERIC_ERROR }; }
}
