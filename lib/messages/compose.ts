import { THANKS_TEMPLATE_KIND } from "@/lib/crm/contract";
import { validateTemplate, type TemplateKind, type TemplateValidation, type TemplateVars } from "@/lib/messages/templates";

/**
 * Mensaje de un envío concreto (punto 15 del backlog): la pareja ve el texto
 * ya relleno y lo puede retocar solo para esa persona antes de abrir
 * WhatsApp. Puro (sin I/O) para poder probarlo.
 */

export const COMPOSE_MAX_LENGTH = 4000;

export const COMPOSE_ERRORS = {
  empty: "Escribid el mensaje.",
  tooLong: `El mensaje puede tener como máximo ${COMPOSE_MAX_LENGTH} caracteres.`,
  missingLink: "Falta su enlace personal: sin él no podrá abrir la invitación ni responder.",
} as const;

/** Las plantillas con enlace (invitación y recordatorio) lo exigen también en cada envío. */
export function needsLink(kind: TemplateKind): boolean {
  return kind !== THANKS_TEMPLATE_KIND;
}

/**
 * Por qué no se puede abrir WhatsApp con este texto (o null si se puede).
 * Nunca se cambia el texto por otro a escondidas: lo que se ve es lo que se
 * envía, así que si quitaron el enlace se avisa en vez de reponerlo.
 */
export function composeIssue(text: string, kind: TemplateKind, link: string | null | undefined): string | null {
  const body = text.trim();
  if (!body) return COMPOSE_ERRORS.empty;
  if (body.length > COMPOSE_MAX_LENGTH) return COMPOSE_ERRORS.tooLong;
  if (needsLink(kind) && link && !body.includes(link)) return COMPOSE_ERRORS.missingLink;
  return null;
}

/** Devuelve el enlace al final, en su propia línea (el mismo sitio que el texto de Vinklo). */
export function restoreLink(text: string, link: string): string {
  const body = text.replace(/\s+$/, "");
  return body ? `${body}\n${link}` : link;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sustituye `value` solo como palabra completa (no «Ana» dentro de «Mariana»). */
function replaceWord(text: string, value: string, token: string): string {
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu"), token);
}

/**
 * «Guardar como plantilla»: el texto ya relleno vuelve a llevar variables
 * para que valga para todos. Orden: enlace, fecha y novios antes que el
 * nombre, porque «Ana y Luis» contiene a «Ana». Solo se sustituyen las
 * variables que este tipo admite (el agradecimiento no lleva enlace ni fecha).
 * Si la boda no tiene fecha, el texto no la lleva y la plantilla tampoco.
 */
export function textToTemplate(text: string, vars: TemplateVars, kind: TemplateKind = "invitation"): string {
  const allowed = needsLink(kind) ? (["enlace", "fecha", "novios", "nombre"] as const) : (["novios", "nombre"] as const);
  let body = text.replace(/\r\n?/g, "\n");
  for (const key of allowed) {
    const value = (vars[key] ?? "").trim();
    if (!value) continue;
    // El enlace es una URL: se sustituye tal cual; el resto, como palabra.
    body = key === "enlace" ? body.split(value).join(`{${key}}`) : replaceWord(body, value, `{${key}}`);
  }
  return body.trim();
}

/** Plantilla lista para guardar (misma validación que el servidor y el CHECK de la tabla). */
export function templateFromText(text: string, vars: TemplateVars, kind: TemplateKind): TemplateValidation {
  return validateTemplate(textToTemplate(text, vars, kind), kind);
}
