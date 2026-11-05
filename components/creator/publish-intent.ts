/**
 * «Crear cuenta y publicar» en un paso (revisión UX, ítem 6).
 *
 * Sin sesión, el botón del creador guarda el borrador, deja esta marca en el
 * localStorage de ESTE navegador y manda a /login?registro=1. Tras crear la
 * cuenta y confirmar el correo (código o enlace), `postLoginPath` lleva a
 * /onboarding; si el asistente encuentra la marca vigente, la consume (la
 * borra ANTES de crear: recargar o volver atrás no vuelve a disparar) y crea
 * y publica la web sola, con el progreso de siempre (finish-wedding.ts).
 *
 * La marca NUNCA viaja en la copia del servidor (`builder_draft_stash`):
 * cualquiera puede dejar una copia para un correo ajeno (builder-stash.ts), y
 * esa copia se anuncia y se puede descartar, nunca se adopta en silencio.
 * Publicarla sola la adoptaría en silencio, así que si el enlace del correo se
 * abre en otro navegador, el asistente abre el borrador recuperado con su
 * aviso y la pareja publica con un toque.
 *
 * La marca va atada a una cuenta (revisión del bloque 2, I-2): al pedir el
 * correo en /login?registro=1 se le añade el email escrito, y el asistente
 * solo publica solo si la sesión es de ese mismo correo. Una marca sin correo
 * (o de otro) no publica nada: en un ordenador compartido, el borrador
 * abandonado de otra persona nunca se publica bajo otra cuenta.
 *
 * Se borra: al usarse (publique o no), al volver a /crear sin sesión (se lo
 * han pensado), al entrar en /login sin `registro=1` (ahí aterrizan todos los
 * «Cerrar sesión») y a las 24 h. Sin almacenamiento, no hay marca y todo
 * sigue como antes (un toque más).
 */

export const PUBLISH_INTENT_KEY = "vinklo:publish-intent:v1";
export const PUBLISH_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** La marca guardada: cuándo se pulsó y, desde /login, con qué correo. */
export type PublishIntent = { at: number; email: string | null };

/** localStorage si existe y se deja usar (modo privado, bloqueos: null). */
export function browserStorage(): IntentStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Correos comparables: sin espacios y en minúsculas. */
export function normalizeIntentEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

function write(storage: IntentStorage, intent: PublishIntent): boolean {
  try {
    storage.setItem(PUBLISH_INTENT_KEY, JSON.stringify({ at: new Date(intent.at).toISOString(), ...(intent.email ? { email: intent.email } : {}) }));
    return true;
  } catch {
    return false;
  }
}

/** Deja la marca (con su hora, aún sin correo). true si quedó guardada. */
export function markPublishIntent(storage: IntentStorage | null, now: number = Date.now()): boolean {
  if (!storage) return false;
  return write(storage, { at: now, email: null });
}

/**
 * Marca vigente (de las últimas 24 h, no del futuro) o null. Una marca en el
 * formato anterior (solo la hora) o rota cuenta como «no hay». Nunca lanza.
 */
export function readPublishIntent(storage: IntentStorage | null, now: number = Date.now()): PublishIntent | null {
  if (!storage) return null;
  let raw: string | null = null;
  try { raw = storage.getItem(PUBLISH_INTENT_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const { at: rawAt, email } = parsed as { at?: unknown; email?: unknown };
  const at = typeof rawAt === "string" ? Date.parse(rawAt) : Number.NaN;
  if (Number.isNaN(at)) return null;
  if (at > now + 60_000 || now - at > PUBLISH_INTENT_TTL_MS) return null;
  return { at, email: typeof email === "string" ? normalizeIntentEmail(email) : null };
}

/**
 * /login?registro=1, al pedir el correo: ata la marca vigente a ese email
 * (el último escrito manda). Sin marca, no hace nada. true si quedó atada.
 */
export function bindPublishIntent(storage: IntentStorage | null, email: string, now: number = Date.now()): boolean {
  const intent = readPublishIntent(storage, now);
  const normalized = normalizeIntentEmail(email);
  if (!storage || !intent || !normalized) return false;
  return write(storage, { at: intent.at, email: normalized });
}

/** ¿Hay marca vigente? Con `email`, solo si está atada a ese mismo correo. Nunca lanza. */
export function hasPublishIntent(storage: IntentStorage | null, now: number = Date.now(), email?: string | null): boolean {
  const intent = readPublishIntent(storage, now);
  if (!intent) return false;
  if (email === undefined) return true;
  const normalized = normalizeIntentEmail(email);
  return normalized !== null && intent.email === normalized;
}

/** Borra la marca. Nunca lanza. */
export function clearPublishIntent(storage: IntentStorage | null): void {
  try { storage?.removeItem(PUBLISH_INTENT_KEY); } catch { /* Sin almacenamiento: no había marca. */ }
}

/** Lee y borra en un paso: solo la primera lectura dice true. */
export function consumePublishIntent(storage: IntentStorage | null, now: number = Date.now()): boolean {
  const intent = hasPublishIntent(storage, now);
  clearPublishIntent(storage);
  return intent;
}

/**
 * Qué hace el asistente al abrirse con sesión:
 *  - `none`: no hay intención de publicar (o no hay sesión): como siempre;
 *  - `wait`: aún se están recuperando el borrador, la foto o «Más fotos»
 *    (publicar ya las perdería sin avisar);
 *  - `review`: la intención existe, pero no se publica sola: es de otro
 *    correo (o de ninguno), hay una invitación de pareja pendiente (crearían
 *    una segunda boda), el borrador es la copia del servidor (otro
 *    navegador) o falta la foto que eligieron. Ven el asistente de siempre y
 *    publican con un toque, con los avisos que ya existen;
 *  - `missing`: falta algo imprescindible: se abre ese campo con su aviso;
 *  - `publish`: se crea y publica sola.
 */
export type AutoPublishDecision = "none" | "wait" | "review" | "missing" | "publish";

export function autoPublishDecision(input: {
  authenticated: boolean;
  intent: boolean;
  /** La marca está atada al correo de la sesión. */
  sameAccount: boolean;
  /** /onboarding avisa de una invitación de pareja pendiente para este correo. */
  pendingInvite: boolean;
  /** Ya están el borrador, la foto y las fotos de la galería de este navegador. */
  resolved: boolean;
  /** El borrador abierto es la copia del servidor (otro navegador). */
  recovered: boolean;
  /** El borrador dice que había foto y este navegador no la tiene. */
  photoLost: boolean;
  /** Falta algo imprescindible (`essentialIssue`). */
  incomplete: boolean;
}): AutoPublishDecision {
  if (!input.authenticated || !input.intent) return "none";
  // Antes de esperar a nada: estos casos nunca publican solos.
  if (!input.sameAccount || input.pendingInvite) return "review";
  if (!input.resolved) return "wait";
  if (input.recovered || input.photoLost) return "review";
  if (input.incomplete) return "missing";
  return "publish";
}

/**
 * El «una sola vez» del asistente, fuera de React para poder probarlo
 * (revisión del bloque 2, I-1). Lo usan el efecto de la publicación
 * automática y `create()`:
 *  - `step(input)`: el efecto lo llama en cada render; devuelve qué hacer y,
 *    salvo `wait`, ya no vuelve a decidir (borra la marca si la había);
 *  - `claim()`: `create()` lo llama antes de crear. false si ya hay una
 *    creación en marcha (un toque durante la espera, o el efecto y el botón
 *    a la vez): nunca hay dos `createWeddingFromCreator` seguidos. Reclamar
 *    también cierra la decisión automática y borra la marca;
 *  - `release()`: la creación falló y se puede volver a intentar a mano.
 */
export type AutoPublishInput = Omit<Parameters<typeof autoPublishDecision>[0], "intent" | "sameAccount"> & { email: string | null };

export function createAutoPublishGate(storage: () => IntentStorage | null, now: () => number = Date.now) {
  let settled = false;
  let inFlight = false;
  return {
    step(input: AutoPublishInput): AutoPublishDecision | null {
      if (settled || inFlight) return null;
      const store = storage();
      // Sin sesión (/crear): la marca se borra al abrir (se lo han pensado).
      if (!input.authenticated) { settled = true; clearPublishIntent(store); return "none"; }
      const at = now();
      const decision = autoPublishDecision({ ...input, intent: hasPublishIntent(store, at), sameAccount: hasPublishIntent(store, at, input.email) });
      if (decision === "wait") return decision;
      settled = true;
      if (decision !== "none") clearPublishIntent(store);
      return decision;
    },
    claim(): boolean {
      if (inFlight) return false;
      inFlight = true;
      settled = true;
      clearPublishIntent(storage());
      return true;
    },
    release(): void { inFlight = false; },
  };
}
