"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeftIcon, XIcon } from "lucide-react";
import {
  MAX_IMPORT_ROWS, markDuplicates, parseGuestList, rowProblem, rowsFromContacts, tooManyRowsMessage,
  type BulkCreateResult, type DuplicateMark, type ImportRow,
} from "@/lib/actions/guest-import";
import { formatCount, plural } from "@/components/panel/guest-status";
import { GroupField } from "@/components/panel/group-field";
import { canonicalGroupName } from "@/lib/crm/groups";
import { SideField, TagField, type SideChoice, type TagContext } from "@/components/panel/tag-field";
import { normalizeTags, type GuestSide } from "@/lib/crm/tags";

/** Acciones que necesita la importación (en producción, server actions de lib/actions/guests.ts). */
export interface BulkImportActions {
  /** `group`: grupo para todo el lote (opcional; "" = sin grupo). `extra`: etiquetas y lado del lote. */
  bulkCreate(rows: { name: string; phone?: string }[], group?: string, extra?: { tags?: string[]; side?: GuestSide | null }): Promise<BulkCreateResult>;
  listContacts(): Promise<{ ok: true; guests: { name: string; phone: string | null }[] } | { ok: false; error: string }>;
}

interface SelectedContact { name?: string[]; tel?: string[] }
interface ContactsManagerLike { select(properties: string[], options: { multiple: boolean }): Promise<SelectedContact[]> }

/**
 * Selector de contactos del navegador (hoy solo Chrome en Android). Se
 * comprueba tras montar (en el servidor no hay navigator): donde no existe,
 * el botón simplemente no se pinta. Sin permiso persistente: cada toque abre
 * el selector del sistema y solo llega lo que la pareja marque.
 */
export function useContactsPicker(): ContactsManagerLike | null {
  const [picker, setPicker] = useState<ContactsManagerLike | null>(null);
  useEffect(() => {
    if ("contacts" in navigator && "ContactsManager" in window) {
      setPicker((navigator as Navigator & { contacts: ContactsManagerLike }).contacts);
    }
  }, []);
  return picker;
}

/** Abre el selector (debe llamarse desde el clic) y devuelve filas; null si la pareja cancela. */
export async function pickContacts(picker: ContactsManagerLike): Promise<ImportRow[] | null> {
  try {
    const contacts = await picker.select(["name", "tel"], { multiple: true });
    const rows = rowsFromContacts(contacts ?? []);
    return rows.length ? rows : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

interface ReviewRow extends ImportRow { key: string; serverError?: string }
let seq = 0;
const toReview = (rows: ImportRow[]): ReviewRow[] => rows.map((row) => ({ ...row, key: `f${++seq}` }));

function duplicateText(mark: DuplicateMark): string {
  const by = mark.by === "phone" ? "mismo teléfono" : "mismo nombre";
  return mark.kind === "existing"
    ? `Posible repetido: ya tenéis a «${mark.match}» (${by}).`
    : `Posible repetido: ya está en esta lista como «${mark.match}» (${by}).`;
}

/**
 * Importación masiva en dos pasos dentro de la hoja: pegar → revisar →
 * añadir. Pegar y el selector de contactos acaban en la MISMA tabla de
 * revisión y llaman a la misma acción. Nunca se importa a ciegas: cada fila
 * se puede corregir o quitar, los posibles repetidos se marcan (se pueden
 * añadir igualmente) y las filas con errores bloquean el botón hasta que se
 * corrigen o se quitan.
 */
export function GuestBulkImport({ actions, initialRows, onDone, initialText = "", groups, initialGroup = "", tags, initialTags = [] }: {
  actions: BulkImportActions;
  /** Grupos ya usados; undefined = sin grupos (migración sin aplicar): no se ofrece el campo. */
  groups?: readonly string[];
  /** Grupo de partida (el elegido en la lista). */
  initialGroup?: string;
  /** Etiquetas y lado; undefined = sin la migración: no se ofrecen. */
  tags?: TagContext;
  /** Etiquetas de partida (la elegida en la lista). */
  initialTags?: string[];
  /** Filas ya elegidas (selector de contactos): se abre directamente en la revisión. */
  initialRows?: ImportRow[] | null;
  /** `finished` = no queda nada por revisar (la hoja se puede cerrar). */
  onDone: (created: number, finished: boolean) => void;
  /** Solo para el borrador (break-ui): texto pegado de partida. */
  initialText?: string;
}) {
  const fromContacts = Boolean(initialRows?.length);
  const [text, setText] = useState(initialText);
  const [group, setGroup] = useState(initialGroup);
  const [batchTags, setBatchTags] = useState<string[]>(initialTags);
  const [batchSide, setBatchSide] = useState<GuestSide | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(fromContacts ? toReview(initialRows!) : null);
  const [existing, setExisting] = useState<{ name: string; phone: string | null }[] | null>(null);
  const [existingFailed, setExistingFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textId = useId();
  const helpId = useId();
  const reviewRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Toda la lista (no solo la página filtrada) para marcar repetidos; una vez por apertura.
  useEffect(() => {
    let alive = true;
    actionsRef.current.listContacts()
      .then((result) => { if (!alive) return; if (result.ok) setExisting(result.guests); else setExistingFailed(true); })
      .catch(() => { if (alive) setExistingFailed(true); });
    return () => { alive = false; };
  }, []);

  const parsedCount = useMemo(() => (rows ? 0 : parseGuestList(text).length), [rows, text]);
  const marks = useMemo(() => (rows ? markDuplicates(rows, existing ?? []) : []), [rows, existing]);
  const problems = useMemo(() => (rows ? rows.map((row) => row.serverError ?? rowProblem(row)) : []), [rows]);
  const invalidCount = problems.filter(Boolean).length;
  const duplicateCount = marks.filter(Boolean).length;

  // Al pasar a la revisión, el foco va al resumen (lectores de pantalla y teclado).
  const inReview = rows !== null;
  useEffect(() => { if (inReview) reviewRef.current?.focus(); }, [inReview]);

  function review() {
    setError(null);
    const parsed = parseGuestList(text);
    if (parsed.length === 0) { setError("No hemos encontrado ningún nombre. Pegad un invitado por línea."); return; }
    if (parsed.length > MAX_IMPORT_ROWS) { setError(tooManyRowsMessage(parsed.length)); return; }
    setRows(toReview(parsed));
  }
  function edit(key: string, patch: Partial<ImportRow>) {
    setRows((list) => list && list.map((row) => (row.key === key ? { ...row, ...patch, serverError: undefined } : row)));
  }
  function drop(keys: Set<string>) {
    setError(null);
    setRows((list) => list && list.filter((row) => !keys.has(row.key)));
  }
  function confirm() {
    if (!rows || rows.length === 0 || invalidCount > 0 || rows.length > MAX_IMPORT_ROWS) return;
    setError(null);
    const sent = rows;
    startTransition(async () => {
      try {
        const rowsToSend = sent.map((row) => ({ name: row.name.trim(), phone: row.phone.trim() || undefined }));
        const groupName = groups ? canonicalGroupName(group, groups) : null;
        const cleanTags = tags ? normalizeTags(batchTags, tags.names) : [];
        const extra = tags && (cleanTags.length > 0 || batchSide) ? { tags: cleanTags, side: batchSide } : undefined;
        const result = extra ? await actions.bulkCreate(rowsToSend, groupName ?? "", extra) : groupName ? await actions.bulkCreate(rowsToSend, groupName) : await actions.bulkCreate(rowsToSend);
        const failed = new Map(result.errors.map((item) => [item.line - 1, item.message]));
        if (!result.ok) {
          setError(result.error);
          if (failed.size) setRows(sent.map((row, index) => (failed.has(index) ? { ...row, serverError: failed.get(index) } : row)));
          return;
        }
        if (failed.size === 0) { onDone(result.created, true); return; }
        // Parte añadida: quedan en la tabla solo las filas rechazadas, con su motivo.
        setRows(sent.flatMap((row, index) => (failed.has(index) ? [{ ...row, serverError: failed.get(index) }] : [])));
        setError(`${plural(result.created, "invitado añadido", "invitados añadidos")}. Estas filas no se han podido añadir: corregidlas o quitadlas.`);
        onDone(result.created, false);
      } catch {
        setError("No se ha añadido ningún invitado. Comprobad la conexión y probad de nuevo.");
      }
    });
  }

  if (!rows) {
    return (
      <form className="pn-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        <div className="pn-field">
          <label htmlFor={textId}>Vuestra lista</label>
          <p id={helpId} className="pn-help">Pegad vuestra lista: un invitado por línea. Podéis incluir el teléfono separado por coma, tabulador o espacio.</p>
          <textarea
            id={textId}
            className="pn-import-text"
            aria-describedby={helpId}
            value={text}
            onChange={(event) => { setText(event.target.value); setError(null); }}
            rows={9}
            spellCheck={false}
            autoComplete="off"
            placeholder={"Marta Díaz, 612 345 678\nAbuela Carmen\nTío Ramón\t+34 915 556 677"}
          />
          <small className="pn-tnum" aria-live="polite">
            {parsedCount === 0 ? "Revisaréis la lista antes de añadirla." : `${plural(parsedCount, "invitado", "invitados")} detectados · revisaréis la lista antes de añadirla.`}
          </small>
        </div>
        {parsedCount > MAX_IMPORT_ROWS && !error && <p className="pn-row-error">{tooManyRowsMessage(parsedCount)}</p>}
        {error && <p role="alert" className="pn-row-error">{error}</p>}
        <div className="pn-form-actions">
          <button className="pn-btn pn-press" type="submit" disabled={parsedCount === 0 || parsedCount > MAX_IMPORT_ROWS}>
            {parsedCount > 0 ? `Revisar ${plural(parsedCount, "invitado", "invitados")}` : "Revisar la lista"}
          </button>
        </div>
      </form>
    );
  }

  const tooMany = rows.length > MAX_IMPORT_ROWS;
  const invalidKeys = new Set(rows.filter((_, index) => problems[index]).map((row) => row.key));
  const duplicateKeys = new Set(rows.filter((_, index) => marks[index]).map((row) => row.key));
  const canConfirm = rows.length > 0 && invalidCount === 0 && !tooMany && !pending;

  return (
    <div className="pn-import">
      <div ref={reviewRef} tabIndex={-1} className="pn-import-summary">
        <p className="pn-tnum text-sm font-semibold">
          {rows.length === 0 ? "No queda ningún invitado en la lista." : plural(rows.length, "invitado para añadir", "invitados para añadir")}
        </p>
        <p className="pn-help pn-tnum">
          {[
            duplicateCount ? plural(duplicateCount, "posible repetido", "posibles repetidos") : null,
            invalidCount ? `${formatCount(invalidCount)} por corregir` : null,
            existing === null && !existingFailed ? "Buscando repetidos en vuestra lista…" : null,
            existingFailed ? "No hemos podido comparar con vuestra lista: revisad los repetidos a ojo." : null,
          ].filter(Boolean).join(" · ") || "Revisad nombres y teléfonos. Podéis corregir cualquier fila o quitarla."}
        </p>
        {(invalidCount > 0 || duplicateCount > 0) && (
          <div className="pn-import-bulk">
            {invalidCount > 0 && <button type="button" className="pn-link pn-press" onClick={() => drop(invalidKeys)}>Quitar las filas por corregir ({formatCount(invalidCount)})</button>}
            {duplicateCount > 0 && <button type="button" className="pn-link pn-press" onClick={() => drop(duplicateKeys)}>Quitar los posibles repetidos ({formatCount(duplicateCount)})</button>}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <ol className="pn-import-list" aria-label="Invitados a añadir">
          {rows.map((row, index) => {
            const problem = problems[index];
            const mark = marks[index];
            const label = row.name.trim() || `la fila ${index + 1}`;
            const noteId = `${row.key}-note`;
            return (
              <li key={row.key} className="pn-import-row" data-invalid={problem ? "true" : undefined} data-duplicate={mark && !problem ? "true" : undefined}>
                <span className="pn-import-num pn-tnum" aria-hidden="true">{index + 1}</span>
                <input
                  className="pn-import-name"
                  aria-label={`Nombre, fila ${index + 1}`}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem || mark ? noteId : undefined}
                  value={row.name}
                  maxLength={160}
                  autoComplete="off"
                  placeholder="Nombre y apellidos"
                  onChange={(event) => edit(row.key, { name: event.target.value })}
                />
                <input
                  className="pn-import-phone"
                  type="tel"
                  inputMode="tel"
                  aria-label={`Teléfono, fila ${index + 1}`}
                  value={row.phone}
                  maxLength={24}
                  autoComplete="off"
                  placeholder="Sin teléfono"
                  onChange={(event) => edit(row.key, { phone: event.target.value })}
                />
                <button type="button" className="pn-import-drop pn-press" aria-label={`Quitar a ${label}`} onClick={() => drop(new Set([row.key]))}>
                  <XIcon aria-hidden="true" className="size-4" />
                </button>
                {(problem || mark) && (
                  <p id={noteId} className={problem ? "pn-import-note pn-import-note--error" : "pn-import-note"}>
                    {problem ?? duplicateText(mark!)}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="pn-import-foot">
        {groups && rows.length > 0 && (
          <div className="pn-form">
            <GroupField value={group} onChange={setGroup} groups={groups} label="Grupo para todos (opcional)" help="Todos los de esta lista entran en este grupo. Podéis cambiarlo luego a cada uno." />
          </div>
        )}
        {tags && rows.length > 0 && (
          <div className="pn-form">
            <SideField value={batchSide} labels={tags.sideLabels} label="De quién son invitados (opcional)" onChange={(side: SideChoice) => { if (side !== "keep") setBatchSide(side); }} />
            <TagField value={batchTags} onChange={setBatchTags} existing={tags.names} suggestions={tags.suggestions} label="Etiquetas para todos (opcional)" help="Todos los de esta lista llevan estas etiquetas. Podéis cambiarlas luego a cada uno." />
          </div>
        )}
        {tooMany && <p role="alert" className="pn-row-error">{tooManyRowsMessage(rows.length)}</p>}
        {!tooMany && invalidCount > 0 && <p className="pn-help">Corregid o quitad las filas marcadas para poder añadir la lista.</p>}
        {error && <p role="alert" className="pn-row-error">{error}</p>}
        <div className="pn-import-foot-actions">
          {!fromContacts && (
            <button type="button" className="pn-link pn-press" disabled={pending} onClick={() => { setRows(null); setError(null); }}>
              <ChevronLeftIcon aria-hidden="true" className="size-4" />Volver al texto
            </button>
          )}
          <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={!canConfirm} onClick={confirm}>
            {pending ? "Añadiendo…" : rows.length > 0 ? `Añadir ${plural(rows.length, "invitado", "invitados")}` : "Añadir"}
          </button>
        </div>
      </div>
    </div>
  );
}
