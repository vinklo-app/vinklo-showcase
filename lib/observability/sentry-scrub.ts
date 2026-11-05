import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Nada de datos personales en Sentry: el enlace personal del invitado va en
 * `?invitacion=` (es un secreto), y cookies, cabeceras y cuerpos pueden llevar
 * sesión, nombres o alergias. Se quitan antes de enviar el evento.
 */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Enlace personal en cualquier texto (mensaje, transacción, error): `invitacion=…` o un token/hash de 64 hex. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(invitacion|token|t)(=|%3D)[^&#\s"']+/gi, "$1$2[redactado]"],
  [/\b[a-f0-9]{48,}\b/gi, "[redactado]"],
  // Enlace personal del proveedor: /v/<uuid> es un secreto de acceso.
  [/\/v\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/v/[redactado]"],
];
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/**
 * Recorre el evento y redacta cada texto por separado. No se serializa a JSON
 * y se vuelve a parsear: una redacción que se comiera un escape rompería el
 * parse y el evento se perdería (un enlace manipulado podría esconder errores).
 */
function redactDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = redactDeep(value[i], seen);
    return value;
  }
  for (const key of Object.keys(value)) (value as Record<string, unknown>)[key] = redactDeep((value as Record<string, unknown>)[key], seen);
  return value;
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }
  delete event.user;
  // Los console.* pueden llevar cualquier cosa: fuera.
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.filter((crumb) => crumb.category !== "console");
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data && typeof crumb.data.url === "string") crumb.data.url = stripQuery(crumb.data.url);
    if (crumb.data && typeof crumb.data.to === "string") crumb.data.to = stripQuery(crumb.data.to);
    if (crumb.data && typeof crumb.data.from === "string") crumb.data.from = stripQuery(crumb.data.from);
  }
  // Última red: cualquier texto que quede (transacción, mensajes, errores,
  // contextos) pasa por la redacción de secretos.
  return redactDeep(event, new WeakSet()) as T;
}

/** Opciones comunes a servidor, edge y navegador. Sin DSN, Sentry no se activa. */
export const sentryBaseOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  beforeSend: scrubEvent,
  beforeSendTransaction: () => null,
};
