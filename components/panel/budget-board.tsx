"use client";

/**
 * Presupuesto de la boda (20261014100000). ES UN REGISTRO de la pareja: lo
 * que prevén, lo que acuerdan con cada proveedor y los pagos que anotan.
 * Vinklo no cobra, no paga ni mueve dinero. Importes en céntimos enteros;
 * lo que se escribe se lee con parseEuros (sin coma flotante).
 * «Pagado» = suma de los pagos que la pareja marca como pagados.
 */
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, CheckIcon, PencilIcon, PiggyBankIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import "@/components/panel/planning.css";
import { formatShortDate, relativeDue, type IsoDate } from "@/lib/planning/dates";
import { centsToInput, formatEuros, parseEuros } from "@/lib/planning/money";
import {
  BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS, BUDGET_LIMITS, budgetCategoryForVendor, paidForItem, sortBudgetItems, summarizeBudget,
  type BudgetCategory, type BudgetData, type BudgetItem, type BudgetItemInput, type BudgetPayment, type BudgetPaymentInput,
} from "@/lib/planning/budget";
import { VENDOR_STATUS_LABELS, type VendorContact } from "@/lib/vendors/contacts";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface BudgetActions {
  setTotal(totalCents: number | null): Promise<Result>;
  addItem(input: BudgetItemInput): Promise<Result<{ id: string }>>;
  updateItem(id: string, input: BudgetItemInput): Promise<Result>;
  removeItem(id: string): Promise<Result>;
  addPayment(itemId: string, input: BudgetPaymentInput): Promise<Result<{ id: string }>>;
  setPaid(id: string, paid: boolean): Promise<Result>;
  removePayment(id: string): Promise<Result>;
}

const DISCLAIMER = "Son vuestras anotaciones: Vinklo no cobra, no paga ni mueve dinero. Solo guarda lo que apuntáis.";

function MoneyField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange(value: string): void; hint?: string }) {
  return (
    <label className="pn-field" htmlFor={id}>{label}{hint && <small>{hint}</small>}
      <span className="pn-money-input"><input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" /></span>
    </label>
  );
}

// ---------------------------------------------------------------- total

function TotalEditor({ total, onSave }: { total: number | null; onSave(cents: number | null): Promise<string | null> }) {
  const [value, setValue] = useState(centsToInput(total));
  const [editing, setEditing] = useState(total === null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!editing) {
    return <button type="button" className="pn-link pn-press" onClick={() => setEditing(true)}><PencilIcon aria-hidden="true" className="size-4" />Cambiar el total previsto</button>;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseEuros(value);
    if (!parsed.ok) { setError(parsed.error); return; }
    start(async () => {
      const failure = await onSave(parsed.cents);
      setError(failure);
      if (!failure) setEditing(parsed.cents === null);
    });
  };
  return (
    <form className="pn-budget-total" onSubmit={submit} noValidate>
      <MoneyField id="budget-total" label="¿Cuánto queréis gastar en total?" value={value} onChange={setValue} hint="Vuestra cifra de referencia. Podéis cambiarla cuando queráis." />
      <button type="submit" className="pn-btn pn-btn--clay pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
      {total !== null && <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => { setEditing(false); setValue(centsToInput(total)); setError(null); }}>Cancelar</button>}
      {error && <p role="alert" className="pn-plan-error" style={{ flexBasis: "100%" }}>{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------- partida

interface ItemDraft { category: BudgetCategory; label: string; vendorContactId: string; budgeted: string; agreed: string; notes: string }
const toItemDraft = (item?: BudgetItem, vendor?: VendorContact): ItemDraft => ({
  category: item?.category ?? (vendor ? budgetCategoryForVendor(vendor.category) : "otros"),
  label: item?.label ?? vendor?.name ?? "",
  vendorContactId: item?.vendorContactId ?? vendor?.id ?? "",
  budgeted: centsToInput(item?.budgetedCents), agreed: centsToInput(item?.agreedCents), notes: item?.notes ?? "",
});

function ItemForm({ initial, vendor, contacts, idPrefix, submitLabel, onSubmit, onCancel }: {
  initial?: BudgetItem; vendor?: VendorContact; contacts: VendorContact[]; idPrefix: string; submitLabel: string;
  onSubmit(input: BudgetItemInput): Promise<string | null>; onCancel(): void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => toItemDraft(initial, vendor));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.label.trim()) { setError("Poned un concepto, por ejemplo «Finca» o «Reportaje»."); return; }
    const budgeted = parseEuros(draft.budgeted);
    const agreed = parseEuros(draft.agreed);
    if (!budgeted.ok) { setError(`Presupuestado: ${budgeted.error}`); return; }
    if (!agreed.ok) { setError(`Acordado: ${agreed.error}`); return; }
    start(async () => {
      setError(await onSubmit({ category: draft.category, label: draft.label, vendorContactId: draft.vendorContactId || null, budgetedCents: budgeted.cents, agreedCents: agreed.cents, notes: draft.notes }));
    });
  };
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form className="pn-plan-form pn-plan-card pn-plan-card--soft" onSubmit={submit} noValidate>
      <div className="pn-plan-form-row">
        <label className="pn-field" htmlFor={id("label")}>Concepto
          <input id={id("label")} value={draft.label} onChange={(e) => set("label", e.target.value)} maxLength={BUDGET_LIMITS.label} autoFocus={!initial} placeholder="Finca" autoComplete="off" />
        </label>
        <label className="pn-field" htmlFor={id("category")}>Categoría
          <select id={id("category")} value={draft.category} onChange={(e) => set("category", e.target.value as BudgetCategory)}>
            {BUDGET_CATEGORIES.map((value) => <option key={value} value={value}>{BUDGET_CATEGORY_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="pn-field" htmlFor={id("vendor")}>Proveedor <small>De vuestra agenda (opcional)</small>
          <select id={id("vendor")} value={draft.vendorContactId} onChange={(e) => {
            const picked = contacts.find((contact) => contact.id === e.target.value);
            setDraft((d) => ({ ...d, vendorContactId: e.target.value, ...(picked && !initial && !d.label.trim() ? { label: picked.name } : {}), ...(picked && !initial ? { category: budgetCategoryForVendor(picked.category) } : {}) }));
          }}>
            <option value="">Sin proveedor</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </select>
        </label>
      </div>
      <div className="pn-plan-form-row">
        <MoneyField id={id("budgeted")} label="Presupuestado" hint="Lo que pensabais gastar" value={draft.budgeted} onChange={(v) => set("budgeted", v)} />
        <MoneyField id={id("agreed")} label="Acordado" hint="Lo que habéis cerrado con el proveedor" value={draft.agreed} onChange={(v) => set("agreed", v)} />
      </div>
      <label className="pn-field" htmlFor={id("notes")}>Notas <small>Opcional</small>
        <textarea id={id("notes")} rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} maxLength={BUDGET_LIMITS.notes} />
      </label>
      {error && <p role="alert" className="pn-plan-error">{error}</p>}
      <div className="pn-plan-actions">
        <button type="submit" className="pn-btn pn-btn--clay pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : submitLabel}</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onCancel} disabled={pending}>Cancelar</button>
      </div>
    </form>
  );
}

function PaymentForm({ idPrefix, onSubmit, onCancel }: { idPrefix: string; onSubmit(input: BudgetPaymentInput): Promise<string | null>; onCancel(): void }) {
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseEuros(amount);
    if (!parsed.ok) { setError(parsed.error); return; }
    if (!parsed.cents) { setError("Escribid cuánto es el pago."); return; }
    start(async () => { setError(await onSubmit({ amountCents: parsed.cents!, dueOn, note })); });
  };
  return (
    <form className="pn-plan-form" onSubmit={submit} noValidate>
      <div className="pn-plan-form-row">
        <MoneyField id={`${idPrefix}-amount`} label="Importe" value={amount} onChange={setAmount} />
        <label className="pn-field" htmlFor={`${idPrefix}-due`}>Fecha prevista <small>Opcional</small>
          <input id={`${idPrefix}-due`} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label className="pn-field" htmlFor={`${idPrefix}-note`}>Nota <small>Opcional</small>
          <input id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={BUDGET_LIMITS.paymentNote} placeholder="Señal" autoComplete="off" />
        </label>
      </div>
      {error && <p role="alert" className="pn-plan-error">{error}</p>}
      <div className="pn-plan-actions">
        <button type="submit" className="pn-btn pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : "Anotar pago"}</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onCancel} disabled={pending}>Cancelar</button>
      </div>
    </form>
  );
}

function PaymentRow({ payment, today, label, onToggle, onRemove }: {
  payment: BudgetPayment; today: IsoDate; label?: string; onToggle(): void; onRemove?(): void;
}) {
  const overdue = !payment.paidOn && payment.dueOn !== null && payment.dueOn < today;
  return (
    <li className="pn-pay" data-paid={payment.paidOn ? "" : undefined} data-overdue={overdue ? "" : undefined}>
      <span className="pn-pay-text">
        <span className="pn-pay-amount">{formatEuros(payment.amountCents)}{label && <span className="pn-muted" style={{ fontWeight: 500 }}> · {label}</span>}</span>
        <span className="pn-pay-meta">
          {payment.paidOn ? `Pagado el ${formatShortDate(payment.paidOn, today)} (anotado por vosotros)`
            : payment.dueOn ? <>{overdue ? <strong>Previsto {relativeDue(payment.dueOn, today).toLocaleLowerCase("es")}</strong> : `Previsto: ${relativeDue(payment.dueOn, today).toLocaleLowerCase("es")}`}</>
            : "Sin fecha prevista"}
          {payment.note ? ` · ${payment.note}` : ""}
        </span>
      </span>
      <span className="pn-pay-tools">
        <button type="button" className="pn-pay-mark pn-press" aria-pressed={Boolean(payment.paidOn)} onClick={onToggle}
          aria-label={payment.paidOn ? `Desmarcar como pagado ${formatEuros(payment.amountCents)}` : `Marcar como pagado ${formatEuros(payment.amountCents)}`}>
          <CheckIcon aria-hidden="true" className="size-4" />{payment.paidOn ? "Pagado" : "Marcar pagado"}
        </button>
        {onRemove && <button type="button" className="pn-task-edit pn-press" aria-label={`Borrar el pago de ${formatEuros(payment.amountCents)}`} onClick={onRemove}><Trash2Icon aria-hidden="true" className="size-4" /></button>}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- tablero

export function BudgetBoard({ initial, contacts, today, actions }: { initial: BudgetData; contacts: VendorContact[]; today: IsoDate; actions: BudgetActions }) {
  const [data, setData] = useState(initial);
  const [source, setSource] = useState(initial);
  if (source !== initial) { setSource(initial); setData(initial); }
  const [adding, setAdding] = useState<{ vendor?: VendorContact } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<string | null>(null);

  const summary = summarizeBudget(data, today);
  const items = sortBudgetItems(data.items);
  const vendorById = new Map(contacts.map((contact) => [contact.id, contact]));
  const linked = new Set(data.items.map((item) => item.vendorContactId).filter(Boolean));
  const hiredWithoutItem = contacts.filter((contact) => contact.status === "contratado" && !linked.has(contact.id));
  const scale = Math.max(summary.total ?? 0, summary.committed, 1);
  const over = summary.margin !== null && summary.margin < 0;

  async function saveTotal(cents: number | null): Promise<string | null> {
    const result = await actions.setTotal(cents);
    if (!result.ok) return result.error;
    setData((d) => ({ ...d, totalCents: cents }));
    return null;
  }
  async function addItem(input: BudgetItemInput): Promise<string | null> {
    const result = await actions.addItem(input);
    if (!result.ok) return result.error;
    setData((d) => ({ ...d, items: [...d.items, {
      id: result.id, category: input.category ?? "otros", label: input.label.trim(), vendorContactId: input.vendorContactId || null,
      budgetedCents: input.budgetedCents ?? null, agreedCents: input.agreedCents ?? null, notes: input.notes?.trim() || null,
      position: Math.max(0, ...d.items.map((item) => item.position)) + 1,
    }] }));
    setAdding(null);
    toast(`Partida añadida: «${input.label.trim()}».`);
    return null;
  }
  async function updateItem(item: BudgetItem, input: BudgetItemInput): Promise<string | null> {
    const result = await actions.updateItem(item.id, input);
    if (!result.ok) return result.error;
    setData((d) => ({ ...d, items: d.items.map((row) => (row.id === item.id ? {
      ...row, category: input.category ?? row.category, label: input.label.trim(), vendorContactId: input.vendorContactId || null,
      budgetedCents: input.budgetedCents ?? null, agreedCents: input.agreedCents ?? null, notes: input.notes?.trim() || null,
    } : row)) }));
    setEditing(null);
    return null;
  }
  async function removeItem(item: BudgetItem) {
    const result = await actions.removeItem(item.id);
    if (!result.ok) { toast(result.error); return; }
    setData((d) => ({ ...d, items: d.items.filter((row) => row.id !== item.id), payments: d.payments.filter((p) => p.itemId !== item.id) }));
    setConfirmItem(null);
    setEditing(null);
    toast(`Partida borrada: «${item.label}».`);
  }
  async function addPayment(item: BudgetItem, input: BudgetPaymentInput): Promise<string | null> {
    const result = await actions.addPayment(item.id, input);
    if (!result.ok) return result.error;
    setData((d) => ({ ...d, payments: [...d.payments, { id: result.id, itemId: item.id, amountCents: input.amountCents, dueOn: input.dueOn || null, paidOn: null, note: input.note?.trim() || null }] }));
    setPaying(null);
    return null;
  }
  async function togglePaid(payment: BudgetPayment) {
    const paid = !payment.paidOn;
    const before = payment.paidOn;
    const patch = (paidOn: string | null) => setData((d) => ({ ...d, payments: d.payments.map((p) => (p.id === payment.id ? { ...p, paidOn } : p)) }));
    patch(paid ? today : null);
    const result = await actions.setPaid(payment.id, paid);
    if (!result.ok) { patch(before); toast(result.error); return; }
    if (paid) toast(`Anotado como pagado: ${formatEuros(payment.amountCents)}.`, { action: { label: "Deshacer", onClick: () => void togglePaid({ ...payment, paidOn: today }) } });
  }
  async function removePayment(payment: BudgetPayment) {
    const result = await actions.removePayment(payment.id);
    if (!result.ok) { toast(result.error); return; }
    setData((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== payment.id) }));
  }

  const isEmpty = data.items.length === 0 && data.totalCents === null;

  return (
    <div className="pn-plan">
      {/* Resumen: previsto vs comprometido vs pagado */}
      <section className="pn-plan-card" aria-labelledby="budget-title">
        <div className="pn-plan-card-head">
          <h2 id="budget-title" className="pn-display pn-h2">Vuestro <em>presupuesto</em></h2>
        </div>
        {isEmpty ? (
          <p className="pn-text text-sm leading-relaxed">Poned una cifra total y anotad, por proveedor, lo que pensabais gastar, lo que habéis acordado y los pagos con su fecha. Aquí veréis lo comprometido, lo pagado y lo que viene.</p>
        ) : (
          <>
            <dl className="pn-budget-figures">
              <div><dt>Previsto</dt><dd>{summary.total === null ? "—" : formatEuros(summary.total)}</dd><small>{summary.total === null ? "Sin total fijado" : "Vuestro total"}</small></div>
              <div data-warn={over ? "" : undefined}><dt>Comprometido</dt><dd>{formatEuros(summary.committed)}</dd>
                <small>{over ? <><AlertTriangleIcon aria-hidden="true" className="inline size-3.5" /> {formatEuros(-summary.margin!)} por encima del previsto</> : summary.margin !== null ? `Quedan ${formatEuros(summary.margin)} sin comprometer` : "Lo acordado con proveedores"}</small></div>
              <div><dt>Pagado</dt><dd>{formatEuros(summary.paid)}</dd><small>Anotado por vosotros</small></div>
              <div><dt>Por pagar</dt><dd>{formatEuros(summary.toPay)}</dd><small>De lo acordado</small></div>
            </dl>
            <div className="pn-budget-meter" data-over={over ? "" : undefined} role="img"
              aria-label={`Comprometido ${formatEuros(summary.committed)} y pagado ${formatEuros(summary.paid)}${summary.total !== null ? ` de ${formatEuros(summary.total)} previstos` : ""}.`}>
              <span data-part="committed" style={{ width: `${Math.min(100, (summary.committed / scale) * 100)}%` }} />
              <span data-part="paid" style={{ width: `${Math.min(100, (summary.paid / scale) * 100)}%` }} />
            </div>
            <ul className="pn-budget-legend" aria-hidden="true">
              <li><i style={{ background: "var(--olive)" }} />Pagado</li>
              <li><i style={{ background: over ? "var(--clay-dark)" : "color-mix(in oklab, var(--ink) 28%, var(--paper-2))" }} />Comprometido</li>
              {summary.total !== null && <li><i style={{ background: "var(--paper-2)", border: "1px solid var(--line-strong)" }} />Previsto</li>}
            </ul>
          </>
        )}
        <TotalEditor key={String(data.totalCents)} total={data.totalCents} onSave={saveTotal} />
        <p className="pn-disclaimer">{DISCLAIMER}</p>
      </section>

      {summary.upcoming.length > 0 && (
        <section className="pn-plan-card" aria-labelledby="upcoming-title">
          <div className="pn-plan-card-head"><h2 id="upcoming-title" className="pn-display pn-h3">Próximos pagos</h2><span className="pn-help">Fechas que habéis anotado</span></div>
          <ul className="pn-pay-list">
            {summary.upcoming.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} today={today} label={payment.itemLabel} onToggle={() => void togglePaid(payment)} />
            ))}
          </ul>
        </section>
      )}

      {summary.byCategory.length > 0 && (
        <section className="pn-plan-card" aria-labelledby="cats-title">
          <h2 id="cats-title" className="pn-display pn-h3" style={{ margin: 0 }}>Por categoría</h2>
          <div className="pn-budget-scroll">
            <table className="pn-budget-cats">
              <thead><tr><th scope="col">Categoría</th><th scope="col">Presupuestado</th><th scope="col">Acordado</th><th scope="col">Pagado</th></tr></thead>
              <tbody>
                {summary.byCategory.map((row) => (
                  <tr key={row.category}><td>{BUDGET_CATEGORY_LABELS[row.category]}</td><td>{formatEuros(row.budgeted)}</td><td>{formatEuros(row.committed)}</td><td>{formatEuros(row.paid)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td>{formatEuros(summary.budgeted)}</td><td>{formatEuros(summary.committed)}</td><td>{formatEuros(summary.paid)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="items-title" className="pn-plan">
        <div className="pn-plan-bar">
          <h2 id="items-title" className="pn-display pn-h3" style={{ margin: 0 }}>Partidas</h2>
          <button type="button" className="pn-btn pn-btn--clay pn-btn--sm pn-press" aria-expanded={Boolean(adding)} onClick={() => { setAdding(adding ? null : {}); setEditing(null); }}>
            <PlusIcon aria-hidden="true" className="size-4" />Nueva partida
          </button>
        </div>
        {hiredWithoutItem.length > 0 && !adding && (
          <div className="pn-plan-card pn-plan-card--soft">
            <p className="pn-help" style={{ margin: 0 }}>Contratados en vuestra agenda sin partida:</p>
            <ul className="pn-starters">
              {hiredWithoutItem.map((contact) => (
                <li key={contact.id}><button type="button" className="pn-starter pn-press" onClick={() => setAdding({ vendor: contact })}><PlusIcon aria-hidden="true" className="size-4" />{contact.name}</button></li>
              ))}
            </ul>
          </div>
        )}
        {adding && <ItemForm key={adding.vendor?.id ?? "new"} vendor={adding.vendor} contacts={contacts} idPrefix="item-new" submitLabel="Añadir partida" onSubmit={addItem} onCancel={() => setAdding(null)} />}
        {items.length === 0 && !adding ? (
          <EmptyState icon={PiggyBankIcon} titleAs="h3" title={<>Ninguna <em>partida</em> todavía</>} body="Una por proveedor o por concepto: finca, catering, fotografía, música, flores, vestido, traje… Con lo presupuestado, lo acordado y los pagos que vayáis anotando." />
        ) : (
          <ul className="pn-items">
            {items.map((item) => {
              const paid = paidForItem(item.id, data.payments);
              const payments = data.payments.filter((payment) => payment.itemId === item.id)
                .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.id.localeCompare(b.id));
              const vendor = item.vendorContactId ? vendorById.get(item.vendorContactId) : undefined;
              const itemOver = item.budgetedCents !== null && item.agreedCents !== null && item.agreedCents > item.budgetedCents;
              if (editing === item.id) {
                return (
                  <li key={item.id}>
                    <ItemForm initial={item} contacts={contacts} idPrefix={`item-${item.id}`} submitLabel="Guardar" onSubmit={(input) => updateItem(item, input)} onCancel={() => setEditing(null)} />
                  </li>
                );
              }
              return (
                <li key={item.id} className="pn-item" data-over={itemOver ? "" : undefined}>
                  <div className="pn-item-head">
                    <div>
                      <h3 className="pn-item-title">{item.label}</h3>
                      <span className="pn-item-sub">{BUDGET_CATEGORY_LABELS[item.category]}{vendor ? ` · ${vendor.name} (${VENDOR_STATUS_LABELS[vendor.status].toLocaleLowerCase("es")})` : ""}</span>
                    </div>
                    <button type="button" className="pn-task-edit pn-press" aria-label={`Editar ${item.label}`} onClick={() => { setEditing(item.id); setAdding(null); setPaying(null); }}><PencilIcon aria-hidden="true" className="size-4" /></button>
                  </div>
                  <dl className="pn-item-figures">
                    <div data-empty={item.budgetedCents === null ? "" : undefined}><dt>Presupuestado</dt><dd>{item.budgetedCents === null ? "—" : formatEuros(item.budgetedCents)}</dd></div>
                    <div data-empty={item.agreedCents === null ? "" : undefined}><dt>Acordado</dt><dd>{item.agreedCents === null ? "—" : formatEuros(item.agreedCents)}</dd></div>
                    <div><dt>Pagado</dt><dd>{formatEuros(paid)}</dd></div>
                  </dl>
                  {itemOver && <p className="pn-plan-error"><AlertTriangleIcon aria-hidden="true" className="inline size-3.5" /> Lo acordado supera lo presupuestado en {formatEuros(item.agreedCents! - item.budgetedCents!)}.</p>}
                  {item.notes && <p className="pn-vendor-note">{item.notes}</p>}
                  {payments.length > 0 && (
                    <ul className="pn-pay-list" aria-label={`Pagos de ${item.label}`}>
                      {payments.map((payment) => (
                        <PaymentRow key={payment.id} payment={payment} today={today} onToggle={() => void togglePaid(payment)} onRemove={() => void removePayment(payment)} />
                      ))}
                    </ul>
                  )}
                  {paying === item.id ? (
                    <PaymentForm idPrefix={`pay-${item.id}`} onSubmit={(input) => addPayment(item, input)} onCancel={() => setPaying(null)} />
                  ) : (
                    <div className="pn-plan-actions">
                      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => { setPaying(item.id); setEditing(null); }}><PlusIcon aria-hidden="true" className="size-4" />Anotar un pago</button>
                      <span className="pn-spacer" />
                      {confirmItem === item.id ? (
                        <>
                          <span className="pn-help">{payments.length > 0 ? `Se borran también sus ${payments.length} pagos anotados.` : "¿Borrar la partida?"}</span>
                          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => void removeItem(item)}>Sí, borrar</button>
                          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setConfirmItem(null)}><XIcon aria-hidden="true" className="size-4" />No</button>
                        </>
                      ) : (
                        <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => setConfirmItem(item.id)}>Borrar</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
