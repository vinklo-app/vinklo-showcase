/**
 * Formato es-ES hecho a mano (DESIGN.md §3: Intl no es fiable en todos los
 * navegadores; aquí se renderiza en servidor, pero se mantiene el criterio).
 */
import type { Metric } from "@/lib/admin/types";
import { formatEuros } from "@/lib/format/money";

/** 12345 → «12.345»; null → «—». */
export function fmtInt(value: Metric): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Céntimos → «1.234,50 €» (siempre dos decimales). */
export function fmtEur(cents: number): string {
  return formatEuros(cents, { cents: "always", rounding: "trunc" });
}

export function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value} %`;
}

const MADRID_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(iso: string): Record<string, string> | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Object.fromEntries(MADRID_PARTS.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
}

/** «04/10 12:30» (hora de Madrid). */
export function fmtDateTime(iso: string): string {
  const p = parts(iso);
  return p ? `${p.day}/${p.month} ${p.hour}:${p.minute}` : "—";
}

/** «04/10/2026» (hora de Madrid). */
export function fmtDate(iso: string): string {
  const p = parts(iso);
  return p ? `${p.day}/${p.month}/${p.year}` : "—";
}

/** Fecha civil YYYY-MM-DD → «12/06/2027» sin pasar por zonas horarias. */
export function fmtCivilDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
