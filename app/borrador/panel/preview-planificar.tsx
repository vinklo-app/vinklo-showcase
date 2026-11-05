"use client";

/**
 * Borrador de Tareas y de Proveedores y presupuesto (solo desarrollo): los
 * componentes reales con datos de muestra y acciones que mutan estado local
 * (sin Supabase). `&fallo=1`: las escrituras fallan (se ve el deshacer).
 */
import { useMemo } from "react";
import { TasksBoard, type TaskActions } from "@/components/panel/tasks-board";
import { VendorsBoard, type VendorActions } from "@/components/panel/vendors-board";
import { BudgetBoard, type BudgetActions } from "@/components/panel/budget-board";
import type { IsoDate } from "@/lib/planning/dates";
import type { BudgetData } from "@/lib/planning/budget";
import type { WeddingTask } from "@/lib/planning/tasks";
import type { VendorCategory, VendorContact } from "@/lib/vendors/contacts";
import { tasksFromSuggestions } from "./planning-fixtures";

const wait = (ms = 200) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const FAIL = { ok: false as const, error: "No hemos podido guardarlo. Comprobad la conexión y probad de nuevo." };
let counter = 900;
const nextId = () => `7f000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function PreviewTareas({ initial, today, weddingDate, fail }: { initial: WeddingTask[]; today: IsoDate; weddingDate: IsoDate | null; fail: boolean }) {
  const actions = useMemo<TaskActions>(() => ({
    async create() { await wait(); return fail ? FAIL : { ok: true, id: nextId() }; },
    async update() { await wait(); return fail ? FAIL : { ok: true }; },
    async setDone() { await wait(); return fail ? FAIL : { ok: true }; },
    async remove() { await wait(); return fail ? FAIL : { ok: true }; },
    async addSuggested(keys) {
      await wait(350);
      if (fail) return FAIL;
      const tasks = tasksFromSuggestions(keys, today, weddingDate, ++counter * 10);
      return { ok: true, added: tasks.length, skipped: keys.length - tasks.length, tasks };
    },
  }), [fail, today, weddingDate]);
  return <TasksBoard initial={initial} today={today} weddingDate={weddingDate} actions={actions} settingsHref="/borrador/panel?vista=ajustes" />;
}

export function PreviewAgenda({ initial, openNew, fail }: { initial: VendorContact[]; openNew: VendorCategory | null; fail: boolean }) {
  const actions = useMemo<VendorActions>(() => ({
    async add() { await wait(); return fail ? FAIL : { ok: true, id: nextId() }; },
    async update() { await wait(); return fail ? FAIL : { ok: true }; },
    async remove() { await wait(); return fail ? FAIL : { ok: true }; },
  }), [fail]);
  return <VendorsBoard initial={initial} actions={actions} openNew={openNew} />;
}

export function PreviewPresupuesto({ initial, contacts, today, fail }: { initial: BudgetData; contacts: VendorContact[]; today: IsoDate; fail: boolean }) {
  const actions = useMemo<BudgetActions>(() => ({
    async setTotal() { await wait(); return fail ? FAIL : { ok: true }; },
    async addItem() { await wait(); return fail ? FAIL : { ok: true, id: nextId() }; },
    async updateItem() { await wait(); return fail ? FAIL : { ok: true }; },
    async removeItem() { await wait(); return fail ? FAIL : { ok: true }; },
    async addPayment() { await wait(); return fail ? FAIL : { ok: true, id: nextId() }; },
    async setPaid() { await wait(); return fail ? FAIL : { ok: true }; },
    async removePayment() { await wait(); return fail ? FAIL : { ok: true }; },
  }), [fail]);
  return <BudgetBoard initial={initial} contacts={contacts} today={today} actions={actions} />;
}
