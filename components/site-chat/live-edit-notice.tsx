/**
 * Avisos en línea del editor sobre la vista previa (live-edit.tsx): el guardado
 * ha fallado y el texto sigue en el campo, o hay un texto sin guardar de una
 * visita anterior. Los botones no roban el foco al campo (onMouseDown): así
 * pulsarlos no dispara el «guardar al salir».
 */
import type { MouseEvent } from "react";

const keepFocus = (event: MouseEvent) => event.preventDefault();
export const NOTICE_ATTR = "data-live-edit-action";

export function LiveEditFailure({ error, retryable, onRetry, onDiscard }: { error: string; retryable: boolean; onRetry(): void; onDiscard(): void }) {
  return (
    <>
      <span role="alert">{error}</span>
      <span className="lv-actions" {...{ [NOTICE_ATTR]: "" }}>
        {retryable && <button type="button" className="lv-action" onMouseDown={keepFocus} onClick={onRetry}>Reintentar</button>}
        <button type="button" className="lv-action" onMouseDown={keepFocus} onClick={onDiscard}>Descartar cambios</button>
      </span>
    </>
  );
}

export function LiveEditRecover({ onRecover, onIgnore }: { onRecover(): void; onIgnore(): void }) {
  return (
    <>
      <span role="status">Hay un texto sin guardar de antes.</span>
      <span className="lv-actions" {...{ [NOTICE_ATTR]: "" }}>
        <button type="button" className="lv-action" onMouseDown={keepFocus} onClick={onRecover}>Recuperarlo</button>
        <button type="button" className="lv-action" onMouseDown={keepFocus} onClick={onIgnore}>Descartarlo</button>
      </span>
    </>
  );
}
