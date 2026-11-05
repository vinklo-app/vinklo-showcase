"use client";

/**
 * Paso «Vuestro día» del creador (8-oct-2026): ceremonia, cóctel y banquete
 * con hora y sitio (pueden ser sitios distintos) y, si activaron autobuses,
 * la salida y la vuelta. Llena el programa de la web. Todo opcional y se
 * salta con un toque; lo que la lectura de la idea encontró escrito ya viene
 * relleno (nunca se inventa). La salida y la vuelta del autobús son los
 * mismos datos que el paso «Vuestra gente» (paradas y vuelta).
 *
 * 13-oct-2026 (punto 9, «en el día hay que poder añadir más cosas»): más
 * momentos con hora, título, sitio y notas (subir, bajar, quitar), más
 * salidas de autobús, los módulos de autobuses y alojamiento con un toque
 * (los mismos editores que «Vuestra gente») y tarjetas de detalles y
 * preguntas. Las filas viven en el borrador (lib/creator-day.ts); la vista
 * previa es la misma invitación (mismo renderer). Solo llega a la web lo que
 * tiene título; los topes son los del contrato.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { BUILDER_MODULE_IDS, BUILDER_MOMENT_LABELS, EMPTY_DAY, builderBusStops, composeBuilderDocument, dayRoom, materializeDay, type BuilderDraft, type BuilderModuleId, type BuilderMomentId } from "@/lib/wedding-builder";
import { HAND_PREFIX, moveRow, nextHandId, type BuilderDayCard, type BuilderDayMoment, type BuilderDayQuestion } from "@/lib/creator-day";
import { SITE_MAX_BUS_STOPS, findScene } from "@/lib/site-document";
import { PlaceCombobox } from "@/components/places/place-combobox";
import { HotelDetails } from "@/components/creator/module-details";
import { clipPlaceText } from "@/lib/places/places";

const MOMENTS: ReadonlyArray<{ id: BuilderMomentId; placeholder: string }> = [
  { id: "ceremony", placeholder: "Iglesia, juzgado, el jardín…" },
  { id: "cocktail", placeholder: "Dónde es el cóctel" },
  { id: "banquet", placeholder: "Dónde es la cena" },
];

/** Módulos que se activan desde aquí (los mismos chips que «Vuestra gente»). */
const DAY_MODULES: ReadonlyArray<{ id: BuilderModuleId; label: string }> = [
  { id: "bus", label: "Autobuses" },
  { id: "hotels", label: "Alojamiento" },
];

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Subir, bajar y quitar una fila (botones de 44 px). */
function RowTools({ label, index, total, onMove, onRemove }: { label: string; index: number; total: number; onMove(to: number): void; onRemove(): void }) {
  return (
    <div className="wb-row-tools">
      <button type="button" className="wb-row-move" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => onMove(index - 1)}><ChevronUpIcon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
      <button type="button" className="wb-row-move" aria-label={`Bajar ${label}`} disabled={index === total - 1} onClick={() => onMove(index + 1)}><ChevronDownIcon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
      <button type="button" className="wb-row-remove" aria-label={`Quitar ${label}`} onClick={onRemove}><Trash2Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
    </div>
  );
}

export function DayStep({ draft, onPatch, onSkip }: { draft: BuilderDraft; onPatch(values: Partial<BuilderDraft>): void; onSkip?(): void }) {
  const day = draft.day ?? EMPTY_DAY;
  const venue = draft.venue.trim();
  const setMoment = (id: BuilderMomentId, values: Partial<(typeof day)[BuilderMomentId]>) => onPatch({ day: { ...day, [id]: { ...day[id], ...values } } });
  const modules = new Set(draft.modules ?? []);
  const bus = modules.has("bus");
  const stops = builderBusStops(draft);
  const first = stops[0] ?? { name: "", time: "", place: "" };
  const setFirstStop = (values: Partial<typeof first>) => onPatch({ busStops: [{ ...first, ...values }, ...stops.slice(1)] });
  const setStop = (index: number, values: Partial<typeof first>) => onPatch({ busStops: stops.map((stop, i) => (i === index ? { ...stop, ...values } : stop)) });
  const back = draft.busReturn ?? { time: "", place: "" };
  const toggleModule = (id: BuilderModuleId) => onPatch({ modules: BUILDER_MODULE_IDS.filter((m) => (m === id ? !modules.has(m) : modules.has(m))) });

  // Al abrir el paso (una vez): lo de plantilla y lo que añadió antes la IA
  // pasan a filas que se editan y se quitan (materializeDay; si la invitación
  // no quedase igual, no cambia nada).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (draft.dayKnown) return;
    const next = materializeDay(draft);
    if (next !== draft) onPatch({ dayMoments: next.dayMoments, dayCards: next.dayCards, dayQuestions: next.dayQuestions, dayKnown: next.dayKnown, sections: next.sections });
  }, [draft, onPatch]);

  const room = useMemo(() => dayRoom(draft), [draft]);
  // Una fila de plantilla sin tocar («auto») enseña lo que la invitación dice ahora.
  const live = useMemo(() => {
    const doc = composeBuilderDocument(draft);
    return { cards: new Map((findScene(doc, "details")?.props.cards ?? []).map((c) => [c.id, c])), questions: new Map((findScene(doc, "faq")?.props.items ?? []).map((q) => [q.id, q])) };
  }, [draft]);
  const moments = draft.dayMoments ?? [];
  // Las «auto» sin equivalente vivo (la plantilla ya no las genera) no se enseñan.
  const cards = (draft.dayCards ?? []).flatMap((row): BuilderDayCard[] => {
    if (!row.auto) return [row];
    const card = live.cards.get(row.id);
    return card ? [{ id: row.id, title: card.title, teaser: card.teaser, body: card.body, ...(card.link ? { link: card.link } : {}), linkLabel: card.linkLabel, auto: true }] : [];
  });
  const questions = (draft.dayQuestions ?? []).flatMap((row): BuilderDayQuestion[] => {
    if (!row.auto) return [row];
    const item = live.questions.get(row.id);
    return item ? [{ id: row.id, question: item.question, answer: item.answer, auto: true }] : [];
  });
  const setMoments = (next: BuilderDayMoment[]) => onPatch({ dayMoments: next });
  const setCards = (next: BuilderDayCard[]) => onPatch({ dayCards: next });
  const setQuestions = (next: BuilderDayQuestion[]) => onPatch({ dayQuestions: next });
  // Tocar una fila de plantilla la hace de la pareja (deja de seguir a la plantilla).
  // Se cambia sobre las filas guardadas (también las «auto» que ahora no se ven), con los valores que se enseñan.
  const savedCards = draft.dayCards ?? [];
  const savedQuestions = draft.dayQuestions ?? [];
  const patchShown = <T extends { id: string; auto?: true }>(saved: T[], shown: T[], set: (next: T[]) => void, id: string, values: Partial<T>) => set(saved.map((row) => {
    if (row.id !== id) return row;
    const next = { ...(shown.find((item) => item.id === id) ?? row), ...values };
    delete next.auto;
    return next;
  }));
  const patchRow = <T extends { id: string }>(rows: T[], set: (next: T[]) => void, id: string, values: Partial<T>) => set(rows.map((row) => (row.id === id ? { ...row, ...values } : row)));
  const moveSaved = <T extends { id: string }>(saved: T[], shown: { id: string }[], set: (next: T[]) => void, index: number, to: number) => {
    const from = saved.findIndex((row) => row.id === shown[index]?.id);
    const target = saved.findIndex((row) => row.id === shown[to]?.id);
    if (from !== -1 && target !== -1) set(moveRow(saved, from, target));
  };

  // La fila recién añadida recibe el foco en su primer campo.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  function addMoment() {
    const id = nextHandId(HAND_PREFIX.moments, room.moments.taken);
    setMoments([...moments, { id, title: "", timeLabel: "", place: "", address: "", notes: "" }]);
    setFocusId(`wb-day-${id}-title`);
  }
  function addCard() {
    const id = nextHandId(HAND_PREFIX.cards, room.cards.taken);
    setCards([...savedCards, { id, title: "", teaser: "", body: "", linkLabel: "" }]);
    setFocusId(`wb-day-${id}-title`);
  }
  function addQuestion() {
    const id = nextHandId(HAND_PREFIX.questions, room.questions.taken);
    setQuestions([...savedQuestions, { id, question: "", answer: "" }]);
    setFocusId(`wb-day-${id}-title`);
  }
  function addStop() {
    const index = Math.max(stops.length, 1);
    onPatch({ busStops: [...(stops.length > 0 ? stops : [first]), { name: "", time: "", place: "" }] });
    setFocusId(`wb-day-stop-${index}`);
  }

  return (
    <div className="wb-day">
      <ol className="wb-rows">
        {bus && (
          <li className="wb-row wb-day-row">
            <div className="wb-row-fields">
              <p className="wb-day-title">Salida del autobús</p>
              <div className="wb-day-fields">
                <label>Hora<input type="time" value={first.time} onChange={(event) => setFirstStop({ time: event.target.value })} /></label>
                <label>Desde<input maxLength={80} value={first.name} onChange={(event) => setFirstStop({ name: event.target.value })} placeholder="Plaza de Castilla" /></label>
              </div>
            </div>
          </li>
        )}
        {bus && stops.slice(1).map((stop, k) => {
          const index = k + 1;
          return (
            <li key={`stop-${index}`} className="wb-row wb-day-row">
              <div className="wb-row-fields">
                <p className="wb-day-title" id={`wb-day-stop-${index}-title`}>Otra salida del autobús</p>
                <div className="wb-day-fields" role="group" aria-labelledby={`wb-day-stop-${index}-title`}>
                  <label>Hora<input type="time" value={stop.time} onChange={(event) => setStop(index, { time: event.target.value })} /></label>
                  <label>Desde<input id={`wb-day-stop-${index}`} maxLength={80} value={stop.name} onChange={(event) => setStop(index, { name: event.target.value })} placeholder="Estación de Atocha" /></label>
                </div>
              </div>
              <button type="button" className="wb-row-remove" aria-label={`Quitar la salida ${index + 1}`} onClick={() => onPatch({ busStops: stops.filter((_, i) => i !== index) })}><Trash2Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
            </li>
          );
        })}
        {MOMENTS.map(({ id, placeholder }) => (
          <li key={id} className="wb-row wb-day-row">
            <div className="wb-row-fields">
              <p className="wb-day-title" id={`wb-day-${id}`}>{BUILDER_MOMENT_LABELS[id]}</p>
              <div className="wb-day-fields" role="group" aria-labelledby={`wb-day-${id}`}>
                <label>Hora<input type="time" value={day[id].time} onChange={(event) => setMoment(id, { time: event.target.value })} /></label>
                {/* Sugerencias de lugares: elegir una deja el nombre y su dirección (para «Cómo llegar»); escribir a mano quita la dirección sugerida. */}
                <PlaceCombobox
                  id={`wb-day-${id}-place`}
                  label="Dónde"
                  maxLength={160}
                  value={day[id].place}
                  onChange={(place) => setMoment(id, { place, address: undefined })}
                  onPick={(picked) => setMoment(id, picked.full ? { address: clipPlaceText(picked.address, 240) } : { place: clipPlaceText(picked.name, 160), address: clipPlaceText(picked.address, 240) })}
                  placeholder={placeholder}
                />
              </div>
              {/* Con el lugar ya escrito, un toque lo copia (nunca se rellena solo). */}
              {venue && !day[id].place.trim() && <button type="button" className="wb-add wb-day-same" onClick={() => setMoment(id, { place: venue.slice(0, 160), address: draft.address.trim() ? clipPlaceText(draft.address, 240) : undefined })}>En {venue}</button>}
            </div>
          </li>
        ))}
        {moments.map((row, index) => {
          const label = row.title.trim() ? `«${row.title.trim()}»` : `el momento ${index + 1}`;
          return (
            <li key={row.id} className="wb-row wb-day-row">
              <div className="wb-row-fields">
                <label>Qué<input id={`wb-day-${row.id}-title`} maxLength={120} value={row.title} onChange={(event) => patchRow(moments, setMoments, row.id, { title: event.target.value })} placeholder="Fiesta, primer baile, recena…" /></label>
                <div className="wb-day-fields">
                  <label>Hora<input type="time" value={HHMM.test(row.timeLabel) ? row.timeLabel : ""} onChange={(event) => patchRow(moments, setMoments, row.id, { timeLabel: event.target.value })} /></label>
                  <PlaceCombobox
                    id={`wb-day-${row.id}-place`}
                    label="Dónde (opcional)"
                    maxLength={160}
                    value={row.place}
                    onChange={(place) => patchRow(moments, setMoments, row.id, { place, address: "" })}
                    onPick={(picked) => patchRow(moments, setMoments, row.id, picked.full ? { address: clipPlaceText(picked.address, 240) } : { place: clipPlaceText(picked.name, 160), address: clipPlaceText(picked.address, 240) })}
                    placeholder="Si es en otro sitio"
                  />
                </div>
                <label>Notas (opcional)<textarea rows={2} maxLength={400} value={row.notes} onChange={(event) => patchRow(moments, setMoments, row.id, { notes: event.target.value })} placeholder="Traed calzado cómodo" /></label>
              </div>
              <RowTools label={label} index={index} total={moments.length} onMove={(to) => setMoments(moveRow(moments, index, to))} onRemove={() => setMoments(moments.filter((m) => m.id !== row.id))} />
            </li>
          );
        })}
        {bus && (
          <li className="wb-row wb-day-row">
            <div className="wb-row-fields">
              <p className="wb-day-title">Vuelta en autobús</p>
              <div className="wb-day-fields">
                <label>Hora<input type="time" value={back.time} onChange={(event) => onPatch({ busReturn: { ...back, time: event.target.value } })} /></label>
                <label>Desde<input maxLength={120} value={back.place} onChange={(event) => onPatch({ busReturn: { ...back, place: event.target.value } })} placeholder="La puerta de la finca" /></label>
              </div>
            </div>
          </li>
        )}
      </ol>
      <div className="wb-day-adds">
        <button type="button" className="wb-add" disabled={room.moments.room === 0} onClick={addMoment}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir otro momento</button>
        {bus && stops.length < SITE_MAX_BUS_STOPS && <button type="button" className="wb-add" onClick={addStop}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir otra salida</button>}
      </div>
      {(moments.length > 0 || room.moments.room === 0) && <p className="wb-help wb-day-note">{room.moments.room === 0 ? "El programa ya tiene todos los momentos que caben." : "En la invitación van por hora; lo que no tiene hora, al final. Sin título no se enseña."}</p>}

      <fieldset className="wb-modules wb-day-more">
        <legend>Añadid más secciones</legend>
        <p className="wb-help">Autobuses y alojamiento salen en la invitación y en el formulario. Podéis quitarlos cuando queráis.</p>
        <div className="wb-chips">
          {DAY_MODULES.map(({ id, label }) => (
            <button key={id} type="button" className="wb-chip" aria-pressed={modules.has(id)} onClick={() => toggleModule(id)}>{label}</button>
          ))}
        </div>
      </fieldset>
      {modules.has("hotels") && <HotelDetails draft={draft} onChange={onPatch} />}

      <fieldset className="wb-subform">
        <legend>Detalles</legend>
        <p className="wb-help">Dress code, regalos, niños, cómo llegar… Cada tarjeta con su título y su texto.</p>
        {cards.length > 0 && (
          <ol className="wb-rows">
            {cards.map((row, index) => (
              <li key={row.id} className="wb-row">
                <div className="wb-row-fields">
                  <label>Título<input id={`wb-day-${row.id}-title`} maxLength={80} value={row.title} onChange={(event) => patchShown(savedCards, cards, setCards, row.id, { title: event.target.value })} placeholder="Dress code" /></label>
                  <label>Texto<textarea rows={3} maxLength={800} value={row.body} onChange={(event) => patchShown(savedCards, cards, setCards, row.id, { body: event.target.value })} placeholder="Etiqueta de verano: traje y vestido largo." /></label>
                </div>
                <RowTools label={row.title.trim() ? `«${row.title.trim()}»` : `la tarjeta ${index + 1}`} index={index} total={cards.length} onMove={(to) => moveSaved(savedCards, cards, setCards, index, to)} onRemove={() => setCards(savedCards.filter((c) => c.id !== row.id))} />
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="wb-add" disabled={room.cards.room === 0} onClick={addCard}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir un detalle</button>
        {room.cards.room === 0 && <p className="wb-help">Ya no caben más tarjetas de detalles.</p>}
      </fieldset>

      <fieldset className="wb-subform">
        <legend>Preguntas</legend>
        <p className="wb-help">Lo que todo el mundo os va a preguntar. Sin respuesta, los invitados no la ven.</p>
        {questions.length > 0 && (
          <ol className="wb-rows">
            {questions.map((row, index) => (
              <li key={row.id} className="wb-row">
                <div className="wb-row-fields">
                  <label>Pregunta<input id={`wb-day-${row.id}-title`} maxLength={160} value={row.question} onChange={(event) => patchShown(savedQuestions, questions, setQuestions, row.id, { question: event.target.value })} placeholder="¿Hay aparcamiento?" /></label>
                  <label>Respuesta<textarea rows={2} maxLength={800} value={row.answer} onChange={(event) => patchShown(savedQuestions, questions, setQuestions, row.id, { answer: event.target.value })} placeholder="Sí, en la propia finca." /></label>
                </div>
                <RowTools label={row.question.trim() ? `«${row.question.trim()}»` : `la pregunta ${index + 1}`} index={index} total={questions.length} onMove={(to) => moveSaved(savedQuestions, questions, setQuestions, index, to)} onRemove={() => setQuestions(savedQuestions.filter((q) => q.id !== row.id))} />
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="wb-add" disabled={room.questions.room === 0} onClick={addQuestion}><PlusIcon aria-hidden="true" size={16} strokeWidth={1.75} />Añadir una pregunta</button>
        {room.questions.room === 0 && <p className="wb-help">Ya no caben más preguntas.</p>}
      </fieldset>
      {onSkip && <button type="button" className="wb-secondary wb-skip" onClick={onSkip}>Lo completamos después</button>}
    </div>
  );
}
