"use client";

/**
 * Hoja inferior del creador (móvil y tablet): aloja el editor del campo que
 * la pareja ha tocado, «Añadir más» o la conversación de «Pedid cambios».
 *
 * - Siempre montada: se abre y se cierra con `translateY` (curva de cajón de
 *   iOS, 300 ms), nunca con un salto de `display`. Cerrada queda `inert`.
 * - El asa se arrastra con captura de puntero: sigue al dedo 1:1 hacia abajo
 *   y con resistencia hacia arriba; al soltar, se cierra si iba rápido
 *   (|dy|/ms > 0,11) o si ha bajado más del 30 % de su alto. Los estilos en
 *   línea se quitan en el mismo frame en que cambia el estado, así la
 *   transición arranca desde donde quedó el dedo.
 * - Escape, un toque fuera y la X de la cabecera la cierran. La invitación
 *   de arriba se sigue viendo y cambia mientras escriben.
 * - `footer`: abajo a la derecha, «Siguiente» (o «Hecho» en el último paso).
 *   Sustituye al antiguo «Hecho» de la cabecera, que confundía (backlog
 *   13-oct-2026, punto 10).
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { rubberBand } from "./native";

const DISMISS_VELOCITY = 0.11;
const DISMISS_FRACTION = 0.3;

export function CreatorSheet({ open, title, lead, onClose, children, footer, kind, sheetRef, bodyRef, closeLabel = "Cerrar" }: {
  open: boolean;
  title: string;
  lead?: string;
  onClose(): void;
  children: ReactNode;
  /** Pie fijo de la hoja (el botón «Siguiente»). */
  footer?: ReactNode;
  /** "field": cubre la barra inferior; "thread": se apoya encima del compositor. */
  kind: "field" | "thread";
  sheetRef?: RefObject<HTMLElement | null>;
  bodyRef?: RefObject<HTMLDivElement | null>;
  closeLabel?: string;
}) {
  const titleId = useId();
  const ownRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // El contenido se conserva mientras la hoja baja (no se vacía a media animación).
  const shown = useRef<{ title: string; lead?: string; children: ReactNode; footer?: ReactNode }>({ title, lead, children, footer });
  if (open) shown.current = { title, lead, children, footer };

  const setRefs = (node: HTMLElement | null) => {
    ownRef.current = node;
    if (sheetRef) (sheetRef as { current: HTMLElement | null }).current = node;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Un desplegable abierto (sugerencias de lugares) se cierra antes.
      if (event.target instanceof Element && event.target.closest("[aria-expanded='true']")) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const drag = useRef<{ id: number; y: number; lastY: number; lastT: number; velocity: number; height: number; offset: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const sheet = ownRef.current;
    if (!sheet || !event.isPrimary || event.button > 0) return;
    drag.current = { id: event.pointerId, y: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, height: sheet.offsetHeight, offset: 0 };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Puntero ya liberado. */ }
    sheet.dataset.dragging = "true";
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const sheet = ownRef.current;
    if (!current || !sheet || event.pointerId !== current.id) return;
    const dt = Math.max(1, event.timeStamp - current.lastT);
    current.velocity = (event.clientY - current.lastY) / dt;
    current.lastY = event.clientY;
    current.lastT = event.timeStamp;
    const dy = event.clientY - current.y;
    // Hacia abajo, 1:1; hacia arriba, con fricción (ya está entera a la vista).
    current.offset = dy >= 0 ? dy : -rubberBand(-dy, current.height);
    sheet.style.transform = `translateY(${current.offset}px)`;
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const sheet = ownRef.current;
    if (!current || event.pointerId !== current.id) return;
    drag.current = null;
    if (!sheet) return;
    const dismiss = event.type !== "pointercancel" && current.offset > 0 && (current.velocity > DISMISS_VELOCITY || current.offset > current.height * DISMISS_FRACTION);
    // Mismo frame: sin estilos en línea y con el estado nuevo, la transición CSS parte de aquí.
    sheet.style.transform = "";
    delete sheet.dataset.dragging;
    if (dismiss) onCloseRef.current();
  };

  const { title: shownTitle, lead: shownLead, children: shownChildren, footer: shownFooter } = shown.current;
  return (
    <div className="wb-sheet-layer" data-open={open ? "true" : "false"} data-kind={kind}>
      {/* Toque fuera = cerrar. No es un control del teclado (Escape ya cierra). */}
      <div className="wb-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section ref={setRefs} className="wb-sheet" role="dialog" aria-modal="false" aria-labelledby={titleId} inert={!open} data-open={open ? "true" : "false"}>
        <div className="wb-sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} aria-hidden="true">
          <span />
        </div>
        <header className="wb-sheet-head">
          <div className="wb-sheet-titles">
            <h2 id={titleId} tabIndex={-1}>{shownTitle}</h2>
            {shownLead && <p>{shownLead}</p>}
          </div>
          <button type="button" className="wb-close-btn" aria-label={closeLabel} onClick={onClose}><XIcon aria-hidden="true" size={18} strokeWidth={1.75} /></button>
        </header>
        <div ref={bodyRef} className="wb-sheet-body" data-footer={shownFooter ? "" : undefined}>{shownChildren}</div>
        {shownFooter && <div className="wb-sheet-foot">{shownFooter}</div>}
      </section>
    </div>
  );
}
