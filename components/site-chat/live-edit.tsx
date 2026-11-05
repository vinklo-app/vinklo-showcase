"use client";

/**
 * Editar desde la vista previa en el ordenador (backlog 13-oct-2026, punto 6):
 * con ratón (hover + puntero fino) y la columna a la vista, tocar un texto de
 * la invitación lo edita ahí mismo; tocar la foto, la fecha, los nombres o una
 * fila del programa abre su editor con el campo enfocado (`LiveEditRoute`,
 * lib/site-chat/live-edit.ts).
 *
 * El texto NO se edita sobre el DOM del renderer (React y framer son dueños de
 * sus nodos; la bienvenida va palabra a palabra): el elemento se oculta
 * (`data-edit-editing`, visibility: hidden, conserva el hueco) y encima va un
 * <textarea> controlado con su misma letra, medida y color. Se guarda con
 * Intro (en los de varias líneas, Cmd/Ctrl + Intro) o al salir; Escape lo deja
 * como estaba. Si el guardado falla (también al salir), el campo sigue abierto
 * con lo escrito, el error en línea y «Reintentar» / «Descartar cambios»; lo
 * pendiente queda en un borrador local que se ofrece al reabrir el campo
 * (lib/site-chat/live-edit-save.ts). Las mismas reglas que el campo (`writeEditText` en `onEditText`),
 * y cada cambio es una versión de «Pedid cambios» (se puede deshacer).
 *
 * Solo existe en las vistas previas (el creador y el panel la montan con
 * `enabled`); la web pública no lleva marcas ni esta capa.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { liveEditLabel, type LiveEditRoute, type LiveTextField } from "@/lib/site-chat/live-edit";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { clearLiveDraft, readLiveDraft, saveLiveText, type LiveOutcome } from "@/lib/site-chat/live-edit-save";
import { LiveEditFailure, LiveEditRecover, NOTICE_ATTR } from "./live-edit-notice";

/** Ratón u otro puntero fino con hover: solo ahí se edita sobre la vista previa. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
export function useFinePointer(): boolean {
  return useMediaQuery(FINE_POINTER_QUERY);
}

const MARK = "data-edit-can";
const EDITING = "data-edit-editing";
const UI = "data-live-edit-ui";

type Outcome = LiveOutcome;
type Editing = { path: string; element: HTMLElement; label: string; field: LiveTextField; initial: string };
type Box = { top: number; left: number; width: number; height: number; scale: number; style: CSSProperties };

/** Elemento marcado bajo el puntero (nunca la propia capa ni un hueco, que tiene su manejador). */
function markedTarget(node: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(node instanceof Element) || node.closest(`[${UI}]`) || node.closest("[data-edit-gap]")) return null;
  const element = node.closest<HTMLElement>(`[${MARK}]`);
  return element && root.contains(element) ? element : null;
}

/** Caja del elemento en coordenadas de la capa (la vista previa del creador va escalada). */
function measure(element: HTMLElement, layer: HTMLElement, root: HTMLElement, withStyle: boolean): Box {
  const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
  const rect = element.getBoundingClientRect();
  const origin = layer.getBoundingClientRect();
  const box: Box = { top: (rect.top - origin.top) / scale, left: (rect.left - origin.left) / scale, width: rect.width / scale, height: rect.height / scale, scale, style: {} };
  if (!withStyle) return box;
  const css = getComputedStyle(element);
  // Textos con relleno de degradado (color transparente): tinta legible.
  const transparent = /rgba?\(.*,\s*0\)$|transparent/.test(css.color);
  box.style = {
    fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight as CSSProperties["fontWeight"], fontStyle: css.fontStyle,
    lineHeight: css.lineHeight, letterSpacing: css.letterSpacing, wordSpacing: css.wordSpacing, textAlign: css.textAlign as CSSProperties["textAlign"],
    textTransform: css.textTransform as CSSProperties["textTransform"], textWrap: css.getPropertyValue("text-wrap") as CSSProperties["textWrap"], color: transparent ? "rgb(36 33 42)" : css.color,
    paddingTop: css.paddingTop, paddingRight: css.paddingRight, paddingBottom: css.paddingBottom, paddingLeft: css.paddingLeft,
  };
  return box;
}

export function LiveEditLayer({ container, enabled, refreshKey, resolve, onEditText, onOpen }: {
  container: RefObject<HTMLElement | null>;
  /** Escritorio con puntero fino, sin «Seleccionar» ni nada en marcha. */
  enabled: boolean;
  /** Cambia con lo pintado (documento): vuelve a marcar. */
  refreshKey: unknown;
  /** Qué hace un clic en cada ruta (null: no se marca). */
  resolve(path: string): LiveEditRoute | null;
  /** Guarda el texto (versión «a mano»). */
  onEditText(path: string, value: string): Promise<Outcome>;
  /** Rutas que no son texto: abrir su editor, ir a su control o seleccionarlas. */
  onOpen(route: Exclude<LiveEditRoute, { kind: "text" }>, path: string, element: HTMLElement): void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [value, setValue] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const [hover, setHover] = useState<{ box: Box; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Guardado en curso (ref: lo leen los manejadores de clic, que pueden ir por delante del render).
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  // Fallo de guardado en curso: el campo sigue abierto con lo escrito.
  const [failure, setFailure] = useState<{ error: string; retryable: boolean } | null>(null);
  // Texto sin guardar de una visita anterior a este mismo campo (se ofrece, no se aplica solo).
  const [recover, setRecover] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; box: Box } | null>(null);
  const editingRef = useRef<Editing | null>(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const handlers = useRef({ resolve, onEditText, onOpen });
  useEffect(() => { handlers.current = { resolve, onEditText, onOpen }; });

  function finish(refocus: boolean) {
    const current = editingRef.current;
    editingRef.current = null;
    busyRef.current = false;
    setEditing(null);
    setBox(null);
    setFailure(null);
    setRecover(null);
    setBusy(false);
    if (!current) return;
    current.element.removeAttribute(EDITING);
    if (!refocus) return;
    // Tras guardar, React puede haber cambiado el elemento: se busca por su ruta.
    requestAnimationFrame(() => {
      const root = container.current;
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(current.path) : current.path.replace(/"/g, "");
      const element = current.element.isConnected ? current.element : root?.querySelector<HTMLElement>(`[data-edit-path="${esc}"]`);
      element?.focus({ preventScroll: true });
    });
  }

  function start(element: HTMLElement) {
    const root = container.current;
    const layer = layerRef.current;
    const path = element.getAttribute("data-edit-path");
    if (!root || !layer || !path) return;
    const route = handlers.current.resolve(path);
    if (!route) return;
    setHover(null);
    if (route.kind !== "text") { handlers.current.onOpen(route, path, element); return; }
    // Otro texto con este aún abierto (el clic no lo desenfoca): lo escrito se guarda antes.
    const previous = editingRef.current;
    if (previous) {
      previous.element.removeAttribute(EDITING);
      const written = fieldRef.current?.value ?? previous.initial;
      // Si un guardado al salir ya está en marcha, ese texto ya tiene dueño (sin versiones dobles).
      if (written !== previous.initial && !busyRef.current) {
        const at = measure(previous.element, layer, root, false);
        // Si falla, el texto queda en el borrador local (se ofrece al reabrir ese campo).
        void saveLiveText({ path: previous.path, initial: previous.initial, value: written, save: handlers.current.onEditText })
          .then((result) => { if (result.status === "failed") setFlash({ text: result.flash, box: at }); });
      }
    }
    const next: Editing = { path, element, label: route.label, field: route.field, initial: route.field.value };
    // El guardado en curso es del editor anterior: el nuevo nace libre.
    busyRef.current = false;
    setBusy(false);
    editingRef.current = next;
    setBox(measure(element, layer, root, true));
    element.setAttribute(EDITING, "");
    setEditing(next);
    setValue(route.field.value);
    setFailure(null);
    setRecover(readLiveDraft(path, route.field.value));
    setFlash(null);
  }

  async function commit(reason: "key" | "blur" | "retry") {
    const current = editingRef.current;
    const field = fieldRef.current;
    if (!current || !field || busyRef.current) return;
    const next = field.value;
    if (next === current.initial) { finish(reason !== "blur"); return; }
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const result = await saveLiveText({ path: current.path, initial: current.initial, value: next, save: handlers.current.onEditText });
    if (editingRef.current !== current) {
      // Ya se edita otro texto: si este guardado falló, se avisa sobre su sitio (y queda en el borrador).
      const layer = layerRef.current;
      const root = container.current;
      if (result.status === "failed" && layer && root && current.element.isConnected) setFlash({ text: result.flash, box: measure(current.element, layer, root, false) });
      return;
    }
    if (result.status === "saved") { finish(reason !== "blur"); return; }
    // Falló (también al salir del campo, p. ej. al cerrar el teclado sin red): el campo
    // sigue abierto con lo escrito, el error en línea y, si procede, «Reintentar».
    busyRef.current = false;
    setBusy(false);
    setFailure({ error: result.error, retryable: result.retryable });
    if (reason !== "blur") requestAnimationFrame(() => fieldRef.current?.focus());
  }

  /** «Descartar cambios» / Escape: vuelve el texto original y borra el borrador. */
  function discard() {
    const current = editingRef.current;
    if (current) clearLiveDraft(current.path);
    finish(true);
  }
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; });
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });

  // Marcas: cada texto con ruta y destino lleva `data-edit-can`, foco de teclado y
  // nombre accesible. La maqueta web monta secciones al acercarse (y el sobre
  // las descubre después): lo que aparece se marca al momento (MutationObserver).
  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) return;
    root.setAttribute("data-edit-live", "");
    const marked = new Map<HTMLElement, Record<string, string | null>>();
    const mark = () => {
      root.querySelectorAll<HTMLElement>("[data-edit-path]").forEach((element) => {
        if (marked.has(element) || element.hasAttribute("data-edit-gap") || element.closest(`[${UI}]`)) return;
        const route = handlers.current.resolve(element.getAttribute("data-edit-path") ?? "");
        if (!route) return;
        marked.set(element, { role: element.getAttribute("role"), tabindex: element.getAttribute("tabindex"), "aria-label": element.getAttribute("aria-label") });
        element.setAttribute(MARK, route.kind);
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", liveEditLabel(route));
      });
    };
    mark();
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(mark); });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      root.removeAttribute("data-edit-live");
      for (const [element, prev] of marked) {
        element.removeAttribute(MARK);
        for (const [name, old] of Object.entries(prev)) {
          if (old === null) element.removeAttribute(name);
          else element.setAttribute(name, old);
        }
      }
    };
  }, [container, enabled, refreshKey]);

  // Clic y teclado sobre lo marcado: se capturan antes que el reproductor (que
  // pasaría de pantalla) o un <details> (que se abriría).
  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) return;
    const swallow = (event: Event) => {
      if (event.defaultPrevented || !markedTarget(event.target, root)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const element = markedTarget(event.target, root);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      startRef.current(element);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.defaultPrevented || !(event.target instanceof HTMLElement) || !event.target.hasAttribute(MARK)) return;
      event.preventDefault();
      event.stopPropagation();
      startRef.current(event.target);
    };
    const over = (event: PointerEvent) => {
      const layer = layerRef.current;
      const element = markedTarget(event.target, root);
      if (!layer || !element || element.hasAttribute(EDITING)) { setHover(null); return; }
      const kind = element.getAttribute(MARK);
      setHover({ box: measure(element, layer, root, false), text: kind === "text" ? "Editar" : kind === "select" ? "Pedir cambios" : "Cambiar" });
    };
    const leave = () => setHover(null);
    root.addEventListener("pointerdown", swallow, true);
    root.addEventListener("pointerup", swallow, true);
    root.addEventListener("click", click, true);
    root.addEventListener("keydown", keydown, true);
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("scroll", leave, true);
    return () => {
      root.removeEventListener("pointerdown", swallow, true);
      root.removeEventListener("pointerup", swallow, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("keydown", keydown, true);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("scroll", leave, true);
      setHover(null);
    };
  }, [container, enabled]);

  // Sin edición posible (móvil, «Seleccionar», IA trabajando): se cierra sin guardar.
  useEffect(() => { if (!enabled && editingRef.current) finishRef.current(false); }, [enabled]);

  // La caja sigue al texto en cada fotograma: desplazamientos dentro de la
  // invitación, entradas al aparecer (WebReveal) y movimiento ligado al scroll.
  useEffect(() => {
    const root = container.current;
    if (!root || !editing) return;
    let frame = 0;
    const follow = () => {
      const layer = layerRef.current;
      const current = editingRef.current;
      if (!layer || !current) return;
      if (!current.element.isConnected) { finishRef.current(false); return; }
      const next = measure(current.element, layer, root, false);
      setBox((old) => (!old || (Math.abs(old.top - next.top) < 0.5 && Math.abs(old.left - next.left) < 0.5 && Math.abs(old.width - next.width) < 0.5 && Math.abs(old.height - next.height) < 0.5 && old.scale === next.scale) ? old : { ...next, style: old.style }));
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [container, editing]);

  // Al abrir: foco y todo el texto seleccionado (se escribe encima o se ajusta).
  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    field?.focus({ preventScroll: true });
    field?.select();
  }, [editing]);

  // Alto: el del texto original y crece con lo escrito (sin animar).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || !box) return;
    field.style.height = "0px";
    field.style.height = `${Math.max(box.height, field.scrollHeight)}px`;
  }, [value, box]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const counterScale = (scale: number): CSSProperties => ({ "--lv-scale": scale } as CSSProperties);
  return (
    <div ref={layerRef} className="lv-layer" {...{ [UI]: "" }}>
      {hover && !editing && (
        <span className="lv-hint" aria-hidden="true" style={{ top: hover.box.top, left: hover.box.left + hover.box.width, ...counterScale(hover.box.scale) }}>{hover.text}</span>
      )}
      {editing && box && (
        <div className="lv-edit" style={{ top: box.top, left: box.left, width: box.width, ...counterScale(box.scale) }}>
          <textarea
            ref={fieldRef}
            className="lv-field"
            aria-label={editing.label}
            aria-invalid={failure ? true : undefined}
            aria-describedby="lv-edit-help"
            rows={1}
            maxLength={editing.field.max}
            value={value}
            readOnly={busy}
            spellCheck
            style={{ ...box.style, minHeight: box.height }}
            onChange={(event) => { setValue(editing.field.multiline ? event.target.value : event.target.value.replace(/\n/g, " ")); setFailure(null); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); discard(); return; }
              if (event.key === "Enter" && !event.nativeEvent.isComposing && (!editing.field.multiline || event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.stopPropagation();
                void commit("key");
              }
            }}
            onBlur={(event) => {
              // Con un fallo a la vista no se reintenta solo al salir (el error ya está en pantalla),
              // ni al pulsar sus botones; al escribir de nuevo vuelve a guardar al salir.
              if (busyRef.current || failure || (event.relatedTarget instanceof Element && event.relatedTarget.closest(`[${NOTICE_ATTR}]`))) return;
              void commit("blur");
            }}
          />
          <div id="lv-edit-help" className="lv-help" data-error={failure ? "" : undefined} data-actions={failure || recover !== null ? "" : undefined}>
            {failure ? <LiveEditFailure error={failure.error} retryable={failure.retryable} onRetry={() => void commit("retry")} onDiscard={discard} />
              : busy ? "Guardando…"
              : recover !== null ? <LiveEditRecover
                onRecover={() => { setValue(recover); setRecover(null); requestAnimationFrame(() => fieldRef.current?.focus()); }}
                onIgnore={() => { clearLiveDraft(editing.path); setRecover(null); requestAnimationFrame(() => fieldRef.current?.focus()); }} />
              : <>
              {editing.field.multiline ? "⌘/Ctrl + Intro para guardar" : "Intro para guardar"} · Esc para cancelar
              <span className="lv-count">{value.length}/{editing.field.max}</span>
            </>}
          </div>
        </div>
      )}
      {flash && <p className="lv-flash" role="alert" style={{ top: flash.box.top + flash.box.height, left: flash.box.left, ...counterScale(flash.box.scale) }}>{flash.text}</p>}
    </div>
  );
}
