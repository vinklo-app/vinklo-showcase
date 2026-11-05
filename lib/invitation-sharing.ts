import { DEFAULT_TEMPLATES, renderTemplate } from "@/lib/messages/templates";
import { whatsappChatUrl, whatsappNumber } from "@/lib/whatsapp-number";

export { whatsappNumber };

/** Abre el chat de esa persona con el texto ya rellenado. Nunca envía: lo hace la pareja. */
export function whatsappMessageUrl(phone: string | null, text: string): string | null {
  return whatsappChatUrl(phone, text);
}

/** Enlace público de la web de la boda (`/b/<slug>`), con la misma base que el panel. */
export function publicWeddingUrl(slug: string, base: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  return `${(base || "http://localhost:3000").replace(/\/$/, "")}/b/${slug}`;
}

/** Texto para compartir la web recién publicada: solo lo que hay (la web y su enlace). */
export function publishedShareText(url: string): string {
  return `Ya tenemos la web de nuestra boda: ${url}`;
}

/** WhatsApp sin destinatario: la pareja elige a quién (o a qué grupo) lo manda. Nunca envía. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Sin `message`: el texto de invitación de Vinklo (comportamiento de siempre).
 * Con `message` (plantilla ya rellenada con buildMessage): se usa tal cual si
 * contiene el enlace personal; si no, se cae al texto de Vinklo para no
 * mandar nunca un mensaje sin enlace.
 */
export function whatsappInvitationUrl(phone: string | null, invitation: string, message?: string): string | null {
  const text = message && message.includes(invitation) ? message : renderTemplate(DEFAULT_TEMPLATES.invitation, { enlace: invitation });
  return whatsappMessageUrl(phone, text);
}

export interface SelectedContact { name?: string[]; tel?: string[] }
export interface ContactPicker {
  select(properties: string[], options: { multiple: boolean }): Promise<SelectedContact[]>;
}
export function contactPicker(): ContactPicker | null {
  if (typeof navigator === "undefined" || !globalThis.isSecureContext) return null;
  return (navigator as Navigator & { contacts?: ContactPicker }).contacts ?? null;
}
