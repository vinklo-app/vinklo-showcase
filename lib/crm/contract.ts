/**
 * Contrato del CRM completo (2026-10-05): embudo de invitados + regalos
 * manuales + agradecimientos. Lo implementan los datos (migración, acciones,
 * lecturas) y lo consume la interfaz del panel. Cambiarlo exige tocar ambos.
 *
 * Reglas (docs/ARQUITECTURA-Y-PLAN-CLAUDE.md §6, PRODUCTO §5):
 *  - El regalo es una ANOTACIÓN manual y privada de la pareja. No es un cobro,
 *    no avisa al invitado y nunca vive en el JSON público de la invitación.
 *  - Asistencia, regalo y pago son dimensiones independientes. «Sin pago en
 *    Vinklo» nunca significa «no ha regalado». Pagos nuevos desactivados.
 *  - Importes enteros en céntimos (EUR). Todo se agrega en Postgres.
 *  - «Enviada» la confirma la pareja (WhatsApp no acredita entrega). «Abierta»
 *    es la primera vez que el invitado abre SU enlace personal.
 */

// ---------------------------------------------------------------- embudo

/** Etapa más avanzada de cada invitado, en orden. */
export const FUNNEL_STAGES = ["added", "prepared", "sent", "opened", "responded"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  added: "Añadidos",
  prepared: "Invitación preparada",
  sent: "Enviada",
  opened: "Abierta",
  responded: "Respondida",
};

/** Sin respuesta, separados por la señal que tenemos. */
export type PendingBucket = "not_sent" | "sent_unopened" | "opened_unanswered";

export interface CrmFunnelSummary {
  /** Invitados por etapa ALCANZADA (acumulado: «sent» incluye a los que abrieron y respondieron). */
  reached: Record<FunnelStage, number>;
  responses: { yes: number; no: number };
  /** Personas que asistirán (confirmados + acompañantes). */
  attendees: number;
  pending: Record<PendingBucket, number>;
  /** Igual que la cola de /panel/invitados/recordatorios (filtro «para_recordar», 20261101120000): entregada (enviada o abierta), sin respuesta, con teléfono, plazo abierto y 3 días de margen. */
  toRemind: number;
}

// ---------------------------------------------------------------- regalos

export const GIFT_KINDS = ["transferencia", "bizum", "efectivo", "lista", "objeto", "experiencia", "otro"] as const;
export type GiftKind = (typeof GIFT_KINDS)[number];

export const GIFT_KIND_LABELS: Record<GiftKind, string> = {
  transferencia: "Transferencia",
  bizum: "Bizum",
  efectivo: "Sobre en efectivo",
  lista: "De la lista de bodas",
  objeto: "Un regalo",
  experiencia: "Una experiencia",
  otro: "Otro",
};

/** Tipos en los que tiene sentido anotar un importe. */
export const MONETARY_GIFT_KINDS: readonly GiftKind[] = ["transferencia", "bizum", "efectivo"];

export const GIFT_MAX_AMOUNT_CENTS = 10_000_000; // 100.000 €
export const GIFT_DESCRIPTION_MAX = 200;
export const GIFT_NOTE_MAX = 500;

/** Estado de regalo de un invitado, derivado: «yes» si tiene algún regalo; «no» si la pareja lo marcó; si no, «unknown». */
export type GuestGiftState = "yes" | "no" | "unknown";

export interface GiftGiver {
  guestId: string;
  name: string;
}

export interface Gift {
  id: string;
  kind: GiftKind;
  /** null = sin importe anotado. */
  amountCents: number | null;
  description: string | null;
  note: string | null;
  /** YYYY-MM-DD o null. */
  receivedOn: string | null;
  /** ISO o null = pendiente de agradecer. */
  thankedAt: string | null;
  /** ≥ 1 mientras la boda no se haya anonimizado; [] tras la retención de 12 meses (20261026100000). */
  givers: GiftGiver[];
  createdAt: string;
}

export interface GiftInput {
  guestIds: string[];
  kind: GiftKind;
  amountCents?: number | null;
  description?: string | null;
  note?: string | null;
  receivedOn?: string | null;
}

export interface CrmGiftSummary {
  count: number;
  /** Suma de importes anotados (los regalos sin importe no suman). */
  totalCents: number;
  /** Regalos con importe anotado. */
  withAmount: number;
  byKind: Record<GiftKind, { count: number; totalCents: number }>;
  /** Regalos sin agradecer. */
  unthanked: number;
  /** Invitados con algún regalo / marcados «sin regalo» / sin indicar. */
  guests: Record<GuestGiftState, number>;
}

export type ActionResult<T = void> = ({ ok: true } & (T extends void ? unknown : { data: T })) | { ok: false; error: string };

/**
 * Firmas de las server actions (lib/actions/gifts.ts) y lecturas
 * (lib/data/crm.ts). Todas resuelven la boda con la sesión (RLS + couple_id);
 * nunca aceptan wedding_id del cliente.
 */
export interface CrmActions {
  createGift(input: GiftInput): Promise<ActionResult<{ id: string }>>;
  updateGift(id: string, input: GiftInput): Promise<ActionResult>;
  deleteGift(id: string): Promise<ActionResult>;
  setGiftThanked(id: string, thanked: boolean): Promise<ActionResult>;
  /** Marca/desmarca «sin regalo» explícito para un invitado sin regalos. */
  setGuestNoGift(guestId: string, noGift: boolean): Promise<ActionResult>;
}

export interface CrmReads {
  getCrmFunnel(): Promise<CrmFunnelSummary | null>;
  getGiftSummary(): Promise<CrmGiftSummary | null>;
  listGifts(): Promise<Gift[]>;
}

/** Campos nuevos por invitado que la lista del panel puede leer/filtrar. */
export interface GuestCrmFields {
  invitationOpenedAt: string | null;
  giftState: GuestGiftState;
  giftCount: number;
  /** Algún regalo de este invitado pendiente de agradecer. */
  giftUnthanked: boolean;
}

/** Plantilla de WhatsApp de agradecimiento: nuevo kind «thanks» (no exige {enlace}). Variables: {nombre}, {novios}. */
export const THANKS_TEMPLATE_KIND = "thanks" as const;
export const DEFAULT_THANKS_TEMPLATE =
  "¡Hola, {nombre}! Muchísimas gracias por vuestro regalo y por acompañarnos. Nos ha hecho muchísima ilusión. Un abrazo, {novios}.";
