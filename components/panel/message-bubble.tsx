import { initials } from "@/components/panel/guest-status";

/**
 * Vista previa de un mensaje como burbuja de chat (server-safe). Es una
 * representación, no WhatsApp: sin hora, sin ticks ni «leído» (Vinklo no sabe
 * si se entrega ni si se lee). Los enlaces se subrayan pero no se pueden
 * pulsar: son de ejemplo.
 */
export function MessageBubble({ text, recipient, placeholder = "Escribid el mensaje para verlo aquí." }: { text: string; recipient: string; placeholder?: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <figure className="pn-chat" aria-label={`Vista previa del mensaje para ${recipient}`}>
      <figcaption className="pn-chat-head">
        <span className="pn-avatar pn-avatar--sm" aria-hidden="true">{initials(recipient)}</span>
        <span className="pn-chat-name">{recipient}</span>
      </figcaption>
      <div className="pn-chat-body">
        {text.trim() ? (
          <p className="pn-bubble">
            {parts.map((part, index) => (index % 2 === 1 ? <span key={index} className="pn-bubble-link">{part}</span> : part))}
          </p>
        ) : (
          <p className="pn-bubble pn-bubble--empty">{placeholder}</p>
        )}
      </div>
    </figure>
  );
}
