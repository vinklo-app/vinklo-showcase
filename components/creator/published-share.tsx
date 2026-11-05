"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, MessageCircleIcon } from "lucide-react";
import { publishedShareText, whatsappShareUrl } from "@/lib/invitation-sharing";

/**
 * El enlace público recién publicado y lo que se hace con él (/onboarding/listo):
 * verlo (pestaña nueva), copiarlo y mandarlo por WhatsApp. Nada se envía solo.
 */
export function PublishedShare({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  // Sin portapapeles (permisos, navegador antiguo): se dice y se copia a mano.
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Sin portapapeles: el enlace sigue escrito arriba para copiarlo a mano.
      setCopyFailed(true);
      return;
    }
    setCopyFailed(false);
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return <section className="wb-done-share" aria-label="Vuestro enlace">
    <p className="wb-done-url" translate="no">{url}</p>
    <div className="wb-done-share-actions">
      <a href={url} target="_blank" rel="noopener noreferrer" className="wb-secondary" aria-label="Ver vuestra web (se abre en otra pestaña)">
        <ExternalLinkIcon aria-hidden="true" size={16} strokeWidth={1.75} />Ver
      </a>
      <button type="button" className="wb-secondary" onClick={copy}>
        {copied ? <CheckIcon aria-hidden="true" size={16} strokeWidth={2} /> : <CopyIcon aria-hidden="true" size={16} strokeWidth={1.75} />}
        {copied ? "Copiado" : "Copiar enlace"}
      </button>
      <a href={whatsappShareUrl(publishedShareText(url))} target="_blank" rel="noopener noreferrer" className="wb-secondary" aria-label="Compartir por WhatsApp (se abre en otra pestaña)">
        <MessageCircleIcon aria-hidden="true" size={16} strokeWidth={1.75} />Compartir por WhatsApp
      </a>
    </div>
    <span role="status" className={copyFailed ? "wb-done-copy-note" : "sr-only"}>{copied ? "Enlace copiado" : copyFailed ? "No se ha podido copiar: seleccionad el enlace de arriba y copiadlo a mano." : ""}</span>
  </section>;
}
