/**
 * Número de WhatsApp (solo dígitos, con prefijo de país) a partir de lo que
 * escribe la pareja. Sin dependencias: lo usan el panel, los mensajes y el
 * contrato de la web (lib/site-document.ts, que viaja con el renderer).
 */

/** Números locales españoles o internacionales con + / 00. Nunca adivinar país ajeno. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  const clean = phone.trim().replace(/[\s().-]/g, "");
  if (/^[67]\d{8}$/.test(clean)) return `34${clean}`;
  const international = clean.startsWith("+") ? clean.slice(1) : clean.startsWith("00") ? clean.slice(2) : clean;
  return /^[1-9]\d{9,14}$/.test(international) ? international : null;
}

/**
 * Chat de WhatsApp con ese número y el texto ya escrito; null sin número
 * válido. Nunca envía. En el panel se usa vía whatsappMessageUrl (la hoja del
 * mensaje); en la web pública, para «Pedir mi invitación».
 */
export function whatsappChatUrl(phone: string | null, text: string): string | null {
  const number = whatsappNumber(phone);
  if (!number || !text.trim()) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
