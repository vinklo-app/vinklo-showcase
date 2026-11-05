"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { askCrmAssistant, applyCrmAssistantProposal } from "@/lib/ai/crm-actions";
import { GuestSheet } from "./guest-sheet";
import { AiAssistantComposer, AiAssistantConversation, type AssistantTurn } from "./ai-assistant";
import { AI_SUGGESTIONS } from "./ai-suggestions";

export function AiAssistantDialog({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: { text: string; id: number } }) {
  const [message, setMessage] = useState(prefill?.text ?? "");
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState<string>();
  const busy = useRef(false);
  const applied = useRef(new Set<string>());
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => { if (prefill) setMessage(prefill.text); }, [prefill]);
  useEffect(() => { if (open) bottom.current?.scrollIntoView({ block: "nearest" }); }, [open, turns.length, pending]);
  async function submit() {
    const text = message.trim();
    if (busy.current || !text) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await askCrmAssistant(text);
      setTurns(list => [...list.slice(-19), { id: crypto.randomUUID(), message: text, result }]);
    } catch { setMessage(text); toast("No hemos podido consultar la IA. Probad de nuevo."); }
    finally { busy.current = false; setPending(false); }
  }
  async function apply(id: string) {
    const turn = turns.find(item => item.id === id);
    if (busy.current || applied.current.has(id) || !turn?.result.ok || !turn.result.proposal || !turn.result.receipt) return;
    busy.current = true; setApplying(id);
    try {
      const result = await applyCrmAssistantProposal(turn.result.proposal, turn.result.receipt);
      if (result.ok) { applied.current.add(id); router.refresh(); }
      setTurns(list => list.map(item => item.id === id ? { ...item, applied: result.ok ? result.message : undefined, error: result.ok ? undefined : result.error } : item));
    } catch { setTurns(list => list.map(item => item.id === id ? { ...item, error: "No podemos confirmar si se ha añadido. Revisad el panel antes de reintentarlo." } : item)); }
    finally { busy.current = false; setApplying(undefined); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast("Mensaje copiado"); }
    catch { toast("No hemos podido copiarlo. Seleccionad el texto para copiarlo."); }
  }
  return (
    <GuestSheet open={open} onClose={onClose} title="vinklo · Asistente IA" wide>
      <p className="pn-help">Usamos recuentos de vuestra boda y lo que escribáis aquí. Evitad incluir datos de salud o información sensible.</p>
      {turns.length === 0 && <div className="pn-ai-welcome"><h3 className="pn-display pn-h2">Contadnos qué necesitáis.</h3><p>Podemos consultar el resumen, preparar un mensaje o proponer un invitado o una tarea. Revisáis cada cambio antes de añadirlo.</p>
        <div className="pn-ai-suggestions">{AI_SUGGESTIONS.map(text => <button key={text} type="button" className="pn-chip" disabled={pending || Boolean(applying)} onClick={() => setMessage(text)}>{text}</button>)}</div></div>}
      <AiAssistantConversation turns={turns} pending={pending} applying={applying} onApply={apply} onCopy={copy} />
      <div ref={bottom} />
      <AiAssistantComposer value={message} onChange={setMessage} pending={pending || Boolean(applying)} onSubmit={submit} />
      {turns.length > 0 && <button type="button" className="pn-link" disabled={pending || Boolean(applying)} onClick={() => { setTurns([]); applied.current.clear(); }}>Borrar esta conversación</button>}
    </GuestSheet>
  );
}
