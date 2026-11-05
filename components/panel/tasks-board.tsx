"use client";

/**
 * Lista de tareas de la boda (2026-10-06). Tres vistas: «Esta semana»
 * (vencidas primero, destacadas, y lo de los próximos 7 días), «Próximas»
 * (por mes; sin fecha al final) y «Hechas». Marcar hecha es un toque y se
 * puede deshacer (desde el aviso o tocando otra vez en «Hechas»).
 * Las sugerencias de Vinklo se añaden con un botón: la pareja elige cuáles,
 * nacen sin hacer y son editables. «Hoy» llega del servidor (Madrid).
 * Optimista: el cambio se ve al instante y se deshace si el servidor falla.
 * Las acciones llegan por props (servidor real o borrador sin base de datos).
 */
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangleIcon, CalendarIcon, CheckIcon, ListChecksIcon, PencilIcon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import "@/components/panel/planning.css";
import { formatShortDate, relativeDue, type IsoDate } from "@/lib/planning/dates";
import {
  countTasks, defaultTaskView, suggestTasks, taskBucket, tasksForView,
  TASK_CATEGORIES, TASK_CATEGORY_LABELS, TASK_LIMITS, TASK_VIEW_LABELS, TASK_VIEWS,
  type TaskCategory, type TaskInput, type TaskView, type WeddingTask,
} from "@/lib/planning/tasks";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface TaskActions {
  create(input: TaskInput): Promise<Result<{ id: string }>>;
  update(id: string, input: TaskInput): Promise<Result>;
  setDone(id: string, done: boolean): Promise<Result>;
  remove(id: string): Promise<Result>;
  addSuggested(keys: string[]): Promise<Result<{ added: number; skipped: number; tasks: WeddingTask[] }>>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MONTH = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" });
function monthLabel(iso: IsoDate): string {
  const label = MONTH.format(new Date(`${iso}T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ---------------------------------------------------------------- formulario

interface Draft { title: string; dueOn: string; category: string; notes: string }
const toDraft = (task?: WeddingTask): Draft => ({ title: task?.title ?? "", dueOn: task?.dueOn ?? "", category: task?.category ?? "", notes: task?.notes ?? "" });

function TaskForm({ initial, submitLabel, onSubmit, onCancel, onDelete, idPrefix }: {
  initial?: WeddingTask; submitLabel: string; idPrefix: string;
  onSubmit(draft: Draft): Promise<string | null>; onCancel(): void; onDelete?(): Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) { setError("Escribid la tarea."); return; }
    start(async () => { setError(await onSubmit(draft)); });
  };
  return (
    <form className="pn-plan-form pn-plan-card pn-plan-card--soft" onSubmit={submit} noValidate>
      <label className="pn-field" htmlFor={`${idPrefix}-title`}>Tarea
        <input id={`${idPrefix}-title`} value={draft.title} onChange={set("title")} maxLength={TASK_LIMITS.title} required autoFocus={!initial} placeholder="Probar el menú con el catering" autoComplete="off" />
      </label>
      <div className="pn-plan-form-row">
        <label className="pn-field" htmlFor={`${idPrefix}-due`}>Fecha límite <small>Opcional</small>
          <input id={`${idPrefix}-due`} type="date" value={draft.dueOn} onChange={set("dueOn")} />
        </label>
        <label className="pn-field" htmlFor={`${idPrefix}-cat`}>Categoría <small>Opcional</small>
          <select id={`${idPrefix}-cat`} value={draft.category} onChange={set("category")}>
            <option value="">Sin categoría</option>
            {TASK_CATEGORIES.map((category) => <option key={category} value={category}>{TASK_CATEGORY_LABELS[category]}</option>)}
          </select>
        </label>
      </div>
      <label className="pn-field" htmlFor={`${idPrefix}-notes`}>Notas <small>Opcional</small>
        <textarea id={`${idPrefix}-notes`} rows={2} value={draft.notes} onChange={set("notes")} maxLength={TASK_LIMITS.notes} />
      </label>
      {error && <p role="alert" className="pn-plan-error">{error}</p>}
      <div className="pn-plan-actions">
        <button type="submit" className="pn-btn pn-btn--clay pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : submitLabel}</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onCancel} disabled={pending}>Cancelar</button>
        <span className="pn-spacer" />
        {onDelete && (confirming ? (
          <>
            <span className="pn-help">¿Borrar esta tarea?</span>
            <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending} onClick={() => start(onDelete)}>Sí, borrar</button>
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setConfirming(false)}>No</button>
          </>
        ) : (
          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => setConfirming(true)}>Borrar</button>
        ))}
      </div>
    </form>
  );
}

const draftToInput = (draft: Draft): TaskInput => ({ title: draft.title, dueOn: draft.dueOn, category: draft.category as TaskCategory | "", notes: draft.notes });

// ---------------------------------------------------------------- sugerencias

function Suggestions({ tasks, today, weddingDate, onAdd, onClose, settingsHref }: {
  tasks: WeddingTask[]; today: IsoDate; weddingDate: IsoDate | null; settingsHref: string;
  onAdd(keys: string[]): Promise<boolean>; onClose?(): void;
}) {
  const suggestions = suggestTasks(weddingDate, today, tasks.flatMap((task) => (task.templateKey ? [task.templateKey] : [])));
  // Por defecto: las que faltan y cuya fecha no ha pasado.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suggestions.filter((s) => !s.added && !s.past).map((s) => s.key)));
  const [pending, start] = useTransition();
  const available = suggestions.filter((s) => !s.added);
  const toggle = (key: string) => setPicked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const chosen = available.filter((s) => picked.has(s.key)).map((s) => s.key);
  return (
    <section className="pn-plan-card" aria-labelledby="suggest-title">
      <div className="pn-plan-card-head">
        <h2 id="suggest-title" className="pn-display pn-h3">Tareas sugeridas</h2>
        {onClose && <button type="button" className="pn-link pn-press pn-muted" onClick={onClose}><XIcon aria-hidden="true" className="size-4" />Cerrar</button>}
      </div>
      <p className="pn-help">
        Un calendario orientativo para una boda en España. Son sugerencias: elegid las que os sirvan y cambiad textos y fechas cuando queráis.
        {weddingDate ? <> Fechas calculadas desde vuestra boda ({formatShortDate(weddingDate)}).</> : <> Sin fecha de boda se añaden sin fecha; <Link href={settingsHref} className="underline underline-offset-4">ponedla en vuestra web</Link> y las siguientes la tendrán.</>}
      </p>
      {available.length === 0 ? (
        <p className="pn-note pn-note--ok">Ya tenéis todas las sugerencias en vuestra lista.</p>
      ) : (
        <ul className="pn-suggest">
          {suggestions.map((s) => (
            <li key={s.key} className="pn-suggest-item" data-added={s.added || undefined}>
              <label>
                <input type="checkbox" checked={s.added || picked.has(s.key)} disabled={s.added || pending} onChange={() => toggle(s.key)} />
                <span className="pn-suggest-text">
                  <span className="pn-suggest-title">{s.title}</span>
                  <span className="pn-suggest-hint">
                    {s.added ? "Ya la tenéis" : s.hint}
                    {!s.added && s.past && <span data-warn> · la fecha sugerida ya pasó</span>}
                  </span>
                </span>
                {s.dueOn && <span className="pn-suggest-date">{formatShortDate(s.dueOn, today)}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="pn-plan-actions">
          <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={pending || chosen.length === 0}
            onClick={() => start(async () => { if (await onAdd(chosen)) onClose?.(); })}>
            <PlusIcon aria-hidden="true" className="size-4" />{pending ? "Añadiendo…" : chosen.length === 0 ? "Elegid alguna" : `Añadir ${plural(chosen.length, "tarea", "tareas")}`}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- fila

function TaskRow({ task, today, editing, onToggle, onEdit, onSave, onCancel, onDelete }: {
  task: WeddingTask; today: IsoDate; editing: boolean;
  onToggle(): void; onEdit(): void; onCancel(): void;
  onSave(draft: Draft): Promise<string | null>; onDelete(): Promise<void>;
}) {
  const bucket = taskBucket(task, today);
  return (
    <li className="pn-task" data-bucket={bucket} data-done={task.done || undefined}>
      <button type="button" className="pn-task-check" aria-pressed={task.done} onClick={onToggle}
        aria-label={task.done ? `Marcar «${task.title}» como pendiente` : `Marcar «${task.title}» como hecha`}>
        <span><CheckIcon aria-hidden="true" strokeWidth={3} /></span>
      </button>
      <div className="pn-task-body">
        <span className="pn-task-title">{task.title}</span>
        {(task.dueOn || task.category) && (
          <span className="pn-task-meta">
            {task.dueOn && (
              <span className="pn-task-due">
                {bucket === "overdue" ? <AlertTriangleIcon aria-hidden="true" className="size-3.5" /> : <CalendarIcon aria-hidden="true" className="size-3.5" />}
                {bucket === "overdue" ? `Vencida · ${relativeDue(task.dueOn, today).toLocaleLowerCase("es")}` : relativeDue(task.dueOn, today)}
              </span>
            )}
            {task.category && <span className="pn-task-tag">{TASK_CATEGORY_LABELS[task.category]}</span>}
          </span>
        )}
        {task.notes && !editing && <p className="pn-task-notes">{task.notes}</p>}
      </div>
      <button type="button" className="pn-task-edit pn-press" aria-label={`Editar «${task.title}»`} aria-expanded={editing} onClick={editing ? onCancel : onEdit}>
        {editing ? <XIcon aria-hidden="true" className="size-4" /> : <PencilIcon aria-hidden="true" className="size-4" />}
      </button>
      {editing && (
        <div className="pn-task-form">
          <TaskForm initial={task} idPrefix={`t-${task.id}`} submitLabel="Guardar" onSubmit={onSave} onCancel={onCancel} onDelete={onDelete} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- tablero

export function TasksBoard({ initial, today, weddingDate, actions, settingsHref = "/panel/ajustes" }: {
  initial: WeddingTask[]; today: IsoDate; weddingDate: IsoDate | null; actions: TaskActions; settingsHref?: string;
}) {
  // Estado derivado de props: la revalidación del servidor manda; los cambios locales se ven mientras tanto.
  const [tasks, setTasks] = useState(initial);
  const [source, setSource] = useState(initial);
  if (source !== initial) { setSource(initial); setTasks(initial); }
  const [view, setView] = useState<TaskView>(() => defaultTaskView(initial, today));
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [announce, setAnnounce] = useState("");

  const counts = countTasks(tasks, today);
  const visible = tasksForView(tasks, view, today);
  const tabCount: Record<TaskView, number> = { semana: counts.thisWeek + counts.overdue, proximas: counts.open - counts.thisWeek - counts.overdue, hechas: counts.done };

  const replace = (id: string, patch: Partial<WeddingTask>) => setTasks((list) => list.map((task) => (task.id === id ? { ...task, ...patch } : task)));

  async function toggle(task: WeddingTask, done = !task.done) {
    const before = { done: task.done, doneAt: task.doneAt };
    replace(task.id, { done, doneAt: done ? new Date().toISOString() : null });
    const message = done ? `Hecha: «${task.title}».` : `«${task.title}» vuelve a pendientes.`;
    setAnnounce(message);
    const result = await actions.setDone(task.id, done);
    if (!result.ok) { replace(task.id, before); toast(result.error); setAnnounce(result.error); return; }
    if (done) toast(message, { action: { label: "Deshacer", onClick: () => void toggle({ ...task, done: true }, false) } });
  }

  async function create(draft: Draft): Promise<string | null> {
    const result = await actions.create(draftToInput(draft));
    if (!result.ok) return result.error;
    const task: WeddingTask = {
      id: result.id, title: draft.title.trim(), notes: draft.notes.trim() || null, dueOn: draft.dueOn || null, done: false, doneAt: null,
      category: (draft.category || null) as TaskCategory | null, position: 0, templateKey: null, createdAt: new Date().toISOString(),
    };
    setTasks((list) => [...list, task]);
    setAdding(false);
    const bucket = taskBucket(task, today);
    setView(bucket === "overdue" || bucket === "week" ? "semana" : "proximas");
    setAnnounce(`Tarea añadida: «${task.title}».`);
    return null;
  }

  async function save(task: WeddingTask, draft: Draft): Promise<string | null> {
    const result = await actions.update(task.id, draftToInput(draft));
    if (!result.ok) return result.error;
    replace(task.id, { title: draft.title.trim(), notes: draft.notes.trim() || null, dueOn: draft.dueOn || null, category: (draft.category || null) as TaskCategory | null });
    setEditing(null);
    return null;
  }

  async function remove(task: WeddingTask) {
    const result = await actions.remove(task.id);
    if (!result.ok) { toast(result.error); return; }
    setTasks((list) => list.filter((item) => item.id !== task.id));
    setEditing(null);
    toast(`Tarea borrada: «${task.title}».`);
  }

  async function addSuggested(keys: string[]): Promise<boolean> {
    const result = await actions.addSuggested(keys);
    if (!result.ok) { toast(result.error); return false; }
    setTasks((list) => [...list, ...result.tasks.filter((task) => !list.some((item) => item.id === task.id))]);
    toast(result.added > 0 ? `${plural(result.added, "tarea añadida", "tareas añadidas")} a vuestra lista.` : "Ya las teníais en vuestra lista.");
    setView(defaultTaskView([...tasks, ...result.tasks], today));
    setSuggesting(false);
    return true;
  }

  const emptyCopy: Record<TaskView, string> = {
    semana: counts.open > 0 ? "Nada vence esta semana. Mirad en «Próximas» lo que viene." : "Nada pendiente esta semana.",
    proximas: "No hay tareas más adelante ni sin fecha.",
    hechas: "Aún no habéis marcado ninguna como hecha.",
  };

  // Grupos dentro de la vista: vencidas / próximos 7 días; meses; sin fecha.
  const groups: { key: string; label: string; warn?: boolean; items: WeddingTask[] }[] = [];
  for (const task of visible) {
    let key: string; let label: string; let warn = false;
    if (view === "hechas") { key = "done"; label = ""; }
    else if (view === "semana") {
      const overdue = taskBucket(task, today) === "overdue";
      key = overdue ? "overdue" : "week"; label = overdue ? "Vencidas" : "Próximos 7 días"; warn = overdue;
    } else if (task.dueOn) { key = task.dueOn.slice(0, 7); label = monthLabel(task.dueOn); }
    else { key = "nodate"; label = "Sin fecha"; }
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(task); else groups.push({ key, label, warn, items: [task] });
  }

  if (tasks.length === 0 && !adding) {
    return (
      <div className="pn-plan">
        <EmptyState icon={ListChecksIcon} title={<>Lo que queda <em>por hacer</em></>}
          body="Apuntad lo que tenéis pendiente o empezad con un calendario sugerido: reservar la finca, enviar las invitaciones, cerrar el menú… Os avisamos en el resumen de lo que toca esta semana.">
          <button type="button" className="pn-btn pn-btn--ghost pn-press" onClick={() => setAdding(true)}><PlusIcon aria-hidden="true" className="size-4" />Escribir una tarea</button>
        </EmptyState>
        <Suggestions tasks={tasks} today={today} weddingDate={weddingDate} onAdd={addSuggested} settingsHref={settingsHref} />
        <p className="sr-only" aria-live="polite">{announce}</p>
      </div>
    );
  }

  return (
    <div className="pn-plan">
      <div className="pn-plan-bar">
        <div role="tablist" aria-label="Vistas de tareas" className="pn-segment pn-plan-tabs">
          {TASK_VIEWS.map((value) => (
            <button key={value} type="button" role="tab" id={`tab-${value}`} aria-controls="tasks-panel" aria-selected={view === value} className="pn-segment-btn"
              data-warn={value === "semana" && counts.overdue > 0 ? "" : undefined} onClick={() => { setView(value); setEditing(null); }}>
              {TASK_VIEW_LABELS[value]} <small>{tabCount[value]}</small>
            </button>
          ))}
        </div>
        <div className="pn-plan-actions">
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" aria-expanded={suggesting} onClick={() => { setSuggesting((v) => !v); setAdding(false); }}>
            <SparklesIcon aria-hidden="true" className="size-4" />Sugerencias
          </button>
          <button type="button" className="pn-btn pn-btn--clay pn-btn--sm pn-press" aria-expanded={adding} onClick={() => { setAdding((v) => !v); setSuggesting(false); setEditing(null); }}>
            <PlusIcon aria-hidden="true" className="size-4" />Nueva tarea
          </button>
        </div>
      </div>

      {counts.overdue > 0 && view !== "semana" && (
        <p className="pn-note pn-note--warn">
          {plural(counts.overdue, "tarea vencida", "tareas vencidas")}. <button type="button" className="underline underline-offset-4" onClick={() => setView("semana")}>Verlas en «Esta semana»</button>
        </p>
      )}

      {adding && <TaskForm idPrefix="new" submitLabel="Añadir tarea" onSubmit={create} onCancel={() => setAdding(false)} />}
      {suggesting && <Suggestions tasks={tasks} today={today} weddingDate={weddingDate} onAdd={addSuggested} onClose={() => setSuggesting(false)} settingsHref={settingsHref} />}

      <div id="tasks-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
        {visible.length === 0 ? (
          <p className="pn-quiet-empty pn-muted"><SparklesIcon aria-hidden="true" className="size-5" />{emptyCopy[view]}</p>
        ) : groups.map((group) => (
          <section key={group.key} aria-label={group.label || TASK_VIEW_LABELS[view]}>
            {group.label && <h3 className="pn-task-group" data-warn={group.warn || undefined}>{group.label} · {group.items.length}</h3>}
            <ul className="pn-tasks">
              {group.items.map((task) => (
                <TaskRow key={task.id} task={task} today={today} editing={editing === task.id}
                  onToggle={() => void toggle(task)} onEdit={() => { setEditing(task.id); setAdding(false); }} onCancel={() => setEditing(null)}
                  onSave={(draft) => save(task, draft)} onDelete={() => remove(task)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
