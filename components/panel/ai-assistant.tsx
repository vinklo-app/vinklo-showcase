"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowUpIcon, SparklesIcon } from "lucide-react";
import type { CrmAssistantResult, CrmProposal } from "@/lib/ai/crm-contract";

export interface AssistantTurn { id: string; message: string; result: CrmAssistantResult; applied?: string; error?: string }

export function AiAssistantProposal({ proposal, pending, applied, onApply, onCopy }: {
  proposal: CrmProposal; pending?: boolean; applied?: string; onApply: () => void; onCopy: (text: string) => void;
}) {
  if (applied) return <p role="status" className="pn-ai-applied">✓ {applied}</p>;
  const draft = proposal.kind === "draft-message";
  return <div className="pn-ai-proposal">
    <p className="pn-overline">{draft ? "Borrador de mensaje" : "Revisad antes de añadir"}</p>
    {proposal.kind === "add-guest" ? <><strong>{proposal.name}</strong><p>Invitado pendiente · hasta {proposal.companions} acompañantes</p></> : <p className="pn-ai-text">{proposal.kind === "add-task" ? proposal.title : proposal.text}</p>}
    <button type="button" className="pn-btn pn-btn--primary" disabled={pending} onClick={() => draft ? onCopy(proposal.text) : onApply()}>
      {draft ? "Copiar mensaje" : pending ? "Añadiendo…" : proposal.kind === "add-task" ? "Añadir tarea" : "Añadir invitado"}
    </button>
    {draft && <p className="pn-help">Vosotros decidís cuándo y a quién enviarlo.</p>}
  </div>;
}

export function AiAssistantConversation({ turns, pending, applying, onApply, onCopy }: {
  turns: AssistantTurn[]; pending?: boolean; applying?: string; onApply: (id: string) => void; onCopy: (text: string) => void;
}) {
  return <div className="pn-ai-conversation" aria-label="Conversación con el asistente">
    {turns.map(turn => <article key={turn.id} className="pn-ai-turn">
      <p className="pn-ai-question">{turn.message}</p>
      {turn.result.ok ? <><p className="pn-ai-text">{turn.result.answer}</p>
        {turn.result.link && <Link className="pn-link" href={turn.result.link.href}>{turn.result.link.label} →</Link>}
        {turn.result.proposal && <AiAssistantProposal proposal={turn.result.proposal} pending={Boolean(applying)} applied={turn.applied} onApply={() => onApply(turn.id)} onCopy={onCopy} />}
      </> : <p role="alert" className="pn-row-error">{turn.result.error}</p>}
      {turn.error && <p role="alert" className="pn-row-error">{turn.error}</p>}
    </article>)}
    {pending && <p role="status" className="pn-help">Consultando vuestra boda…</p>}
  </div>;
}

export function AiAssistantComposer({ value, onChange, onSubmit, pending }: { value: string; onChange: (value: string) => void; onSubmit: () => void; pending?: boolean }) {
  const id = useId();
  return <form className="pn-ai-composer" onSubmit={event => { event.preventDefault(); if (!pending && value.trim()) onSubmit(); }}>
    <label htmlFor={id}>Pedid ayuda con vuestra boda</label>
    <div className="pn-ai-input"><textarea id={id} value={value} maxLength={1200} rows={3} disabled={pending} placeholder="¿Cuántos invitados faltan por responder?" onChange={event => onChange(event.target.value)} />
      <button type="submit" className="pn-btn pn-btn--primary" disabled={pending || !value.trim()} aria-label={pending ? "Consultando…" : "Consultar al asistente"}><ArrowUpIcon className="size-5" aria-hidden="true" /><span className="sr-only">{pending ? "Consultando…" : "Consultar"}</span></button>
    </div>
    <p className="pn-help"><SparklesIcon className="size-3 inline" aria-hidden="true" /> IA de vinklo · Comprobad las respuestas. Cada petición es independiente.</p>
  </form>;
}
