/**
 * Conversación de «Pedid cambios» guardada en el navegador (13-oct-2026): la
 * pareja ve lo que pidió y lo que se respondió aunque recargue.
 *
 *  - Creador (`"all"`): todo el hilo y las últimas versiones (con su
 *    documento, para «Restaurar» y «Deshacer»), junto al borrador local.
 *  - Panel (`"errors"`): solo las peticiones que NO se aplicaron; las que sí,
 *    ya están en `wedding_site_drafts_history` (servidor) y vuelven con
 *    `load`.
 *
 * Solo guarda lo que escribió la pareja y nuestras respuestas: nunca datos de
 * invitados (el documento de la web no los tiene). Una petición en marcha al
 * recargar queda como «se interrumpió», con «Probar de nuevo».
 * Puro: serializar y leer; quien lo usa decide la clave y el almacenamiento.
 */
import { parseSiteDocument } from "@/lib/site-document";
import { PROMPT_MAX, type SiteVersion, type ThreadState, type Turn } from "./thread";

export const CREATOR_CHAT_STORAGE_KEY = "vinklo:creator-chat:v1";
/**
 * Fecha de edición (`updatedAt`) del borrador al que pertenece la conversación
 * guardada. Se escribe junto al borrador; si el borrador que se abre es otro
 * (p. ej. la copia del servidor traída de otro dispositivo), la conversación
 * guardada no se enseña: «Restaurar» adoptaría documentos de otro borrador.
 */
export const CREATOR_CHAT_DRAFT_KEY = "vinklo:creator-chat:v1:draft";

export const panelChatStorageKey = (weddingId: string) => `vinklo:site-chat-errors:v1:${weddingId}`;

export type ChatPersistMode = "all" | "errors";

/** Versiones con documento que se guardan en el creador (el resto del hilo, como texto). */
export const STORED_VERSIONS = 10;
const STORED_TURNS = 60;
const STORED_ERRORS = 20;

export const INTERRUPTED_ERROR = "Se interrumpió al recargar la página. Probad de nuevo.";

interface Stored { v: 1; turns: Turn[]; versions: SiteVersion[] }

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const list = (value: unknown, max = 40) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 200)) : []);

/** Lo que se guarda del hilo. La petición en curso se guarda como interrumpida. */
export function serializeThread(state: ThreadState, mode: ChatPersistMode, maxVersions = STORED_VERSIONS): string {
  const turns = state.turns.map((turn): Turn => (turn.status === "working"
    ? { id: turn.id, kind: "ai", prompt: turn.prompt, ...(turn.focusLabel ? { focusLabel: turn.focusLabel } : {}), ...(turn.at ? { at: turn.at } : {}), status: "error", error: INTERRUPTED_ERROR, retryable: true }
    : turn));
  if (mode === "errors") {
    // Una petición en marcha no se guarda: pudo llegar a guardarse en el
    // servidor y, al recargar, «Probar de nuevo» la aplicaría dos veces.
    const failed = state.turns.filter((t) => t.kind === "ai" && t.status === "error");
    const stored: Stored = { v: 1, turns: failed.slice(-STORED_ERRORS), versions: [] };
    return JSON.stringify(stored);
  }
  const initial = state.versions.find((v) => v.kind === "initial");
  const rest = maxVersions > 0 ? state.versions.filter((v) => v.kind !== "initial").slice(-maxVersions) : [];
  const stored: Stored = { v: 1, turns: turns.slice(-STORED_TURNS), versions: initial ? [initial, ...rest] : rest };
  return JSON.stringify(stored);
}

function parseTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = text(t.id, 80);
  if (!id) return null;
  const at = typeof t.at === "string" && !Number.isNaN(Date.parse(t.at)) ? { at: t.at } : {};
  const action = t.action && typeof t.action === "object" && typeof (t.action as { label?: unknown }).label === "string" && typeof (t.action as { target?: unknown }).target === "string"
    ? { action: { label: text((t.action as { label: string }).label, 80), target: text((t.action as { target: string }).target, 80) } }
    : {};
  if (t.kind === "manual" || t.kind === "restore") {
    if (t.status !== "done") return null;
    return { id, kind: t.kind, ...at, status: "done", versionId: text(t.versionId, 80), summary: text(t.summary, 1200), changes: list(t.changes) };
  }
  if (t.kind !== "ai") return null;
  const base = { id, kind: "ai" as const, prompt: text(t.prompt, PROMPT_MAX), ...(typeof t.focusLabel === "string" ? { focusLabel: text(t.focusLabel, 120) } : {}), ...at };
  if (t.status === "done") {
    const dropped = list(t.dropped);
    return { ...base, status: "done", versionId: text(t.versionId, 80), summary: text(t.summary, 1200), changes: list(t.changes), ...(dropped.length ? { dropped } : {}), ...action };
  }
  if (t.status === "error" || t.status === "working") {
    return t.status === "error"
      ? { ...base, status: "error", error: text(t.error, 1200) || INTERRUPTED_ERROR, retryable: t.retryable === true, ...action }
      : { ...base, status: "error", error: INTERRUPTED_ERROR, retryable: true };
  }
  return null;
}

function parseVersion(raw: unknown): SiteVersion | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const kind = v.kind;
  if (kind !== "ai" && kind !== "manual" && kind !== "restore" && kind !== "initial") return null;
  const document = parseSiteDocument(v.document);
  if (!document.ok) return null;
  const id = text(v.id, 80);
  if (!id) return null;
  return {
    id, kind,
    createdAt: typeof v.createdAt === "string" && !Number.isNaN(Date.parse(v.createdAt)) ? v.createdAt : new Date(0).toISOString(),
    prompt: text(v.prompt, PROMPT_MAX), summary: text(v.summary, 1200), changes: list(v.changes),
    document: document.document,
    draftVersion: typeof v.draftVersion === "number" ? v.draftVersion : null,
  };
}

/** Lee lo guardado (nunca lanza). null si no hay nada que valga. */
export function parseStoredThread(raw: string | null, mode: ChatPersistMode): ThreadState | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) return null;
  const stored = value as { turns?: unknown; versions?: unknown };
  const turns = (Array.isArray(stored.turns) ? stored.turns : []).map(parseTurn).filter((t): t is Turn => t !== null);
  if (mode === "errors") {
    const errors = turns.filter((t) => t.kind === "ai" && t.status === "error").slice(-STORED_ERRORS);
    return errors.length > 0 ? { turns: errors, versions: [] } : null;
  }
  const versions = (Array.isArray(stored.versions) ? stored.versions : []).map(parseVersion).filter((v): v is SiteVersion => v !== null);
  return turns.length > 0 || versions.length > 0 ? { turns: turns.slice(-STORED_TURNS), versions } : null;
}
