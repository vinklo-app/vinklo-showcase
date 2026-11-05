"use client";

/**
 * Reproductor Story de la invitación.
 *
 * El servidor pinta TODAS las escenas apiladas (vista continua): es lo que
 * ve quien no ejecuta JavaScript y lo que indexa el HTML. Al hidratar, el
 * reproductor pasa a modo Story (una escena por pantalla, progreso arriba,
 * toque/teclas/botones para moverse) salvo que el invitado hubiera pedido
 * «Ver todos los detalles» en esta sesión (sessionStorage, con try/catch).
 *
 * Reglas (CLAUDE.md, BRIEF): HTML accesible, sin scroll largo como
 * navegación principal, controles manuales siempre visibles,
 * `prefers-reduced-motion` (solo fundido). Las escenas con formulario
 * (RSVP) y cualquier escena que desborde se desplazan internamente.
 *
 * Autoavance (decisión del propietario, 13-oct-2026; la Story pasa a ser
 * Premium): con `autoAdvanceSeconds` la Story pasa sola de escena con una
 * barra de progreso por escena. No corre con el sobre cerrado ni mientras
 * se abre, con la pestaña oculta, mientras el dedo mantiene pulsado, con el
 * ratón encima de los controles, con el foco en un control de la escena ni
 * en pausa (botón). Se para en la última escena y nunca abandona una escena con
 * formulario (RSVP). Con movimiento reducido arranca en pausa: solo avanza
 * si el invitado pulsa «Reanudar». La lógica pura está en
 * `autoAdvanceRunning`/`stepAutoAdvance` (probada en story-player.test.ts).
 *
 * Es client-safe y no sabe nada del documento: recibe nodos ya pintados.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "@/lib/hooks/use-media-query";

import { EnvelopeOpenContext, SealedContext, useThemeColor, type InviteThemeColors } from "./theme-color";
import type { InvitationMode } from "./types";

import "./story-player.css";

export type StoryPanelKind = "cover" | "venue" | "agenda" | "rsvp" | "story" | "gallery" | "details" | "faq" | "transport" | "stay" | "extra";

export interface StoryPanel {
  /** Id estable (el de la escena, o derivado) para `key` y `data-scene-id`. */
  id: string;
  kind: StoryPanelKind;
  node: ReactNode;
  /** "photo": escena a sangre sobre foto; el cromo pasa a papel sobre tinta. */
  tone?: "photo";
}

export type StoryView = "story" | "all";

export interface StoryPlayerProps {
  panels: StoryPanel[];
  mode: InvitationMode;
  /** Pie de marca (plan free): bajo los controles en la Story, al final en la vista continua. */
  footer?: ReactNode;
  /**
   * Opcional. Id del panel que debe mostrarse. Al montar, la Story abre en
   * él sin animar; cada vez que cambia (o que ese panel aparece, p. ej. el
   * lugar al escribirlo), pasa a él con la transición normal. Entre cambios
   * la navegación es libre. No mueve el foco ni anuncia: lo usa el creador
   * mientras se escribe. Un id que no existe no hace nada.
   */
  activeSceneId?: string;
  /** Franja del iPhone (theme-color) según se vea la portada con foto u otra escena. Solo web pública. */
  themeColors?: InviteThemeColors;
  /** Segundos por escena del autoavance. Sin él (preview del creador y del editor), solo a mano. */
  autoAdvanceSeconds?: number | null;
}

/** Clave de sesión: «Ver todos los detalles» se recuerda hasta cerrar la pestaña. */
const STORAGE_KEY = "vinklo.story.view";
/** Deslizar: umbral de dirección (px), distancia (fracción del ancho) y velocidad (px/ms) para pasar de escena. */
const SWIPE_SLOP = 10;
const SWIPE_DISTANCE = 0.25;
const SWIPE_VELOCITY = 0.11;
/** Donde un arrastre no debe convertirse en gesto (escribir, seleccionar). */
const NO_SWIPE = "input,textarea,select,[contenteditable]";

/** Resistencia progresiva al tirar más allá de la primera/última escena (Apple). */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Estilo en línea de la escena actual y de la vecina mientras el dedo arrastra
 * `x` px. Con movimiento reducido no hay desplazamiento (el estilo en línea
 * pisaría la regla CSS reducida): solo se funden, y al soltar se conmuta.
 */
export function dragFrame(x: number, width: number, reduced: boolean) {
  const progress = Math.min(1, Math.abs(x) / width);
  // La siguiente asoma desde su lado, siguiendo al dedo.
  const from = x < 0 ? width * 0.18 : -width * 0.18;
  return {
    current: { transform: reduced ? "none" : `translateX(${x}px)`, opacity: String(1 - progress * 0.5) },
    neighbour: { transform: reduced ? "none" : `translateX(${from * (1 - progress)}px)`, opacity: String(Math.min(1, progress * 1.6)) },
  };
}

/** Elementos cuyo toque no debe navegar (formularios, enlaces, botones). */
const INTERACTIVE = "a,button,input,textarea,select,label,form,[contenteditable]";

// --- Autoavance -------------------------------------------------------------

/** Tope de tiempo por frame: tras una pestaña dormida o un tirón no se salta escena. */
export const AUTO_FRAME_CAP_MS = 100;
/** Pulsación larga (ms): pausa para leer y al soltar no pasa de escena. */
export const HOLD_MS = 350;
/** Tras desplazarse dentro de una escena larga, el reloj espera esto (ms) antes de seguir. */
export const SCROLL_IDLE_MS = 2500;
/** Campos: con el foco en ellos el reloj siempre se para (se está escribiendo). */
const FIELD_FOCUS = "input,textarea,select,[contenteditable]";
/** Una escena con esto dentro es un formulario: el autoavance nunca la abandona. */
const FORM_FIELDS = "form,input,textarea,select";

/** ¿Puede esta escena pasar sola a la siguiente? Ni la última ni un formulario. */
export function canAutoAdvance(index: number, total: number, kind: StoryPanelKind | undefined, hasForm: boolean): boolean {
  return index < total - 1 && kind !== "rsvp" && !hasForm;
}

export interface AutoAdvanceGate {
  /** Autoavance activado (web pública con la Story). */
  enabled: boolean;
  view: StoryView;
  hydrated: boolean;
  /** Sobre abierto del todo (sin sobre = true). */
  opened: boolean;
  /** Pestaña oculta (`document.hidden`). */
  hidden: boolean;
  /** Dedo o botón del ratón pulsado sobre el escenario. */
  held: boolean;
  /** Ratón encima de los controles (solo con puntero fino). */
  hovered: boolean;
  /** Foco en un enlace, botón o campo de la escena. */
  focused: boolean;
  /** Desplazándose dentro de la escena (y hasta SCROLL_IDLE_MS después). */
  scrolling: boolean;
  /** Pausa del invitado (botón; con movimiento reducido, de entrada). */
  paused: boolean;
  /** `canAutoAdvance` de la escena actual. */
  advanceable: boolean;
}

/** ¿Corre ahora el reloj de la escena? Cualquier motivo de pausa lo congela (no lo reinicia). */
export function autoAdvanceRunning(g: AutoAdvanceGate): boolean {
  return g.enabled && g.view === "story" && g.hydrated && g.opened && !g.hidden && !g.held && !g.hovered && !g.focused && !g.scrolling && !g.paused && g.advanceable;
}

/**
 * Un frame del reloj: suma `dt` (con tope) y dice si toca pasar de escena.
 * `progress` (0–1) es lo que llena el segmento de la escena actual.
 */
export function stepAutoAdvance(elapsed: number, dt: number, durationMs: number): { elapsed: number; progress: number; advance: boolean } {
  const next = elapsed + Math.min(Math.max(dt, 0), AUTO_FRAME_CAP_MS);
  const advance = next >= durationMs;
  return { elapsed: advance ? durationMs : next, progress: durationMs > 0 ? Math.min(1, next / durationMs) : 1, advance };
}

function readStoredView(): StoryView | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "all" ? "all" : null;
  } catch {
    return null;
  }
}

function writeStoredView(view: StoryView) {
  try {
    if (view === "all") window.sessionStorage.setItem(STORAGE_KEY, "all");
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento bloqueado: la preferencia dura lo que la página */
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input,textarea,select,[contenteditable]") || target.isContentEditable;
}

function ChevronLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function StoryPlayer({ panels, mode, footer, activeSceneId, themeColors, autoAdvanceSeconds }: StoryPlayerProps) {
  const total = panels.length;
  const autoEnabled = typeof autoAdvanceSeconds === "number" && autoAdvanceSeconds > 0;
  // SSR y primer render: vista continua, sin cromo (data-hydrated ausente).
  const [view, setView] = useState<StoryView>("all");
  const [hydrated, setHydrated] = useState(false);
  const [rawIndex, setRawIndex] = useState(0);
  const [instant, setInstant] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const index = Math.min(rawIndex, Math.max(0, total - 1));

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRefs = useRef<Array<HTMLDivElement | null>>([]);
  /** Solo se mueve el foco tras una navegación del invitado, nunca al cargar. */
  const pendingFocus = useRef(false);

  useEffect(() => {
    // Preview (creador/landing): nunca persiste; arranca siempre en Story.
    const stored = mode === "public" ? readStoredView() : null;
    setView(stored ?? "story");
    setHydrated(true);
  }, [mode]);

  // Escena pedida desde fuera (creador): la primera vez sin animar.
  const requestedIndex = activeSceneId ? panels.findIndex((panel) => panel.id === activeSceneId) : -1;
  const requestApplied = useRef(false);
  useEffect(() => {
    if (requestedIndex < 0) return;
    const first = !requestApplied.current;
    requestApplied.current = true;
    if (first) setInstant(true);
    setRawIndex(requestedIndex);
    if (!first) return;
    const id = window.requestAnimationFrame(() => setInstant(false));
    return () => window.cancelAnimationFrame(id);
  }, [activeSceneId, requestedIndex]);

  const focusScene = useCallback((i: number) => {
    const panel = sceneRefs.current[i];
    if (!panel) return;
    const heading = panel.querySelector<HTMLElement>("h1, h2");
    const target = heading ?? panel;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, []);

  const go = useCallback(
    (next: number, options: { instant?: boolean; auto?: boolean } = {}) => {
      if (next < 0 || next >= total || next === index) return;
      setInstant(Boolean(options.instant));
      setRawIndex(next);
      // Anuncio educado también en el autoavance: quien lee con lector de
      // pantalla (cursor virtual, sin foco) sabe que la escena ha cambiado.
      setAnnouncement(`Escena ${next + 1} de ${total}`);
      if (options.auto) {
        // El autoavance no roba el foco; solo lo acompaña si estaba dentro de
        // la escena que se va (si no, quedaría en una escena inerte).
        pendingFocus.current = Boolean(sceneRefs.current[index]?.contains(document.activeElement));
        return;
      }
      pendingFocus.current = true;
    },
    [index, total],
  );

  // Tras cambiar de escena: foco al título (o a la escena) y fin del modo instantáneo.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    focusScene(index);
    if (instant) {
      const id = window.requestAnimationFrame(() => setInstant(false));
      return () => window.cancelAnimationFrame(id);
    }
  }, [index, instant, focusScene]);

  const showAll = useCallback(() => {
    setInstant(true);
    setView("all");
    if (mode === "public") writeStoredView("all");
    pendingFocus.current = true;
    // La escena actual queda a la vista en la pila (sin animación).
    window.requestAnimationFrame(() => {
      sceneRefs.current[index]?.scrollIntoView({ block: "start" });
      focusScene(index);
      setInstant(false);
    });
  }, [index, mode, focusScene]);

  const showStory = useCallback(() => {
    setInstant(true);
    setView("story");
    if (mode === "public") writeStoredView("story");
    window.requestAnimationFrame(() => {
      focusScene(index);
      setInstant(false);
    });
  }, [index, mode, focusScene]);

  const handleKey = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent) => {
      if (view !== "story") return;
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(index + 1, { instant: event.repeat });
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1, { instant: event.repeat });
      }
    },
    [go, index, view],
  );

  // Público: las flechas funcionan en toda la página. Preview: solo con el
  // foco dentro del marco (puede haber dos reproductores en la misma página).
  useEffect(() => {
    if (mode !== "public") return;
    const onKey = (event: KeyboardEvent) => {
      // Con el sobre cerrado (apertura «sobre») las flechas no pasan escenas por debajo.
      if (document.querySelector("[data-sealed]")) return;
      handleKey(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, handleKey]);

  // Toque: mitad derecha avanza, mitad izquierda retrocede. Nunca sobre
  // enlaces, botones o formularios (la escena RSVP se maneja con los botones).
  const handleStageClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (view !== "story") return;
      if (suppressClick.current) return;
      // Con autoavance, mantener pulsado es pausar para leer: al soltar no se pasa de escena.
      const longPress = autoEnabled && lastHold.current > HOLD_MS;
      lastHold.current = 0;
      if (longPress) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE)) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < rect.width / 2) go(index - 1);
      else go(index + 1);
    },
    [go, index, view, autoEnabled],
  );

  // --- Deslizar entre escenas (como una Story) --------------------------
  // La escena sigue al dedo 1:1 (transform directo en el elemento, sin
  // transición); al soltar, la velocidad o la distancia deciden. Al confirmar
  // se quitan los estilos en línea y se cambia de escena en el mismo frame:
  // la transición CSS arranca desde donde quedó el dedo (interrumpible).
  const drag = useRef<{
    id: number;
    x0: number;
    y0: number;
    dx: number;
    axis: "x" | "y" | null;
    samples: Array<{ x: number; t: number }>;
    width: number;
    reduced: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  /** Pulsación: inicio (timeStamp) y duración de la última, para distinguir toque de pulsación larga. */
  const holdStart = useRef(0);
  const lastHold = useRef(0);
  const [held, setHeld] = useState(false);

  const sceneStyle = useCallback((i: number, transform: string | null, opacity: string | null) => {
    const el = sceneRefs.current[i];
    if (!el) return;
    el.style.transition = transform === null ? "" : "none";
    el.style.transform = transform ?? "";
    el.style.opacity = opacity ?? "";
    el.style.visibility = transform === null ? "" : "visible";
  }, []);

  const clearDragStyles = useCallback(() => {
    for (let i = 0; i < sceneRefs.current.length; i++) {
      const el = sceneRefs.current[i];
      if (el && el.style.transform !== "") {
        el.style.transition = "";
        el.style.transform = "";
        el.style.opacity = "";
        el.style.visibility = "";
      }
    }
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (view !== "story" || drag.current || !event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest(NO_SWIPE)) return;
      holdStart.current = event.timeStamp;
      setHeld(true);
      const width = stageRef.current?.getBoundingClientRect().width ?? 1;
      drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, dx: 0, axis: null, samples: [{ x: event.clientX, t: event.timeStamp }], width, reduced: prefersReducedMotion() };
    },
    [view],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.id) return;
      const dx = event.clientX - d.x0;
      const dy = event.clientY - d.y0;
      if (d.axis === null) {
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
        d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (d.axis === "x") stageRef.current?.setPointerCapture(event.pointerId);
      }
      if (d.axis !== "x") return;
      d.samples.push({ x: event.clientX, t: event.timeStamp });
      if (d.samples.length > 6) d.samples.shift();
      // Sin escena a la que ir: resistencia en lugar de tope.
      const atStart = dx > 0 && index === 0;
      const atEnd = dx < 0 && index >= total - 1;
      const x = atStart || atEnd ? rubberband(dx, d.width) : dx;
      d.dx = x;
      const frame = dragFrame(x, d.width, d.reduced);
      sceneStyle(index, frame.current.transform, frame.current.opacity);
      const neighbour = x < 0 ? index + 1 : index - 1;
      const other = x < 0 ? index - 1 : index + 1;
      sceneStyle(other, null, null);
      if (neighbour >= 0 && neighbour < total) sceneStyle(neighbour, frame.neighbour.transform, frame.neighbour.opacity);
    },
    [index, total, sceneStyle],
  );

  // Cambiar de vista a mitad de un arrastre no deja escenas desplazadas.
  useEffect(() => {
    drag.current = null;
    clearDragStyles();
  }, [view, clearDragStyles]);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.id) return;
      drag.current = null;
      setHeld(false);
      lastHold.current = event.timeStamp - holdStart.current;
      if (d.axis !== "x") return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      const first = d.samples[0];
      const last = d.samples[d.samples.length - 1];
      const velocity = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      const commit = !cancelled && (Math.abs(d.dx) > d.width * SWIPE_DISTANCE || Math.abs(velocity) > SWIPE_VELOCITY);
      // Dirección por el signo de la velocidad si fue un golpe rápido; si no, por la distancia.
      const direction = Math.abs(velocity) > SWIPE_VELOCITY ? Math.sign(-velocity) : Math.sign(-d.dx);
      const next = index + direction;
      clearDragStyles();
      if (commit && direction !== 0 && next >= 0 && next < total) go(next);
    },
    [index, total, go, clearDragStyles],
  );

  const isStory = view === "story";
  const onPhoto = isStory && panels[index]?.tone === "photo";
  const sealed = useContext(SealedContext);
  useThemeColor(themeColors && !sealed ? (onPhoto ? themeColors.cover : themeColors.scene) : null);

  // --- Autoavance -------------------------------------------------------------
  const durationMs = autoEnabled ? autoAdvanceSeconds * 1000 : 0;
  // Abierto del todo: también espera a que termine la animación del sobre.
  const opened = useContext(EnvelopeOpenContext);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [formScene, setFormScene] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const segmentRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const elapsed = useRef(0);

  // Movimiento reducido: el autoavance arranca en pausa (lo activa el invitado).
  useEffect(() => {
    if (autoEnabled && prefersReducedMotion()) setPaused(true);
  }, [autoEnabled]);

  useEffect(() => {
    if (!autoEnabled) return;
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [autoEnabled]);

  // Escena nueva: el reloj vuelve a cero y se mira si es un formulario. Antes
  // de pintar: si no, al volver atrás el segmento enseñaría su llenado viejo.
  useLayoutEffect(() => {
    elapsed.current = 0;
    const segment = segmentRefs.current[index];
    segment?.style.setProperty("--sp-fill", "0");
    setFormScene(Boolean(sceneRefs.current[index]?.querySelector(FORM_FIELDS)));
  }, [index, view]);

  const advanceable = canAutoAdvance(index, total, panels[index]?.kind, formScene);
  const running = autoAdvanceRunning({ enabled: autoEnabled, view, hydrated, opened, hidden, held, hovered, focused, scrolling, paused, advanceable });

  // Leer una escena larga (preguntas, capítulos) desplazándose dentro: el
  // reloj se congela y sigue SCROLL_IDLE_MS después del último desplazamiento.
  // El evento scroll no burbujea: se escucha en captura sobre el escenario.
  useEffect(() => {
    const stage = stageRef.current;
    if (!autoEnabled || !stage) return;
    let timer = 0;
    const onScroll = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest(".sp-scene[data-state='active']")) return;
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), SCROLL_IDLE_MS);
    };
    stage.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      stage.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(timer);
    };
  }, [autoEnabled]);

  useEffect(() => {
    if (!running) return;
    const segment = segmentRefs.current[index];
    let last: number | null = null;
    let frame = window.requestAnimationFrame(function tick(now) {
      const dt = last === null ? 0 : now - last;
      last = now;
      const step = stepAutoAdvance(elapsed.current, dt, durationMs);
      elapsed.current = step.elapsed;
      segment?.style.setProperty("--sp-fill", String(step.progress));
      if (step.advance) {
        go(index + 1, { auto: true });
        return;
      }
      frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [running, index, durationMs, go]);

  // Ratón sobre los controles (progreso, pausa, Anterior/Siguiente): pausa
  // mientras el invitado va a usarlos. No sobre el escenario: en escritorio el
  // ratón casi siempre está encima y la Story no avanzaría nunca.
  const onChromeEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Solo ratón de verdad (no el «hover» que emula un toque).
    if (event.pointerType === "mouse" && window.matchMedia("(hover: hover) and (pointer: fine)").matches) setHovered(true);
  }, []);
  const onChromeLeave = useCallback(() => setHovered(false), []);
  // El botón del ratón soltado fuera del escenario no deja la Story en pausa.
  const onStageLeave = useCallback(() => {
    if (drag.current && drag.current.axis !== "x") {
      drag.current = null;
      setHeld(false);
    }
  }, []);
  const onFocusChange = useCallback(() => {
    // Tras el cambio de foco: ¿queda en un campo, o en un control al que se
    // llegó con el teclado? Un enlace tocado con el dedo o el ratón (p. ej.
    // «Ver en el mapa», que abre otra pestaña) se queda con el foco pero no
    // debe congelar la Story al volver; los títulos con tabindex=-1 no cuentan.
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      const inStage = Boolean(active && stageRef.current?.contains(active));
      setFocused(inStage && Boolean(active?.matches(FIELD_FOCUS) || (active?.matches(INTERACTIVE) && active.matches(":focus-visible"))));
    });
  }, []);

  return (
    <div
      className="sp"
      data-view={view}
      data-hydrated={hydrated ? "true" : undefined}
      data-instant={instant ? "true" : undefined}
      data-on-photo={onPhoto ? "true" : undefined}
      onKeyDown={mode === "preview" ? handleKey : undefined}
    >
      <div className="sp-chrome sp-top" onPointerEnter={autoEnabled ? onChromeEnter : undefined} onPointerLeave={autoEnabled ? onChromeLeave : undefined}>
        <div className="sp-progress" aria-hidden="true">
          {panels.map((panel, i) => (
            <span
              key={panel.id}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              data-segment={i + 1}
              data-filled={i < index || (i === index && !(autoEnabled && advanceable)) ? "true" : "false"}
              data-timed={i === index && autoEnabled && advanceable ? "true" : undefined}
            />
          ))}
        </div>
        {autoEnabled && (
          <button
            type="button"
            className="sp-autoplay"
            aria-label={paused ? "Reanudar el avance automático" : "Pausar el avance automático"}
            // Última escena o formulario: aquí no hay avance que pausar (deshabilitado, sin desaparecer).
            aria-disabled={advanceable ? undefined : true}
            data-running={running ? "true" : undefined}
            onClick={() => {
              if (advanceable) setPaused((value) => !value);
            }}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}
        <button type="button" className="sp-btn sp-btn-text sp-switch-story" onClick={showStory}>
          Ver como historia
        </button>
      </div>

      {/* El toque sobre el escenario es un atajo; la navegación accesible son
          los botones y las flechas. */}
      <div
        ref={stageRef}
        className="sp-stage"
        onClick={handleStageClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onPointerLeave={autoEnabled ? onStageLeave : undefined}
        onFocus={autoEnabled ? onFocusChange : undefined}
        onBlur={autoEnabled ? onFocusChange : undefined}
      >
        {panels.map((panel, i) => {
          const state = !isStory ? undefined : i === index ? "active" : i < index ? "before" : "after";
          return (
            <div
              key={panel.id}
              ref={(el) => {
                sceneRefs.current[i] = el;
              }}
              className="sp-scene"
              data-scene-id={panel.id}
              data-scene-type={panel.kind}
              data-tone={panel.tone}
              data-state={state}
              inert={isStory && i !== index ? true : undefined}
            >
              {panel.node}
            </div>
          );
        })}
      </div>

      <div className="sp-chrome sp-bottom" onPointerEnter={autoEnabled ? onChromeEnter : undefined} onPointerLeave={autoEnabled ? onChromeLeave : undefined}>
        <div className="sp-controls">
          <button type="button" className="sp-btn" aria-label="Anterior" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft />
            <span className="sp-btn-label">Anterior</span>
          </button>
          <button type="button" className="sp-btn sp-btn-text" onClick={showAll}>
            <span className="sp-btn-ellipsis">Ver todos los detalles</span>
          </button>
          <button type="button" className="sp-btn" aria-label="Siguiente" onClick={() => go(index + 1)} disabled={index >= total - 1}>
            <span className="sp-btn-label">Siguiente</span>
            <ChevronRight />
          </button>
        </div>
        {isStory && footer}
      </div>

      {!isStory && footer}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
