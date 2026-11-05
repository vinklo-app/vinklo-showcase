import "server-only";

import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * True si el email está en la allowlist ADMIN_EMAILS (separados por comas).
 * Solo mira la lista: NO decide acceso (para eso, `isAdminUser`).
 */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * Admin = email en la allowlist Y email confirmado en Supabase. Sin la
 * confirmación, quien registrara una cuenta con el correo de un admin
 * antes de que éste la use podría pasar por admin.
 */
export function isAdminUser(
  user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined,
): boolean {
  if (!user?.email_confirmed_at) return false;
  return isAdminEmail(user.email ?? undefined);
}

/**
 * Frontera de auth del admin. Se llama al PRINCIPIO de cada página de
 * /admin — no basta con el layout: en Next.js el layout no es una
 * frontera de seguridad (las páginas se renderizan en paralelo, el
 * layout no re-corre en navegación cliente, y un bypass de middleware
 * dejaría las páginas sin proteger). Para cualquiera fuera de la lista la
 * ruta NO existe: notFound(), nunca un 403.
 */
export async function assertAdmin(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminUser(user)) {
    notFound();
  }
}
