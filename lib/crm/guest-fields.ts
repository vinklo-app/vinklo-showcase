/**
 * Campos del CRM por invitado (puro; cliente y servidor). La fila viene de
 * `guest_page` (lib/data/attendance.ts) y se traduce al contrato GuestCrmFields.
 */
import type { GuestCrmFields, GuestGiftState } from "@/lib/crm/contract";

export interface GuestCrmRow {
  invitation_opened_at?: string | null;
  gift_none?: boolean;
  gift_count?: number;
  gift_unthanked?: boolean;
}

/** «yes» si tiene algún regalo; «no» si la pareja marcó «sin regalo»; si no, «unknown». */
export function guestGiftState(giftCount: number, giftNone: boolean): GuestGiftState {
  if (giftCount > 0) return "yes";
  return giftNone ? "no" : "unknown";
}

export function toGuestCrmFields(row: GuestCrmRow): GuestCrmFields {
  const giftCount = row.gift_count ?? 0;
  return {
    invitationOpenedAt: row.invitation_opened_at ?? null,
    giftState: guestGiftState(giftCount, row.gift_none ?? false),
    giftCount,
    giftUnthanked: giftCount > 0 && (row.gift_unthanked ?? false),
  };
}
