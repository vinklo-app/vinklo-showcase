"use client";

/**
 * Datos de autobuses y hoteles en el paso «Vuestra gente» del creador
 * (8-oct-2026): se piden justo al activar el módulo. Todo opcional: lo que
 * quede vacío no se enseña a los invitados (la escena se oculta y, sin
 * paradas, el formulario no pregunta por el autobús); se completa después en
 * el panel. Nada se inventa: solo lo que escribe la pareja.
 */
import { PlusIcon, Trash2Icon } from "lucide-react";
import { SITE_MAX_BUS_STOPS, SITE_MAX_HOTELS } from "@/lib/site-document";
import { builderBusStops, builderHotels, httpsLink, type BuilderBusStop, type BuilderDraft, type BuilderHotel } from "@/lib/wedding-builder";

type Patch = (values: Partial<BuilderDraft>) => void;

export function BusDetails({ draft, onChange }: { draft: BuilderDraft; onChange: Patch }) {
  const saved = builderBusStops(draft);
  const stops: BuilderBusStop[] = saved.length > 0 ? saved : [{ name: "", time: "", place: "" }];
  const back = draft.busReturn ?? { time: "", place: "" };
  const set = (next: BuilderBusStop[]) => onChange({ busStops: next });
  const patchStop = (index: number, values: Partial<BuilderBusStop>) => set(stops.map((stop, i) => (i === index ? { ...stop, ...values } : stop)));
  return (
    <fieldset className="wb-subform">
      <legend>Autobuses</legend>
      <p className="wb-help">Desde dónde salen y a qué hora. Si aún no lo sabéis, dejadlo en blanco: no se enseña nada hasta que lo completéis.</p>
      <ol className="wb-rows">
        {stops.map((stop, index) => (
          <li key={index} className="wb-row">
            <div className="wb-row-fields">
              <label>Salida {stops.length > 1 ? index + 1 : ""}<input maxLength={80} value={stop.name} onChange={(event) => patchStop(index, { name: event.target.value })} placeholder="Por ejemplo, Plaza de Castilla" /></label>
              <div className="wb-field-pair">
                <label>Hora de salida<input type="time" value={stop.time} onChange={(event) => patchStop(index, { time: event.target.value })} /></label>
                <label>Punto exacto (opcional)<input maxLength={160} value={stop.place} onChange={(event) => patchStop(index, { place: event.target.value })} placeholder="Junto a la boca de metro" /></label>
              </div>
            </div>
            {stops.length > 1 && <button type="button" className="wb-row-remove" aria-label={`Quitar la salida ${index + 1}`} onClick={() => set(stops.filter((_, i) => i !== index))}><Trash2Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>}
          </li>
        ))}
      </ol>
      {stops.length < SITE_MAX_BUS_STOPS && <button type="button" className="wb-add" onClick={() => set([...stops, { name: "", time: "", place: "" }])}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir otra salida</button>}
      <div className="wb-field-pair">
        <label>Vuelta (hora)<input type="time" value={back.time} onChange={(event) => onChange({ busReturn: { ...back, time: event.target.value } })} /></label>
        <label>Vuelta desde (opcional)<input maxLength={120} value={back.place} onChange={(event) => onChange({ busReturn: { ...back, place: event.target.value } })} placeholder="La puerta de la finca" /></label>
      </div>
    </fieldset>
  );
}

export function HotelDetails({ draft, onChange }: { draft: BuilderDraft; onChange: Patch }) {
  const saved = builderHotels(draft);
  const hotels: BuilderHotel[] = saved.length > 0 ? saved : [{ name: "", code: "", link: "" }];
  const set = (next: BuilderHotel[]) => onChange({ stayHotels: next });
  const patchHotel = (index: number, values: Partial<BuilderHotel>) => set(hotels.map((hotel, i) => (i === index ? { ...hotel, ...values } : hotel)));
  return (
    <fieldset className="wb-subform">
      <legend>Hoteles</legend>
      <p className="wb-help">Los que recomendáis a vuestros invitados. El código de descuento y el enlace son opcionales.</p>
      <ol className="wb-rows">
        {hotels.map((hotel, index) => {
          const badLink = hotel.link.trim() !== "" && !httpsLink(hotel.link);
          return (
            <li key={index} className="wb-row">
              <div className="wb-row-fields">
                <label>Hotel {hotels.length > 1 ? index + 1 : ""}<input maxLength={80} value={hotel.name} onChange={(event) => patchHotel(index, { name: event.target.value })} placeholder="Por ejemplo, Hotel Los Olivos" /></label>
                <div className="wb-field-pair">
                  <label>Código (opcional)<input maxLength={40} autoCapitalize="characters" value={hotel.code} onChange={(event) => patchHotel(index, { code: event.target.value })} /></label>
                  <label>Enlace (opcional)<input type="url" inputMode="url" maxLength={2048} value={hotel.link} aria-invalid={badLink || undefined} onChange={(event) => patchHotel(index, { link: event.target.value })} placeholder="https://" /></label>
                </div>
                {badLink && <p className="wb-help" role="status">Ese enlace no parece una web segura (https). No lo añadiremos hasta que lo corrijáis.</p>}
              </div>
              {hotels.length > 1 && <button type="button" className="wb-row-remove" aria-label={`Quitar el hotel ${index + 1}`} onClick={() => set(hotels.filter((_, i) => i !== index))}><Trash2Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>}
            </li>
          );
        })}
      </ol>
      {hotels.length < SITE_MAX_HOTELS && <button type="button" className="wb-add" onClick={() => set([...hotels, { name: "", code: "", link: "" }])}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir otro hotel</button>}
    </fieldset>
  );
}
