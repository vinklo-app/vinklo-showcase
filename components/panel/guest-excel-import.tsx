"use client";

/**
 * «Importar desde Excel» (backlog 13-oct-2026, punto 13): archivo → revisión
 * del mapeo → importación en una sola acción. El archivo se lee en el
 * navegador (lib/crm/read-spreadsheet, lector cargado bajo demanda); los
 * valores de ejemplo solo se pintan aquí. Al servidor van las invitaciones
 * confirmadas, con un id de importación que hace idempotente el reintento.
 * Nada se importa a ciegas: «Hemos leído N filas: X invitaciones y Y
 * personas», cada columna con su campo editable, repetidos y teléfonos raros.
 */
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckIcon, ChevronLeftIcon, FileSpreadsheetIcon, TriangleAlertIcon } from "lucide-react";
import "@/components/panel/guest-import.css";
import {
  EXCEL_ACCEPT, EXCEL_MAX_ROWS, IMPORT_FIELDS, IMPORT_FIELD_LABELS, analyzeSheet, buildGuests, markGuestDuplicates, readSummary,
  type ImportField, type ImportGuest, type RawSheet, type SheetAnalysis,
} from "@/lib/crm/guest-excel-import";
import { readSpreadsheet } from "@/lib/crm/read-spreadsheet";
import { EXCEL_TABLE_FIELD } from "@/lib/crm/excel-tables";
import type { ExcelImportResult } from "@/lib/actions/guest-excel";
import { plural } from "@/components/panel/guest-status";

export interface ExcelImportActions {
  importGuests(importId: string, guests: ImportGuest[]): Promise<ExcelImportResult>;
  /** Toda la lista guardada, para marcar repetidos (listGuestContacts). */
  listContacts(): Promise<{ ok: true; guests: { name: string; phone: string | null }[] } | { ok: false; error: string }>;
}

/** Tope del envío a la acción (el servidor acepta 4,25 MB). */
const PAYLOAD_MAX = 3.5 * 1024 * 1024;

function newImportId(): string {
  const api: Crypto = globalThis.crypto;
  if (typeof api.randomUUID === "function") return api.randomUUID();
  // Sin randomUUID (navegadores viejos o http): v4 con getRandomValues.
  const b = api.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Step = { kind: "file" } | { kind: "review"; file: string; raw: RawSheet[] } | { kind: "done"; guests: number; people: number; skipped: number; repeated: boolean; withTables: boolean };

export function GuestExcelImport({ actions, partners, onDone, initialSheets, tablesHref }: {
  actions: ExcelImportActions;
  /** «Mesas»: si el Excel traía columna Mesa, se ofrece ir a sentar según el archivo. */
  tablesHref?: string;
  partners?: { p1?: string | null; p2?: string | null };
  /** Al terminar (la hoja se puede cerrar): invitaciones añadidas. */
  onDone: (guests: number) => void;
  /** Solo para el borrador: hojas ya leídas. */
  initialSheets?: { file: string; sheets: RawSheet[] };
}) {
  const [step, setStep] = useState<Step>(initialSheets ? { kind: "review", file: initialSheets.file, raw: initialSheets.sheets } : { kind: "file" });
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputId = useId();
  const helpId = useId();

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const result = await readSpreadsheet(file);
      if (!result.ok) { setError(result.error); return; }
      setStep({ kind: "review", file: file.name, raw: result.sheets });
    } finally { setReading(false); }
  }

  if (step.kind === "done") {
    return (
      <div className="pn-xl-done" role="status">
        <span className="pn-xl-done-icon" aria-hidden="true"><CheckIcon className="size-5" /></span>
        <p className="text-sm font-semibold pn-tnum">
          {step.repeated ? `Esta importación ya se había hecho: ${plural(step.guests, "invitación", "invitaciones")} (${plural(step.people, "persona", "personas")}) ya están en vuestra lista. No se ha duplicado a nadie.`
            : step.guests === 0 ? "No había nadie nuevo que añadir." : `Hemos añadido ${plural(step.guests, "invitación", "invitaciones")} (${plural(step.people, "persona", "personas")}) a vuestra lista.`}
        </p>
        {step.skipped > 0 && <p className="pn-help pn-tnum">{plural(step.skipped, "repetido se ha quedado fuera", "repetidos se han quedado fuera")}.</p>}
        {step.withTables && tablesHref && step.guests > 0 && <p className="pn-help">Vuestro Excel trae la columna Mesa: en «Mesas» podéis crear esas mesas y sentar según el archivo a quien aún no tiene mesa y no ha dicho que no viene. Se puede deshacer.</p>}
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-btn--clay pn-press" onClick={() => onDone(step.guests)}>Ver la lista</button>
          {step.withTables && tablesHref && step.guests > 0 && <Link href={tablesHref} className="pn-btn pn-btn--ghost pn-press">Ir a Mesas</Link>}
        </div>
      </div>
    );
  }

  if (step.kind === "review") {
    return <ExcelReview key={step.file} file={step.file} raw={step.raw} actions={actions} partners={partners} onBack={() => { setStep({ kind: "file" }); setError(null); }}
      onImported={(guests, people, skipped, repeated, withTables) => setStep({ kind: "done", guests, people, skipped, repeated, withTables })} />;
  }

  return (
    <div className="pn-form">
      <div className="pn-field">
        <label htmlFor={inputId} className="pn-xl-drop pn-press" data-busy={reading ? "true" : undefined}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void pick(event.dataTransfer.files?.[0]); }}>
          <FileSpreadsheetIcon aria-hidden="true" className="size-6" />
          <span className="font-semibold">{reading ? "Leyendo el archivo…" : "Elegid vuestro Excel"}</span>
          <span className="pn-help">.xlsx, .xls, .ods o .csv · hasta 5 MB y {EXCEL_MAX_ROWS.toLocaleString("es-ES")} filas</span>
        </label>
        <input id={inputId} type="file" accept={EXCEL_ACCEPT} className="sr-only" aria-describedby={helpId} disabled={reading}
          onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
        <p id={helpId} className="pn-help">Da igual cómo esté hecho: buscamos la fila de títulos, entendemos nombres, teléfonos, acompañantes, mesa o menú, y lo que no encaje lo guardamos como campo propio de cada invitado. Revisaréis todo antes de importar. El archivo no sale de vuestro dispositivo: solo se guardan los invitados que confirméis.</p>
      </div>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
    </div>
  );
}

function ExcelReview({ file, raw, actions, partners, onBack, onImported }: {
  file: string; raw: RawSheet[]; actions: ExcelImportActions; partners?: { p1?: string | null; p2?: string | null };
  onBack: () => void; onImported: (guests: number, people: number, skipped: number, repeated: boolean, withTables: boolean) => void;
}) {
  const [analyses, setAnalyses] = useState<SheetAnalysis[]>(() => raw.map((sheet) => analyzeSheet(sheet)));
  const [included, setIncluded] = useState<boolean[]>(() => analyses.map((a) => a.mapping.includes("name")));
  const [existing, setExisting] = useState<{ name: string; phone: string | null }[] | null>(null);
  const [existingFailed, setExistingFailed] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Un id por revisión: un reintento (doble clic, corte de red) no duplica a nadie.
  const importId = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    let alive = true;
    actionsRef.current.listContacts()
      .then((result) => { if (!alive) return; if (result.ok) setExisting(result.guests); else setExistingFailed(true); })
      .catch(() => { if (alive) setExistingFailed(true); });
    summaryRef.current?.focus();
    return () => { alive = false; };
  }, []);

  const chosen = useMemo(() => analyses.filter((_, index) => included[index]), [analyses, included]);
  const built = useMemo(() => buildGuests(chosen, { partners, sheetAsGroup: chosen.length > 1 }), [chosen, partners]);
  const marks = useMemo(() => markGuestDuplicates(built.guests, existing ?? []), [built.guests, existing]);
  const existingDupes = marks.filter((mark) => mark?.kind === "existing").length;
  const batchDupes = marks.filter((mark) => mark?.kind === "batch").length;
  // Índices (en built.guests) de lo que se envía: para señalar la fila del archivo si el servidor rechaza una.
  const sentIndexes = built.guests.flatMap((_, index) => (skipExisting && marks[index]?.kind === "existing" ? [] : [index]));
  const toImport = sentIndexes.map((index) => built.guests[index]);
  const importPeople = toImport.reduce((sum, guest) => sum + 1 + guest.companions, 0);
  const hasName = chosen.some((analysis) => analysis.mapping.includes("name"));
  const phoneWarnings = built.warnings.filter((w) => w.kind === "phone");
  const otherWarnings = built.warnings.filter((w) => w.kind !== "phone");
  const tooMany = toImport.length > EXCEL_MAX_ROWS;

  function setField(sheet: number, column: number, field: ImportField) {
    setError(null);
    setAnalyses((list) => list.map((analysis, index) => {
      if (index !== sheet) return analysis;
      // Los campos de una sola columna se mueven: la anterior pasa a campo propio.
      const single = ["name", "phone", "attendance", "companions", "people", "kids", "household", "group", "side"].includes(field) && field !== "name";
      const mapping = analysis.mapping.map((current, i) => (i === column ? field : single && current === field ? "custom" : current));
      return { ...analysis, mapping, columns: analysis.columns.map((c, i) => ({ ...c, field: mapping[i] })) };
    }));
  }
  function setHeaderRow(sheet: number, row: number) {
    setError(null);
    setAnalyses((list) => list.map((analysis, index) => (index === sheet ? analyzeSheet(raw[index], row) : analysis)));
  }

  function confirm() {
    // Hasta saber qué hay ya en la lista no se importa (los repetidos se saltan por defecto).
    if (toImport.length === 0 || !hasName || tooMany || (existing === null && !existingFailed)) return;
    const payload = toImport;
    if (new Blob([JSON.stringify(payload)]).size > PAYLOAD_MAX) {
      setError("Hay demasiados datos para importarlos de una vez. Quitad columnas que no necesitéis (elegid «No importar») o dividid el archivo.");
      return;
    }
    setError(null);
    importId.current ??= newImportId();
    const id = importId.current;
    const skipped = built.guests.length - payload.length;
    startTransition(async () => {
      try {
        const result = await actions.importGuests(id, payload);
        if (!result.ok) {
          const origin = result.row ? built.origins[sentIndexes[result.row - 1]] : undefined;
          const where = origin ? `${chosen.length > 1 ? `Hoja «${origin.sheet}», fila ${origin.line}` : `Fila ${origin.line} del archivo`}: ` : "";
          setError(`${where}${result.error.replace(/\s*\(invitación \d+\)$/, "").replace(/^La invitación \d+ no es válida/, "No es válida")}`);
          return;
        }
        onImported(result.guests, result.people, skipped, result.repeated, payload.some((guest) => Boolean(guest.extra?.[EXCEL_TABLE_FIELD])));
      } catch {
        setError("No sabemos si se ha importado: comprobad la conexión y pulsad de nuevo. No se duplicará nadie.");
      }
    });
  }

  const preview = toImport.slice(0, 6);
  return (
    <div className="pn-xl">
      <div ref={summaryRef} tabIndex={-1} className="pn-import-summary">
        <p className="pn-tnum text-sm font-semibold">{readSummary({ rows: built.rows, guests: built.guests.length, people: built.people })}</p>
        <p className="pn-help pn-tnum">
          {[
            `«${file}»`,
            existing === null && !existingFailed ? "Buscando repetidos en vuestra lista…" : null,
            existingFailed ? "No hemos podido comparar con vuestra lista: revisad los repetidos a ojo." : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>

      {(existingDupes > 0 || batchDupes > 0 || phoneWarnings.length > 0 || otherWarnings.length > 0) && (
        <div className="pn-xl-warn">
          <p className="pn-xl-warn-title"><TriangleAlertIcon aria-hidden="true" className="size-4" />Revisad antes de importar</p>
          <ul className="pn-xl-warn-list pn-tnum">
            {existingDupes > 0 && (
              <li>
                {plural(existingDupes, "invitación ya está", "invitaciones ya están")} en vuestra lista (mismo nombre o teléfono).
                <label className="pn-xl-check">
                  <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} />
                  No importarlas otra vez
                </label>
              </li>
            )}
            {batchDupes > 0 && <li>{plural(batchDupes, "fila parece repetida", "filas parecen repetidas")} dentro del archivo: se importarán; borradlas luego si sobran.</li>}
            {phoneWarnings.length > 0 && <li>{plural(phoneWarnings.length, "teléfono no parece válido", "teléfonos no parecen válidos")}: se guardan aparte, en «(revisar)», para que los corrijáis.</li>}
            {otherWarnings.length > 0 && <li>{plural(otherWarnings.length, "aviso más", "avisos más")}.</li>}
          </ul>
          {built.warnings.length > 0 && (
            <details className="pn-xl-details">
              <summary className="pn-link">Ver el detalle</summary>
              <ul className="pn-xl-detail-list">
                {built.warnings.slice(0, 60).map((warning, index) => <li key={index}>{chosen.length > 1 && warning.sheet ? `${warning.sheet} · ` : ""}{warning.text}</li>)}
                {built.warnings.length > 60 && <li>… y {built.warnings.length - 60} más.</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {analyses.map((analysis, sheetIndex) => (
        <fieldset key={analysis.name} className="pn-xl-sheet" disabled={pending}>
          <legend className="pn-xl-legend">
            {analyses.length > 1 ? (
              <label className="pn-xl-check">
                <input type="checkbox" checked={included[sheetIndex]} onChange={(event) => setIncluded((list) => list.map((value, i) => (i === sheetIndex ? event.target.checked : value)))} />
                Hoja «{analysis.name}» <span className="pn-help pn-tnum">({plural(analysis.dataRows.length, "fila", "filas")})</span>
              </label>
            ) : <span>Columnas del archivo</span>}
          </legend>
          {included[sheetIndex] && (
            <>
              <label className="pn-xl-row-pick">
                <span className="pn-help">Fila de títulos</span>
                <select className="pn-xl-select" value={analysis.headerRow} onChange={(event) => setHeaderRow(sheetIndex, Number(event.target.value))}>
                  <option value={-1}>No hay fila de títulos</option>
                  {raw[sheetIndex].rows.slice(0, 15).map((row, rowIndex) => row.some((value) => value.trim()) && (
                    <option key={rowIndex} value={rowIndex}>{`Fila ${rowIndex + 1}: ${row.filter((value) => value.trim()).slice(0, 3).join(", ").slice(0, 50)}`}</option>
                  ))}
                </select>
              </label>
              {!analysis.mapping.includes("name") && <p className="pn-row-error">Elegid qué columna lleva el nombre de cada invitado.</p>}
              <ol className="pn-xl-cols">
                {analysis.columns.map((column) => column.stats.filled > 0 && (
                  <li key={column.index} className="pn-xl-col" data-field={column.field}>
                    <div className="pn-xl-col-head">
                      <span className="pn-xl-col-name">{column.header}</span>
                      <span className="pn-xl-col-sample">{column.samples.join(" · ")}</span>
                    </div>
                    <select className="pn-xl-select" aria-label={`Campo para la columna «${column.header}»`} value={column.field}
                      onChange={(event) => setField(sheetIndex, column.index, event.target.value as ImportField)}>
                      {IMPORT_FIELDS.map((field) => <option key={field} value={field}>{field === "custom" ? `Campo propio «${column.header.slice(0, 30)}»` : IMPORT_FIELD_LABELS[field]}</option>)}
                    </select>
                  </li>
                ))}
              </ol>
            </>
          )}
        </fieldset>
      ))}

      {preview.length > 0 && (
        <div className="pn-xl-preview">
          <p className="pn-help">Así quedarán (primeras {preview.length}):</p>
          <ul className="pn-list">
            {preview.map((guest, index) => {
              const extras = Object.keys(guest.extra).length;
              return (
                <li key={index} className="pn-xl-preview-row">
                  <span className="pn-name">{guest.name}</span>
                  <span className="pn-sub">
                    {[
                      guest.phone ?? "Sin teléfono",
                      guest.companion_names.length ? `con ${guest.companion_names.join(", ")}` : guest.companions ? `+${guest.companions}` : null,
                      guest.status === "si" ? "Confirmado" : guest.status === "no" ? "No viene" : null,
                      guest.group,
                      extras ? plural(extras, "campo propio", "campos propios") : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="pn-import-foot">
        {tooMany && <p role="alert" className="pn-row-error">Son {toImport.length.toLocaleString("es-ES")} invitaciones: como máximo {EXCEL_MAX_ROWS.toLocaleString("es-ES")} de una vez. Dividid el archivo.</p>}
        {error && <p role="alert" className="pn-row-error">{error}</p>}
        <div className="pn-import-foot-actions">
          <button type="button" className="pn-link pn-press whitespace-nowrap" disabled={pending} onClick={onBack}>
            <ChevronLeftIcon aria-hidden="true" className="size-4" />Otro archivo
          </button>
          <button type="button" className="pn-btn pn-btn--clay pn-press" disabled={pending || toImport.length === 0 || !hasName || tooMany || (existing === null && !existingFailed)} onClick={confirm}>
            {pending ? "Importando…" : toImport.length > 0 ? `Importar ${plural(toImport.length, "invitación", "invitaciones")} (${plural(importPeople, "persona", "personas")})` : "Nada que importar"}
          </button>
        </div>
      </div>
    </div>
  );
}
