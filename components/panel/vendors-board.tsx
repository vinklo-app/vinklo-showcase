"use client";

/**
 * Agenda de proveedores (wedding_vendor_contacts, 20261005100000). SIN
 * DINERO: con quién trabajáis, cómo contactar y en qué punto está cada uno.
 * La «nota sobre pagos» es texto vuestro; los importes van en Presupuesto.
 * Vinklo no contacta con nadie: los enlaces tel:/mailto: abren vuestro
 * dispositivo y no marcan nada como contactado.
 */
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { MailIcon, PencilIcon, PhoneIcon, PlusIcon, StoreIcon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/panel/page-head";
import { VendorIcon } from "@/components/panel/vendor-icon";
import {
  countVendors, matchesVendor, statusCountLabel, toVendorInput, vendorSubline, VENDOR_STAGE_ORDER, VENDOR_TONES, type VendorFilter,
} from "@/components/panel/vendor-status";
import "@/components/panel/planning.css";
import {
  VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, VENDOR_LIMITS, VENDOR_STATUSES, VENDOR_STATUS_LABELS,
  type VendorCategory, type VendorContact, type VendorContactInput, type VendorStatus,
} from "@/lib/vendors/contacts";

/** Por dónde suelen empezar (mismos atajos que vendor-summary.tsx). */
const STARTER_CATEGORIES: VendorCategory[] = ["lugar", "catering", "fotografia", "musica", "flores", "vestuario"];

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface VendorActions {
  add(input: VendorContactInput): Promise<Result<{ id: string }>>;
  update(id: string, input: VendorContactInput): Promise<Result>;
  remove(id: string): Promise<Result>;
}

type Draft = Required<{ [K in keyof VendorContactInput]: string }>;
const toDraft = (contact?: VendorContact, category?: VendorCategory): Draft => ({
  name: contact?.name ?? "", category: contact?.category ?? category ?? "otro", contactName: contact?.contactName ?? "",
  phone: contact?.phone ?? "", email: contact?.email ?? "", status: contact?.status ?? "por_contactar",
  paymentNote: contact?.paymentNote ?? "", notes: contact?.notes ?? "",
});
const draftToInput = (draft: Draft): VendorContactInput => ({ ...draft, category: draft.category as VendorCategory, status: draft.status as VendorStatus });

function VendorForm({ initial, category, idPrefix, submitLabel, onSubmit, onCancel, onDelete }: {
  initial?: VendorContact; category?: VendorCategory; idPrefix: string; submitLabel: string;
  onSubmit(draft: Draft): Promise<string | null>; onCancel(): void; onDelete?(): Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, category));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) { setError("Escribid el nombre del proveedor."); return; }
    start(async () => { setError(await onSubmit(draft)); });
  };
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form className="pn-plan-form pn-plan-card pn-plan-card--soft" onSubmit={submit} noValidate>
      <div className="pn-plan-form-row">
        <label className="pn-field" htmlFor={id("name")}>Nombre
          <input id={id("name")} value={draft.name} onChange={set("name")} maxLength={VENDOR_LIMITS.name} required autoFocus={!initial} placeholder="Finca El Olivar" autoComplete="off" />
        </label>
        <label className="pn-field" htmlFor={id("category")}>Tipo
          <select id={id("category")} value={draft.category} onChange={set("category")}>
            {VENDOR_CATEGORIES.map((value) => <option key={value} value={value}>{VENDOR_CATEGORY_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="pn-field" htmlFor={id("status")}>En qué punto está
          <select id={id("status")} value={draft.status} onChange={set("status")}>
            {VENDOR_STATUSES.map((value) => <option key={value} value={value}>{VENDOR_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
      </div>
      <div className="pn-plan-form-row">
        <label className="pn-field" htmlFor={id("contact")}>Persona de contacto <small>Opcional</small>
          <input id={id("contact")} value={draft.contactName} onChange={set("contactName")} maxLength={VENDOR_LIMITS.contactName} autoComplete="off" />
        </label>
        <label className="pn-field" htmlFor={id("phone")}>Teléfono <small>Opcional</small>
          <input id={id("phone")} type="tel" inputMode="tel" value={draft.phone} onChange={set("phone")} maxLength={VENDOR_LIMITS.phone} autoComplete="off" />
        </label>
        <label className="pn-field" htmlFor={id("email")}>Email <small>Opcional</small>
          <input id={id("email")} type="email" inputMode="email" value={draft.email} onChange={set("email")} maxLength={VENDOR_LIMITS.email} autoComplete="off" />
        </label>
      </div>
      <label className="pn-field" htmlFor={id("payment")}>Nota sobre pagos <small>Texto vuestro, p. ej. «señal del 30 % antes del 1 de marzo». Los importes se anotan en Presupuesto.</small>
        <input id={id("payment")} value={draft.paymentNote} onChange={set("paymentNote")} maxLength={VENDOR_LIMITS.paymentNote} autoComplete="off" />
      </label>
      <label className="pn-field" htmlFor={id("notes")}>Notas <small>Opcional</small>
        <textarea id={id("notes")} rows={2} value={draft.notes} onChange={set("notes")} maxLength={VENDOR_LIMITS.notes} />
      </label>
      {error && <p role="alert" className="pn-plan-error">{error}</p>}
      <div className="pn-plan-actions">
        <button type="submit" className="pn-btn pn-btn--clay pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : submitLabel}</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onCancel} disabled={pending}>Cancelar</button>
        <span className="pn-spacer" />
        {onDelete && (confirming ? (
          <>
            <span className="pn-help">¿Quitarlo de la agenda? Sus partidas del presupuesto se quedan sin proveedor.</span>
            <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending} onClick={() => start(onDelete)}>Sí, quitar</button>
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => setConfirming(false)}>No</button>
          </>
        ) : (
          <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" onClick={() => setConfirming(true)}>Quitar</button>
        ))}
      </div>
    </form>
  );
}

export function VendorsBoard({ initial, actions, openNew = null }: { initial: VendorContact[]; actions: VendorActions; openNew?: VendorCategory | null }) {
  const [contacts, setContacts] = useState(initial);
  const [source, setSource] = useState(initial);
  if (source !== initial) { setSource(initial); setContacts(initial); }
  const [filter, setFilter] = useState<VendorFilter>("todos");
  const [adding, setAdding] = useState<VendorCategory | null>(openNew);
  const [editing, setEditing] = useState<string | null>(null);
  const counts = countVendors(contacts);
  const visible = contacts.filter((contact) => matchesVendor(contact, filter, ""));

  async function add(draft: Draft): Promise<string | null> {
    const input = draftToInput(draft);
    const result = await actions.add(input);
    if (!result.ok) return result.error;
    const now = new Date().toISOString();
    setContacts((list) => [...list, {
      id: result.id, name: draft.name.trim(), category: input.category ?? "otro", contactName: draft.contactName.trim() || null,
      phone: draft.phone.trim() || null, email: draft.email.trim().toLowerCase() || null, status: input.status ?? "por_contactar",
      paymentNote: draft.paymentNote.trim() || null, notes: draft.notes.trim() || null, createdAt: now, updatedAt: now,
    }]);
    setAdding(null);
    toast(`«${draft.name.trim()}» añadido a vuestra agenda.`);
    return null;
  }

  async function save(contact: VendorContact, draft: Draft): Promise<string | null> {
    const input = draftToInput(draft);
    const result = await actions.update(contact.id, input);
    if (!result.ok) return result.error;
    setContacts((list) => list.map((item) => (item.id === contact.id ? {
      ...item, name: draft.name.trim(), category: input.category ?? item.category, status: input.status ?? item.status,
      contactName: draft.contactName.trim() || null, phone: draft.phone.trim() || null, email: draft.email.trim().toLowerCase() || null,
      paymentNote: draft.paymentNote.trim() || null, notes: draft.notes.trim() || null,
    } : item)));
    setEditing(null);
    return null;
  }

  async function setStatus(contact: VendorContact, status: VendorStatus) {
    const before = contact.status;
    setContacts((list) => list.map((item) => (item.id === contact.id ? { ...item, status } : item)));
    const result = await actions.update(contact.id, toVendorInput(contact, { status }));
    if (!result.ok) {
      setContacts((list) => list.map((item) => (item.id === contact.id ? { ...item, status: before } : item)));
      toast(result.error);
    }
  }

  async function remove(contact: VendorContact) {
    const result = await actions.remove(contact.id);
    if (!result.ok) { toast(result.error); return; }
    setContacts((list) => list.filter((item) => item.id !== contact.id));
    setEditing(null);
    toast(`«${contact.name}» quitado de la agenda.`);
  }

  if (contacts.length === 0 && !adding) {
    return (
      <div className="pn-plan">
        <EmptyState icon={StoreIcon} title={<>Con quién <em>trabajáis</em></>}
          body="Apuntad a quién vais a llamar y con quién habéis cerrado. Es vuestra agenda: Vinklo no contacta con nadie ni cobra nada.">
          <ul className="pn-starters" aria-label="Empezad por">
            {STARTER_CATEGORIES.map((category) => (
              <li key={category}>
                <button type="button" className="pn-starter pn-press" onClick={() => setAdding(category)}>
                  <VendorIcon category={category} />{VENDOR_CATEGORY_LABELS[category]}
                </button>
              </li>
            ))}
          </ul>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="pn-plan">
      <div className="pn-plan-bar">
        <div className="pn-chips" role="group" aria-label="Filtrar por estado">
          <button type="button" className="pn-chip pn-press" aria-current={filter === "todos" ? "true" : undefined} onClick={() => setFilter("todos")}>Todos <small>{counts.total}</small></button>
          {VENDOR_STAGE_ORDER.filter((status) => counts[status] > 0).map((status) => (
            <button key={status} type="button" className="pn-chip pn-press" aria-current={filter === status ? "true" : undefined} onClick={() => setFilter(status)}>
              {VENDOR_STATUS_LABELS[status]} <small>{counts[status]}</small>
            </button>
          ))}
        </div>
        <button type="button" className="pn-btn pn-btn--clay pn-btn--sm pn-press" aria-expanded={Boolean(adding)} onClick={() => { setAdding(adding ? null : "otro"); setEditing(null); }}>
          <PlusIcon aria-hidden="true" className="size-4" />Añadir proveedor
        </button>
      </div>

      {adding && <VendorForm key={adding} category={adding} idPrefix="nuevo" submitLabel="Añadir a la agenda" onSubmit={add} onCancel={() => setAdding(null)} />}

      {visible.length === 0 ? (
        filter === "todos" ? null : <p className="pn-quiet-empty pn-muted">No hay proveedores {statusCountLabel(filter, 2)}.</p>
      ) : (
        <ul className="pn-vendors">
          {visible.map((contact) => (
            <li key={contact.id} className="pn-vendor" data-status={contact.status}>
              <VendorIcon category={contact.category} tone={VENDOR_TONES[contact.status]} />
              <div className="pn-vendor-main">
                <span className="pn-vendor-name">{contact.name}</span>
                <span className="pn-vendor-sub">{vendorSubline(contact)}</span>
                {(contact.phone || contact.email) && (
                  <span className="pn-vendor-links">
                    {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}><PhoneIcon aria-hidden="true" className="size-3.5" />{contact.phone}</a>}
                    {contact.email && <a href={`mailto:${contact.email}`}><MailIcon aria-hidden="true" className="size-3.5" />{contact.email}</a>}
                  </span>
                )}
                {contact.paymentNote && <p className="pn-vendor-note"><strong>Pagos:</strong> {contact.paymentNote}</p>}
                {contact.notes && editing !== contact.id && <p className="pn-vendor-note">{contact.notes}</p>}
              </div>
              <label className="pn-vendor-status">
                <span className="sr-only">Estado de {contact.name}</span>
                <select className="pn-select" value={contact.status} onChange={(event) => void setStatus(contact, event.target.value as VendorStatus)}>
                  {VENDOR_STATUSES.map((status) => <option key={status} value={status}>{VENDOR_STATUS_LABELS[status]}</option>)}
                </select>
              </label>
              <div className="pn-vendor-tools">
                <button type="button" className="pn-task-edit pn-press" aria-label={`Editar ${contact.name}`} aria-expanded={editing === contact.id}
                  onClick={() => { setEditing(editing === contact.id ? null : contact.id); setAdding(null); }}>
                  {editing === contact.id ? <XIcon aria-hidden="true" className="size-4" /> : <PencilIcon aria-hidden="true" className="size-4" />}
                </button>
              </div>
              {editing === contact.id && (
                <div className="pn-vendor-form">
                  <VendorForm initial={contact} idPrefix={`v-${contact.id}`} submitLabel="Guardar" onSubmit={(draft) => save(contact, draft)} onCancel={() => setEditing(null)} onDelete={() => remove(contact)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
