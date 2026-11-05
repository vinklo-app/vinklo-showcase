"use client";

/**
 * Detalles de app nativa del creador (móvil). Todo degrada a «no hace nada»:
 * sin `visualViewport`, sin `navigator.vibrate` (iOS Safari no lo tiene) o
 * fuera del ancho móvil, el creador funciona igual.
 */
import { useEffect, useState, type RefObject } from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

/**
 * Mismo corte que el CSS del creador (`@media (max-width: 999.98px)`): por
 * debajo, la invitación arriba y los editores en una hoja; por encima, la
 * columna de 420 px y el móvil a su lado.
 */
export const MOBILE_QUERY = "(max-width: 999.98px)";

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * Pulso háptico corto. Solo Android/Chrome lo soporta en web; en iOS no
 * existe y no se finge. Solo en acciones que la pareja confirma (enviar un
 * paso, elegir, aplicar), nunca al teclear.
 */
export function haptic(kind: "tap" | "select" | "success" = "tap") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  try { navigator.vibrate(kind === "success" ? [8, 40, 12] : kind === "select" ? 5 : 8); } catch { /* Sin permiso: nada. */ }
}

/**
 * Teclado virtual (móvil): la carcasa del creador mide lo que mide el
 * viewport visual, así el compositor queda siempre sobre el teclado.
 * Android lo resuelve con `interactive-widget=resizes-content` (el dvh
 * encoge); iOS no lo soporta, así que se lee `visualViewport` y se escribe
 * alto y desplazamiento directamente en el elemento (sin variables CSS que
 * recalculen los hijos). Con zoom de pellizco (scale ≠ 1) no se toca nada.
 */
export function useKeyboardAwareShell(shellRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const reset = () => { shell.style.height = ""; shell.style.transform = ""; delete shell.dataset.keyboard; };
    if (!enabled) { reset(); return; }
    let frame = 0;
    // Alto sin teclado: en Android (resizes-content) innerHeight también
    // encoge, así que se compara con el mayor alto visto, no con innerHeight.
    let baseline = viewport.height;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (Math.abs(viewport.scale - 1) > 0.01) return;
        shell.style.height = `${Math.round(viewport.height)}px`;
        shell.style.transform = viewport.offsetTop > 0 ? `translateY(${Math.round(viewport.offsetTop)}px)` : "";
        // Teclado abierto: el viewport visual pierde bastante más que la barra del navegador.
        baseline = Math.max(baseline, viewport.height);
        const open = baseline - viewport.height > 120;
        if (open) shell.dataset.keyboard = "open"; else delete shell.dataset.keyboard;
        const active = document.activeElement;
        if (open && active instanceof HTMLElement && shell.contains(active)) active.scrollIntoView({ block: "nearest" });
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); reset(); };
  }, [shellRef, enabled]);
}

/** Resistencia de Apple al tirar más allá del borde. */
export function rubberBand(distance: number, dimension: number) {
  return (1 - 1 / ((distance * 0.55) / dimension + 1)) * dimension;
}

/**
 * Móvil: la invitación se pinta a tamaño de teléfono (ancho real, alto de un
 * iPhone) y se escala para caber entera en el hueco que deja la hoja. Así se
 * ve como la verán los invitados, no aplastada. Sin hueco útil (teclado
 * abierto), se oculta y la hoja ocupa la pantalla.
 *
 * `mode: "width"` (creador en el móvil): la invitación ocupa todo el ancho,
 * de borde a borde (escala = ancho disponible / ancho lógico), con sus
 * proporciones; queda más alta que lo visible y nunca se oculta.
 * `mode: "fill"`: igual, pero con el alto exacto del hueco (la invitación
 * cabe en lo visible y lo demás se desplaza dentro).
 */
export function useFitPreview(areaRef: RefObject<HTMLElement | null>, enabled: boolean, mode: "contain" | "width" | "fill" = "contain") {
  const [fit, setFit] = useState<{ w: number; h: number; scale: number; hidden: boolean } | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    if (!enabled || !area) { setFit(null); return; }
    const measure = () => {
      const style = getComputedStyle(area);
      const room = { w: area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), h: area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
      if (mode === "width" || mode === "fill") {
        // Teléfono: su propio ancho. Tableta: una invitación de móvil ampliada.
        const w = room.w <= 480 ? Math.max(1, Math.round(room.w)) : 430;
        const scale = Math.max(0.01, room.w / w);
        // "fill": el alto visible (un móvil más corto, mismas proporciones de letra).
        const h = mode === "fill" ? Math.max(320, Math.round(room.h / scale)) : Math.max(Math.round(w * 2.17), Math.ceil(room.h / scale));
        setFit((old) => (old && old.w === w && old.h === h && Math.abs(old.scale - scale) < 0.002 ? old : { w, h, scale, hidden: false }));
        return;
      }
      // En el móvil, el ancho real del teléfono; en escritorio, un iPhone de 390 px.
      const w = window.innerWidth <= 720 ? Math.min(window.innerWidth, 440) : 390;
      const h = Math.round(w * 2.17);
      const scale = Math.max(0, Math.min(room.w / w, room.h / h, 1));
      setFit((old) => (old && old.w === w && old.h === h && Math.abs(old.scale - scale) < 0.002 ? old : { w, h, scale, hidden: h * scale < 140 }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [areaRef, enabled, mode]);
  return fit;
}
