/**
 * Textos que ve la pareja en la edición con IA (es-ES, «vosotros»). Puro: lo
 * usan el servidor y los tests. Reglas:
 *  - nunca se habla de «escenas» (es jerga interna): son «secciones»;
 *  - cuando algo no se puede, se dice qué hacer en su lugar y, si existe, se
 *    ofrece un atajo (`AiAction`) al sitio de la página donde se hace a mano.
 */
import type { SiteDocumentIssue } from "@/lib/site-document";

/** Longitud máxima de una petición de cambio. Aquí (puro) y no en
 *  site-edit-patch.ts: el chat del creador solo necesita el número, y aquel
 *  módulo arrastra el esquema de zod y el aplicador del parche al cliente. */
export const SITE_EDIT_MAX_INSTRUCTION = 500;

/**
 * Atajo que la UI pinta como enlace a `#target` SOLO si ese elemento existe en
 * la página (en el panel sí; en el creador todavía no).
 */
export interface AiAction {
  label: string;
  /** id de un elemento de la página (sin «#»). */
  target: string;
}

/** ids de los apartados del panel › Vuestra web a los que se puede saltar. */
export const AI_TARGETS = {
  /** Fieldset «Vuestro contenido» (components/panel/site-editor.tsx). */
  content: "vuestro-contenido",
  /** Fieldset «La foto» (components/panel/site-editor.tsx). */
  photo: "la-foto",
  /** Bloque «Los datos»: nombres y fecha (components/panel/wedding-settings.tsx). */
  settings: "los-datos",
} as const;

export const ACTION_CONTENT: AiAction = { label: "Ir a Vuestro contenido", target: AI_TARGETS.content };
export const ACTION_PHOTO: AiAction = { label: "Ir a La foto", target: AI_TARGETS.photo };
export const ACTION_SETTINGS: AiAction = { label: "Ir a Los datos", target: AI_TARGETS.settings };

export const AI_UNAVAILABLE_ERROR = "La edición con IA no está disponible ahora mismo.";
export const AI_RATE_ERROR = "Habéis pedido muchos cambios seguidos. Esperad un momento y probad de nuevo.";
/** Tope global de gasto agotado: no es culpa de la pareja (plan 4.6). */
export const AI_BUSY_ERROR = "Ahora mismo no podemos usar la IA. Podéis hacer el cambio a mano desde Vuestro contenido o probar más tarde.";
export const AI_EMPTY_ERROR = "Contadnos qué queréis cambiar.";
export const AI_UNREADABLE_ERROR = "No hemos podido leer vuestra web. Recargad la página y probad de nuevo.";
export const AI_NOTHING_ERROR = "No hemos encontrado nada que cambiar con esa petición. Probad a contarlo de otra forma o hacedlo a mano desde Vuestro contenido.";
export const AI_LIMITS_ERROR = "La propuesta no cumple los límites de la web. Probad con un texto más corto.";
export const AI_TOO_MANY_SECTIONS_ERROR = "Vuestra web ya tiene todas las secciones posibles. Ocultad o quitad alguna desde Vuestro contenido y probad de nuevo.";
export const AI_TOO_BIG_ERROR = "Vuestra web ha llegado a su tamaño máximo. Acortad algún texto desde Vuestro contenido y probad de nuevo.";

export const instructionTooLong = (max: number) => `La petición puede tener hasta ${max} caracteres.`;

/** Lo que la IA no puede hacer, clasificado por el modelo (`notPossible`). */
export const NOT_POSSIBLE_KINDS = ["names", "date", "photo", "gallery", "rsvpQuestions", "guests", "other"] as const;
export type NotPossibleKind = (typeof NOT_POSSIBLE_KINDS)[number];

/**
 * «all» (panel): hay apartados a mano en la misma página. «creator»
 * (creador, 13-oct-2026): aún no existe la web, pero el borrador ya guarda
 * el contenido de las secciones. «design»: el creador antes de ese cambio
 * (solo diseño); se mantiene para clientes con la versión anterior en caché.
 */
export type AiScope = "all" | "creator" | "design";

/** Lo que la IA ya no cambia (13-oct-2026): la apertura y el paso a «Como una Story». */
export function refusedMessage(kind: "layout" | "opening", scope: AiScope): string {
  if (kind === "opening") return "La invitación siempre se abre con el sobre: eso no se cambia.";
  return scope === "all"
    ? "«Como una Story» no se activa desde el chat: elegidla a mano en «La forma»."
    : "«Como una Story» no se activa desde el chat.";
}

export function notPossibleMessage(kind: NotPossibleKind, scope: AiScope): { text: string; action?: AiAction } {
  const panel = scope === "all";
  switch (kind) {
    case "names":
      return panel
        ? { text: "Los nombres no se cambian con la IA: cambiadlos en «Los datos», más abajo en esta página.", action: ACTION_SETTINGS }
        : { text: "Los nombres no se cambian con la IA: escribidlos en su paso del creador." };
    case "date":
      return panel
        ? { text: "La fecha no se cambia con la IA: cambiadla en «Los datos», más abajo en esta página.", action: ACTION_SETTINGS }
        : { text: "La fecha no se cambia con la IA: elegidla en su paso del creador." };
    case "photo":
      return panel
        ? { text: "La foto no se cambia con la IA: subid otra en «La foto», arriba en esta página.", action: ACTION_PHOTO }
        : { text: "La foto no se cambia con la IA: elegidla en su paso del creador." };
    case "gallery":
      return panel
        ? { text: "Las fotos y sus pies se añaden a mano desde Vuestro contenido.", action: ACTION_CONTENT }
        : { text: "Las fotos de la galería las podréis añadir desde Vuestro contenido cuando hayáis creado la web." };
    case "rsvpQuestions":
      return panel
        ? { text: "Las preguntas del formulario (canción, niños y menú) se activan a mano desde Vuestro contenido.", action: ACTION_CONTENT }
        : { text: "Las preguntas del formulario (canción, niños y menú) se eligen en el paso de los invitados." };
    case "guests":
      return { text: "La IA no toca la lista de invitados: la tenéis en Invitados, en el panel." };
    case "other":
      return panel
        ? { text: "Eso no lo podemos cambiar con la IA. Podéis hacerlo a mano desde Vuestro contenido.", action: ACTION_CONTENT }
        : { text: "Eso no lo podemos cambiar con la IA. Cuando hayáis creado la web, podréis hacerlo a mano desde Vuestro contenido." };
  }
}

/** Contenido que en el creador aún no se puede editar con la IA. */
export function blockedInCreatorMessage(sections: string[]): string {
  return `${capitalize(joinEs(sections))}: lo podréis añadir cuando hayáis creado la web, desde Vuestro contenido (o pedírselo a la IA allí).`;
}

export function droppedMessage(dropped: string[]): string {
  return `No hemos cambiado ${joinEs(dropped)}: para no inventar datos, escribid el valor exacto en la petición.`;
}

/**
 * Error de validación del documento → texto para la pareja. Los mensajes del
 * contrato que hablan de «escenas», bytes o identificadores no se enseñan tal
 * cual.
 */
export function friendlyIssue(issue: SiteDocumentIssue | undefined): { text: string; action?: AiAction } {
  const message = issue?.message ?? "";
  if (!message) return { text: AI_LIMITS_ERROR };
  if (/m[aá]ximo \d+ escenas/i.test(message)) return { text: AI_TOO_MANY_SECTIONS_ERROR, action: ACTION_CONTENT };
  if (/bytes/i.test(message)) return { text: AI_TOO_BIG_ERROR, action: ACTION_CONTENT };
  if (/escena|identificador/i.test(message)) return { text: AI_NOTHING_ERROR, action: ACTION_CONTENT };
  return { text: message };
}

/**
 * Último filtro del texto del modelo: «escena(s)» → «sección(es)». Nunca
 * debería hacer falta (las instrucciones lo prohíben), pero es jerga interna.
 */
export function plainSpanish(text: string): string {
  return text
    .replace(/\bescenas\b/g, "secciones")
    .replace(/\bEscenas\b/g, "Secciones")
    .replace(/\besta escena\b/g, "esta sección")
    .replace(/\bla escena\b/g, "la sección")
    .replace(/\buna escena\b/g, "una sección")
    .replace(/\bescena\b/g, "sección")
    .replace(/\bEscena\b/g, "Sección");
}

export function joinEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}
