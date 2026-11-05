"use client";

/**
 * Chat del editor (como Lovable): hilo de turnos con su progreso, versiones
 * restaurables y el compositor con «Seleccionar» y edición a mano del texto
 * seleccionado. Lo usan el panel (Vuestra web) y el creador. La lógica está
 * en `use-site-chat.ts` y `lib/site-chat/*`; aquí solo la interfaz.
 *
 * Textos: «vosotros» a la pareja, siempre «secciones» (nunca la jerga interna), sin emojis.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUpIcon, MousePointerClickIcon, PencilIcon, RotateCcwIcon, Undo2Icon, XIcon } from "lucide-react";
import { AiActionLink } from "@/components/creator/ai-edit";
import { SITE_EDIT_MAX_INSTRUCTION } from "@/lib/ai/messages";
import { changePromptFor, type EditTarget } from "@/lib/site-chat/edit-focus";
import type { SaveOutcome } from "@/lib/site-chat/restore";
import { canRestore, findVersion, isLatestVersion, undoTarget, versionTime, type Turn, type TurnStage } from "@/lib/site-chat/thread";
import type { useSiteChat } from "./use-site-chat";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";
import "./site-chat.css";

type Chat = ReturnType<typeof useSiteChat>;

/** Tras este tiempo esperando, se dice que sigue en marcha (sin prometer cuánto falta). */
const SLOW_AFTER_MS = 9000;

function stageText(stage: TurnStage, focusLabel: string | undefined, slow: boolean): string {
  if (stage === "saving") return "Guardando en el borrador…";
  if (stage === "reading") return "Leyendo vuestra web…";
  if (slow) return "Sigue en ello. Puede tardar unos segundos más.";
  return focusLabel ? `Cambiando ${focusLabel}…` : "Preparando los cambios…";
}

function Working({ turn, onCancel }: { turn: Extract<Turn, { status: "working" }>; onCancel: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="sc-working" role="status">
      <span className="sc-dots" aria-hidden="true"><span /><span /><span /></span>
      <span>{stageText(turn.stage, turn.focusLabel, slow && turn.stage === "changing")}</span>
      {turn.stage !== "saving" && <button type="button" className="sc-link" onClick={onCancel}>Cancelar</button>}
    </div>
  );
}

function VersionActions({ chat, versionId, disabled, onResult }: { chat: Chat; versionId: string; disabled: boolean; onResult: (outcome: SaveOutcome) => void }) {
  const [busy, setBusy] = useState(false);
  const latest = isLatestVersion(chat.state, versionId);
  const undo = latest ? undoTarget(chat.state) : null;
  const restorable = canRestore(chat.state, versionId);
  if (!undo && !restorable) return null;
  const run = async (job: () => Promise<SaveOutcome>) => { setBusy(true); try { onResult(await job()); } finally { setBusy(false); } };
  return (
    <div className="sc-version-actions">
      {latest && undo && (
        <button type="button" className="sc-ghost" disabled={disabled || busy} onClick={() => void run(chat.undoLast)}>
          <Undo2Icon aria-hidden="true" size={15} strokeWidth={1.75} />Deshacer
        </button>
      )}
      {!latest && restorable && (
        <button type="button" className="sc-ghost" disabled={disabled || busy} onClick={() => void run(() => chat.restore(versionId))}>
          <RotateCcwIcon aria-hidden="true" size={15} strokeWidth={1.75} />Restaurar esta versión
        </button>
      )}
    </div>
  );
}

/** Texto del compositor compartido entre el hilo (chips, «Cambiar la petición») y la caja. */
export function useComposerText() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fill = useCallback((value: string) => {
    setText(value.slice(0, SITE_EDIT_MAX_INSTRUCTION));
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);
  return { text, setText, inputRef, fill };
}
export type ComposerText = ReturnType<typeof useComposerText>;

/**
 * Turnos del hilo como <li> (el panel los pinta en su tarjeta; el creador,
 * dentro de su propia conversación). Los chips de siguiente petición van
 * bajo la última respuesta.
 */
export function ChatTurns({ chat, suggestions, composer, disabled = false, onNotice, appliedLabel = "Guardado en el borrador" }: { chat: Chat; suggestions: string[]; composer: ComposerText; disabled?: boolean; onNotice: (text: string | null) => void; /** «Guardado en el borrador» (panel) o «Aplicado en vuestra web» (creador). */ appliedLabel?: string }) {
  const { state, busy } = chat;
  const onVersionResult = (outcome: SaveOutcome) => onNotice(outcome.ok ? null : outcome.error);
  const last = state.turns[state.turns.length - 1];
  const chips = (label: string) => (
    <div className="sc-chips" role="group" aria-label={label}>
      {suggestions.map((s) => <button key={s} type="button" className="sc-chip" disabled={disabled} onClick={() => composer.fill(s)}>{s}</button>)}
    </div>
  );

  const renderTurn = (turn: Turn, index: number) => {
    const isLast = index === state.turns.length - 1;
    if (turn.kind !== "ai") {
      const version = findVersion(state, turn.versionId);
      return (
        <li key={turn.id} className="sc-line">
          {turn.kind === "restore" ? <RotateCcwIcon aria-hidden="true" size={14} strokeWidth={1.75} /> : <PencilIcon aria-hidden="true" size={14} strokeWidth={1.75} />}
          <div className="sc-line-body">
            <p>{turn.summary}{version ? <span className="sc-time"> · {versionTime(version.createdAt)}</span> : null}</p>
            <VersionActions chat={chat} versionId={turn.versionId} disabled={busy || disabled} onResult={onVersionResult} />
          </div>
        </li>
      );
    }
    const version = turn.status === "done" ? findVersion(state, turn.versionId) : null;
    return (
      <li key={turn.id} className="sc-turn">
        <div className="sc-user">
          {turn.focusLabel && <span className="sc-user-focus">{turn.focusLabel}</span>}
          <p>{turn.prompt}</p>
        </div>
        <div className="sc-assistant" data-status={turn.status}>
          <span className="sc-mark" aria-hidden="true">v.</span>
          <div className="sc-assistant-body">
            {turn.status === "working" && <Working turn={turn} onCancel={() => chat.cancel(turn.id)} />}
            {turn.status === "error" && (
              <>
                <p role="alert" className="sc-error">{turn.error}</p>
                <AiActionLink action={turn.action} className="sc-link" />
                <div className="sc-chips">
                  {turn.retryable
                    ? <button type="button" className="sc-chip" disabled={busy || disabled} onClick={() => chat.retry(turn.id)}>Probar de nuevo</button>
                    : <button type="button" className="sc-chip" disabled={disabled} onClick={() => composer.fill(turn.prompt)}>Cambiar la petición</button>}
                </div>
              </>
            )}
            {turn.status === "done" && (
              <>
                <p className="sc-summary">{turn.summary}</p>
                {turn.changes.length > 0 && (
                  <ul className="sc-changes" aria-label="Cambios">
                    {/* Pueden repetirse («Preguntas: nuevo orden»): clave por posición. */}
                    {turn.changes.map((change, k) => <li key={k}>{change}</li>)}
                  </ul>
                )}
                <AiActionLink action={turn.action} className="sc-link" />
                <p className="sc-meta">{appliedLabel}{version ? ` · ${versionTime(version.createdAt)}` : ""}</p>
                <VersionActions chat={chat} versionId={turn.versionId} disabled={busy || disabled} onResult={onVersionResult} />
              </>
            )}
            {isLast && turn.status === "done" && !busy && suggestions.length > 0 && chips("Siguientes ideas")}
          </div>
        </div>
      </li>
    );
  };

  return (
    <>
      {state.turns.map(renderTurn)}
      {last && last.kind !== "ai" && !busy && suggestions.length > 0 && <li className="sc-chips-after">{chips("Siguientes ideas")}</li>}
    </>
  );
}

export interface ChatComposerProps {
  chat: Chat;
  composer: ComposerText;
  /** Lo seleccionado en la vista previa (chip del compositor). */
  target: EditTarget | null;
  onClearTarget: () => void;
  selecting: boolean;
  onToggleSelect: () => void;
  /** Guardar a mano el texto seleccionado (versión «a mano»). Sin esto, no hay edición a mano. */
  onEditText?: (path: string, value: string) => Promise<SaveOutcome | { ok: false; error: string }>;
  /** Mensaje tras guardar (p. ej. «Guardado en el borrador…»). */
  savedNote?: string;
  /** Error de restaurar/deshacer. */
  notice?: string | null;
  disabled?: boolean;
  placeholder?: string;
  footer?: ReactNode;
}

export function ChatComposer({ chat, composer, target, onClearTarget, selecting, onToggleSelect, onEditText, savedNote, notice, disabled = false, placeholder = "Poned colores más suaves y una bienvenida más cercana", footer }: ChatComposerProps) {
  const inputId = useId();
  const { text, setText, inputRef } = composer;
  const [editing, setEditing] = useState<{ path: string; value: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const editRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const { busy } = chat;

  // Al cambiar la selección se cierra la edición a mano.
  useEffect(() => { setEditing(null); setEditError(null); }, [target?.path]);
  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing]);

  const send = () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    void chat.ask(value, target ? { label: target.label, focus: target.focus } : undefined);
    setText("");
  };

  async function saveEdit() {
    if (!editing || !onEditText) return;
    setEditBusy(true);
    setEditError(null);
    const outcome = await onEditText(editing.path, editing.value);
    setEditBusy(false);
    if (!outcome.ok) { setEditError(outcome.error); return; }
    setEditing(null);
  }

  return (
    <div className="sc-composer">
      {notice && <p role="alert" className="sc-error sc-notice">{notice}</p>}
      {savedNote && !notice && <p className="sc-saved" role="status">{savedNote}</p>}
      {target && (
        <div className="sc-target">
          <span className="sc-target-chip">
            <MousePointerClickIcon aria-hidden="true" size={14} strokeWidth={1.75} />
            <span className="sc-target-label">{target.label}</span>
            <button type="button" aria-label={`Quitar la selección: ${target.label}`} onClick={onClearTarget}><XIcon aria-hidden="true" size={14} strokeWidth={2} /></button>
          </span>
          {target.field && onEditText && !editing && (
            <button type="button" className="sc-link" disabled={disabled || busy} onClick={() => setEditing({ path: target.path, value: target.field!.value })}>
              <PencilIcon aria-hidden="true" size={13} strokeWidth={1.75} />Editar el texto a mano
            </button>
          )}
        </div>
      )}
      {editing && target?.field ? (
        <div className="sc-edit" role="group" aria-label={`Editar a mano: ${target.label}`}>
          <label htmlFor={`${inputId}-edit`} className="sc-edit-label">{target.label}</label>
          {target.field.multiline
            ? <textarea id={`${inputId}-edit`} ref={editRef} rows={4} maxLength={target.field.max} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
            : <input id={`${inputId}-edit`} ref={editRef} type="text" maxLength={target.field.max} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(); } }} />}
          <div className="sc-edit-foot">
            <span className="sc-count">{editing.value.length}/{target.field.max}</span>
            <button type="button" className="sc-ghost" onClick={() => setEditing(null)} disabled={editBusy}>Cancelar</button>
            <button type="button" className="sc-primary" onClick={() => void saveEdit()} disabled={editBusy || disabled}>{editBusy ? "Guardando…" : "Guardar"}</button>
          </div>
          {editError && <p role="alert" className="sc-error">{editError}</p>}
        </div>
      ) : (
        <div className="sc-box">
          <label htmlFor={inputId} className="sc-ai-label">Pedid cambios con IA</label>
          <textarea
            id={inputId}
            ref={inputRef}
            rows={2}
            maxLength={SITE_EDIT_MAX_INSTRUCTION}
            value={text}
            disabled={disabled}
            enterKeyHint="send"
            placeholder={target ? changePromptFor(target) : placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <div className="sc-box-bar">
            <button type="button" className="sc-select" aria-pressed={selecting} disabled={disabled} onClick={onToggleSelect}>
              <MousePointerClickIcon aria-hidden="true" size={15} strokeWidth={1.75} />Seleccionar
            </button>
            <span className="sc-count" aria-hidden="true">{text.length > SITE_EDIT_MAX_INSTRUCTION - 80 ? `${text.length}/${SITE_EDIT_MAX_INSTRUCTION}` : ""}</span>
            <button type="button" className="sc-send" onClick={send} disabled={disabled || busy || !text.trim()} aria-label="Enviar la petición">
              <ArrowUpIcon aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
      {selecting && <p className="sc-help">Tocad una sección o un texto de la vista previa para centrar ahí el cambio.</p>}
      {footer}
    </div>
  );
}

/** Mantiene el último turno a la vista DENTRO de `scroller` (sin mover la página). */
export function useFollowLastTurn(chat: Chat, scroller: RefObject<HTMLElement | null>) {
  const last = chat.state.turns[chat.state.turns.length - 1];
  const lastKey = last ? `${last.id}:${last.status}:${last.status === "working" ? last.stage : ""}` : "";
  useEffect(() => {
    const el = scroller.current;
    if (!lastKey || !el) return;
    const reduce = prefersReducedMotion();
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [lastKey, scroller]);
}

export interface SiteChatProps extends Omit<ChatComposerProps, "composer" | "notice"> {
  /** Chips de siguiente petición (deterministas, `suggestNextPrompts`). */
  suggestions: string[];
  /** Primer mensaje cuando aún no hay conversación. */
  intro: ReactNode;
}

/** Tarjeta completa (panel): hilo con su propio desplazamiento + compositor. */
export function SiteChat({ chat, suggestions, intro, disabled = false, ...composerProps }: SiteChatProps) {
  const composer = useComposerText();
  const [notice, setNotice] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  useFollowLastTurn(chat, threadRef);
  return (
    <div className="sc-chat">
      <div ref={threadRef} className="sc-thread" role="log" aria-live="polite" aria-label="Conversación con el editor">
        <ol>
          <li className="sc-turn">
            <div className="sc-assistant">
              <span className="sc-mark" aria-hidden="true">v.</span>
              <div className="sc-assistant-body">
                <div className="sc-intro">{intro}</div>
                {chat.state.turns.length === 0 && suggestions.length > 0 && (
                  <div className="sc-chips" role="group" aria-label="Ideas para empezar">
                    {suggestions.map((s) => <button key={s} type="button" className="sc-chip" disabled={disabled} onClick={() => composer.fill(s)}>{s}</button>)}
                  </div>
                )}
              </div>
            </div>
          </li>
          <ChatTurns chat={chat} suggestions={suggestions} composer={composer} disabled={disabled} onNotice={setNotice} />
        </ol>
      </div>
      <ChatComposer chat={chat} composer={composer} notice={notice} disabled={disabled} {...composerProps} />
    </div>
  );
}
