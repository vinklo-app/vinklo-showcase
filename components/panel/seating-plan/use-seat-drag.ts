"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SeatGuest } from "@/lib/crm/seating";

export const NONE = "none";

// ---------------------------------------------------------------- arrastrar

/** Velocidad de autodesplazamiento (px por fotograma) a menos de 72 px del borde superior o inferior. */
function edgeSpeed(y: number): number {
  const zone = 72;
  if (y < zone) return -Math.ceil(((zone - y) / zone) * 18);
  if (y > window.innerHeight - zone) return Math.ceil(((y - (window.innerHeight - zone)) / zone) * 18);
  return 0;
}

export interface DragState { guestId: string; name: string; from: string | null }

/**
 * Arrastre con Pointer Events. Empieza tras 6 px (un clic no arrastra), solo
 * con ratón o lápiz y nunca desde un control. La «ficha» que sigue al
 * puntero tiene pointer-events: none para que elementFromPoint vea la mesa.
 */
export function useSeatDrag(onDrop: (guestId: string, target: string | null) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; state: DragState; id: number } | null>(null);
  const live = useRef<{ drag: DragState | null; over: string | null }>({ drag: null, over: null });
  const dropRef = useRef(onDrop);
  useEffect(() => { dropRef.current = onDrop; }, [onDrop]);

  const targetAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-table]");
    return el?.dataset.dropTable ?? null;
  };
  const place = (x: number, y: number) => {
    if (ghost.current) ghost.current.style.transform = `translate3d(${x + 14}px, ${y + 10}px, 0)`;
  };
  const pointer = useRef({ x: 0, y: 0 });
  const scrollFrame = useRef<number | null>(null);
  const finish = useCallback(() => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    start.current = null;
    live.current = { drag: null, over: null };
    setDrag(null); setOver(null);
    document.documentElement.removeAttribute("data-seat-dragging");
  }, []);

  useEffect(() => {
    function move(event: PointerEvent) {
      const pending = start.current;
      if (!pending || event.pointerId !== pending.id) return;
      if (!live.current.drag) {
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
        live.current.drag = pending.state;
        setDrag(pending.state);
        document.documentElement.setAttribute("data-seat-dragging", "");
      }
      event.preventDefault();
      pointer.current = { x: event.clientX, y: event.clientY };
      place(event.clientX, event.clientY);
      hover();
      // Cerca del borde, la página se desplaza sola (las mesas pueden estar fuera de la vista).
      const edge = edgeSpeed(event.clientY);
      if (edge !== 0 && scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(autoScroll);
    }
    function hover() {
      const target = targetAt(pointer.current.x, pointer.current.y);
      if (target !== live.current.over) { live.current.over = target; setOver(target); }
    }
    function autoScroll() {
      scrollFrame.current = null;
      if (!live.current.drag) return;
      const speed = edgeSpeed(pointer.current.y);
      if (speed === 0) return;
      window.scrollBy(0, speed);
      hover();
      scrollFrame.current = requestAnimationFrame(autoScroll);
    }
    function up(event: PointerEvent) {
      const pending = start.current;
      if (!pending || event.pointerId !== pending.id) return;
      const dragging = live.current.drag;
      if (dragging) {
        const target = targetAt(event.clientX, event.clientY) ?? live.current.over;
        const tableId = target === NONE ? null : target;
        if (target !== null && tableId !== dragging.from) dropRef.current(dragging.guestId, tableId);
      }
      finish();
    }
    function key(event: KeyboardEvent) { if (event.key === "Escape" && start.current) finish(); }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", key);
    };
  }, [finish]);

  const bind = (guest: SeatGuest, from: string | null) => ({
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if ((event.target as HTMLElement).closest("select, button, input, a, label")) return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, state: { guestId: guest.id, name: guest.name, from } };
      place(event.clientX, event.clientY);
    },
  });

  return { drag, over, ghost, bind };
}
