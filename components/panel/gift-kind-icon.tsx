import { BanknoteIcon, EllipsisIcon, GiftIcon, LandmarkIcon, ListChecksIcon, MailIcon, SmartphoneIcon, TicketIcon, type LucideIcon } from "lucide-react";
import type { GiftKind } from "@/lib/crm/contract";

/** Un icono por tipo de regalo (lucide, mismo trazo que el resto del panel). «Sobre» = sobre, no billete. */
export const GIFT_KIND_ICONS: Record<GiftKind, LucideIcon> = {
  transferencia: LandmarkIcon,
  bizum: SmartphoneIcon,
  efectivo: MailIcon,
  lista: ListChecksIcon,
  objeto: GiftIcon,
  experiencia: TicketIcon,
  otro: EllipsisIcon,
};

export function GiftKindIcon({ kind, className = "size-4" }: { kind: GiftKind; className?: string }) {
  const Icon = GIFT_KIND_ICONS[kind] ?? BanknoteIcon;
  return <Icon aria-hidden="true" className={className} />;
}
