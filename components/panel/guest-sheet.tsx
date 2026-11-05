"use client";

import { useEffect, useId, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";

const EXIT_MS = 180;
const DISMISS_VELOCITY = 0.11; // px/ms hacia abajo
const SETTLE = "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)";
const MOBILE_QUERY = "(max-width: 639.98px)";

/**
 * Hoja de edición sobre <dialog> nativo (foco atrapado, Esc y fondo gratis).
 * Móvil: sube desde abajo (260 ms --ease-out) y baja en 180 ms; escritorio:
 * panel centrado con scale(0.97)+fade. La salida se anima con
 * data-state="closing" antes de llamar a close(). Reduced-motion: solo fundido.
 *
 * Móvil: el asa (grip + cabecera) se arrastra. La hoja sigue al dedo 1:1;
 * hacia arriba ofrece resistencia; al soltar se cierra si el gesto va hacia
 * abajo a más de 0,11 px/ms o si ha bajado más de un 30 % de su altura, y
 * si no vuelve a su sitio. El cierre arranca desde donde quedó el dedo
 * (sin el salto de la animación de salida, que empieza en 0).
 */
export function GuestSheet({ open, title, onClose, children, wide = false, confirmClose = false }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
  /**
   * Hay cambios sin guardar: al arrastrarla hacia abajo vuelve a su sitio y
   * se llama a onClose para que el padre pregunte antes de cerrar (Esc, ✕ y
   * el fondo ya pasan siempre por onClose).
   */
  confirmClose?: boolean;
  /** Escritorio: hoja más ancha (tabla de revisión de la importación). */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const draggedOut = useRef(false);
  const justDragged = useRef(false);
  const drag = useRef<{ id: number; y0: number; active: boolean; hist: Array<[number, number]> } | null>(null);
  const titleId = useId();
  // Hojas anidadas (p. ej. «Mensaje para…» sobre la ficha): cada una guarda el
  // overflow que encontró y lo devuelve al cerrarse, así cerrar la de encima
  // no desbloquea el scroll de la página bajo la de debajo.
  const lockedOverflow = useRef<string | null>(null);
  function lockScroll() {
    if (lockedOverflow.current !== null) return;
    lockedOverflow.current = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (lockedOverflow.current === null) return;
    document.documentElement.style.overflow = lockedOverflow.current;
    lockedOverflow.current = null;
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setClosing(false);
      draggedOut.current = false;
      dialog.removeAttribute("data-drag");
      dialog.style.transform = "";
      dialog.style.transition = "";
      if (!dialog.open) {
        dialog.showModal();
        // El foco va al título (no a la ✕): sin anillo sobre «Cerrar» al abrir y el lector anuncia la hoja.
        dialog.querySelector<HTMLElement>(".pn-sheet-title")?.focus();
      }
      lockScroll();
      return;
    }
    if (!dialog.open) return;
    if (draggedOut.current) {
      // Ya salió con el dedo: cerrar sin volver a animar.
      dialog.close();
      dialog.removeAttribute("data-drag");
      dialog.style.transform = "";
      dialog.style.transition = "";
      draggedOut.current = false;
      unlockScroll();
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      dialog.close();
      setClosing(false);
      unlockScroll();
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => () => unlockScroll(), []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!window.matchMedia(MOBILE_QUERY).matches || drag.current || event.button > 0) return;
    drag.current = { id: event.pointerId, y0: event.clientY, active: false, hist: [[event.clientY, event.timeStamp]] };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const dialog = ref.current;
    if (!d || d.id !== event.pointerId || !dialog) return;
    const dy = event.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) < 6) return;
      d.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      dialog.setAttribute("data-drag", "true");
    }
    const height = dialog.offsetHeight;
    // Hacia arriba: resistencia progresiva (rubber-band), nunca un tope seco.
    const y = dy >= 0 ? dy : -((-dy * height * 0.55) / (height + 0.55 * -dy)) * 0.35;
    dialog.style.transition = "none";
    dialog.style.transform = `translate3d(0, ${y}px, 0)`;
    d.hist.push([event.clientY, event.timeStamp]);
    if (d.hist.length > 8) d.hist.shift();
  }
  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const dialog = ref.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (!d.active || !dialog) return;
    justDragged.current = true;
    window.setTimeout(() => { justDragged.current = false; }, 350);
    // Velocidad solo con los últimos 100 ms: un dedo que se ha parado no «lanza».
    const now = event.timeStamp;
    const recent = d.hist.filter(([, t]) => now - t <= 100);
    const [y1, t1] = recent[0] ?? [event.clientY, now];
    const [y2, t2] = [event.clientY, now];
    const velocity = event.type === "pointercancel" ? 0 : (y2 - y1) / Math.max(1, t2 - t1);
    const dy = event.clientY - d.y0;
    const dismiss = velocity > DISMISS_VELOCITY || (velocity >= 0 && dy > dialog.offsetHeight * 0.3);
    if (dismiss && confirmClose) {
      dialog.style.transition = prefersReducedMotion() ? "none" : SETTLE;
      dialog.style.transform = "";
      onClose();
      return;
    }
    if (dismiss) {
      // Más rápida que la entrada y desde la posición actual.
      dialog.setAttribute("data-drag", "out");
      dialog.style.transition = prefersReducedMotion() ? "none" : `transform ${EXIT_MS + 20}ms var(--ease-out)`;
      dialog.style.transform = "translate3d(0, 100%, 0)";
      draggedOut.current = true;
      window.setTimeout(onClose, EXIT_MS);
      return;
    }
    dialog.style.transition = prefersReducedMotion() ? "none" : SETTLE;
    dialog.style.transform = "";
  }
  // El clic que sigue a un arrastre (soltar sobre la ✕) no cuenta como toque.
  function onHandleClickCapture(event: React.MouseEvent) {
    if (justDragged.current) { event.preventDefault(); event.stopPropagation(); }
  }

  return (
    <dialog
      ref={ref}
      className={wide ? "pn-sheet pn-sheet--wide" : "pn-sheet"}
      data-state={closing ? "closing" : undefined}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="pn-sheet-inner">
        <div className="pn-sheet-handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onHandleClickCapture}>
          <div className="pn-sheet-grip" aria-hidden="true" />
          <div className="pn-sheet-head">
            <h2 id={titleId} tabIndex={-1} className="pn-display pn-h2 pn-sheet-title">{title}</h2>
            <button type="button" onClick={onClose} className="pn-sheet-close pn-press" aria-label="Cerrar">
              <XIcon aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
        {open || closing ? children : null}
      </div>
    </dialog>
  );
}
