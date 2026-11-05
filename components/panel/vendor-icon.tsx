import {
  CakeSliceIcon, CameraIcon, CarIcon, ClapperboardIcon, Flower2Icon, LandmarkIcon, MailIcon,
  MusicIcon, PaletteIcon, ScissorsIcon, ShirtIcon, StoreIcon, UtensilsCrossedIcon, type LucideIcon,
} from "lucide-react";
import type { VendorCategory } from "@/lib/vendors/contacts";
import type { VendorTone } from "@/components/panel/vendor-status";

const ICONS: Record<VendorCategory, LucideIcon> = {
  lugar: LandmarkIcon,
  catering: UtensilsCrossedIcon,
  fotografia: CameraIcon,
  video: ClapperboardIcon,
  musica: MusicIcon,
  flores: Flower2Icon,
  decoracion: PaletteIcon,
  vestuario: ShirtIcon,
  belleza: ScissorsIcon,
  tarta: CakeSliceIcon,
  transporte: CarIcon,
  papeleria: MailIcon,
  otro: StoreIcon,
};

/**
 * Avatar del proveedor: el icono de su tipo dentro del mismo círculo de 44 px
 * que las iniciales de los invitados. El fondo lleva el tono del estado
 * (oliva al contratar), así la columna de avatares ya se lee como estado.
 * Sin tono (atajos del vacío): solo el glifo, en línea con el texto.
 */
export function VendorIcon({ category, tone, size = "md" }: { category: VendorCategory; tone?: VendorTone; size?: "sm" | "md" }) {
  const Icon = ICONS[category] ?? StoreIcon;
  if (!tone) return <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />;
  return (
    <span className={`pn-vicon ${size === "sm" ? "pn-vicon--sm" : ""}`} data-tone={tone} aria-hidden="true">
      <Icon strokeWidth={1.75} />
    </span>
  );
}
