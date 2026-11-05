"use client";

/**
 * Motor del chat del editor (como Lovable), compartido por el panel y el
 * creador. Cada petición:
 *   1. entra al hilo como mensaje de la pareja;
 *   2. la respuesta enseña su progreso: «Leyendo vuestra web…» mientras se
 *      envía, «Cambiando Preguntas…» (si hay algo seleccionado) o «Preparando
 *      los cambios…» mientras la IA responde (no hay streaming: son fases
 *      honestas por tiempo, sin afirmar nada concreto) y «Guardando en el
 *      borrador…» mientras se guarda de verdad;
 *   3. el cambio se APLICA al momento (`commit`): en el panel, borrador con la
 *      versión leída al pedirlo; en el creador, el borrador local;
 *   4. acaba con el resumen, los cambios y chips de siguiente petición.
 * «Restaurar esta versión» y «Deshacer» guardan un documento anterior como
 * versión NUEVA. Nada llega a los invitados hasta publicar.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ProposeSiteEditResult } from "@/lib/ai/site-editor";
import type { SiteDocument } from "@/lib/site-document";
import { restoredDocument, type SaveOutcome } from "@/lib/site-chat/restore";
import { parseStoredThread, serializeThread, type ChatPersistMode } from "@/lib/site-chat/persist";
import { EMPTY_THREAD, findVersion, hasWorkingTurn, restoreSummary, threadReducer, undoTarget, type SiteVersion, type SiteVersionRow, type ThreadState, type VersionKind } from "@/lib/site-chat/thread";

export const AI_UNAVAILABLE = "La edición con IA no está disponible ahora mismo.";
/** Pasado este tiempo esperando a la IA, la fase dice «Preparando…» en vez de «Leyendo…». */
const READING_MS = 1400;

export interface ChatFocus {
  /** Chip: «Preguntas · ¿Hay aparcamiento?». */
  label: string;
  /** Pista para la IA (`describeEditTarget().focus`). */
  focus: string;
}

export interface SiteChatHost {
  /** Documento y versión sobre los que se calcula la petición (espera a guardados en vuelo). */
  snapshot(): Promise<{ document: SiteDocument; base: number | null }>;
  propose(input: { instruction: string; document: SiteDocument; focus?: string }): Promise<ProposeSiteEditResult>;
  /** Aplica el documento (borrador). `base`: la versión del snapshot. */
  commit(document: SiteDocument, base: number | null, entry: { kind: VersionKind; prompt: string; summary: string; changes: string[] }): Promise<SaveOutcome>;
  /** Otra pestaña o la pareja guardó antes: recargar lo último. */
  onConflict?(): void;
}

/**
 * Dónde se guarda la conversación en este navegador (lib/site-chat/persist.ts).
 * `storageKey` null = no se guarda (p. ej. aún sin boda).
 */
export interface SiteChatPersist {
  storageKey: string | null;
  mode: ChatPersistMode;
}

let localIds = 0;
const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(localIds++).toString(36)}`;

export function useSiteChat(host: SiteChatHost, persist?: SiteChatPersist) {
  const [state, dispatch] = useReducer(threadReducer, EMPTY_THREAD);
  const stateRef = useRef<ThreadState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Conversación guardada: se recupera al abrir y se guarda en cada cambio.
  // `hydrated`: no se escribe nada hasta haber leído lo guardado (si no, el
  // hilo vacío del primer render lo borraría).
  const storageKey = persist?.storageKey ?? null;
  const mode = persist?.mode ?? "all";
  const hydrated = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey || hydrated.current === storageKey) return;
    let stored = null;
    try { stored = parseStoredThread(localStorage.getItem(storageKey), mode); } catch { /* Navegación privada: sin almacenamiento. */ }
    if (stored) dispatch({ type: "hydrate", state: stored });
    hydrated.current = storageKey;
  }, [storageKey, mode]);
  useEffect(() => {
    if (!storageKey || hydrated.current !== storageKey) return;
    try {
      if (state.turns.length === 0 && state.versions.every((v) => v.kind === "initial")) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, serializeThread(state, mode));
    } catch {
      // Sin sitio: al menos el hilo como texto (sin los documentos de las versiones).
      try { localStorage.setItem(storageKey, serializeThread(state, mode, 0)); } catch { /* Sin almacenamiento. */ }
    }
  }, [state, storageKey, mode]);
  const hostRef = useRef(host);
  useEffect(() => { hostRef.current = host; }, [host]);
  /** Petición y foco de cada turno, para «Probar de nuevo». */
  const requests = useRef(new Map<string, { prompt: string; focus?: ChatFocus }>());
  const cancelled = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending.values()) window.clearTimeout(timer); };
  }, []);

  const seed = useCallback((document: SiteDocument, draftVersion: number | null) => {
    dispatch({ type: "seed", version: { id: "inicio", kind: "initial", createdAt: new Date().toISOString(), prompt: "", summary: "Como estaba al abrir el editor.", changes: [], document, draftVersion } });
  }, []);
  /** Sin versión de partida (creador), la primera es lo que había antes del primer cambio: destino de «Deshacer». */
  const seedIfEmpty = useCallback((document: SiteDocument, draftVersion: number | null) => {
    if (stateRef.current.versions.length === 0) seed(document, draftVersion);
  }, [seed]);
  const load = useCallback((rows: SiteVersionRow[]) => dispatch({ type: "load", rows }), []);

  const ask = useCallback(async (raw: string, focus?: ChatFocus) => {
    const prompt = raw.trim();
    if (!prompt || hasWorkingTurn(stateRef.current)) return;
    const id = localId("t");
    requests.current.set(id, { prompt, focus });
    dispatch({ type: "send", id, prompt, focusLabel: focus?.label });
    timers.current.set(id, window.setTimeout(() => dispatch({ type: "stage", id, stage: "changing" }), READING_MS));
    const clear = () => { const t = timers.current.get(id); if (t !== undefined) window.clearTimeout(t); timers.current.delete(id); };

    const { document, base } = await hostRef.current.snapshot();
    seedIfEmpty(document, base);
    let result: ProposeSiteEditResult;
    try {
      result = await hostRef.current.propose({ instruction: prompt, document, ...(focus ? { focus: focus.focus } : {}) });
    } catch {
      // 504 por duración de la función, red caída o acción rechazada.
      result = { ok: false, error: AI_UNAVAILABLE };
    }
    clear();
    if (cancelled.current.has(id)) return;
    if (!result.ok) {
      const error = result.error || AI_UNAVAILABLE;
      dispatch({ type: "fail", id, error, retryable: error === AI_UNAVAILABLE, action: result.action });
      return;
    }
    dispatch({ type: "stage", id, stage: "saving" });
    const saved = await hostRef.current.commit(result.document, base, { kind: "ai", prompt, summary: result.summary, changes: result.changes });
    if (cancelled.current.has(id)) return;
    if (!saved.ok) {
      dispatch({ type: "fail", id, error: saved.error, retryable: saved.retryable });
      if (saved.conflict) hostRef.current.onConflict?.();
      return;
    }
    const version: SiteVersion = { id: saved.historyId ?? localId("v"), kind: "ai", createdAt: saved.createdAt ?? new Date().toISOString(), prompt, summary: result.summary, changes: result.changes, document: result.document, draftVersion: saved.draftVersion };
    dispatch({ type: "succeed", id, version, dropped: result.dropped, action: result.action });
  }, [seedIfEmpty]);

  const cancel = useCallback((id: string) => {
    cancelled.current.add(id);
    const t = timers.current.get(id);
    if (t !== undefined) window.clearTimeout(t);
    dispatch({ type: "cancel", id });
  }, []);

  const retry = useCallback((id: string) => {
    // Tras recargar no queda la petición en memoria: se repite el texto del turno (sin el foco).
    const turn = stateRef.current.turns.find((t) => t.id === id);
    const request = requests.current.get(id) ?? (turn?.kind === "ai" ? { prompt: turn.prompt } : undefined);
    dispatch({ type: "cancel", id });
    if (request) void ask(request.prompt, request.focus);
  }, [ask]);

  /** Empieza de cero (p. ej. al descartar el borrador del creador). */
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    if (storageKey) { try { localStorage.removeItem(storageKey); } catch { /* Sin almacenamiento. */ } }
  }, [storageKey]);

  /** Guarda un documento como versión nueva (a mano o restaurada). */
  const record = useCallback(async (document: SiteDocument | ((current: SiteDocument) => SiteDocument), entry: { kind: "manual" | "restore"; summary: string; changes: string[] }): Promise<SaveOutcome> => {
    const snap = await hostRef.current.snapshot();
    seedIfEmpty(snap.document, snap.base);
    const next = typeof document === "function" ? document(snap.document) : document;
    const saved = await hostRef.current.commit(next, snap.base, { kind: entry.kind, prompt: "", summary: entry.summary, changes: entry.changes });
    if (saved.ok) {
      dispatch({ type: "record", version: { id: saved.historyId ?? localId("v"), kind: entry.kind, createdAt: saved.createdAt ?? new Date().toISOString(), prompt: "", summary: entry.summary, changes: entry.changes, document: next, draftVersion: saved.draftVersion } });
    } else if (saved.conflict) {
      hostRef.current.onConflict?.();
    }
    return saved;
  }, [seedIfEmpty]);

  const restore = useCallback((versionId: string, undo = false) => {
    const target = findVersion(stateRef.current, versionId);
    if (!target) return Promise.resolve<SaveOutcome>({ ok: false, conflict: false, error: "Esa versión ya no está en el historial.", retryable: false });
    return record((current) => restoredDocument(target.document, current), { kind: "restore", summary: restoreSummary(target, undo), changes: [] });
  }, [record]);

  const undoLast = useCallback(() => {
    const target = undoTarget(stateRef.current);
    if (!target) return Promise.resolve<SaveOutcome>({ ok: false, conflict: false, error: "No hay nada que deshacer.", retryable: false });
    return restore(target.id, true);
  }, [restore]);

  /** Apunta una versión ya guardada por otro camino (colores, apertura… a mano). */
  const push = useCallback((version: SiteVersion) => dispatch({ type: "record", version }), []);

  return { state, seed, load, ask, cancel, retry, record, restore, undoLast, push, reset, busy: hasWorkingTurn(state) };
}
