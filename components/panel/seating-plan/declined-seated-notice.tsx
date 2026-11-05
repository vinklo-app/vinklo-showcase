"use client";

import { formatCount } from "@/components/panel/guest-status";

/** Aviso «N invitados sentados ya no vienen» y «Quitarlos»; el estado y la acción son del plan. */
export function DeclinedSeatedNotice({ declinedSeated, askDeclined, setAskDeclined, autoPending, pending, removeDeclined }: {
  declinedSeated: Array<{ id: string; name: string; tableId: string }>;
  askDeclined: boolean; setAskDeclined: (ask: boolean) => void;
  autoPending: boolean; pending: boolean;
  removeDeclined: () => Promise<void>;
}) {
  return (
    <div className="pn-note pn-note--warn pn-auto-undo" role="status">
      {askDeclined ? (
        <>
          <span>¿Quitar de sus mesas a {declinedSeated.length === 1 ? `${declinedSeated[0].name}, que no viene` : `los ${formatCount(declinedSeated.length)} que no vienen`}? {declinedSeated.length === 1 ? "Vuelve" : "Vuelven"} a «Sin mesa».</span>
          <span className="flex flex-wrap gap-2">
            <button type="button" className="pn-btn pn-btn--sm pn-press" disabled={autoPending || pending} onClick={() => void removeDeclined()}>Quitar de las mesas</button>
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setAskDeclined(false)}>Cancelar</button>
          </span>
        </>
      ) : (
        <>
          <span>{declinedSeated.length === 1 ? "1 invitado sentado ya no viene" : `${formatCount(declinedSeated.length)} invitados sentados ya no vienen`}</span>
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={autoPending} onClick={() => setAskDeclined(true)}>Quitarlos</button>
        </>
      )}
    </div>
  );
}
