"use client";

/**
 * Módulos de la web (8-oct-2026): autobuses y alojamiento. Un solo marcado
 * para la Story y la maqueta web (cambia la clase raíz y el envoltorio); el
 * formulario de asistencia pregunta por ellos (components/guest/rsvp-form).
 * En el preview los enlaces y el botón de copiar no actúan.
 */
import { useState } from "react";

import type { BusStop, Hotel } from "@/lib/site-document";
import { formatRsvpDate } from "@/lib/rsvp-window";
import type { InvitationMode } from "../types";

import "./modules.css";

export function BusStops({ stops, returnNote }: { stops: BusStop[]; returnNote: string }) {
  return (
    <div className="mod-bus">
      {stops.length > 0 && (
        <>
          <p className="mod-kicker">Ida</p>
          <ol className="mod-stops">
            {stops.map((stop) => (
              <li key={stop.id} className="mod-stop">
                {/* Sin hora no se pinta nada (nunca «—» de relleno). */}
                {stop.time && <span className="mod-stop-time font-display">{stop.time}</span>}
                <span className="mod-stop-text">
                  <b>{stop.name}</b>
                  {stop.place && <small>{stop.place}</small>}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {returnNote && (
        <>
          <p className="mod-kicker">Vuelta</p>
          <p className="mod-return">{returnNote}</p>
        </>
      )}
    </div>
  );
}

export function HotelList({ hotels, mode, now }: { hotels: Hotel[]; mode: InvitationMode; now?: Date }) {
  return (
    <ul className="mod-hotels" data-count={hotels.length}>
      {hotels.map((hotel) => (
        <li key={hotel.id} className="mod-hotel">
          <p className="mod-hotel-name font-display">{hotel.name}</p>
          {hotel.note && <p className="mod-hotel-note">{hotel.note}</p>}
          {(hotel.code || hotel.bookBy) && (
            <div className="mod-hotel-meta">
              {hotel.code && <CopyCode code={hotel.code} mode={mode} />}
              {hotel.bookBy && <span className="mod-hotel-by">Reserva antes del {formatRsvpDate(hotel.bookBy, now)}</span>}
            </div>
          )}
          {hotel.link &&
            (mode === "public" ? (
              <a href={hotel.link} target="_blank" rel="noopener noreferrer" className="mod-hotel-link">Reservar en su web</a>
            ) : (
              <span aria-disabled="true" className="mod-hotel-link">Reservar en su web</span>
            ))}
        </li>
      ))}
    </ul>
  );
}

/** Código de descuento: se copia con un toque (en el preview, solo se muestra). */
function CopyCode({ code, mode }: { code: string; mode: InvitationMode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="mod-code">
      <span className="mod-code-label">Código</span>
      <b className="mod-code-value">{code}</b>
      {mode === "public" && (
        <button type="button" className="mod-code-copy" onClick={copy} aria-live="polite">
          {copied ? "Copiado" : "Copiar"}
        </button>
      )}
    </span>
  );
}
