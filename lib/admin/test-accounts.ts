/**
 * Heurística para no confundir cuentas internas (equipo o pruebas) con
 * clientes reales en el resumen del admin. NO es una frontera de
 * seguridad — eso vive en lib/admin.ts (ADMIN_EMAILS + assertAdmin). Esto
 * solo clasifica filas para que el fundador no lea "9 cuentas" como 9
 * parejas reales cuando la mayoría son de prueba (2026-10-04).
 */
import { isAdminEmail } from "@/lib/admin";

const TEST_LOCAL_PREFIXES = ["prueba", "test", "demo", "diagnostico"];

/** Dirección usada para pruebas internas: dominio propio o prefijo conocido. */
export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return false;
  if (domain === "vinklo.es") return true;
  return TEST_LOCAL_PREFIXES.some((prefix) => local.startsWith(prefix));
}

/** Cuenta interna: del equipo (ADMIN_EMAILS) o de pruebas (isTestEmail). */
export function isInternalEmail(email: string | null | undefined): boolean {
  return isTestEmail(email) || isAdminEmail(email ?? undefined);
}
