/**
 * Regalos y embudo en el panel (puro, sin React ni I/O): formato de euros,
 * lectura del importe que escribe la pareja, validación del formulario con
 * las mismas cotas que el contrato, regalos de cada invitado y pasos del
 * embudo. El regalo es una ANOTACIÓN de la pareja: nada aquí cobra, avisa
 * ni dice que Vinklo haya movido dinero (lib/crm/contract.ts).
 */
import {
  FUNNEL_STAGES, GIFT_DESCRIPTION_MAX, GIFT_KINDS, GIFT_MAX_AMOUNT_CENTS, GIFT_NOTE_MAX, MONETARY_GIFT_KINDS,
  type CrmFunnelSummary, type FunnelStage, type Gift, type GiftInput, type GiftKind, type GuestGiftState, type PendingBucket,
} from "@/lib/crm/contract";
import type { GuestListFilter } from "@/lib/messages/filters";
import { parseEsAmountToCents } from "@/lib/amounts";
import { formatCount } from "@/components/panel/guest-status";
import { formatEuros } from "@/lib/format/money";

/* --- Euros ---------------------------------------------------------------- */

/** Céntimos → texto del campo («150» o «150,50»), para editar un regalo. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  return rest ? `${euros},${String(rest).padStart(2, "0")}` : String(euros);
}

export function isMonetaryKind(kind: GiftKind): boolean {
  return MONETARY_GIFT_KINDS.includes(kind);
}

export function isGiftKind(value: unknown): value is GiftKind {
  return typeof value === "string" && (GIFT_KINDS as readonly string[]).includes(value);
}

/* --- Formulario ----------------------------------------------------------- */

export interface GiftDraft {
  kind: GiftKind | null;
  /** Lo que escribe la pareja («150», «1.000,50»); vacío = sin importe. */
  amount: string;
  description: string;
  note: string;
  /** YYYY-MM-DD (input date) o vacío. */
  receivedOn: string;
  guestIds: string[];
}

export type GiftDraftResult = { ok: true; input: GiftInput } | { ok: false; field: keyof GiftDraft; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mismas cotas que el contrato; el servidor vuelve a validar. */
export function giftDraftToInput(draft: GiftDraft): GiftDraftResult {
  if (!draft.kind || !isGiftKind(draft.kind)) return { ok: false, field: "kind", error: "Elegid qué os han regalado." };
  const guestIds = Array.from(new Set(draft.guestIds));
  if (guestIds.length === 0) return { ok: false, field: "guestIds", error: "Elegid al menos a una persona de vuestra lista." };
  let amountCents: number | null = null;
  if (isMonetaryKind(draft.kind) && draft.amount.trim()) {
    amountCents = parseEsAmountToCents(draft.amount);
    if (amountCents === null) return { ok: false, field: "amount", error: "Escribid el importe en euros, por ejemplo 150 o 150,50." };
    if (amountCents <= 0) return { ok: false, field: "amount", error: "El importe tiene que ser mayor que 0. Si no lo sabéis, dejadlo vacío." };
    if (amountCents > GIFT_MAX_AMOUNT_CENTS) return { ok: false, field: "amount", error: `El importe puede ser como máximo ${formatEuros(GIFT_MAX_AMOUNT_CENTS)}.` };
  }
  const description = draft.description.trim();
  if (description.length > GIFT_DESCRIPTION_MAX) return { ok: false, field: "description", error: `La descripción puede tener como máximo ${GIFT_DESCRIPTION_MAX} caracteres.` };
  const note = draft.note.trim();
  if (note.length > GIFT_NOTE_MAX) return { ok: false, field: "note", error: `La nota puede tener como máximo ${GIFT_NOTE_MAX} caracteres.` };
  const receivedOn = draft.receivedOn.trim();
  if (receivedOn && (!DATE.test(receivedOn) || Number.isNaN(new Date(`${receivedOn}T00:00:00Z`).getTime()))) {
    return { ok: false, field: "receivedOn", error: "Revisad la fecha." };
  }
  return {
    ok: true,
    input: { guestIds, kind: draft.kind, amountCents, description: description || null, note: note || null, receivedOn: receivedOn || null },
  };
}

export function emptyGiftDraft(guestId: string): GiftDraft {
  return { kind: null, amount: "", description: "", note: "", receivedOn: "", guestIds: [guestId] };
}

export function giftToDraft(gift: Gift): GiftDraft {
  return {
    kind: gift.kind,
    amount: centsToInput(gift.amountCents),
    description: gift.description ?? "",
    note: gift.note ?? "",
    receivedOn: gift.receivedOn ?? "",
    guestIds: gift.givers.map((giver) => giver.guestId),
  };
}

/* --- Regalos de un invitado ----------------------------------------------- */

/** Regalos en los que participa esta persona (también los de grupo). Más recientes primero. */
export function giftsForGuest(gifts: readonly Gift[], guestId: string): Gift[] {
  return gifts
    .filter((gift) => gift.givers.some((giver) => giver.guestId === guestId))
    .sort((a, b) => (b.receivedOn ?? b.createdAt).localeCompare(a.receivedOn ?? a.createdAt) || b.createdAt.localeCompare(a.createdAt));
}

/** «150 €» · «Sin importe» (efectivo sin cifra) · descripción para los regalos sin dinero. */
export function giftHeadline(gift: Pick<Gift, "kind" | "amountCents" | "description">): string {
  if (gift.amountCents !== null) return formatEuros(gift.amountCents);
  if (gift.description) return gift.description;
  return isMonetaryKind(gift.kind) ? "Sin importe anotado" : "";
}

/** «Con Lucía y Pablo» (otros que lo regalaron juntos) o "" si es solo de esta persona. */
export function coGiversLine(gift: Pick<Gift, "givers">, guestId: string): string {
  const others = gift.givers.filter((giver) => giver.guestId !== guestId).map((giver) => giver.name);
  if (others.length === 0) return "";
  if (others.length <= 2) return `Junto a ${others.join(" y ")}`;
  return `Junto a ${others.slice(0, 2).join(", ")} y ${others.length - 2 === 1 ? "1 persona más" : `${formatCount(others.length - 2)} personas más`}`;
}

/**
 * Estado de regalo que pinta la fila. Con los regalos cargados (`gifts` no
 * null), manda lo que tenemos, también lo recién anotado o borrado antes de
 * que el servidor recalcule. Sin ellos (falló la lectura), el del servidor.
 */
export function rowGiftState(serverState: GuestGiftState | undefined, gifts: readonly Gift[] | null, noGiftLocal?: boolean): GuestGiftState {
  if (gifts === null) return serverState ?? "unknown";
  if (gifts.length > 0) return "yes";
  if (noGiftLocal !== undefined) return noGiftLocal ? "no" : "unknown";
  return serverState === "no" ? "no" : "unknown";
}

/* --- Embudo --------------------------------------------------------------- */

export interface FunnelStepView {
  stage: FunnelStage;
  value: number;
  /** % sobre el paso anterior (entero) o null en el primero / sin base. */
  conversion: number | null;
  /** Fracción sobre «Añadidos» para la barra (0..1). */
  share: number;
}

/** Porcentaje entero, acotado a 0..100 (los acumulados nunca deberían superar al anterior). */
export function percent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function funnelSteps(summary: Pick<CrmFunnelSummary, "reached">): FunnelStepView[] {
  const base = summary.reached.added;
  return FUNNEL_STAGES.map((stage, index) => {
    const value = summary.reached[stage];
    const previous = index > 0 ? summary.reached[FUNNEL_STAGES[index - 1]] : null;
    return {
      stage,
      value,
      conversion: previous === null ? null : percent(value, previous),
      share: base > 0 ? Math.max(0, Math.min(1, value / base)) : 0,
    };
  });
}

/** Cada grupo sin respuesta y el filtro de la lista que lo muestra. */
export const PENDING_BUCKET_FILTER: Record<PendingBucket, GuestListFilter> = {
  not_sent: "sin_enviar",
  sent_unopened: "enviada_sin_abrir",
  opened_unanswered: "abierta_sin_responder",
};
