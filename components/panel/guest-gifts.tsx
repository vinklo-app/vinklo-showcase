"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, HeartHandshakeIcon, MessageCircleIcon, PencilIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  GIFT_DESCRIPTION_MAX, GIFT_KINDS, GIFT_KIND_LABELS, GIFT_NOTE_MAX,
  type CrmActions, type Gift, type GuestGiftState,
} from "@/lib/crm/contract";
import { whatsappNumber } from "@/lib/invitation-sharing";
import { buildThanksMessage, firstName, type MessageContext, type TemplateKind } from "@/lib/messages/templates";
import { WhatsAppCompose, type ComposeRequest, type SaveTemplateResult } from "@/components/panel/whatsapp-compose";
import { pendingCommits } from "@/components/panel/deferred-commit";
import { GiftKindIcon } from "@/components/panel/gift-kind-icon";
import {
  coGiversLine, emptyGiftDraft, giftDraftToInput, giftHeadline, giftToDraft, isMonetaryKind, type GiftDraft,
} from "@/components/panel/gifts";
import { shortDate } from "@/components/panel/reminders";

/*
 * «Regalo» en la hoja de un invitado: lo que la pareja ha anotado (también
 * los regalos de grupo), anotar / editar / borrar con deshacer, «Sin regalo»
 * y el agradecimiento (marcar y WhatsApp con la plantilla). Una ANOTACIÓN
 * privada: nada avisa al invitado ni dice que Vinklo haya movido dinero.
 * Antes de abrir WhatsApp se ve (y se puede retocar) el agradecimiento en la
 * hoja común whatsapp-compose.tsx. Abrir WhatsApp NO marca «agradecido»: lo
 * confirma la pareja al volver.
 *
 * Todo vive dentro de la hoja (<dialog> modal, capa superior): los avisos de
 * sonner quedarían debajo del fondo y su «Deshacer» no se podría pulsar. Por
 * eso el deshacer y las confirmaciones van en línea, en la propia sección.
 */

export interface GuestOption { id: string; name: string }
export interface ThanksMessage { template: string | null; context: MessageContext }
type SaveTemplate = (kind: TemplateKind, body: string) => Promise<SaveTemplateResult>;

/** Cambios locales que el padre aplica a su lista de regalos (el servidor revalida después). */
export interface GiftStore {
  upsert(gift: Gift): void;
  remove(id: string): void;
  setNoGift(guestId: string, noGift: boolean): void;
}

const UNDO_MS = 4000;
const NETWORK_ERROR = "No se ha guardado. Comprobad la conexión y probad de nuevo.";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES");

/* --- Formulario ----------------------------------------------------------- */

function GiftForm({ guest, initial, directory, searchDirectory, onSubmit, onCancel, onDelete }: {
  guest: GuestOption;
  initial: GiftDraft;
  directory: GuestOption[];
  /** Búsqueda en el servidor (R05). Sin ella se filtra `directory` en local. */
  searchDirectory?: (query: string) => Promise<GuestOption[]>;
  onSubmit: (draft: GiftDraft) => Promise<string | null>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<{ field: keyof GiftDraft | null; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = { kind: useId(), amount: useId(), error: useId(), givers: useId(), search: useId() };
  const amountRef = useRef<HTMLInputElement>(null);
  // Nombres conocidos: los de la página, los del regalo y los encontrados al buscar.
  const [found, setFound] = useState<GuestOption[]>([]);
  const [known, setKnown] = useState<GuestOption[]>([]);
  const names = useMemo(() => new Map([...directory, ...known, guest].map((option) => [option.id, option.name])), [directory, known, guest]);
  const monetary = draft.kind !== null && isMonetaryKind(draft.kind);
  const needle = normalize(search.trim());
  useEffect(() => {
    if (!searchDirectory || !needle) { setFound([]); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      void searchDirectory(search.trim()).then((rows) => { if (live) setFound(rows); }, () => { if (live) setFound([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [needle, search, searchDirectory]);
  const pool = searchDirectory ? found : directory;
  const matches = needle
    ? pool.filter((option) => option.id !== guest.id && !draft.guestIds.includes(option.id) && (searchDirectory || normalize(option.name).includes(needle))).slice(0, 8)
    : [];
  const pick = (option: GuestOption) => { setKnown((old) => (old.some((o) => o.id === option.id) ? old : [...old, option])); set({ guestIds: [...draft.guestIds, option.id] }); setSearch(""); };
  const set = (patch: Partial<GiftDraft>) => { setDraft((current) => ({ ...current, ...patch })); setError(null); };
  const invalid = (field: keyof GiftDraft) => (error?.field === field ? true : undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = giftDraftToInput(draft);
    if (!result.ok) { setError({ field: result.field, message: result.error }); return; }
    startTransition(async () => {
      try {
        const problem = await onSubmit(draft);
        if (problem) setError({ field: null, message: problem });
      } catch { setError({ field: null, message: NETWORK_ERROR }); }
    });
  }

  return (
    <form className="pn-form pn-gift-form" onSubmit={submit} noValidate>
      <fieldset disabled={pending}>
        <legend className="sr-only">Regalo de {guest.name}</legend>
        <div className="pn-field" role="radiogroup" aria-labelledby={ids.kind} aria-invalid={invalid("kind")}>
          <span id={ids.kind}>¿Qué os han regalado?</span>
          <div className="pn-gift-kind-picker">
            {GIFT_KINDS.map((kind) => (
              <label key={kind} className="pn-chip pn-chip--pick pn-press">
                <input type="radio" name="gift-kind" value={kind} checked={draft.kind === kind} className="sr-only"
                  onChange={() => { set({ kind, amount: isMonetaryKind(kind) ? draft.amount : "" }); if (isMonetaryKind(kind)) requestAnimationFrame(() => amountRef.current?.focus()); }} />
                <GiftKindIcon kind={kind} />{GIFT_KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </div>

        {monetary && (
          <label className="pn-field">
            <span>Importe (opcional)</span>
            <span className="pn-money">
              <input ref={amountRef} id={ids.amount} inputMode="decimal" autoComplete="off" enterKeyHint="next" placeholder="150" maxLength={14}
                value={draft.amount} aria-invalid={invalid("amount")} aria-describedby={error?.field === "amount" ? ids.error : undefined}
                onChange={(event) => set({ amount: event.target.value })} />
              <span aria-hidden="true">€</span>
            </span>
            <small>Solo para vuestra cuenta. Si no lo sabéis o preferís no anotarlo, dejadlo vacío.</small>
          </label>
        )}

        <label className="pn-field">
          <span>{monetary ? "Descripción (opcional)" : "¿Qué es? (opcional)"}</span>
          <input maxLength={GIFT_DESCRIPTION_MAX} autoComplete="off" placeholder={monetary ? "Para el viaje" : "La cafetera de la lista"} value={draft.description}
            aria-invalid={invalid("description")} onChange={(event) => set({ description: event.target.value })} />
        </label>

        <label className="pn-field">
          <span>Recibido el (opcional)</span>
          <input type="date" value={draft.receivedOn} aria-invalid={invalid("receivedOn")} onChange={(event) => set({ receivedOn: event.target.value })} />
        </label>

        <div className="pn-field">
          <span id={ids.givers}>De parte de</span>
          <ul className="pn-givers" aria-labelledby={ids.givers}>
            {draft.guestIds.map((id) => (
              <li key={id} className="pn-giver">
                <span className="min-w-0 truncate">{names.get(id) ?? "Invitado"}</span>
                {draft.guestIds.length > 1 && (
                  <button type="button" className="pn-giver-drop pn-press" aria-label={`Quitar a ${names.get(id) ?? "este invitado"}`} onClick={() => set({ guestIds: draft.guestIds.filter((guestId) => guestId !== id) })}>
                    <XIcon aria-hidden="true" className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {(directory.length > 0 || searchDirectory) && (
            <div className="pn-giver-search">
              <div className="pn-search">
                <SearchIcon aria-hidden="true" className="pn-muted size-4 shrink-0" />
                <input id={ids.search} type="search" value={search} autoComplete="off" enterKeyHint="search" placeholder="Regalo de grupo: añadid a más personas"
                  aria-label="Buscar a otra persona de vuestra lista" aria-controls={`${ids.search}-results`}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (matches[0]) pick(matches[0]); } }}
                  onChange={(event) => setSearch(event.target.value)} />
              </div>
              {needle && (
                <ul id={`${ids.search}-results`} className="pn-giver-results" aria-label="Personas de vuestra lista">
                  {matches.length === 0 ? <li className="pn-help px-1 py-2">Nadie de vuestra lista coincide con «{search.trim()}».</li> : matches.map((option) => (
                    <li key={option.id}>
                      <button type="button" className="pn-giver-option pn-press" onClick={() => pick(option)}>
                        <PlusIcon aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 truncate">{option.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error?.field === "guestIds" && <small className="pn-row-error">{error.message}</small>}
        </div>

        <label className="pn-field">
          <span>Nota para vosotros (opcional)</span>
          <textarea rows={2} maxLength={GIFT_NOTE_MAX} value={draft.note} aria-invalid={invalid("note")} onChange={(event) => set({ note: event.target.value })} />
          <small>Nadie más la ve.</small>
        </label>
      </fieldset>

      {error && error.field !== "guestIds" && <p id={ids.error} role="alert" className="pn-row-error">{error.message}</p>}
      <div className="pn-form-actions">
        <span className="flex flex-wrap items-center gap-x-4">
          <button className="pn-btn pn-press" type="submit" disabled={pending}>{pending ? "Guardando…" : onDelete ? "Guardar el regalo" : "Anotar el regalo"}</button>
          <button type="button" className="pn-link pn-press" disabled={pending} onClick={onCancel}>Cancelar</button>
        </span>
        {onDelete && <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending} onClick={onDelete}>Borrar</button>}
      </div>
    </form>
  );
}

/* --- Un regalo anotado ------------------------------------------------------ */

function GiftItem({ gift, guest, thanks, actions, store, onEdit, beforeMutate, saveTemplate }: {
  gift: Gift; guest: GuestOption & { phone: string | null }; thanks: ThanksMessage; actions: CrmActions; store: GiftStore; onEdit: () => void;
  saveTemplate?: SaveTemplate;
  /** Confirma los borrados pendientes de deshacer antes de tocar el servidor. */
  beforeMutate: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [composing, setComposing] = useState<ComposeRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const headline = giftHeadline(gift);
  const meta = [gift.receivedOn ? `Recibido el ${shortDate(`${gift.receivedOn}T12:00:00Z`)}` : null, coGiversLine(gift, guest.id) || null].filter(Boolean).join(" · ");
  const message = buildThanksMessage(thanks.template, guest.name, thanks.context);
  const canWhatsApp = whatsappNumber(guest.phone) !== null && message.trim() !== "";

  function setThanked(next: boolean) {
    const previous = gift;
    setError(null);
    setAsking(false);
    store.upsert({ ...gift, thankedAt: next ? new Date().toISOString() : null });
    startTransition(async () => {
      try {
        await beforeMutate();
        const result = await actions.setGiftThanked(gift.id, next);
        if (!result.ok) { store.upsert(previous); setError(result.error); }
      } catch { store.upsert(previous); setError(NETWORK_ERROR); }
    });
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); setAsking(true); }
    catch { setError("No se ha podido copiar. Escribidle desde vuestro móvil."); }
  }

  return (
    <li className="pn-gift" data-thanked={gift.thankedAt ? "true" : undefined}>
      <span className="pn-gift-icon" aria-hidden="true"><GiftKindIcon kind={gift.kind} /></span>
      <div className="min-w-0">
        <p className="pn-name">
          {GIFT_KIND_LABELS[gift.kind]}
          {headline && <span className="pn-gift-headline"> · <span className={gift.amountCents !== null ? "pn-tnum" : undefined}>{headline}</span></span>}
        </p>
        {gift.amountCents !== null && gift.description && <p className="pn-sub">{gift.description}</p>}
        {meta && <p className="pn-sub">{meta}</p>}
        {gift.note && <p className="pn-sub whitespace-pre-wrap">{gift.note}</p>}
      </div>
      <button type="button" className="pn-gift-edit pn-press" onClick={onEdit} aria-label={`Editar el regalo (${GIFT_KIND_LABELS[gift.kind]})`}>
        <PencilIcon aria-hidden="true" className="size-4" />
      </button>

      <div className="pn-gift-thanks">
        {gift.thankedAt ? (
          <p className="pn-gift-thanked">
            <CheckIcon aria-hidden="true" className="size-4" />Agradecido{shortDate(gift.thankedAt) ? ` el ${shortDate(gift.thankedAt)}` : ""}
            <button type="button" className="pn-link pn-press pn-muted ml-auto" disabled={pending} onClick={() => setThanked(false)}>Desmarcar</button>
          </p>
        ) : asking ? (
          <div className="pn-gift-ask" role="group" aria-label="Confirmar el agradecimiento">
            <p className="text-sm font-semibold">¿Le habéis enviado el agradecimiento?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pn-btn pn-btn--sm pn-press" disabled={pending} onClick={() => setThanked(true)}><CheckIcon aria-hidden="true" className="size-4" />Sí, marcar agradecido</button>
              <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending} onClick={() => setAsking(false)}>Todavía no</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {canWhatsApp ? (
              <button type="button" className="pn-act pn-press"
                onClick={() => setComposing({ kind: "thanks", name: guest.name, phone: guest.phone, text: message, vars: { nombre: firstName(guest.name), novios: thanks.context.novios } })}>
                <MessageCircleIcon aria-hidden="true" className="size-4" />Agradecer por WhatsApp
              </button>
            ) : (
              <button type="button" className="pn-act pn-press" onClick={copy}>
                <CopyIcon aria-hidden="true" className="size-4" />{copied ? "Mensaje copiado" : "Copiar agradecimiento"}
              </button>
            )}
            <button type="button" className="pn-act pn-act--ink pn-press" disabled={pending} onClick={() => setThanked(true)}>
              <HeartHandshakeIcon aria-hidden="true" className="size-4" />Marcar agradecido
            </button>
          </div>
        )}
        {!gift.thankedAt && !canWhatsApp && !asking && <p className="pn-help">Sin un teléfono válido no podemos abrir WhatsApp: copiad el mensaje y enviádselo vosotros.</p>}
      </div>
      {error && <p role="alert" className="pn-row-error pn-gift-error">{error}</p>}
      <WhatsAppCompose request={composing} onClose={() => setComposing(null)} onOpened={() => setAsking(true)} saveTemplate={saveTemplate} />
    </li>
  );
}

/* --- Sección completa -------------------------------------------------------- */

export function GuestGifts({ guest, gifts, giftState, directory, searchDirectory, actions, thanks, store, first = false, saveTemplate }: {
  guest: GuestOption & { phone: string | null };
  /** Regalos en los que participa esta persona. */
  gifts: Gift[];
  giftState: GuestGiftState;
  /** Personas conocidas (la página) para los regalos de grupo. */
  directory: GuestOption[];
  /** Búsqueda de personas en el servidor (R05). */
  searchDirectory?: (query: string) => Promise<GuestOption[]>;
  actions: CrmActions;
  thanks: ThanksMessage;
  store: GiftStore;
  first?: boolean;
  /** «Guardar como plantilla» desde la hoja del agradecimiento. */
  saveTemplate?: SaveTemplate;
}) {
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "new" } | { kind: "edit"; gift: Gift }>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  /** Regalos borrados que aún se pueden recuperar (el servidor no se ha enterado). */
  const [removed, setRemoved] = useState<Gift[]>([]);
  const commits = useRef(new Map<string, () => Promise<void>>());
  const undoers = useRef(new Map<string, () => void>());
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  // Al cerrar la hoja, lo borrado se confirma (pagehide lo cubre pendingCommits).
  useEffect(() => {
    const map = commits.current;
    return () => { for (const commit of Array.from(map.values())) commit(); };
  }, []);
  const switchLabel = useId();
  const switchHelp = useId();
  // Conocidos = la página + quienes ya regalan junto a esta persona (pueden estar en otra página).
  const people = useMemo(() => {
    const byId = new Map(directory.map((option) => [option.id, option]));
    for (const gift of gifts) for (const giver of gift.givers) if (!byId.has(giver.guestId)) byId.set(giver.guestId, { id: giver.guestId, name: giver.name });
    return [...byId.values()];
  }, [directory, gifts]);
  const others = useMemo(() => people.filter((option) => option.id !== guest.id), [people, guest.id]);
  const nameOf = (id: string) => (id === guest.id ? guest.name : people.find((option) => option.id === id)?.name ?? "Invitado");

  /**
   * Antes de otra acción, los borrados con «deshacer» pendiente se confirman y
   * se esperan: si no, la revalidación de esa acción traería del servidor el
   * regalo aún sin borrar y reaparecería durante un momento.
   */
  async function flushRemovals() {
    await Promise.all(Array.from(commits.current.values()).map((commit) => commit()));
  }

  async function save(draft: GiftDraft, existing?: Gift): Promise<string | null> {
    await flushRemovals();
    const result = giftDraftToInput(draft);
    if (!result.ok) return result.error;
    const input = result.input;
    const givers = input.guestIds.map((guestId) => ({ guestId, name: nameOf(guestId) }));
    const local = {
      kind: input.kind, amountCents: input.amountCents ?? null, description: input.description ?? null,
      note: input.note ?? null, receivedOn: input.receivedOn ?? null, givers,
    };
    if (existing) {
      const updated = await actions.updateGift(existing.id, input);
      if (!updated.ok) return updated.error;
      store.upsert({ ...existing, ...local });
      setStatus("Regalo guardado.");
    } else {
      const created = await actions.createGift(input);
      if (!created.ok) return created.error;
      store.upsert({ id: created.data.id, ...local, thankedAt: null, createdAt: new Date().toISOString() });
      setStatus(givers.length > 1 ? `Regalo de grupo anotado (${givers.length} personas).` : "Regalo anotado.");
    }
    setMode({ kind: "list" });
    return null;
  }

  /** Borrar con deshacer: desaparece al momento; el servidor solo se entera si no se deshace (4 s). */
  function remove(gift: Gift) {
    setMode({ kind: "list" });
    setStatus("");
    store.remove(gift.id);
    setRemoved((list) => [...list, gift]);
    let settled = false;
    const release = () => {
      settled = true;
      window.clearTimeout(timer);
      pendingCommits.delete(commit);
      commits.current.delete(gift.id);
      setRemoved((list) => list.filter((item) => item.id !== gift.id));
    };
    function commit(): Promise<void> {
      if (settled) return Promise.resolve();
      release();
      return actions.deleteGift(gift.id).then(
        (result) => { if (!result.ok) { store.upsert(gift); setError(result.error); toast(`No se ha borrado el regalo: ${result.error}`); } },
        () => { store.upsert(gift); setError(NETWORK_ERROR); toast("No se ha borrado el regalo. Comprobad la conexión y probad de nuevo."); },
      );
    }
    const timer = window.setTimeout(commit, UNDO_MS);
    pendingCommits.add(commit);
    commits.current.set(gift.id, commit);
    undoers.current.set(gift.id, () => { if (settled) return; release(); store.upsert(gift); setStatus("Regalo recuperado."); });
  }
  function toggleNoGift() {
    const next = giftState !== "no";
    setError(null);
    store.setNoGift(guest.id, next);
    startTransition(async () => {
      try {
        await flushRemovals();
        const result = await actions.setGuestNoGift(guest.id, next);
        if (!result.ok) { store.setNoGift(guest.id, !next); setError(result.error); }
      } catch { store.setNoGift(guest.id, !next); setError(NETWORK_ERROR); }
    });
  }

  return (
    <section className="pn-sheet-section" data-first={first ? "true" : undefined} aria-labelledby={titleId}>
      <h3 id={titleId} className="pn-sheet-section-title">Regalo</h3>
      {mode.kind !== "list" ? (
        <GiftForm
          key={mode.kind === "edit" ? mode.gift.id : "nuevo"}
          guest={guest}
          directory={others}
          searchDirectory={searchDirectory}
          initial={mode.kind === "edit" ? giftToDraft(mode.gift) : emptyGiftDraft(guest.id)}
          onSubmit={(draft) => save(draft, mode.kind === "edit" ? mode.gift : undefined)}
          onCancel={() => setMode({ kind: "list" })}
          onDelete={mode.kind === "edit" ? () => remove(mode.gift) : undefined}
        />
      ) : (
        <>
          {removed.length > 0 && (
            <ul className="pn-list pn-gift-undos">
              {removed.map((gift) => (
                <li key={gift.id} className="pn-gift-undo">
                  <span className="min-w-0">Regalo borrado<span className="pn-muted"> · {GIFT_KIND_LABELS[gift.kind]}{giftHeadline(gift) ? ` · ${giftHeadline(gift)}` : ""}</span></span>
                  <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={() => undoers.current.get(gift.id)?.()}>Deshacer</button>
                </li>
              ))}
            </ul>
          )}
          {gifts.length > 0 ? (
            <ul className="pn-list pn-gifts">
              {gifts.map((gift) => (
                <GiftItem key={gift.id} gift={gift} guest={guest} thanks={thanks} actions={actions} store={store} onEdit={() => setMode({ kind: "edit", gift })} beforeMutate={flushRemovals} saveTemplate={saveTemplate} />
              ))}
            </ul>
          ) : (
            <p className="pn-help">
              {giftState === "no" ? "Lo habéis marcado sin regalo." : "Aún no habéis anotado ningún regalo de esta persona. Es solo para vuestra cuenta: nadie más lo ve."}
            </p>
          )}
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" onClick={() => setMode({ kind: "new" })}>
            <PlusIcon aria-hidden="true" className="size-4" />{gifts.length > 0 ? "Anotar otro regalo" : "Anotar regalo"}
          </button>
          {gifts.length === 0 && (
            <div className="pn-switch-row">
              <span>
                <span id={switchLabel} className="block text-sm font-semibold">Sin regalo</span>
                <span id={switchHelp} className="pn-help block">Para llevar vuestra cuenta: deja de aparecer en «Sin regalo indicado».</span>
              </span>
              <button type="button" role="switch" aria-checked={giftState === "no"} aria-labelledby={switchLabel} aria-describedby={switchHelp} disabled={pending} onClick={toggleNoGift} className="pn-switch">
                <span aria-hidden="true" />
              </button>
            </div>
          )}
          {error && <p role="alert" className="pn-row-error">{error}</p>}
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {status && mode.kind === "list" && <p className="pn-help pn-gift-status" aria-hidden="true"><CheckIcon className="size-3.5" />{status}</p>}
    </section>
  );
}
