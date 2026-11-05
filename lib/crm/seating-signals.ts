/**
 * Avisos proactivos de las mesas (mesas con IA, 9-oct-2026). Puro y
 * determinista: decide CUÁNDO ofrecer «Ver propuesta» sin que la pareja lo
 * pida. Nunca aplica nada; solo abre la vista previa.
 *
 * Señales:
 *  - tagged: se ha terminado de etiquetar (antes había invitados sin
 *    etiqueta y ahora ninguno de los que pueden venir).
 *  - unseated: hay personas que vienen sin mesa.
 *  - over: alguna mesa supera sus plazas.
 *  - confirmed: ha cambiado el número de personas confirmadas desde la
 *    última vez que se vio o descartó el aviso.
 *
 * El «recuerdo» (`SeatingMemory`) se guarda por boda en el dispositivo
 * (localStorage, ver components/panel/seating-notice.tsx): el aviso sale una
 * vez por cada cambio. En otro dispositivo puede salir una vez más; es
 * aceptable y no exige migración.
 */
import { partySize, tableOccupancy, unseatedAttending, type SeatingPlan } from "@/lib/crm/seating";

export interface SeatingSnapshot {
  /** Personas que vienen (invitado + acompañantes de los «si»). */
  confirmed: number;
  /** Invitaciones que pueden venir (no «no») sin ninguna etiqueta. */
  untagged: number;
  /** Invitaciones que pueden venir con alguna etiqueta. */
  tagged: number;
}

export type SeatingSignal =
  | { kind: "tagged"; guests: number }
  | { kind: "unseated"; people: number }
  | { kind: "over"; tables: string[] }
  | { kind: "confirmed"; before: number; now: number };

export interface SeatingSignals {
  signals: SeatingSignal[];
  snapshot: SeatingSnapshot;
  /** Identifica esta combinación de señales: si cambia, el aviso vuelve a salir. "" = sin señales. */
  fingerprint: string;
}

/** Lo que se recuerda por boda: el último aviso visto o descartado y la foto de entonces. */
export interface SeatingMemory {
  fingerprint: string;
  snapshot: SeatingSnapshot;
}

export function seatingSnapshot(plan: SeatingPlan): SeatingSnapshot {
  let confirmed = 0, untagged = 0, tagged = 0;
  for (const guest of [...plan.tables.flatMap((table) => table.guests), ...plan.unseated]) {
    confirmed += partySize(guest);
    if (guest.rsvp_status === "no") continue;
    if ((guest.tags ?? []).length > 0) tagged += 1; else untagged += 1;
  }
  return { confirmed, untagged, tagged };
}

export function computeSignals(plan: SeatingPlan, previous: SeatingSnapshot | null): SeatingSignals {
  const snapshot = seatingSnapshot(plan);
  const signals: SeatingSignal[] = [];
  if (previous && previous.untagged > 0 && snapshot.untagged === 0 && snapshot.tagged > 0) signals.push({ kind: "tagged", guests: snapshot.tagged });
  const unseated = unseatedAttending(plan);
  if (unseated > 0) signals.push({ kind: "unseated", people: unseated });
  const over = plan.tables.filter((table) => tableOccupancy(table).over).map((table) => table.id).sort();
  if (over.length > 0) signals.push({ kind: "over", tables: over });
  if (previous && previous.confirmed !== snapshot.confirmed) signals.push({ kind: "confirmed", before: previous.confirmed, now: snapshot.confirmed });
  const fingerprint = signals.map((signal) => {
    switch (signal.kind) {
      case "tagged": return `t${signal.guests}`;
      case "unseated": return `u${signal.people}`;
      case "over": return `o${signal.tables.join(",")}`;
      case "confirmed": return `c${signal.before}>${signal.now}`;
    }
  }).join("|");
  return { signals, snapshot, fingerprint };
}

/** ¿Se enseña el aviso? Solo si hay señales y no son las mismas que ya se vieron o descartaron. */
export function shouldNotify(current: SeatingSignals, memory: SeatingMemory | null): boolean {
  return current.signals.length > 0 && current.fingerprint !== memory?.fingerprint;
}

/**
 * Qué recordar tras esta visita:
 *  - `seen` (descartado, «Ver propuesta» o aplicado): esta combinación y la foto actual.
 *  - Sin aviso a la vista: se actualiza la foto en silencio (para detectar el
 *    siguiente cambio), conservando el último aviso visto.
 *  - Con un aviso pendiente: nada cambia (vuelve a salir en la próxima visita).
 */
export function nextMemory(current: SeatingSignals, memory: SeatingMemory | null, seen: boolean): SeatingMemory | null {
  if (seen) return { fingerprint: current.fingerprint, snapshot: current.snapshot };
  if (shouldNotify(current, memory)) return memory;
  return { fingerprint: memory?.fingerprint ?? "", snapshot: current.snapshot };
}

/** Lectura tolerante del recuerdo guardado (JSON del dispositivo). */
export function parseSeatingMemory(raw: string | null): SeatingMemory | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SeatingMemory> | null;
    const s = value?.snapshot;
    const num = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
    if (!value || typeof value.fingerprint !== "string" || !s || !num(s.confirmed) || !num(s.untagged) || !num(s.tagged)) return null;
    return { fingerprint: value.fingerprint, snapshot: { confirmed: s.confirmed, untagged: s.untagged, tagged: s.tagged } };
  } catch {
    return null;
  }
}

const people = (n: number) => (n === 1 ? "1 persona" : `${n.toLocaleString("es-ES")} personas`);

/** Frases del aviso, en el orden de las señales. `tableName` traduce ids a nombres. */
export function signalLines(signals: readonly SeatingSignal[], tableName: (id: string) => string): string[] {
  return signals.map((signal) => {
    switch (signal.kind) {
      case "tagged": return "Habéis terminado de etiquetar a vuestros invitados.";
      case "unseated": return signal.people === 1 ? "1 persona que viene aún no tiene mesa." : `${people(signal.people)} que vienen aún no tienen mesa.`;
      case "over": return signal.tables.length === 1 ? `${tableName(signal.tables[0]!)} supera sus plazas.` : `${signal.tables.length} mesas superan sus plazas.`;
      case "confirmed": return `Han cambiado los confirmados: de ${people(signal.before)} a ${people(signal.now)}.`;
    }
  });
}
