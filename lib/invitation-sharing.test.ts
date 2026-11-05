import { describe, expect, it } from "vitest";
import { whatsappNumber, whatsappInvitationUrl, whatsappMessageUrl } from "./invitation-sharing";

/**
 * Oráculo compartido con SQL: la MISMA lista está en tests/sql/crm-mensajes.sql
 * para `public.whatsapp_number`, que decide «Sin teléfono» y «Para recordar».
 */
export const WHATSAPP_NUMBER_ORACLE: Array<[string | null, string | null]> = [
  ["612 345 678", "34612345678"], ["+34 612 345 678", "34612345678"], ["0034 612345678", "34612345678"],
  ["+44 7700 900123", "447700900123"], ["0044 7700 900123", "447700900123"], ["(612) 34-56.78", "34612345678"],
  ["  712345678  ", "34712345678"], ["612\u00a0345\u00a0678", "34612345678"], ["+1 415 555 2671", "14155552671"], ["6123456789", "6123456789"],
  ["912345678", null], ["61234567", null], ["123", null], ["", null], ["javascript:alert(1)", null],
  ["+00000000000", null], ["+0034612345678", null], ["+34 612 345 678 9012 3456", null], [null, null],
];

describe("compartir una invitación personal", () => {
  it.each(WHATSAPP_NUMBER_ORACLE)("whatsappNumber(%j) = %j (igual que SQL)", (phone, expected) => {
    expect(whatsappNumber(phone)).toBe(expected);
  });
  it.each([null, "", "123", "javascript:alert(1)", "+00000000000"])("rechaza teléfono inválido %s", (phone) => {
    expect(whatsappInvitationUrl(phone, "https://example.test/b/boda?invitacion=abc")).toBeNull();
  });
  it("codifica el enlace completo sin inyectar parámetros", () => {
    const invitation = "https://example.test/b/boda?invitacion=abc&x=1";
    const url = new URL(whatsappInvitationUrl("612345678", invitation)!);
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/34612345678");
    expect(url.searchParams.get("text")).toContain(invitation);
    expect(Array.from(url.searchParams.keys())).toEqual(["text"]);
  });
  it("sin mensaje mantiene el texto de siempre", () => {
    const invitation = "https://example.test/b/boda?invitacion=abc";
    expect(new URL(whatsappInvitationUrl("612345678", invitation)!).searchParams.get("text"))
      .toBe(`Nos casamos y nos haría mucha ilusión que vinieras. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:\n${invitation}`);
  });
  it("usa el mensaje rellenado solo si lleva el enlace personal", () => {
    const invitation = "https://example.test/b/boda?invitacion=abc";
    const own = new URL(whatsappInvitationUrl("612345678", invitation, `¡Hola, Marta! ${invitation}`)!);
    expect(own.searchParams.get("text")).toBe(`¡Hola, Marta! ${invitation}`);
    const withoutLink = new URL(whatsappInvitationUrl("612345678", invitation, "¡Hola, Marta!")!);
    expect(withoutLink.searchParams.get("text")).toContain(invitation);
  });
  it("whatsappMessageUrl no abre chats vacíos ni sin número válido", () => {
    expect(whatsappMessageUrl("612345678", "  ")).toBeNull();
    expect(whatsappMessageUrl("123", "Hola")).toBeNull();
    expect(whatsappMessageUrl("612345678", "a&b=c")).toBe("https://wa.me/34612345678?text=a%26b%3Dc");
  });
});
