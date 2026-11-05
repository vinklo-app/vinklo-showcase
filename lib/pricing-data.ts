import { BRAND_NAME } from "@/lib/brand";

/**
 * Datos de planes — fuente única para la sección de precios del home
 * (teaser) y la página /precios. El copy vive aquí para que ambos no
 * puedan desincronizarse; la matemática de la comisión del invitado vive
 * en lib/fees.ts y se calcula en vivo, nunca se hardcodea.
 */

// Fuente única de precios: lib/premium.ts (los usa el checkout real).
// Aquí solo se re-exportan con los nombres que usa el marketing.
export {
  PREMIUM_LAUNCH_PRICE_CENTS as PREMIUM_PRICE_CENTS,
  PREMIUM_PRICE_CENTS as PREMIUM_FULL_PRICE_CENTS,
} from "@/lib/premium";

import { FREE_CONTRIBUTION_LIMIT } from "@/lib/premium";

export const FREE_FEATURES = [
  "Vuestra página de invitado, preciosa y lista para WhatsApp",
  "El bote en tiempo real en vuestro panel",
  "Calendario de pagos con hasta 3 proveedores",
  `Hasta ${FREE_CONTRIBUTION_LIMIT} aportaciones`,
] as const;

export const PREMIUM_FEATURES = [
  "Aportaciones ilimitadas",
  "Proveedores ilimitados",
  "Portal de proveedores: cada uno sube su factura y su calendario",
  "Recordatorios de vencimientos por email",
  "Exportación a CSV",
  "Enlace personalizado para vuestra boda",
  "Sin marca en vuestra página",
  "Dos administradores: los dos lleváis el panel",
] as const;

export const PRICING_FAQS = [
  {
    q: "¿Por qué paga el invitado y no nosotros?",
    a: `Porque así vosotros recibís el 100 % de cada aportación, sin que la boda os cueste nada. Es el mismo modelo que las entradas de un concierto: unos gastos de gestión pequeños, visibles antes de pagar, a cambio de la comodidad de aportar en menos de un minuto desde WhatsApp. Sin ${BRAND_NAME} la alternativa real son las transferencias — y perseguirlas una a una.`,
  },
  {
    q: "¿El invitado ve la comisión antes de pagar?",
    a: "Siempre. Los gastos de gestión aparecen en su propia línea antes de confirmar el pago, con el total exacto. Nadie se lleva sorpresas — es una regla de diseño del producto.",
  },
  {
    q: "¿Premium Boda es una suscripción?",
    a: "No. Es un pago único que cubre toda la boda, se acabe cuando se acabe. Nada de cuotas mensuales ni renovaciones.",
  },
  {
    q: "¿Qué pasa si alguien prefiere regalar en mano?",
    a: "Nada: el regalo en mano de toda la vida sigue funcionando, y podéis apuntarlo en vuestro panel para llevar el tracking completo junto a las aportaciones online.",
  },
  {
    q: "¿Los pagos aplazados con Klarna nos cuestan algo?",
    a: "No. Si un invitado financia su aportación en 3 pagos sin intereses con Klarna, vosotros recibís el importe íntegro igual — el aplazamiento es cosa del invitado y no tiene coste para vosotros.",
  },
] as const;
