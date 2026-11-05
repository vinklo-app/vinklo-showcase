"use client";

/**
 * Borrador del plan de mesas (solo desarrollo): el componente real con datos
 * de muestra y acciones que mutan estado local (sin Supabase ni IA real).
 * `&fallo=1`: sentar falla (se ve el deshacer optimista). «Sentar
 * automáticamente» aplica la propuesta con ids de mentira (`&fallo=1`:
 * aplicar falla). Mesas con IA: `&plano=1` abre la revisión de un plano de
 * muestra, `&propuesta=1` abre la propuesta, `&ia=0` sin IA (plantilla y
 * lectura del plano no disponible). El aviso proactivo sale con datos
 * frescos del navegador (localStorage `vinklo:mesas:borrador`).
 */
import { useMemo } from "react";
import { SeatingPlanView, type SeatingActions } from "@/components/panel/seating-plan";
import type { GuestRow } from "@/components/panel/guest-list";
import { FLOOR_PLAN_ERRORS, normalizeFloorPlan } from "@/lib/crm/floor-plan";

import { SAMPLE_FLOOR_READING, samplePlan, sampleExplanation, tid } from "./seating-fixtures";

const wait = (ms = 250) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const FAIL = "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo.";

export function PreviewMesas({ guests, demo, empty, fail, floor = false, proposal = false, noAi = false, excel = false }: {
  guests: GuestRow[]; demo: boolean; empty: boolean; fail: boolean; floor?: boolean; proposal?: boolean; noAi?: boolean;
  /** `&excel=1`: quien no tiene mesa trae columna Mesa de un Excel («3», «3», «Presidencial», «7»…). */
  excel?: boolean;
}) {
  const initial = useMemo(() => samplePlan(guests, demo, empty), [guests, demo, empty]);
  const excelTables = useMemo(() => {
    if (!excel) return undefined;
    const values = ["3", "3", "Presidencial", "7", "3.0", "7"];
    return Object.fromEntries(initial.unseated.map((guest, index) => [guest.id, values[index % values.length]]));
  }, [excel, initial]);
  const reading = useMemo(() => normalizeFloorPlan(SAMPLE_FLOOR_READING), []);
  const actions = useMemo<SeatingActions>(() => {
    let next = 100;
    const names = new Map(initial.tables.map((table) => [table.id, table.name.toLocaleLowerCase("es")]));
    const taken = (name: string, except?: string) => [...names.entries()].some(([id, value]) => id !== except && value === name.toLocaleLowerCase("es"));
    return {
      async create({ name }) {
        await wait();
        if (taken(name)) return { ok: false, error: "Ya tenéis una mesa con ese nombre." };
        next += 1;
        names.set(tid(next), name.toLocaleLowerCase("es"));
        return { ok: true, id: tid(next) };
      },
      async rename(id, name) {
        await wait();
        if (taken(name, id)) return { ok: false, error: "Ya tenéis una mesa con ese nombre." };
        names.set(id, name.toLocaleLowerCase("es"));
        return { ok: true };
      },
      async setSeats() { await wait(120); return { ok: true }; },
      async remove(id) { await wait(); names.delete(id); return { ok: true }; },
      async seat(ids) {
        await wait();
        if (fail) return { ok: false, error: FAIL };
        return { ok: true, moved: ids.length, missing: 0 };
      },
      // Como apply_seating: todo o nada; crea las mesas nuevas y devuelve sus ids.
      async apply(newTables, assignments) {
        await wait(500);
        if (fail) return { ok: false, error: FAIL };
        if (newTables.some((table) => taken(table.name))) return { ok: false, error: "Ya tenéis una mesa con ese nombre. Actualizad la página y probad de nuevo." };
        const created = newTables.map((table) => {
          next += 1;
          names.set(tid(next), table.name.toLocaleLowerCase("es"));
          return { key: table.key, id: tid(next) };
        });
        return { ok: true, created, seated: assignments.filter((item) => "guestId" in item).length };
      },
      async setPinnedGroup() { await wait(150); return fail ? { ok: false, error: FAIL } : { ok: true }; },
      // «IA» de muestra: tarda un poco y devuelve frases con {p1}/{p2}, como el modelo.
      async explain(tables) {
        await wait(900);
        if (noAi) return { ok: false };
        return { ok: true, explanations: Object.fromEntries(tables.map((table) => [table.tableId, sampleExplanation(table)])) };
      },
      async readFloorPlan() {
        await wait(1200);
        if (noAi) return { ok: false, error: FLOOR_PLAN_ERRORS.unavailable };
        return { ok: true, reading };
      },
      // Como save_floor_plan: crea o actualiza en una sola llamada.
      async saveFloorPlan(rows) {
        await wait(400);
        if (fail) return { ok: false, error: FAIL };
        return {
          ok: true,
          tables: rows.map((row) => {
            if (row.id) { names.set(row.id, row.name.toLocaleLowerCase("es")); return { ...row, id: row.id, created: false }; }
            next += 1;
            names.set(tid(next), row.name.toLocaleLowerCase("es"));
            return { ...row, id: tid(next), created: true };
          }),
        };
      },
    };
  }, [initial, fail, noAi, reading]);
  return (
    <SeatingPlanView initial={initial} actions={actions} listHref="/borrador/panel?vista=invitados" weddingKey="borrador"
      partners={{ p1: "Lucía", p2: "Juan" }} openProposal={proposal} initialFloorReading={floor ? reading : undefined} excelTables={excelTables} />
  );
}
