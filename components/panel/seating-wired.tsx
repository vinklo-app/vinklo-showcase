"use client";

import { applySeating, createTable, deleteTable, renameTable, saveFloorPlan, seatGuests, setTablePinnedGroup, setTableSeats } from "@/lib/actions/tables";
import { explainSeating, readFloorPlan } from "@/lib/ai/seating-actions";
import { SeatingPlanView, type SeatingActions } from "@/components/panel/seating-plan";
import type { SeatingPlan } from "@/lib/crm/seating";

/** El plan de mesas con las server actions reales (lib/actions/tables.ts y lib/ai/seating-actions.ts). */
const ACTIONS: SeatingActions = {
  create: createTable,
  rename: renameTable,
  setSeats: setTableSeats,
  remove: deleteTable,
  seat: seatGuests,
  apply: applySeating,
  setPinnedGroup: setTablePinnedGroup,
  explain: explainSeating,
  readFloorPlan,
  saveFloorPlan,
};

export function SeatingPlanLive({ initial, weddingKey, partners, openProposal, excelTables }: {
  initial: SeatingPlan; weddingKey: string; partners: { p1: string; p2: string }; openProposal: boolean;
  /** Columna Mesa del Excel de quienes no tienen mesa (getExcelTables). */
  excelTables?: Record<string, string>;
}) {
  return <SeatingPlanView initial={initial} actions={ACTIONS} weddingKey={weddingKey} partners={partners} openProposal={openProposal} excelTables={excelTables} />;
}
