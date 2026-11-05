"use client";

import { createContext, useCallback, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { SparklesIcon } from "lucide-react";
import { AI_SUGGESTIONS } from "./ai-suggestions";
import "./ai-assistant.css";

// The conversation, dialog and action proxies are downloaded only after opening.
const AiAssistantDialog = dynamic(() => import("./ai-assistant-dialog").then(module => module.AiAssistantDialog), {
  ssr: false,
  loading: () => <p role="status" className="pn-ai-loading">Abriendo el asistente…</p>,
});

const AssistantContext = createContext<((message?: string) => void) | null>(null);

export function AiAssistantCard() {
  const open = useContext(AssistantContext);
  if (!open) return null;
  return <section className="pn-ai-card" aria-labelledby="ai-card-title">
    <div><p className="pn-overline"><SparklesIcon aria-hidden="true" className="size-4 inline" /> vinklo IA</p>
      <h2 id="ai-card-title" className="pn-display pn-h2">Vuestra boda, con una mano más.</h2>
      <p>Preguntad cómo van las respuestas, preparad mensajes y añadid invitados o tareas con ayuda de la IA.</p></div>
    <button type="button" className="pn-ai-open" onClick={() => open()}>¿En qué os ayudamos hoy? <span aria-hidden="true">↗</span></button>
    <div className="pn-ai-suggestions">{AI_SUGGESTIONS.map(message => <button key={message} type="button" className="pn-chip" onClick={() => open(message)}>{message}</button>)}</div>
  </section>;
}

export function AiAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; id: number }>();
  const path = usePathname();
  const show = useCallback((message?: string) => {
    if (message) setPrefill(previous => ({ text: message, id: (previous?.id ?? 0) + 1 }));
    setActivated(true);
    setOpen(true);
  }, []);
  return <AssistantContext.Provider value={show}>
    {path !== "/panel" && <div className="pn-ai-toolbar pn-wrap"><button type="button" className="pn-ai-launcher pn-btn" onClick={() => show()} aria-haspopup="dialog"><SparklesIcon className="size-4" aria-hidden="true" /> Asistente IA</button></div>}
    {children}
    {activated && <AiAssistantDialog open={open} onClose={() => setOpen(false)} prefill={prefill} />}
  </AssistantContext.Provider>;
}
