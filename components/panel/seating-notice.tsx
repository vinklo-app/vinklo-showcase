"use client";

/**
 * Aviso proactivo de las mesas (lib/crm/seating-signals.ts): sale solo,
 * sin que la pareja lo pida, cuando se termina de etiquetar, hay gente que
 * viene sin mesa, una mesa se pasa de plazas o cambian los confirmados.
 * «Ver propuesta» abre la vista previa; NUNCA aplica nada.
 *
 * Se evalúa una vez al cargar la página (no persigue a la pareja mientras
 * mueve gente). Lo ya visto se recuerda por boda en este dispositivo
 * (localStorage `vinklo:mesas:<boda>`); sin almacenamiento disponible, el
 * aviso sale en cada carga mientras haya señales.
 */
import { useEffect, useRef, useState } from "react";
import { SparklesIcon, XIcon } from "lucide-react";
import "@/components/panel/seating-ai.css";
import type { SeatingPlan } from "@/lib/crm/seating";
import { computeSignals, nextMemory, parseSeatingMemory, shouldNotify, signalLines, type SeatingMemory, type SeatingSignals } from "@/lib/crm/seating-signals";

const storageKey = (wedding: string) => `vinklo:mesas:${wedding}`;

function readMemory(key: string): SeatingMemory | null {
  try { return parseSeatingMemory(window.localStorage.getItem(key)); } catch { return null; }
}
function writeMemory(key: string, memory: SeatingMemory | null) {
  if (!memory) return;
  try { window.localStorage.setItem(key, JSON.stringify(memory)); } catch { /* sin almacenamiento: el aviso puede repetirse */ }
}

export function SeatingNotice({ plan, weddingKey, onPropose, onVisibilityChange, alreadyOpen = false }: {
  plan: SeatingPlan; weddingKey: string; onPropose: () => void;
  /** Si el aviso está a la vista (la barra baja su botón a secundario mientras tanto). */
  onVisibilityChange?: (visible: boolean) => void;
  /** La propuesta ya se abrió sola (`?propuesta=1`): cuenta como vista y no se pinta. */
  alreadyOpen?: boolean;
}) {
  const [state, setState] = useState<{ signals: SeatingSignals; memory: SeatingMemory | null } | null>(null);
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);

  // Una vez por carga, con el plano con el que se abrió la página.
  useEffect(() => {
    const key = storageKey(weddingKey);
    const memory = readMemory(key);
    const signals = computeSignals(planRef.current, memory?.snapshot ?? null);
    writeMemory(key, nextMemory(signals, memory, alreadyOpen));
    // Leer localStorage solo es posible tras montar (SSR): el aviso aparece después.
    if (!alreadyOpen && shouldNotify(signals, memory)) setState({ signals, memory });
  }, [weddingKey, alreadyOpen]);

  const visible = state !== null;
  useEffect(() => {
    onVisibilityChange?.(visible);
    return () => onVisibilityChange?.(false);
  }, [visible, onVisibilityChange]);

  if (!state) return null;
  const seen = () => { writeMemory(storageKey(weddingKey), nextMemory(state.signals, state.memory, true)); setState(null); };
  const tableName = (id: string) => plan.tables.find((table) => table.id === id)?.name ?? "Una mesa";
  const lines = signalLines(state.signals.signals, tableName);
  return (
    <section className="pn-seat-notice" aria-labelledby="aviso-mesas" role="status">
      <div className="pn-seat-notice-head">
        <p id="aviso-mesas" className="pn-seat-notice-title">Tenemos una propuesta de mesas para vosotros</p>
        <button type="button" className="pn-seat-icon pn-press" aria-label="Descartar el aviso" onClick={seen}><XIcon aria-hidden="true" className="size-4" /></button>
      </div>
      <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      <p className="pn-help m-0">La veis antes de aplicar nada y podéis deshacerla.</p>
      <div className="pn-seat-notice-actions">
        <button type="button" className="pn-btn pn-btn--sm pn-press" onClick={() => { seen(); onPropose(); }}><SparklesIcon aria-hidden="true" className="size-4" />Ver propuesta</button>
        <button type="button" className="pn-link pn-press" onClick={seen}>Ahora no</button>
      </div>
    </section>
  );
}
