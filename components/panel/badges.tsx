/**
 * Badges del panel con la paleta vinklo (server-safe: sin hooks).
 * salvia = confirmada, cava = pendiente, granate = fallida.
 */
import type {
  ContributionMethod,
  ContributionStatus,
} from "@/components/panel/types";

const BASE =
  "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap";

export function MethodBadge({ method }: { method: ContributionMethod }) {
  return (
    <span
      className={`${BASE} border-[var(--tinta)]/15 bg-transparent text-[var(--tinta)]/70`}
    >
      {method === "card" ? "Tarjeta" : "Bizum"}
    </span>
  );
}

const STATUS_STYLES: Record<ContributionStatus, string> = {
  confirmed:
    "border-transparent bg-[var(--salvia)]/15 text-[var(--salvia)]",
  pending:
    "border-transparent bg-[var(--cava)]/15 text-[color-mix(in_srgb,var(--cava)_55%,var(--tinta))]",
  failed: "border-transparent bg-[var(--granate)]/10 text-[var(--granate)]",
};

const STATUS_LABELS: Record<ContributionStatus, string> = {
  confirmed: "Confirmada",
  pending: "Pendiente",
  failed: "Fallida",
};

export function StatusBadge({ status }: { status: ContributionStatus }) {
  return (
    <span className={`${BASE} ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
