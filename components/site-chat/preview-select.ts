"use client";

/**
 * «Seleccionar» sobre la vista previa: con el modo activo, pasar el ratón por
 * una sección o un texto lo resalta (contorno ciruela, CSS) y tocarlo lo fija
 * en el compositor. El clic se captura ANTES de que llegue al reproductor
 * (que avanzaría de pantalla) o a un <details> (que se abriría); los botones
 * de navegación que no son textos siguen funcionando.
 *
 * El elemento fijado lleva `data-edit-selected` (lo pone este hook en el DOM,
 * no el renderer) y se vuelve a marcar tras cada cambio del documento.
 */
import { useEffect, type RefObject } from "react";

const TARGET = "[data-edit-path], [data-edit-scene]";

function targetOf(node: EventTarget | null, root: HTMLElement): { path: string; element: HTMLElement } | null {
  if (!(node instanceof Element)) return null;
  const element = node.closest<HTMLElement>(TARGET);
  if (!element || !root.contains(element)) return null;
  const path = element.getAttribute("data-edit-path") ?? element.getAttribute("data-edit-scene");
  return path ? { path, element } : null;
}

export function usePreviewSelection({ container, active, selected, refreshKey, onPick }: {
  container: RefObject<HTMLElement | null>;
  active: boolean;
  /** Ruta fijada (o null). */
  selected: string | null;
  /** Cambia cuando cambia lo pintado (documento): vuelve a marcar. */
  refreshKey: unknown;
  onPick: (path: string) => void;
}) {
  useEffect(() => {
    const root = container.current;
    if (!root || !active) return;
    root.setAttribute("data-selecting", "");
    const swallow = (event: Event) => {
      const hit = targetOf(event.target, root);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      const hit = targetOf(event.target, root);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      onPick(hit.path);
    };
    root.addEventListener("pointerdown", swallow, true);
    root.addEventListener("pointerup", swallow, true);
    root.addEventListener("click", click, true);
    return () => {
      root.removeAttribute("data-selecting");
      root.removeEventListener("pointerdown", swallow, true);
      root.removeEventListener("pointerup", swallow, true);
      root.removeEventListener("click", click, true);
    };
  }, [container, active, onPick]);

  useEffect(() => {
    const root = container.current;
    if (!root || !selected) return;
    const marked: HTMLElement[] = [];
    const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(selected) : selected.replace(/"/g, "");
    root.querySelectorAll<HTMLElement>(`[data-edit-path="${esc}"], [data-edit-scene="${esc}"]`).forEach((el) => {
      el.setAttribute("data-edit-selected", "");
      marked.push(el);
    });
    return () => { for (const el of marked) el.removeAttribute("data-edit-selected"); };
  }, [container, selected, refreshKey]);
}
