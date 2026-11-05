import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, formatShortDate, isIsoDate, relativeDue, todayIn } from "./dates";
import { centsToInput, formatEuros, MAX_CENTS, parseEuros } from "./money";
import { budgetCategoryForVendor, budgetItemSchema, budgetPaymentSchema, parseBudgetItems, sortBudgetItems, summarizeBudget, type BudgetData } from "./budget";
import { countTasks, defaultTaskView, parseTaskRows, suggestTasks, taskBucket, taskInputSchema, tasksForView, templateDueOn, TASK_TEMPLATES, type WeddingTask } from "./tasks";

describe("fechas de calendario", () => {
  it("valida YYYY-MM-DD reales", () => {
    expect(isIsoDate("2027-06-12")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("12/06/2027")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it("suma días y meses sin desbordar", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addMonths("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonths("2027-06-12", -12)).toBe("2026-06-12");
    expect(daysBetween("2026-10-06", "2026-10-13")).toBe(7);
    expect(daysBetween("2026-10-06", "2026-10-01")).toBe(-5);
  });
  it("hoy en Madrid, no en UTC", () => {
    // 23:30 UTC del 6 de octubre = 01:30 del 7 en Madrid (horario de verano).
    expect(todayIn("Europe/Madrid", new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
    expect(todayIn("Europe/Madrid", new Date("2026-10-06T10:00:00Z"))).toBe("2026-10-06");
  });
  it("dice cuándo vence en palabras", () => {
    const today = "2026-10-06"; // martes
    expect(relativeDue(today, today)).toBe("Hoy");
    expect(relativeDue("2026-10-07", today)).toBe("Mañana");
    expect(relativeDue("2026-10-05", today)).toBe("Ayer");
    expect(relativeDue("2026-10-01", today)).toBe("Hace 5 días");
    expect(relativeDue("2026-10-09", today)).toBe("El viernes");
    expect(relativeDue("2026-11-20", today)).toBe("20 nov");
    expect(formatShortDate("2027-06-12", today)).toBe("12 jun 2027");
  });
});

describe("importes en céntimos", () => {
  it("lee lo que escribe la pareja sin coma flotante", () => {
    expect(parseEuros("")).toEqual({ ok: true, cents: null });
    expect(parseEuros("1200")).toEqual({ ok: true, cents: 120000 });
    expect(parseEuros("1.200")).toEqual({ ok: true, cents: 120000 });
    expect(parseEuros("1.200.000")).toEqual({ ok: true, cents: 120000000 });
    expect(parseEuros("1.234,56")).toEqual({ ok: true, cents: 123456 });
    expect(parseEuros("1234,5")).toEqual({ ok: true, cents: 123450 });
    expect(parseEuros("12.5")).toEqual({ ok: true, cents: 1250 });
    expect(parseEuros("12.50")).toEqual({ ok: true, cents: 1250 });
    expect(parseEuros("1 200 €")).toEqual({ ok: true, cents: 120000 });
    expect(parseEuros("0,10")).toEqual({ ok: true, cents: 10 });
    expect(parseEuros("0,29")).toEqual({ ok: true, cents: 29 }); // 0.29 * 100 en coma flotante = 28.999…
    expect(parseEuros("1200 euros")).toEqual({ ok: true, cents: 120000 });
  });
  it("rechaza lo ambiguo, negativo o enorme", () => {
    for (const bad of ["-5", "12,345", "1.2.3", "abc", "1,2,3", "12.345,6,7", "1.20.0"]) expect(parseEuros(bad).ok).toBe(false);
    expect(parseEuros("10000000").ok).toBe(false);
    expect(parseEuros("9.999.999,99")).toEqual({ ok: true, cents: MAX_CENTS });
  });
  it("pinta en formato de España", () => {
    expect(formatEuros(120000)).toBe("1.200 €");
    expect(formatEuros(123456)).toBe("1.234,56 €");
    expect(formatEuros(5)).toBe("0,05 €");
    expect(formatEuros(-2500)).toBe("−25 €");
    expect(centsToInput(123450)).toBe("1.234,50");
    expect(centsToInput(null)).toBe("");
    // Ida y vuelta.
    for (const value of [0, 1, 99, 100, 123456, MAX_CENTS]) expect(parseEuros(centsToInput(value))).toEqual({ ok: true, cents: value });
  });
});

describe("presupuesto", () => {
  const today = "2026-10-06";
  const data: BudgetData = {
    totalCents: 2_500_000,
    items: [
      { id: "i1", category: "finca", label: "Finca", vendorContactId: "v1", budgetedCents: 800_000, agreedCents: 850_000, notes: null, position: 1 },
      { id: "i2", category: "fotografia", label: "Reportaje", vendorContactId: null, budgetedCents: 250_000, agreedCents: null, notes: null, position: 2 },
      { id: "i3", category: "finca", label: "Alquiler de sillas", vendorContactId: null, budgetedCents: null, agreedCents: 40_000, notes: null, position: 3 },
    ],
    payments: [
      { id: "p1", itemId: "i1", amountCents: 255_000, dueOn: "2026-09-01", paidOn: "2026-09-02", note: "Señal" },
      { id: "p2", itemId: "i1", amountCents: 595_000, dueOn: "2027-05-01", paidOn: null, note: null },
      { id: "p3", itemId: "i3", amountCents: 40_000, dueOn: "2026-10-01", paidOn: null, note: null },
      { id: "p4", itemId: "i2", amountCents: 50_000, dueOn: null, paidOn: null, note: null },
      { id: "px", itemId: "borrada", amountCents: 1, dueOn: null, paidOn: "2026-01-01", note: null },
    ],
  };
  it("previsto, comprometido y pagado (solo lo marcado)", () => {
    const summary = summarizeBudget(data, today);
    expect(summary.total).toBe(2_500_000);
    expect(summary.budgeted).toBe(1_050_000);
    expect(summary.committed).toBe(890_000);
    expect(summary.paid).toBe(255_000);
    expect(summary.toPay).toBe(635_000);
    expect(summary.margin).toBe(1_610_000);
    expect(summary.byCategory.map((row) => [row.category, row.budgeted, row.committed, row.paid, row.items])).toEqual([
      ["finca", 800_000, 890_000, 255_000, 2],
      ["fotografia", 250_000, 0, 0, 1],
    ]);
  });
  it("próximos pagos: por fecha, vencidos marcados, sin fecha al final", () => {
    const upcoming = summarizeBudget(data, today).upcoming;
    expect(upcoming.map((payment) => [payment.id, payment.overdue, payment.itemLabel])).toEqual([
      ["p3", true, "Alquiler de sillas"], ["p2", false, "Finca"], ["p4", false, "Reportaje"],
    ]);
  });
  it("sin total fijado, sin margen", () => {
    expect(summarizeBudget({ ...data, totalCents: null }, today).margin).toBeNull();
    expect(summarizeBudget({ totalCents: null, items: [], payments: [] }, today)).toMatchObject({ budgeted: 0, committed: 0, paid: 0, byCategory: [], upcoming: [] });
  });
  it("valida partidas y pagos", () => {
    expect(budgetItemSchema.safeParse({ label: "  " }).success).toBe(false);
    expect(budgetItemSchema.safeParse({ label: "Finca", agreedCents: -1 }).success).toBe(false);
    expect(budgetItemSchema.safeParse({ label: "Finca", agreedCents: 1.5 }).success).toBe(false);
    expect(budgetItemSchema.safeParse({ label: "Finca", category: "joyas" }).success).toBe(false);
    expect(budgetItemSchema.safeParse({ label: "Finca", vendorContactId: "no-uuid" }).success).toBe(false);
    expect(budgetItemSchema.parse({ label: " Finca ", vendorContactId: "" })).toEqual({ category: "otros", label: "Finca", vendorContactId: null, budgetedCents: null, agreedCents: null, notes: "" });
    expect(budgetPaymentSchema.safeParse({ amountCents: 0 }).success).toBe(false);
    expect(budgetPaymentSchema.safeParse({ amountCents: 100, dueOn: "2027-02-30" }).success).toBe(false);
    expect(budgetPaymentSchema.parse({ amountCents: 100, dueOn: "" })).toEqual({ amountCents: 100, dueOn: null, note: "" });
  });
  it("lee filas y ordena", () => {
    expect(parseBudgetItems([{ id: "x", category: "joyas", label: "x", vendor_contact_id: null, budgeted_cents: null, agreed_cents: null, notes: null, position: 0 }])).toBeNull();
    expect(sortBudgetItems([data.items[2], data.items[0]]).map((item) => item.id)).toEqual(["i1", "i3"]);
    expect(budgetCategoryForVendor("lugar")).toBe("finca");
    expect(budgetCategoryForVendor("vestuario")).toBe("otros");
  });
});

describe("tareas", () => {
  const today = "2026-10-06";
  const task = (over: Partial<WeddingTask>): WeddingTask => ({ id: over.id ?? "t", title: "T", notes: null, dueOn: null, done: false, doneAt: null, category: null, position: 0, templateKey: null, createdAt: "2026-10-01T00:00:00Z", ...over });
  it("sugerencias con fecha desde la boda; las pasadas se marcan", () => {
    const suggestions = suggestTasks("2027-06-12", today, ["reservar-finca"]);
    const byKey = Object.fromEntries(suggestions.map((s) => [s.key, s]));
    expect(byKey["reservar-finca"]).toMatchObject({ dueOn: "2026-06-12", past: true, added: true });
    expect(byKey["enviar-invitaciones"]).toMatchObject({ dueOn: "2027-03-12", past: false, hint: "2-3 meses antes" });
    expect(byKey["confirmar-menu"].dueOn).toBe("2027-05-12");
    expect(byKey["plan-mesas"].dueOn).toBe("2027-05-29");
    expect(suggestions).toHaveLength(TASK_TEMPLATES.length);
    // Sin fecha de boda: sin fechas (y nada «pasado»).
    expect(suggestTasks(null, today).every((s) => s.dueOn === null && !s.past)).toBe(true);
    expect(templateDueOn(TASK_TEMPLATES[0], "no-fecha")).toBeNull();
    expect(new Set(TASK_TEMPLATES.map((t) => t.key)).size).toBe(TASK_TEMPLATES.length);
    for (const t of TASK_TEMPLATES) expect(t.key).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("clasifica: vencidas, esta semana (7 días), próximas, hechas", () => {
    expect(taskBucket(task({ dueOn: "2026-10-05" }), today)).toBe("overdue");
    expect(taskBucket(task({ dueOn: today }), today)).toBe("week");
    expect(taskBucket(task({ dueOn: "2026-10-12" }), today)).toBe("week");
    expect(taskBucket(task({ dueOn: "2026-10-13" }), today)).toBe("later");
    expect(taskBucket(task({ dueOn: null }), today)).toBe("later");
    expect(taskBucket(task({ dueOn: "2026-10-01", done: true }), today)).toBe("done");
  });
  it("vistas ordenadas y recuentos", () => {
    const tasks = [
      task({ id: "a", dueOn: "2026-10-10" }), task({ id: "b", dueOn: "2026-10-02" }), task({ id: "c", dueOn: null }),
      task({ id: "d", dueOn: "2026-12-01" }), task({ id: "e", done: true, doneAt: "2026-10-05T10:00:00Z" }), task({ id: "f", done: true, doneAt: "2026-10-06T10:00:00Z" }),
    ];
    expect(tasksForView(tasks, "semana", today).map((t) => t.id)).toEqual(["b", "a"]);
    expect(tasksForView(tasks, "proximas", today).map((t) => t.id)).toEqual(["d", "c"]);
    expect(tasksForView(tasks, "hechas", today).map((t) => t.id)).toEqual(["f", "e"]);
    expect(countTasks(tasks, today)).toEqual({ thisWeek: 1, overdue: 1, open: 4, done: 2, total: 6 });
    expect(defaultTaskView(tasks, today)).toBe("semana");
    expect(defaultTaskView([task({ dueOn: "2027-01-01" })], today)).toBe("proximas");
  });
  it("valida la tarea", () => {
    expect(taskInputSchema.safeParse({ title: " " }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", dueOn: "2026-13-01" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", category: "joyas" }).success).toBe(false);
    expect(taskInputSchema.parse({ title: " Flores ", dueOn: "", category: "" })).toEqual({ title: "Flores", notes: "", dueOn: null, category: null });
    expect(parseTaskRows([{ id: "x" }])).toBeNull();
  });
});
