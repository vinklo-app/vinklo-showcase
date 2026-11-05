import type { InvitationMode } from "../types";
import { buildGoogleCalendarUrl, buildWeddingIcs, icsDataUrl, icsFileName, mapsUrl } from "../format";

export interface WeddingActionsData {
  partnerName1: string;
  partnerName2: string;
  weddingDate: string;
  time: string;
  venue: string;
  address: string;
  /** place_id de Google (sugerencia elegida): «Ver en el mapa» abre el sitio exacto. */
  placeId?: string;
  /** Horas del programa: alargan el evento si acaba más tarde de inicio + 8 h. */
  programTimes?: readonly string[];
  /**
   * Ruta del .ics de la web publicada (/b/[slug]/calendario.ics). En la web
   * pública «Añadir al calendario» la abre (text/calendar, inline): los
   * navegadores de WhatsApp e Instagram ignoran los `data:` con `download`.
   * Sin ella, el `data:` de siempre.
   */
  calendarHref?: string;
}

export interface WeddingActionsProps {
  data: WeddingActionsData;
  mode: InvitationMode;
  /** "photo": sobre la foto de portada (texto papel sobre velo de tinta). */
  tone?: "paper" | "photo";
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

/**
 * «Añadir al calendario» (.ics de la ruta pública o, sin ella, generado a partir del documento) y
 * «Ver en el mapa» (Google Maps con el lugar/dirección escritos por la pareja).
 * La etiqueta no es «Cómo llegar» para no confundirla con los enlaces por
 * momento de la agenda (que ya usan ese texto). Solo aparece lo que se puede construir con datos reales: sin fecha no hay
 * calendario; sin lugar ni dirección no hay mapa. En el preview no navegan.
 */
export function WeddingActions({ data, mode, tone = "paper" }: WeddingActionsProps) {
  const ics = buildWeddingIcs(data);
  const gcal = buildGoogleCalendarUrl(data);
  const maps = mapsUrl(data.venue, data.address, data.placeId);
  if (!ics && !maps) return null;

  const items: Array<{ key: string; label: string; icon: React.ReactNode; href: string; download?: string; external?: boolean }> = [];
  if (ics) {
    items.push({
      key: "calendar",
      label: "Añadir al calendario",
      icon: <CalendarIcon />,
      ...(data.calendarHref
        ? { href: data.calendarHref }
        : { href: icsDataUrl(ics), download: icsFileName(data.partnerName1, data.partnerName2) }),
    });
  }
  if (gcal) items.push({ key: "gcal", label: "Google Calendar", icon: <CalendarIcon />, href: gcal, external: true });
  if (maps) items.push({ key: "maps", label: "Ver en el mapa", icon: <PinIcon />, href: maps, external: true });

  return (
    <div className="sp-actions" data-tone={tone}>
      {items.map((item) =>
        mode === "public" ? (
          <a
            key={item.key}
            className="sp-action"
            data-action={item.key}
            href={item.href}
            download={item.download}
            target={item.external ? "_blank" : undefined}
            rel={item.external ? "noopener noreferrer" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ) : (
          <span key={item.key} className="sp-action" data-action={item.key} aria-disabled="true">
            {item.icon}
            <span>{item.label}</span>
          </span>
        ),
      )}
    </div>
  );
}
