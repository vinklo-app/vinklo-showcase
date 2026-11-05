import { z } from "zod";
import { addDays, addMonths, isIsoDate, type IsoDate } from "@/lib/planning/dates";

/*
 * Lista de tareas de la boda (20261014200000). Las sugerencias de Vinklo son
 * eso, sugerencias: la pareja elige cuáles añadir, nacen sin hacer y se pueden
 * editar o borrar. Sus fechas se calculan desde weddings.wedding_date en el
 * SERVIDOR (el cliente solo manda las claves).
 * Módulo puro: lo usan servidor y cliente.
 */

export const TASK_CATEGORIES = ["finca", "proveedores", "invitados", "ceremonia", "vestuario", "papeleo", "dia", "otros"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  finca: "Finca",
  proveedores: "Proveedores",
  invitados: "Invitados",
  ceremonia: "Ceremonia",
  vestuario: "Vestuario",
  papeleo: "Papeleo",
  dia: "El día",
  otros: "Otros",
};

export const TASK_LIMITS = { title: 120, notes: 1000 } as const;
export const TASKS_LIMIT = 500;
/** «Esta semana» = hoy y los 6 días siguientes. */
export const WEEK_DAYS = 7;

// ------------------------------------------------------------ sugerencias

export interface TaskTemplate {
  key: string;
  title: string;
  category: TaskCategory;
  /** Antelación respecto a la boda. */
  before: { months?: number; days?: number };
  /** Cómo se dice la antelación («12 meses antes»). */
  hint: string;
}

/** Calendario orientativo de una boda en España. Orden = de más a menos antelación. */
export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  { key: "fijar-presupuesto", title: "Fijar el presupuesto y un número aproximado de invitados", category: "otros", before: { months: 13 }, hint: "13 meses antes" },
  { key: "reservar-finca", title: "Reservar la finca", category: "finca", before: { months: 12 }, hint: "12 meses antes" },
  { key: "reservar-ceremonia", title: "Reservar la ceremonia (iglesia, juzgado u oficiante)", category: "ceremonia", before: { months: 11 }, hint: "11 meses antes" },
  { key: "contratar-fotografia", title: "Contratar fotografía y vídeo", category: "proveedores", before: { months: 10 }, hint: "10 meses antes" },
  { key: "cerrar-catering", title: "Cerrar el catering", category: "proveedores", before: { months: 9 }, hint: "9 meses antes" },
  { key: "contratar-musica", title: "Contratar la música", category: "proveedores", before: { months: 8 }, hint: "8 meses antes" },
  { key: "elegir-vestido", title: "Elegir el vestido", category: "vestuario", before: { months: 8 }, hint: "8 meses antes" },
  { key: "cerrar-lista", title: "Cerrar la lista de invitados", category: "invitados", before: { months: 6 }, hint: "6 meses antes" },
  { key: "elegir-traje", title: "Elegir el traje", category: "vestuario", before: { months: 5 }, hint: "5 meses antes" },
  { key: "flores-decoracion", title: "Elegir flores y decoración", category: "proveedores", before: { months: 5 }, hint: "5 meses antes" },
  { key: "expediente", title: "Empezar el expediente matrimonial", category: "papeleo", before: { months: 4 }, hint: "4 meses antes" },
  { key: "enviar-invitaciones", title: "Enviar las invitaciones", category: "invitados", before: { months: 3 }, hint: "2-3 meses antes" },
  { key: "alianzas", title: "Comprar las alianzas", category: "vestuario", before: { months: 2 }, hint: "2 meses antes" },
  { key: "confirmar-menu", title: "Confirmar el menú", category: "proveedores", before: { months: 1 }, hint: "1 mes antes" },
  { key: "recordar-respuestas", title: "Recordar a quien no ha respondido", category: "invitados", before: { days: 28 }, hint: "4 semanas antes" },
  { key: "programa-dia", title: "Publicar el programa del día en la web", category: "dia", before: { days: 21 }, hint: "3 semanas antes" },
  { key: "plan-mesas", title: "Hacer el plan de mesas", category: "invitados", before: { days: 14 }, hint: "2 semanas antes" },
  { key: "confirmar-proveedores", title: "Confirmar horarios con los proveedores", category: "proveedores", before: { days: 7 }, hint: "1 semana antes" },
];

const TEMPLATE_BY_KEY = new Map(TASK_TEMPLATES.map((template) => [template.key, template]));
export function findTaskTemplate(key: string): TaskTemplate | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

/** Fecha sugerida = fecha de la boda menos la antelación. Sin fecha de boda: null. */
export function templateDueOn(template: TaskTemplate, weddingDate: IsoDate | null): IsoDate | null {
  if (!weddingDate || !isIsoDate(weddingDate)) return null;
  const afterMonths = template.before.months ? addMonths(weddingDate, -template.before.months) : weddingDate;
  return template.before.days ? addDays(afterMonths, -template.before.days) : afterMonths;
}

export interface TaskSuggestion {
  key: string;
  title: string;
  category: TaskCategory;
  hint: string;
  dueOn: IsoDate | null;
  /** La fecha sugerida ya pasó (se ofrece sin marcar). */
  past: boolean;
  /** Ya la tenéis añadida. */
  added: boolean;
}

export function suggestTasks(weddingDate: IsoDate | null, today: IsoDate, addedKeys: Iterable<string> = []): TaskSuggestion[] {
  const added = new Set(addedKeys);
  return TASK_TEMPLATES.map((template) => {
    const dueOn = templateDueOn(template, weddingDate);
    return { key: template.key, title: template.title, category: template.category, hint: template.hint, dueOn, past: Boolean(dueOn && dueOn < today), added: added.has(template.key) };
  });
}

// ------------------------------------------------------------ tareas

export interface WeddingTask {
  id: string;
  title: string;
  notes: string | null;
  dueOn: IsoDate | null;
  done: boolean;
  doneAt: string | null;
  category: TaskCategory | null;
  position: number;
  templateKey: string | null;
  createdAt: string;
}

export const TASK_COLUMNS = "id, title, notes, due_on, done, done_at, category, position, template_key, created_at";

const taskRow = z.object({
  id: z.string(), title: z.string(), notes: z.string().nullable(), due_on: z.string().nullable(), done: z.boolean(),
  done_at: z.string().nullable(), category: z.enum(TASK_CATEGORIES).nullable(), position: z.number().int(),
  template_key: z.string().nullable(), created_at: z.string(),
});

export function parseTaskRows(data: unknown): WeddingTask[] | null {
  const parsed = z.array(taskRow).safeParse(data ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id, title: row.title, notes: row.notes, dueOn: row.due_on, done: row.done, doneAt: row.done_at,
    category: row.category, position: row.position, templateKey: row.template_key, createdAt: row.created_at,
  }));
}

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Escribid la tarea.").max(TASK_LIMITS.title, `La tarea admite hasta ${TASK_LIMITS.title} caracteres.`),
  notes: z.string().trim().max(TASK_LIMITS.notes, `Las notas admiten hasta ${TASK_LIMITS.notes} caracteres.`).optional().default(""),
  dueOn: z.union([z.literal(""), z.string().refine(isIsoDate, "Revisad la fecha.")]).nullable().optional().transform((value) => value || null),
  category: z.union([z.literal(""), z.enum(TASK_CATEGORIES, "Elegid una categoría de la lista.")]).nullable().optional().transform((value) => value || null),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export type TaskBucket = "overdue" | "week" | "later" | "done";

export function taskBucket(task: Pick<WeddingTask, "done" | "dueOn">, today: IsoDate): TaskBucket {
  if (task.done) return "done";
  if (!task.dueOn) return "later";
  if (task.dueOn < today) return "overdue";
  if (task.dueOn <= addDays(today, WEEK_DAYS - 1)) return "week";
  return "later";
}

export interface TaskCounts { thisWeek: number; overdue: number; open: number; done: number; total: number }

export function countTasks(tasks: ReadonlyArray<Pick<WeddingTask, "done" | "dueOn">>, today: IsoDate): TaskCounts {
  const counts: TaskCounts = { thisWeek: 0, overdue: 0, open: 0, done: 0, total: tasks.length };
  for (const task of tasks) {
    const bucket = taskBucket(task, today);
    if (bucket === "done") counts.done += 1; else counts.open += 1;
    if (bucket === "week") counts.thisWeek += 1;
    if (bucket === "overdue") counts.overdue += 1;
  }
  return counts;
}

export type TaskView = "semana" | "proximas" | "hechas";
export const TASK_VIEWS: readonly TaskView[] = ["semana", "proximas", "hechas"];
export const TASK_VIEW_LABELS: Record<TaskView, string> = { semana: "Esta semana", proximas: "Próximas", hechas: "Hechas" };
export function isTaskView(value: unknown): value is TaskView {
  return typeof value === "string" && (TASK_VIEWS as readonly string[]).includes(value);
}

const byDue = (a: WeddingTask, b: WeddingTask) =>
  (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Tareas de una vista, ya ordenadas. «Esta semana» = vencidas primero y las de los próximos 7 días. */
export function tasksForView(tasks: readonly WeddingTask[], view: TaskView, today: IsoDate): WeddingTask[] {
  if (view === "hechas") {
    return tasks.filter((task) => task.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || byDue(a, b));
  }
  const wanted: TaskBucket[] = view === "semana" ? ["overdue", "week"] : ["later"];
  return tasks.filter((task) => wanted.includes(taskBucket(task, today))).sort(byDue);
}

/** La vista con la que se abre: la semana si tiene algo; si no, las próximas. */
export function defaultTaskView(tasks: readonly WeddingTask[], today: IsoDate): TaskView {
  return tasksForView(tasks, "semana", today).length > 0 ? "semana" : "proximas";
}
