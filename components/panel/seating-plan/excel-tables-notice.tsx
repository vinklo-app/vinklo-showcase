"use client";

import { plural } from "@/components/panel/guest-status";
import type { ExcelTablesProposal } from "@/lib/crm/excel-tables";
import { TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX } from "@/lib/crm/seating";

/** Aviso «Crear N mesas y sentar según vuestro Excel»; el estado y la acción son del plan. */
export function ExcelTablesNotice({ excelProposal, autoPending, pending, seatFromExcel, setExcelDismissed }: {
  excelProposal: ExcelTablesProposal; autoPending: boolean; pending: boolean;
  seatFromExcel: () => Promise<void>; setExcelDismissed: (dismissed: boolean) => void;
}) {
  return (
    <div className="pn-note pn-auto-undo" role="status">
      <span>
        Vuestro Excel trae la mesa de {plural(excelProposal.guests, "invitado que aún no tiene mesa", "invitados que aún no tienen mesa")}.
        {excelProposal.created > 0 && <span className="pn-help block">Las mesas nuevas son de {TABLE_SEATS_DEFAULT} plazas, o más si hacen falta (hasta {TABLE_SEATS_MAX}).{excelProposal.reused > 0 ? " Las que ya tenéis con el mismo nombre se aprovechan." : ""}</span>}
      </span>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="pn-btn pn-btn--sm pn-press" disabled={autoPending || pending} onClick={() => void seatFromExcel()}>
          {excelProposal.created > 0 ? `Crear ${plural(excelProposal.created, "mesa", "mesas")} y sentar según vuestro Excel` : "Sentar según vuestro Excel"}
        </button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setExcelDismissed(true)}>Ahora no</button>
      </span>
    </div>
  );
}
