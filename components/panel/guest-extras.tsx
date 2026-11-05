"use client";

/**
 * Ficha del invitado: acompañantes con nombre (§4.3) y «No sentar con…»
 * (§3.5). Va debajo de los datos del invitado y guarda por su cuenta (no
 * toca GuestInput): los nombres se guardan solos al dejar de escribir (antes
 * había un botón aparte y, al pulsar «Guardar cambios» de la ficha, se perdían). Se carga al abrir la ficha; sin la migración, no aparece.
 * Las acciones llegan por props (servidor real o borrador sin base de datos).
 */
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import "@/components/panel/companions.css";
import { companionDraftKey, reconcileCompanionSave, singleFlightSave } from "@/lib/crm/companion-autosave";
import { COMPANIONS_MAX, COMPANION_NAME_MAX } from "@/lib/rsvp-companions";
import type { ExtrasResult, GuestApart, GuestCompanion } from "@/lib/actions/companions";

export interface GuestExtrasActions {
  load(guestId: string): Promise<ExtrasResult<{ companions: GuestCompanion[]; apart: GuestApart[] }>>;
  saveCompanions(guestId: string, list: Array<{ id?: string; name: string; kid: boolean }>): Promise<ExtrasResult<{ companions: GuestCompanion[] }>>;
  addApart(guestId: string, otherId: string): Promise<ExtrasResult>;
  removeApart(guestId: string, otherId: string): Promise<ExtrasResult>;
  /** Buscar por nombre (searchGuestDirectory). Sin ella no se ofrece «No sentar con…». */
  searchGuests?(query: string): Promise<{ id: string; name: string }[]>;
}

interface Row { key: string; id?: string; name: string; kid: boolean; byGuest: boolean; away: boolean }
let nextKey = 0;
const toRow = (companion: GuestCompanion): Row => ({ key: companion.id, id: companion.id, name: companion.name, kid: companion.isKid, byGuest: companion.byGuest, away: companion.tableId !== null });

export function GuestExtras({ guest, actions, registerFlush }: { registerFlush?: (flush: (() => Promise<boolean>) | null) => void; guest: { id: string; name: string; companions: number; status: string }; actions: GuestExtrasActions }) {
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState<string>("[]");
  const [apart, setApart] = useState<GuestApart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const titleId = useId();
  const rowsRef = useRef<Row[]>([]);
  const savedRef = useRef("[]");
  const readyRef = useRef(false);
  const mounted = useRef(true);
  function changeRows(update: Row[] | ((list: Row[]) => Row[])) {
    const next = typeof update === "function" ? update(rowsRef.current) : update;
    rowsRef.current = next;
    if (mounted.current) setRows(next);
  }
  const saveLatest = useRef<() => Promise<boolean>>(async () => true);
  const [flush] = useState(() => singleFlightSave(() => saveLatest.current()));
  useEffect(() => {
    mounted.current = true;
    registerFlush?.(flush);
    return () => { mounted.current = false; registerFlush?.(null); };
  }, [flush, registerFlush]);

  // Se carga una vez por invitado (las acciones pueden cambiar de identidad en cada render).
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => {
    let alive = true;
    actionsRef.current.load(guest.id).then((result) => {
      if (!alive) return;
      if (!result.ok) { setState(result.missing ? "hidden" : "error"); return; }
      const loaded = result.companions.map(toRow);
      changeRows(loaded);
      savedRef.current = companionDraftKey(loaded);
      setSaved(savedRef.current);
      readyRef.current = true;
      setApart(result.apart);
      setState("ready");
    }).catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [guest.id]);

  const rowsKey = companionDraftKey(rows);
  const complete = rows.every((row) => row.name.trim().length > 0);
  // Closing the tab while dirty must not silently discard a pending save.
  useEffect(() => {
    if (state !== "ready" || (rowsKey === saved && !pending)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const onHidden = () => { if (document.visibilityState === "hidden") void flush(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [state, rowsKey, saved, pending, flush]);
  // Guardado automático: 900 ms después del último cambio, si no falta ningún nombre.
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (state !== "ready" || rowsKey === saved || !complete) return;
    const timer = window.setTimeout(() => saveRef.current(), 900);
    return () => window.clearTimeout(timer);
  }, [state, rowsKey, saved, complete]);

  saveLatest.current = async () => {
    if (!readyRef.current) return true;
    if (mounted.current) { setPending(true); setError(null); setSavedNote(false); }
    try {
      while (companionDraftKey(rowsRef.current) !== savedRef.current) {
        const snapshot = rowsRef.current.map(row => ({ ...row }));
        if (snapshot.some(row => !row.name.trim())) {
          if (mounted.current) setError("Escribid los nombres que faltan o quitad las filas vacías antes de cerrar.");
          return false;
        }
        const result = await actionsRef.current.saveCompanions(guest.id, snapshot.map(({ id, name, kid }) => ({ ...(id ? { id } : {}), name: name.trim(), kid })));
        if (!result.ok) { if (mounted.current) setError(result.error); return false; }
        // Preserve edits made while this request was in flight; then save those too.
        changeRows(reconcileCompanionSave(snapshot, rowsRef.current, result.companions));
        savedRef.current = companionDraftKey(result.companions.map(toRow));
        if (mounted.current) setSaved(savedRef.current);
      }
      if (mounted.current) setSavedNote(true);
      return true;
    } catch {
      if (mounted.current) setError("No hemos podido guardar los nombres. Probad de nuevo antes de cerrar.");
      return false;
    } finally { if (mounted.current) setPending(false); }
  };
  const save = () => { void flush(); };
  saveRef.current = save;

  if (state === "hidden") return null;
  if (state === "loading") return <p className="pn-help pn-extras" aria-live="polite">Cargando acompañantes y mesas…</p>;
  if (state === "error") return <p className="pn-row-error pn-extras">No hemos podido cargar sus acompañantes. Cerrad y abrid la ficha para reintentarlo.</p>;

  const dirty = rowsKey !== saved;
  const update = (key: string, patch: Partial<Row>) => changeRows(list => list.map(row => row.key === key ? { ...row, ...patch } : row));

  return (
    <section className="pn-extras" aria-labelledby={titleId}>
      <div className="pn-extras-block">
        <h3 id={titleId}>Acompañantes con nombre</h3>
        <p className="pn-help">
          {guest.status === "si"
            ? `Viene con ${guest.companions === 1 ? "1 acompañante" : `${guest.companions} acompañantes`}. Sus nombres sirven para las mesas, la mesa infantil y las tarjetas.`
            : "Podéis apuntar ya los nombres de quien vendrá con esta persona."}
          {" "}Si los escribió el invitado al confirmar, aparecen aquí.
        </p>
        {rows.length > 0 && (
          <ul className="pn-companion-rows">
            {rows.map((row, index) => (
              <li key={row.key} className="pn-companion-row">
                <label className="min-w-0">
                  <span className="sr-only">Nombre del acompañante {index + 1}</span>
                  <input type="text" value={row.name} maxLength={COMPANION_NAME_MAX} autoComplete="off" placeholder={`Acompañante ${index + 1}`} onChange={(event) => update(row.key, { name: event.target.value })} />
                </label>
                <label className="pn-companion-kid">
                  <input type="checkbox" checked={row.kid} onChange={(event) => update(row.key, { kid: event.target.checked })} />Niño/a
                </label>
                <button type="button" className="pn-icon-btn pn-press" onClick={() => changeRows((list) => list.filter((item) => item.key !== row.key))} aria-label={`Quitar a ${row.name || `el acompañante ${index + 1}`}`}>
                  <Trash2Icon aria-hidden="true" className="size-4" />
                </button>
                {(row.byGuest || row.away) && (
                  <span className="pn-companion-meta">{[row.byGuest ? "Lo escribió el invitado" : null, row.away ? "Sentado en otra mesa (mesa infantil)" : null].filter(Boolean).join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {guest.status === "si" && rows.length > guest.companions && <p className="pn-note pn-note--warn">Hay más nombres que acompañantes confirmados ({guest.companions}).</p>}
        {error && <p role="alert" className="pn-row-error">{error}</p>}
        <div className="pn-extras-actions">
          {rows.length < COMPANIONS_MAX && (
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending}
              onClick={() => changeRows((list) => [...list, { key: `n${++nextKey}`, name: "", kid: false, byGuest: false, away: false }])}>
              <PlusIcon aria-hidden="true" className="size-4" />Añadir acompañante
            </button>
          )}
          {/* Se guarda solo; el botón queda para reintentar tras un error. */}
          {dirty && error && <button type="button" className="pn-btn pn-btn--sm pn-press" disabled={pending} onClick={save}>{pending ? "Guardando…" : "Volver a guardar"}</button>}
          <span className="pn-help" aria-live="polite">{pending ? "Guardando…" : dirty && !complete ? "Escribid el nombre para guardarlo." : savedNote && !dirty ? "Nombres guardados." : ""}</span>
        </div>
      </div>

      {actions.searchGuests && <ApartField guest={guest} apart={apart} setApart={setApart} actions={actions} />}
    </section>
  );
}

function ApartField({ guest, apart, setApart, actions }: { guest: { id: string; name: string }; apart: GuestApart[]; setApart: (list: GuestApart[]) => void; actions: GuestExtrasActions }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchId = useId();
  const request = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || !actions.searchGuests) { setResults([]); return; }
    const mine = ++request.current;
    const timer = setTimeout(() => {
      actions.searchGuests!(needle).then((found) => { if (request.current === mine) setResults(found); }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [query, actions]);

  const taken = new Set([guest.id, ...apart.map((item) => item.id)]);
  const options = results.filter((item) => !taken.has(item.id)).slice(0, 6);

  function add(other: { id: string; name: string }) {
    setError(null);
    startTransition(async () => {
      const result = await actions.addApart(guest.id, other.id);
      if (!result.ok) { setError(result.error); return; }
      setApart([...apart, other].sort((a, b) => a.name.localeCompare(b.name, "es")));
      setQuery(""); setResults([]);
      toast(`${guest.name} y ${other.name} no se sentarán juntos.`);
    });
  }
  function remove(other: GuestApart) {
    setError(null);
    startTransition(async () => {
      const result = await actions.removeApart(guest.id, other.id);
      if (!result.ok) { setError(result.error); return; }
      setApart(apart.filter((item) => item.id !== other.id));
    });
  }

  return (
    <div className="pn-extras-block">
      <h3>No sentar con…</h3>
      <p className="pn-help">«Sentar automáticamente» no los pondrá en la misma mesa (salvo que sean del mismo grupo: el grupo va siempre junto).</p>
      {apart.length > 0 && (
        <ul className="pn-apart-list" aria-label={`No sentar a ${guest.name} con`}>
          {apart.map((item) => (
            <li key={item.id} className="pn-apart-chip">
              <span>{item.name}</span>
              <button type="button" className="pn-press" disabled={pending} onClick={() => remove(item)} aria-label={`Quitar: ${item.name} ya puede sentarse con ${guest.name}`}><XIcon aria-hidden="true" className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="pn-apart-search" htmlFor={searchId}>
        <span className="sr-only">Buscar a quién no sentar con {guest.name}</span>
        <input id={searchId} type="search" value={query} autoComplete="off" placeholder="Buscar por nombre…" onChange={(event) => setQuery(event.target.value)} disabled={pending} />
      </label>
      {options.length > 0 && (
        <ul className="pn-apart-results" aria-label="Resultados">
          {options.map((item) => (
            <li key={item.id}><button type="button" className="pn-press" disabled={pending} onClick={() => add(item)}>{item.name}</button></li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && options.length === 0 && results.length === 0 && <p className="pn-help">Nadie con ese nombre.</p>}
      {error && <p role="alert" className="pn-row-error">{error}</p>}
    </div>
  );
}
