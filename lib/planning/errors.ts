/**
 * Tabla o columna nuevas aún sin aplicar en la base: PostgREST responde
 * PGRST205 (tabla) / PGRST204 (columna) y Postgres 42P01 / 42703. Mismo
 * criterio que lib/actions/tables.ts. Con esto la página avisa en vez de romper.
 */
export function isMissingMigration(error: { code?: string } | null | undefined): boolean {
  return ["PGRST205", "PGRST204", "42P01", "42703"].includes(error?.code ?? "");
}

export type PlanningRead<T> = { status: "ok"; data: T } | { status: "missing" } | { status: "error" };
