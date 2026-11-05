/**
 * Conversación del editor con IA (como Lovable): cada petición es un turno
 * (mensaje de la pareja + respuesta que enseña su progreso y acaba con el
 * resumen y los cambios) y cada cambio aplicado es una VERSIÓN del borrador.
 * «Restaurar esta versión» y «Deshacer» guardan un documento anterior como
 * borrador NUEVO: nunca se borra nada. Nada llega a los invitados hasta
 * publicar.
 *
 * Puro y client-safe (sin zod): lo usan el editor del panel (historial en
 * `wedding_site_drafts_history`; lo que falló, en el navegador), el creador
 * (todo en el navegador, junto al borrador: persist.ts) y los tests.
 */
import type { AiAction } from "@/lib/ai/messages";
import type { SiteDocument } from "@/lib/site-document";

export type VersionKind = "ai" | "manual" | "restore";

/** Una versión del borrador. `initial`: como estaba al abrir (solo en memoria, destino de «Deshacer»). */
export interface SiteVersion {
  id: string;
  kind: VersionKind | "initial";
  createdAt: string;
  /** Petición de la pareja (≤ 600), vacía en las de a mano. */
  prompt: string;
  summary: string;
  changes: string[];
  document: SiteDocument;
  /** Versión del borrador que se guardó (null en el creador, sin base de datos). */
  draftVersion: number | null;
  /** Quién la hizo (para decir «vuestra pareja» si no fuisteis vosotros). */
  authorId?: string | null;
}

/** Fila de la tabla (lo que devuelve el servidor). */
export type SiteVersionRow = Omit<SiteVersion, "kind"> & { kind: VersionKind };

export type TurnStage = "reading" | "changing" | "saving";

/** `at`: cuándo se pidió (ISO). Ordena el hilo al juntar lo guardado con el historial del servidor. */
export type Turn =
  | { id: string; kind: "ai"; prompt: string; focusLabel?: string; at?: string; status: "working"; stage: TurnStage }
  | { id: string; kind: "ai"; prompt: string; focusLabel?: string; at?: string; status: "done"; versionId: string; summary: string; changes: string[]; dropped?: string[]; action?: AiAction }
  | { id: string; kind: "ai"; prompt: string; focusLabel?: string; at?: string; status: "error"; error: string; retryable: boolean; action?: AiAction }
  /** Retoque a mano o restauración: una línea del hilo con su versión. */
  | { id: string; kind: "manual" | "restore"; at?: string; status: "done"; versionId: string; summary: string; changes: string[] };

export interface ThreadState {
  turns: Turn[];
  /** Versiones en orden cronológico (la última es el borrador actual). */
  versions: SiteVersion[];
}

export const HISTORY_LIMIT = 50;
export const PROMPT_MAX = 600;

export const EMPTY_THREAD: ThreadState = { turns: [], versions: [] };

export type ThreadAction =
  | { type: "seed"; version: SiteVersion }
  | { type: "load"; rows: SiteVersionRow[] }
  /** Conversación guardada en este navegador (al abrir). Solo si el hilo sigue vacío. */
  | { type: "hydrate"; state: ThreadState }
  | { type: "reset" }
  | { type: "send"; id: string; prompt: string; focusLabel?: string; at?: string }
  | { type: "stage"; id: string; stage: TurnStage }
  | { type: "succeed"; id: string; version: SiteVersion; dropped?: string[]; action?: AiAction }
  | { type: "fail"; id: string; error: string; retryable: boolean; action?: AiAction }
  | { type: "cancel"; id: string }
  | { type: "record"; version: SiteVersion };

function capVersions(versions: SiteVersion[]): SiteVersion[] {
  // Se conserva la inicial (destino de «Deshacer») aunque haya 50 más.
  const initial = versions.find((v) => v.kind === "initial");
  const rest = versions.filter((v) => v.kind !== "initial");
  const kept = rest.slice(-HISTORY_LIMIT);
  return initial ? [initial, ...kept] : kept;
}

/** Orden cronológico estable; los turnos sin hora se quedan al final en su orden. */
function byTime(turns: Turn[]): Turn[] {
  return turns
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => {
      if (a.turn.at && b.turn.at && a.turn.at !== b.turn.at) return a.turn.at.localeCompare(b.turn.at);
      if (Boolean(a.turn.at) !== Boolean(b.turn.at)) return a.turn.at ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ turn }) => turn);
}

function turnFromVersion(version: SiteVersionRow | SiteVersion): Turn | null {
  if (version.kind === "initial") return null;
  if (version.kind === "ai") {
    return { id: `t-${version.id}`, kind: "ai", prompt: version.prompt, at: version.createdAt, status: "done", versionId: version.id, summary: version.summary, changes: version.changes };
  }
  return { id: `t-${version.id}`, kind: version.kind, at: version.createdAt, status: "done", versionId: version.id, summary: version.summary, changes: version.changes };
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "seed":
      if (state.versions.some((v) => v.id === action.version.id)) return state;
      return { ...state, versions: [action.version, ...state.versions] };
    case "load": {
      // El historial del servidor manda; se conservan los turnos en curso o con
      // error (aún no tienen fila) y la versión inicial.
      const rows = [...action.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-HISTORY_LIMIT);
      const initial = state.versions.find((v) => v.kind === "initial");
      const pending = state.turns.filter((t) => t.status !== "done");
      const turns = rows.map(turnFromVersion).filter((t): t is Turn => t !== null);
      return { turns: byTime([...turns, ...pending]), versions: initial ? [initial, ...rows] : [...rows] };
    }
    case "reset":
      return EMPTY_THREAD;
    case "hydrate":
      // Solo sobre un hilo sin turnos (lo de esta sesión manda); las versiones
      // ya cargadas (p. ej. la inicial del panel) se conservan.
      if (state.turns.length > 0) return state;
      return { turns: byTime(action.state.turns), versions: state.versions.length > 0 ? state.versions : capVersions(action.state.versions) };
    case "send":
      return { ...state, turns: [...state.turns, { id: action.id, kind: "ai", prompt: action.prompt.slice(0, PROMPT_MAX), ...(action.focusLabel ? { focusLabel: action.focusLabel } : {}), at: action.at ?? new Date().toISOString(), status: "working", stage: "reading" }] };
    case "stage":
      return { ...state, turns: state.turns.map((t) => (t.id === action.id && t.status === "working" ? { ...t, stage: action.stage } : t)) };
    case "succeed":
      return {
        turns: state.turns.map((t) => (t.id === action.id && t.kind === "ai"
          ? { id: t.id, kind: "ai", prompt: t.prompt, ...(t.focusLabel ? { focusLabel: t.focusLabel } : {}), ...(t.at ? { at: t.at } : {}), status: "done", versionId: action.version.id, summary: action.version.summary, changes: action.version.changes, ...(action.dropped?.length ? { dropped: action.dropped } : {}), ...(action.action ? { action: action.action } : {}) }
          : t)),
        versions: capVersions([...state.versions, action.version]),
      };
    case "fail":
      return { ...state, turns: state.turns.map((t) => (t.id === action.id && t.kind === "ai" ? { id: t.id, kind: "ai", prompt: t.prompt, ...(t.focusLabel ? { focusLabel: t.focusLabel } : {}), ...(t.at ? { at: t.at } : {}), status: "error", error: action.error, retryable: action.retryable, ...(action.action ? { action: action.action } : {}) } : t)) };
    case "cancel":
      return { ...state, turns: state.turns.filter((t) => t.id !== action.id) };
    case "record": {
      const turn = turnFromVersion(action.version);
      return { turns: turn ? [...state.turns, turn] : state.turns, versions: capVersions([...state.versions, action.version]) };
    }
  }
}

/** Versión actual (la última). */
export function currentVersion(state: ThreadState): SiteVersion | null {
  return state.versions[state.versions.length - 1] ?? null;
}

/** Destino de «Deshacer»: la versión anterior a la actual (null si no hay). */
export function undoTarget(state: ThreadState): SiteVersion | null {
  if (state.versions.length < 2) return null;
  return state.versions[state.versions.length - 2] ?? null;
}

/** ¿Se puede restaurar esta versión? No la actual ni una que ya no existe. */
export function canRestore(state: ThreadState, versionId: string): boolean {
  const current = currentVersion(state);
  return Boolean(current && current.id !== versionId && state.versions.some((v) => v.id === versionId));
}

/** El turno de la versión actual (para enseñar «Deshacer» solo en él). */
export function isLatestVersion(state: ThreadState, versionId: string): boolean {
  return currentVersion(state)?.id === versionId;
}

/** Turnos con la petición en marcha. */
export function hasWorkingTurn(state: ThreadState): boolean {
  return state.turns.some((t) => t.status === "working");
}

export function findVersion(state: ThreadState, versionId: string): SiteVersion | null {
  return state.versions.find((v) => v.id === versionId) ?? null;
}

/** Hora corta para el hilo («12:05», «ayer 18:30», «3 oct»). */
export function versionTime(createdAt: string, now = new Date()): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date);
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day(date) === day(now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(yesterday)) return `ayer ${time}`;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(date);
}

/** Resumen de una restauración, con la hora de la versión restaurada. */
export function restoreSummary(target: SiteVersion, undo: boolean): string {
  if (undo) return "Deshecho el último cambio.";
  if (target.kind === "initial") return "Restaurada la web como estaba al abrir el editor.";
  const when = versionTime(target.createdAt);
  return `Restaurada la versión${when ? (/^\d/.test(when) ? ` de las ${when}` : ` de ${when}`) : ""}${target.prompt ? `: «${target.prompt.length > 60 ? `${target.prompt.slice(0, 59)}…` : target.prompt}»` : ""}.`;
}
