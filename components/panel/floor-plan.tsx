"use client";

/**
 * Plano del salón (mesas con IA, 9-oct-2026).
 *  - `FloorPlanMap`: dibujo pequeño de las mesas según su posición (0–1).
 *  - `FloorPlanPanel`: subir una foto o captura del plano → la IA lee las
 *    mesas → «Revisar mesas detectadas» (nombre, plazas, forma, quitar,
 *    añadir) → guardar. La imagen se prepara en el navegador (≤ 2000 px,
 *    JPEG, sin EXIF: photo-prepare) y el servidor solo la usa en memoria.
 *    Sin foto, se puede partir de las mesas actuales y colocarlas a mano.
 */
import { useId, useRef, useState } from "react";
import { ImageUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import "@/components/panel/seating-ai.css";
import { PHOTO_ACCEPT, preparePhoto } from "@/components/creator/photo-prepare";
import { formatCount, plural } from "@/components/panel/guest-status";
import { floorPlanRowsError, matchExistingTables, toSaveRows, type DetectedTable, type FloorPlanReading, type FloorSaveRow, type SavedFloorTable } from "@/lib/crm/floor-plan";
import {
  TABLE_NAME_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, TABLE_SEATS_MIN, TABLE_SHAPES, TABLE_SHAPE_LABELS, nextTableName, tableOccupancy,
  type SeatTable, type TableShape,
} from "@/lib/crm/seating";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface FloorPlanActions {
  read(form: FormData): Promise<Result<{ reading: FloorPlanReading }>>;
  save(rows: FloorSaveRow[]): Promise<Result<{ tables: SavedFloorTable[] }>>;
}

export interface MapTable { key: string; name: string; shape: TableShape | null; x: number | null; y: number | null; label?: string; warn?: boolean }

/** Número corto de la mesa para el dibujo («Mesa 12» → «12»; «Presidencial» → «P»). */
function shortLabel(name: string): string {
  const number = name.match(/(\d{1,3})\s*$/);
  return number ? number[1]! : name.trim().charAt(0).toLocaleUpperCase("es");
}

export function FloorPlanMap({ tables, title = "Plano del salón" }: { tables: readonly MapTable[]; title?: string }) {
  const placed = tables.filter((table) => table.x !== null && table.y !== null);
  if (placed.length === 0) return null;
  return (
    <figure className="pn-floor-map" aria-label={title}>
      <div className="pn-floor-canvas">
        {placed.map((table) => (
          <span key={table.key} className="pn-floor-table" data-shape={table.shape ?? "redonda"} data-warn={table.warn || undefined}
            style={{ left: `${(table.x! * 100).toFixed(2)}%`, top: `${(table.y! * 100).toFixed(2)}%` }} title={table.label ? `${table.name} · ${table.label}` : table.name}>
            <span aria-hidden="true">{shortLabel(table.name)}</span>
            <span className="sr-only">{table.name}{table.label ? `, ${table.label}` : ""}</span>
          </span>
        ))}
      </div>
      <figcaption className="pn-help">{placed.length === tables.length ? "Posición aproximada de cada mesa." : `Posición aproximada de ${plural(placed.length, "mesa", "mesas")}; el resto, sin posición.`}</figcaption>
    </figure>
  );
}

/** Mesas del plano actual como filas editables (para colocarlas sin foto). */
function rowsFromTables(tables: readonly SeatTable[]): DetectedTable[] {
  return tables.map((table, index) => ({
    key: `e${index + 1}`, id: table.id, name: table.name, seats: table.seats, shape: table.shape ?? "redonda",
    x: typeof table.pos_x === "number" ? table.pos_x : null, y: typeof table.pos_y === "number" ? table.pos_y : null,
  }));
}

type Step = { kind: "start" } | { kind: "reading" } | { kind: "review"; rows: DetectedTable[]; notes: string; fromPhoto: boolean };

export function FloorPlanPanel({ tables, actions, onSaved, onCancel, initialReading }: {
  tables: SeatTable[];
  actions: FloorPlanActions;
  onSaved: (saved: SavedFloorTable[]) => void;
  onCancel: () => void;
  /** Solo el borrador: empieza ya en la revisión. */
  initialReading?: FloorPlanReading;
}) {
  const [step, setStep] = useState<Step>(() => (initialReading
    ? { kind: "review", rows: matchExistingTables(initialReading.tables, tables), notes: initialReading.notes, fromPhoto: true }
    : { kind: "start" }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const counter = useRef(1000);
  const inputId = useId();

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStep({ kind: "reading" });
    const prepared = await preparePhoto(file);
    if (!prepared.ok) { setError(prepared.error); setStep({ kind: "start" }); return; }
    const form = new FormData();
    form.set("plano", new File([prepared.photo.blob], "plano.jpg", { type: "image/jpeg" }));
    const result = await actions.read(form);
    if (fileRef.current) fileRef.current.value = "";
    if (!result.ok) { setError(result.error); setStep({ kind: "start" }); return; }
    setStep({ kind: "review", rows: matchExistingTables(result.reading.tables, tables), notes: result.reading.notes, fromPhoto: true });
  }

  if (step.kind !== "review") {
    return (
      <div className="grid gap-4">
        <p className="pn-help">Subid una foto o captura del plano con la disposición de las mesas. Leemos cada mesa (número o nombre, forma, plazas y dónde está) y os la enseñamos para que la corrijáis antes de guardar.</p>
        <label htmlFor={inputId} className="pn-floor-drop" data-busy={step.kind === "reading" || undefined}>
          <ImageUpIcon aria-hidden="true" className="size-6" />
          <span>{step.kind === "reading" ? "Leyendo el plano… (unos segundos)" : "Elegir la foto o captura del plano"}</span>
          <small>JPG, PNG o WebP. La reducimos en vuestro dispositivo y le quitamos los datos de ubicación.</small>
          <input ref={fileRef} id={inputId} type="file" accept={PHOTO_ACCEPT} className="sr-only" disabled={step.kind === "reading"} onChange={(event) => void upload(event.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="pn-note pn-note--warn">{error}</p>}
        <p className="pn-help">Privacidad: la imagen se envía a Google (Gemini) solo para leer las mesas y no se guarda. Antes de subirla, comprobad que no lleva nombres de invitados.</p>
        <div className="pn-form-actions">
          {tables.length > 0 && (
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={step.kind === "reading"}
              onClick={() => setStep({ kind: "review", rows: rowsFromTables(tables), notes: "", fromPhoto: false })}>
              Sin foto: revisar vuestras {formatCount(tables.length)} mesas
            </button>
          )}
          <button type="button" className="pn-link pn-press" onClick={onCancel}>Cancelar</button>
        </div>
        {tables.length === 0 && <p className="pn-help">Si no subís nada, «Sentar automáticamente» crea las mesas que falten (de 10 plazas, o las que elijáis).</p>}
      </div>
    );
  }

  const rows = step.rows;
  const setRows = (next: DetectedTable[]) => { setStep({ ...step, rows: next }); setError(null); };
  const update = (key: string, patch: Partial<DetectedTable>) => setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const problem = floorPlanRowsError(rows, tables);
  const updates = rows.filter((row) => row.id).length;
  const creates = rows.length - updates;

  async function save() {
    if (problem) { setError(problem); return; }
    setSaving(true);
    try {
      const result = await actions.save(toSaveRows(rows));
      if (!result.ok) { setError(result.error); return; }
      onSaved(result.tables);
    } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-4">
      <h3 className="pn-h3 m-0">{step.fromPhoto ? "Revisar mesas detectadas" : "Revisar vuestras mesas"}</h3>
      <p className="pn-help" aria-live="polite">
        {step.fromPhoto ? `Hemos leído ${plural(rows.length, "mesa", "mesas")}. ` : ""}
        Corregid lo que haga falta. {creates > 0 ? `Se crearán ${plural(creates, "mesa nueva", "mesas nuevas")}` : "No se crea ninguna mesa"}{updates > 0 ? ` y se actualizarán ${plural(updates, "mesa que ya teníais", "mesas que ya teníais")}` : ""}; las demás no cambian. Nadie cambia de mesa.
      </p>
      {step.notes && <p className="pn-note">{step.notes}</p>}
      <FloorPlanMap tables={rows.map((row) => ({ key: row.key, name: row.name, shape: row.shape, x: row.x, y: row.y, label: `${row.seats} plazas` }))} title="Vista previa del plano" />
      <ul className="pn-floor-rows" aria-label="Mesas del plano">
        {rows.map((row) => (
          <li key={row.key} className="pn-floor-row">
            <label className="pn-field pn-floor-name">
              <span>Mesa{row.id ? " (ya la teníais)" : " (nueva)"}</span>
              <input value={row.name} maxLength={TABLE_NAME_MAX} onChange={(event) => update(row.key, { name: event.target.value })} />
            </label>
            <label className="pn-field pn-floor-seats">
              <span>Plazas</span>
              <input type="number" inputMode="numeric" min={TABLE_SEATS_MIN} max={TABLE_SEATS_MAX} value={row.seats}
                onChange={(event) => update(row.key, { seats: Math.min(TABLE_SEATS_MAX, Math.max(TABLE_SEATS_MIN, Math.round(Number(event.target.value)) || TABLE_SEATS_DEFAULT)) })} />
            </label>
            <label className="pn-field pn-floor-shape">
              <span>Forma</span>
              <select value={row.shape} onChange={(event) => update(row.key, { shape: event.target.value as TableShape })}>
                {TABLE_SHAPES.map((shape) => <option key={shape} value={shape}>{TABLE_SHAPE_LABELS[shape]}</option>)}
              </select>
            </label>
            <button type="button" className="pn-seat-icon pn-press pn-floor-remove" aria-label={`Quitar ${row.name || "esta mesa"} de la lista`} onClick={() => setRows(rows.filter((item) => item.key !== row.key))}>
              <Trash2Icon aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start"
        onClick={() => { counter.current += 1; setRows([...rows, { key: `n${counter.current}`, id: null, name: nextTableName([...tables, ...rows]), seats: TABLE_SEATS_DEFAULT, shape: "redonda", x: null, y: null }]); }}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir una mesa
      </button>
      {(error || problem) && <p role="alert" className="pn-note pn-note--warn">{error ?? problem}</p>}
      <div className="pn-form-actions">
        <button type="button" className="pn-btn pn-press" disabled={saving || Boolean(problem)} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar las mesas"}</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={saving} onClick={() => { setError(null); setStep({ kind: "start" }); }}>Subir otra imagen</button>
        <button type="button" className="pn-link pn-press" disabled={saving} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** Mesas del plano con su ocupación, para dibujarlas encima de las tarjetas. */
export function mapTablesOf(tables: readonly SeatTable[]): MapTable[] {
  return tables.map((table) => {
    const occ = tableOccupancy(table);
    return {
      key: table.id, name: table.name, shape: table.shape ?? null,
      x: typeof table.pos_x === "number" ? table.pos_x : null, y: typeof table.pos_y === "number" ? table.pos_y : null,
      label: `${formatCount(occ.attending)}/${formatCount(table.seats)}`, warn: occ.over,
    };
  });
}
