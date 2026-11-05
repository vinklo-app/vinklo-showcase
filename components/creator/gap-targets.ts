"use client";

/**
 * Huecos en la invitación del creador: lo que aún falta (nombres, fecha) se
 * marca en la propia vista previa con `data-edit-gap` (contorno discontinuo
 * ciruela que respira, CSS del creador) y un toque abre su editor.
 *
 * Solo intercepta los toques en esas rutas: el resto de la invitación sigue
 * funcionando (pasar de pantalla en la Story, abrir el sobre, desplazarse).
 * Se vuelve a marcar tras cada cambio del documento (`refreshKey`).
 *
 * Una ruta `scene:<id>` marca una sección entera (`data-edit-scene`): las
 * secciones de la plantilla que aún esperan contenido (lib/template-preview.ts).
 */
import { useEffect, useRef, type RefObject } from "react";

/** Prefijo de los huecos que son una sección entera. */
export const SCENE_GAP_PREFIX = "scene:";
const GAP_SELECTOR = "[data-edit-path], [data-edit-scene]";

function keysOf(element: Element): string[] {
  const keys: string[] = [];
  const path = element.getAttribute("data-edit-path");
  if (path) keys.push(path);
  const scene = element.getAttribute("data-edit-scene");
  if (scene) keys.push(`${SCENE_GAP_PREFIX}${scene}`);
  return keys;
}

function gapOf(node: EventTarget | null, root: HTMLElement, paths: ReadonlySet<string>): string | null {
  if (!(node instanceof Element)) return null;
  let element: Element | null = node.closest(GAP_SELECTOR);
  while (element && root.contains(element)) {
    const hit = keysOf(element).find((key) => paths.has(key));
    if (hit) return hit;
    element = element.parentElement?.closest(GAP_SELECTOR) ?? null;
  }
  return null;
}

/** Nombre accesible del hueco por defecto (nombres o fecha). */
function defaultLabel(path: string): string {
  return path.endsWith("/names") ? "Escribir vuestros nombres" : "Elegir la fecha";
}

export function useGapTargets({ container, paths, refreshKey, onPick, label = defaultLabel }: {
  container: RefObject<HTMLElement | null>;
  /** Rutas `data-edit-path` que son hueco ahora mismo (vacío = nada que marcar). */
  paths: readonly string[];
  refreshKey: unknown;
  onPick(path: string): void;
  /** Nombre accesible de cada hueco (el toque abre su editor). */
  label?: (path: string) => string;
}) {
  const labelOf = useRef(label);
  useEffect(() => { labelOf.current = label; });
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; });
  const joined = paths.join("|");

  useEffect(() => {
    const root = container.current;
    if (!root || !joined) return;
    const wanted = new Set(joined.split("|"));
    const marked: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>(GAP_SELECTOR).forEach((element) => {
      const path = keysOf(element).find((key) => wanted.has(key));
      if (!path) return;
      element.setAttribute("data-edit-gap", "");
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", labelOf.current(path));
      marked.push(element);
    });
    const swallow = (event: Event) => {
      if (!gapOf(event.target, root, wanted)) return;
      event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      const path = gapOf(event.target, root, wanted);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      pick.current(path);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const path = gapOf(event.target, root, wanted);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      pick.current(path);
    };
    root.addEventListener("pointerdown", swallow, true);
    root.addEventListener("pointerup", swallow, true);
    root.addEventListener("click", click, true);
    root.addEventListener("keydown", keydown, true);
    return () => {
      for (const element of marked) {
        element.removeAttribute("data-edit-gap");
        element.removeAttribute("role");
        element.removeAttribute("tabindex");
        element.removeAttribute("aria-label");
      }
      root.removeEventListener("pointerdown", swallow, true);
      root.removeEventListener("pointerup", swallow, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("keydown", keydown, true);
    };
  }, [container, joined, refreshKey]);
}
