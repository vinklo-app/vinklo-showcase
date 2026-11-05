import { DEFAULT_THANKS_TEMPLATE, THANKS_TEMPLATE_KIND } from "@/lib/crm/contract";
import { firstName } from "@/lib/messages/first-name";

/**
 * Motor puro de plantillas de WhatsApp (sin I/O; se usa en cliente y servidor).
 * Vinklo solo prepara el texto: la pareja lo envía desde su móvil vía wa.me.
 * La misma regla de validación vive como CHECK en
 * supabase/migrations/20261004100000_crm_messages_reminders.sql.
 */

export const MESSAGE_KINDS = ["invitation", "reminder"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Todas las plantillas guardables. «thanks» (agradecimiento por un regalo) va
 * aparte de MESSAGE_KINDS para no cambiar los Record<MessageKind, …> del panel:
 * no lleva enlace y solo admite {nombre} y {novios}.
 */
export const TEMPLATE_KINDS = [...MESSAGE_KINDS, THANKS_TEMPLATE_KIND] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_VARIABLES = ["nombre", "enlace", "novios", "fecha"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

export const TEMPLATE_MAX_LENGTH = 1000;

/**
 * Sin plantilla guardada. La invitación es un único mensaje (texto + enlace
 * personal) que la pareja puede retocar antes de enviar (6-oct-2026, petición
 * del propietario; 13-oct-2026, tono cercano en vez de «nos complace…»). Cada frase con
 * una variable vacía se cae sola (renderTemplate), así que también se lee
 * bien sin nombre, sin fecha o sin novios.
 */
export const DEFAULT_TEMPLATES: Record<MessageKind, string> = {
  invitation: "¡Hola, {nombre}! Nos casamos y nos haría mucha ilusión que vinieras. Será el {fecha}. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:\n{enlace}\n\nUn abrazo, {novios}",
  reminder: "¡Hola, {nombre}! ¿Podrás acompañarnos el {fecha}? Nos ayuda mucho saberlo para organizarlo todo. Puedes responder aquí: {enlace} — {novios}",
};

/** Texto por defecto de cualquier plantilla (incluida la de agradecimiento). */
export function defaultTemplate(kind: TemplateKind): string {
  return kind === THANKS_TEMPLATE_KIND ? DEFAULT_THANKS_TEMPLATE : DEFAULT_TEMPLATES[kind];
}

export const TEMPLATE_ERRORS = {
  empty: "Escribid el mensaje.",
  tooLong: `El mensaje puede tener como máximo ${TEMPLATE_MAX_LENGTH} caracteres.`,
  missingLink: "El mensaje necesita {enlace} para que cada persona pueda responder.",
  unknownVariable: "Solo se pueden usar {nombre}, {enlace}, {novios} y {fecha}. Quitad las demás llaves.",
  unknownThanksVariable: "En el agradecimiento solo se pueden usar {nombre} y {novios}. Quitad las demás llaves.",
} as const;

export type TemplateValidation = { ok: true; body: string } | { ok: false; error: string };

const KNOWN_TOKEN = /\{(nombre|enlace|novios|fecha)\}/g;
const THANKS_TOKEN = /\{(nombre|novios)\}/g;

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && (MESSAGE_KINDS as readonly string[]).includes(value);
}
export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

/** Normaliza saltos de línea y espacios finales; el texto interior se respeta. */
export function normalizeTemplate(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/**
 * Misma regla que el CHECK wedding_message_templates_body (20261008100000).
 * Sin `kind` (o invitation/reminder): {enlace} obligatorio. «thanks»: sin
 * enlace y solo {nombre}/{novios}.
 */
export function validateTemplate(body: unknown, kind: TemplateKind = "invitation"): TemplateValidation {
  if (typeof body !== "string") return { ok: false, error: TEMPLATE_ERRORS.empty };
  const normalized = normalizeTemplate(body);
  if (normalized.length === 0) return { ok: false, error: TEMPLATE_ERRORS.empty };
  if (normalized.length > TEMPLATE_MAX_LENGTH) return { ok: false, error: TEMPLATE_ERRORS.tooLong };
  if (kind === THANKS_TEMPLATE_KIND) {
    if (/[{}]/.test(normalized.replace(THANKS_TOKEN, ""))) return { ok: false, error: TEMPLATE_ERRORS.unknownThanksVariable };
    return { ok: true, body: normalized };
  }
  if (!normalized.includes("{enlace}")) return { ok: false, error: TEMPLATE_ERRORS.missingLink };
  if (/[{}]/.test(normalized.replace(KNOWN_TOKEN, ""))) return { ok: false, error: TEMPLATE_ERRORS.unknownVariable };
  return { ok: true, body: normalized };
}

/**
 * Nombre para el saludo («¡Hola, {nombre}!»): ver lib/messages/first-name.ts
 * (nombres compuestos, parejas, tratamientos y nunca un apellido solo).
 */
export { firstName };

/** «Ana» + «Luis» → «Ana y Luis». Vacío si falta alguno. */
export function coupleNames(partner1: string | null | undefined, partner2: string | null | undefined): string {
  const a = (partner1 ?? "").trim();
  const b = (partner2 ?? "").trim();
  return a && b ? `${a} y ${b}` : a || b;
}

/** "2027-06-12" → «sábado, 12 de junio». Fecha civil: sin zona horaria del navegador. */
export function formatWeddingDate(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) return "";
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

/** Frases: hasta . ! ? (inclusive, con cierres repetidos) o salto de línea. */
const SENTENCE = /[^.!?\n]*(?:[.!?]+|\n|$)/g;

/**
 * Rellena la plantilla. Una variable sin valor se quita con su frase; si esa
 * frase lleva {enlace}, solo se quita la variable (el enlace nunca se pierde).
 * Limpia espacios dobles y espacios antes de puntuación.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const value = (key: TemplateVariable) => (vars[key] ?? "").trim();
  const missing = TEMPLATE_VARIABLES.filter((key) => !value(key));
  let text = normalizeTemplate(body);
  if (missing.length) {
    const hasMissing = new RegExp(`\\{(${missing.join("|")})\\}`);
    text = (text.match(SENTENCE) ?? [])
      .filter((sentence) => !hasMissing.test(sentence) || sentence.includes("{enlace}"))
      .join("");
  }
  text = text.replace(KNOWN_TOKEN, (_, key: TemplateVariable) => value(key));
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+—\s*$/, "")
    .trim();
}

export interface MessageContext {
  /** «Ana y Luis» */ novios: string;
  /** «sábado, 12 de junio» o "" si la boda no tiene fecha */ fecha: string;
}

/** Atajo: plantilla guardada (o la de Vinklo) + invitado + enlace personal. */
export function buildMessage(kind: MessageKind, savedBody: string | null | undefined, guestName: string, link: string, context: MessageContext): string {
  const body = savedBody && validateTemplate(savedBody).ok ? savedBody : DEFAULT_TEMPLATES[kind];
  return renderTemplate(body, { nombre: firstName(guestName), enlace: link, novios: context.novios, fecha: context.fecha });
}

/** Agradecimiento por un regalo: plantilla guardada (si es válida) o la de Vinklo. Sin enlace. */
export function buildThanksMessage(savedBody: string | null | undefined, guestName: string, context: Pick<MessageContext, "novios">): string {
  const body = savedBody && validateTemplate(savedBody, THANKS_TEMPLATE_KIND).ok ? savedBody : DEFAULT_THANKS_TEMPLATE;
  return renderTemplate(body, { nombre: firstName(guestName), novios: context.novios });
}
