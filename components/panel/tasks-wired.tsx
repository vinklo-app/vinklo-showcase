"use client";

import { addSuggestedTasks, createTask, deleteTask, setTaskDone, updateTask } from "@/lib/actions/tasks";
import { TasksBoard, type TaskActions } from "@/components/panel/tasks-board";
import type { IsoDate } from "@/lib/planning/dates";
import type { WeddingTask } from "@/lib/planning/tasks";

/** La lista de tareas con las server actions reales (lib/actions/tasks.ts). */
const ACTIONS: TaskActions = {
  create: createTask,
  update: updateTask,
  setDone: setTaskDone,
  remove: deleteTask,
  addSuggested: addSuggestedTasks,
};

export function TasksBoardLive({ initial, today, weddingDate }: { initial: WeddingTask[]; today: IsoDate; weddingDate: IsoDate | null }) {
  return <TasksBoard initial={initial} today={today} weddingDate={weddingDate} actions={ACTIONS} />;
}
