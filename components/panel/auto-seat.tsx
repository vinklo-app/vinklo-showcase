"use client";

/**
 * «Sentar automáticamente» (plan maestro 8-oct-2026, §3.4): opciones, vista
 * previa y aplicar. El cálculo es puro (lib/crm/auto-seating.ts) y se hace en
 * el navegador; aplicar y deshacer son UNA llamada a apply_seating cada uno.
 * Nada se guarda hasta pulsar «Aplicar».
 *
 * Mesas con IA (9-oct-2026): la vista previa explica cada mesa con una frase
 * (plantilla al instante; la de la IA, si llega, la sustituye; a la IA solo
 * van datos anónimos: lib/crm/seating-explain.ts). Con mesas que se pasan de
 * plazas, «Liberar sitio» levanta a quien sobra (grupos enteros) para
 * recolocarlo. `autoPropose` abre directamente la propuesta (aviso
 * proactivo y «Ver propuesta»).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, InfoIcon } from "lucide-react";
import "@/components/panel/tags.css";
import { formatCount, plural } from "@/components/panel/guest-status";
import { AUTO_SEAT_DEFAULTS, autoSeat, hasAffinityData, type AutoSeatGuest, type AutoSeatOptions, type AutoSeatResult } from "@/lib/crm/auto-seating";
import { TABLE_SEATS_MAX, TABLE_SEATS_MIN, findGuestTable, hasSeatingRules, partySize, tableOccupancy, type SeatingPlan } from "@/lib/crm/seating";
import { KIDS_TABLE_EXPLANATION, buildExplainTables, sideNames, templateExplanation, withPartnerNames, type ExplainTable } from "@/lib/crm/seating-explain";
import { relieveOverfull } from "@/lib/crm/table-ops";

/** Frases de la IA por alias de mesa ({ ok: false } = quedarse con la plantilla). */
export type ExplainAction = (tables: ExplainTable[]) => Promise<{ ok: true; explanations: Record<string, string> } | { ok: false }>;

/** El plano actual en la forma que pide el algoritmo (seats = todo el grupo: el algoritmo descuenta a quien se sienta aparte). */
export function autoSeatGuests(plan: SeatingPlan): AutoSeatGuest[] {
  const all = [...plan.tables.flatMap((table) => table.guests), ...plan.unseated];
  return all.map((guest) => ({
    id: guest.id, name: guest.name, seats: partySize(guest), group: guest.group_name,
    tags: guest.tags ?? [], side: guest.side ?? null, tableId: findGuestTable(plan, guest.id), status: guest.rsvp_status,
    companions: (guest.companion_list ?? []).map((companion) => ({ id: companion.id, isKid: companion.is_kid, tableId: companion.table_id })),
  }));
}

/** Entrada completa del algoritmo a partir del plano. */
export function autoSeatInput(plan: SeatingPlan, guests: AutoSeatGuest[], options: AutoSeatOptions) {
  return {
    tables: plan.tables.map(({ id, name, seats, pinned_group }) => ({ id, name, seats, pinnedGroup: pinned_group ?? null })),
    guests, options, apart: plan.apart ?? [],
  };
}

/** Etiquetas en uso en el plano, de más a menos personas. */
function planTags(guests: readonly AutoSeatGuest[]): string[] {
  const counts = new Map<string, number>();
  for (const guest of guests) for (const tag of guest.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([tag]) => tag);
}

const REASON: Record<AutoSeatResult["unplaced"][number]["reason"], string> = {
  group_too_big: "su grupo es más grande que la mesa más grande posible (30): repartidlo vosotros",
  no_room: "no queda sitio: añadid plazas o permitid mesas nuevas",
  apart: "solo cabían junto a alguien con quien no deben sentarse: añadid una mesa",
};

export function AutoSeatPanel({ plan, listHref, pending, onApply, onCancel, autoPropose = false, explain, partners = { p1: "", p2: "" } }: {
  plan: SeatingPlan;
  /** Enlace a la lista de invitados (para etiquetar). */
  listHref: string;
  pending: boolean;
  onApply: (result: AutoSeatResult) => void;
  onCancel: () => void;
  /** Abrir ya con la propuesta (opciones por defecto). */
  autoPropose?: boolean;
  /** Frases de la IA (sin ella, solo la plantilla). */
  explain?: ExplainAction;
  /** Nombres de la pareja para «invitados de Lucía» (nunca van a la IA). */
  partners?: { p1: string; p2: string };
}) {
  const guests = useMemo(() => autoSeatGuests(plan), [plan]);
  const tags = useMemo(() => planTags(guests), [guests]);
  const overTables = plan.tables.filter((table) => tableOccupancy(table).over).length;
  const [options, setOptions] = useState<AutoSeatOptions>({ ...AUTO_SEAT_DEFAULTS, tagPriority: [] });
  const [relieve, setRelieve] = useState(true);
  const [priority, setPriority] = useState<string[]>(tags);
  const [result, setResult] = useState<AutoSeatResult | null>(null);
  /** Frase por mesa (id real): plantilla y, si llega, la de la IA. */
  const [why, setWhy] = useState<Map<string, string>>(new Map());
  const request = useRef(0);
  const affinity = hasAffinityData(guests);
  const names = new Map(guests.map((guest) => [guest.id, guest.name]));
  // Mesa infantil: solo con la migración y si alguien ha dado nombres de niños.
  const namedKids = hasSeatingRules(plan) ? guests.reduce((sum, guest) => sum + (guest.companions ?? []).filter((companion) => companion.isKid).length, 0) : 0;
  const set = (patch: Partial<AutoSeatOptions>) => { setOptions((current) => ({ ...current, ...patch })); setResult(null); };
  const move = (index: number, delta: number) => {
    setPriority((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  };

  function propose(opts: AutoSeatOptions = options, release = relieve) {
    // Mesas que se pasan: quien sobra (grupos enteros) entra en la propuesta como «sin mesa».
    const released = release && opts.keepCurrent ? new Set(relieveOverfull(plan)) : new Set<string>();
    const input = released.size > 0 ? guests.map((guest) => (released.has(guest.id) ? { ...guest, tableId: null } : guest)) : guests;
    const next = autoSeat(autoSeatInput(plan, input, { ...opts, kidsTable: Boolean(opts.kidsTable) && namedKids > 0, tagPriority: priority }));
    setResult(next);
    const { tables, aliases } = buildExplainTables(input, next, opts.includePending);
    const names = sideNames(partners.p1, partners.p2);
    const texts = new Map<string, string>();
    for (const table of next.tables) if (table.kids && table.added > 0) texts.set(table.tableId, KIDS_TABLE_EXPLANATION);
    for (const table of tables) texts.set(aliases.get(table.tableId)!, templateExplanation(table, names));
    setWhy(texts);
    if (!explain || tables.length === 0) return;
    const ticket = ++request.current;
    void explain(tables).then((response) => {
      if (ticket !== request.current || !response.ok) return;
      setWhy((current) => {
        const merged = new Map(current);
        for (const [alias, text] of Object.entries(response.explanations)) {
          const id = aliases.get(alias);
          if (id) merged.set(id, withPartnerNames(text, partners.p1, partners.p2));
        }
        return merged;
      });
    }).catch(() => { /* se queda la plantilla */ });
  }

  // «Ver propuesta» (aviso proactivo): la propuesta con las opciones por defecto, sin pasar por el formulario.
  const proposed = useRef(false);
  useEffect(() => {
    if (!autoPropose || proposed.current) return;
    proposed.current = true;
    propose();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPropose]);

  if (result) {
    const changed = result.tables.filter((table) => table.added > 0);
    const unplacedByReason = (reason: keyof typeof REASON) => result.unplaced.filter((item) => item.reason === reason);
    const nothing = result.assignments.length === 0 && result.companionAssignments.length === 0;
    return (
      <div className="grid gap-4">
        <p className="pn-help" aria-live="polite">
          {nothing
            ? "No hay a nadie más que sentar con estas opciones."
            : `Sentaríamos a ${plural(result.seatedPeople, "persona", "personas")} en ${plural(changed.length, "mesa", "mesas")}${result.newTables.length ? `, de las que ${result.newTables.length === 1 ? "una es nueva" : `${formatCount(result.newTables.length)} son nuevas`}` : ""}. Aún no se ha guardado nada.`}
        </p>
        {changed.length > 0 && (
          <ul className="pn-auto-preview" aria-label="Mesas propuestas">
            {changed.map((table) => (
              <li key={table.tableId} data-new={table.isNew || undefined}>
                <span className="pn-auto-preview-name">
                  {table.label}{table.kids ? " · Niños" : table.mainTag ? ` · ${table.mainTag}` : ""}
                  <small>{table.isNew ? "Mesa nueva" : `+${formatCount(table.added)} en esta propuesta`}</small>
                </span>
                <span className="pn-auto-preview-count">{formatCount(table.used)}/{formatCount(table.seats)}</span>
                {why.get(table.tableId) && <p className="pn-auto-why">{why.get(table.tableId)}</p>}
              </li>
            ))}
          </ul>
        )}
        {result.kidsWithFamily > 0 && (
          <p className="pn-note pn-note--warn">{result.kidsWithFamily === 1 ? "Un niño o niña no cabe en la mesa infantil: se queda con su familia." : `${formatCount(result.kidsWithFamily)} niños no caben en la mesa infantil: se quedan con su familia.`} Añadid plazas a la mesa infantil o permitid mesas nuevas.</p>
        )}
        {result.pinMissed.length > 0 && (
          <p className="pn-note pn-note--warn">No cabe en su mesa fija: {result.pinMissed.map((group) => `«${group}»`).join(", ")}. Los sentamos en otra; añadid plazas a su mesa si preferís.</p>
        )}
        {result.conflicts.length > 0 && (
          <p className="pn-note pn-note--warn">
            Siguen en la misma mesa aunque no deberían (son del mismo grupo o ya los habíais sentado juntos): {result.conflicts.slice(0, 6).map((pair) => `${names.get(pair.a) ?? "Invitado"} y ${names.get(pair.b) ?? "invitado"}`).join("; ")}{result.conflicts.length > 6 ? ` y ${formatCount(result.conflicts.length - 6)} más` : ""}.
          </p>
        )}
        {(["group_too_big", "no_room", "apart"] as const).map((reason) => {
          const list = unplacedByReason(reason);
          if (list.length === 0) return null;
          return (
            <p key={reason} className="pn-note pn-note--warn">
              Sin sitio ({REASON[reason]}): {list.slice(0, 12).map((item) => names.get(item.guestId) ?? "Invitado").join(", ")}{list.length > 12 ? ` y ${formatCount(list.length - 12)} más` : ""}.
            </p>
          );
        })}
        <div className="pn-form-actions">
          <button type="button" className="pn-btn pn-press" disabled={pending || nothing} onClick={() => onApply(result)}>{pending ? "Aplicando…" : "Aplicar"}</button>
          <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending} onClick={() => { request.current += 1; setResult(null); }}>Cambiar opciones</button>
          <button type="button" className="pn-link pn-press" disabled={pending} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <form className="pn-auto-options" onSubmit={(event) => { event.preventDefault(); propose(); }}>
      {!affinity && (
        <p className="pn-note">
          <InfoIcon aria-hidden="true" className="mr-1 inline size-4 align-[-0.15em]" />
          Sin etiquetas, solo podemos juntar a cada grupo. Etiquetad a vuestros invitados para mejores mesas. <Link href={listHref} className="pn-link">Ir a la lista</Link>
        </p>
      )}
      <fieldset>
        <legend>A quién sentar</legend>
        <label className="pn-auto-radio"><input type="radio" name="quien" checked={!options.includePending} onChange={() => set({ includePending: false })} />Solo confirmados</label>
        <label className="pn-auto-radio"><input type="radio" name="quien" checked={options.includePending} onChange={() => set({ includePending: true })} />Confirmados y pendientes</label>
      </fieldset>
      <fieldset>
        <legend>Quien ya tiene mesa</legend>
        <label className="pn-auto-radio"><input type="radio" name="actuales" checked={options.keepCurrent} onChange={() => set({ keepCurrent: true })} />Mantener a quien ya habéis sentado</label>
        <label className="pn-auto-radio"><input type="radio" name="actuales" checked={!options.keepCurrent} onChange={() => set({ keepCurrent: false })} />Reorganizar todo</label>
      </fieldset>
      {overTables > 0 && options.keepCurrent && (
        <label className="pn-auto-radio pn-auto-check">
          <input type="checkbox" checked={relieve} onChange={(event) => { setRelieve(event.target.checked); setResult(null); }} />
          <span>Liberar sitio en {overTables === 1 ? "la mesa que se pasa" : `las ${formatCount(overTables)} mesas que se pasan`}<small>Levantamos a quien sobra (siempre grupos enteros, empezando por el más pequeño que basta) y lo sentamos donde quepa.</small></span>
        </label>
      )}
      {namedKids > 0 && (
        <label className="pn-auto-radio pn-auto-check">
          <input type="checkbox" checked={Boolean(options.kidsTable)} onChange={(event) => set({ kidsTable: event.target.checked })} />
          <span>Mesa infantil: sentar juntos a los {formatCount(namedKids)} niños con nombre<small>Usamos la mesa «Mesa infantil» si ya existe; si no, la creamos. Liberan su sitio en la mesa de su familia.</small></span>
        </label>
      )}
      <label className="pn-field">
        <span>Plazas de las mesas nuevas</span>
        <input type="number" inputMode="numeric" min={TABLE_SEATS_MIN} max={TABLE_SEATS_MAX} value={options.newTableSeats}
          onChange={(event) => set({ newTableSeats: Math.min(TABLE_SEATS_MAX, Math.max(TABLE_SEATS_MIN, Number(event.target.value) || AUTO_SEAT_DEFAULTS.newTableSeats)) })} />
        <small>Si falta sitio, creamos mesas de este tamaño (un grupo más grande recibe una a su medida, hasta 30).</small>
      </label>
      {priority.length > 1 && (
        <details>
          <summary className="pn-link pn-press">Orden de prioridad de las etiquetas (opcional)</summary>
          <p className="pn-help mt-2">Si alguien tiene varias etiquetas, la de más arriba decide con quién se sienta.</p>
          <ol className="pn-auto-priority mt-2">
            {priority.map((tag, index) => (
              <li key={tag}>
                <span>{tag}</span>
                <button type="button" className="pn-seat-icon pn-press" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${tag}`}><ArrowUpIcon aria-hidden="true" className="size-4" /></button>
                <button type="button" className="pn-seat-icon pn-press" disabled={index === priority.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar ${tag}`}><ArrowDownIcon aria-hidden="true" className="size-4" /></button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="pn-help">Nunca separamos un grupo, juntamos a quien comparte etiqueta (o lado), respetamos las plazas, las mesas fijas de cada grupo y «No sentar con…» (en la ficha de cada invitado). Quedan fuera por ahora: la mesa presidencial y la forma de las mesas.</p>
      <div className="pn-form-actions">
        <button type="submit" className="pn-btn pn-press">Ver la propuesta</button>
        <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
