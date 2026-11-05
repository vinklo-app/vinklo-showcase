"use client";

/**
 * «Confirma tu asistencia» — el formulario de RSVP de la invitación.
 * Sin registro: nombre, sí/no, acompañantes, alergias (con consentimiento)
 * y una nota logística aparte (P1-5, 11-oct-2026).
 *
 * Solo presentación (refresh 2026-10-03): campos subrayados con filete,
 * opciones de 44 px, `:active scale(0.97)`, sin tarjeta. La server action,
 * los ids y los nombres de campo no cambian.
 *
 * V2 (2026-10-03): la primera confirmación con «sí» se celebra una sola vez
 * (entrada breve + ocho puntos que se abren; estilos en
 * components/invitation/story-player.css, solo fundido con reduced-motion).
 */
import { useEffect, useRef, useState, useTransition } from "react";

import { submitRsvp } from "@/lib/actions/rsvp";
import type { RsvpAnswersInput } from "@/lib/rsvp-answers";
import { NO_MODULES, RSVP_SONG_MAX, type BusUse, type LodgingWhere, type RsvpModules } from "@/lib/rsvp-modules";
import {
  busQuestion,
  LOGISTIC_NOTE_KEPT_TEXT,
  maxCompanionsHint,
  previousResponseText,
  rsvpFormInitialState,
  rsvpKeptPayload,
  rsvpPeopleSummary,
  rsvpReceipt,
  rsvpChangeUntilText,
  type RsvpReceiptRow,
  tooManyCompanionsError,
  type RsvpPrevious,
  companionNamesNotice,
} from "@/lib/rsvp-form-state";
import { companionListFromRows, kidsFromRows, type CompanionRow } from "@/lib/rsvp-companions";
import {
  composeHealthNote,
  dietPersonLabel,
  dietPreferenceCounts,
  HEALTH_NOTE_MAX,
  isHealthTag,
  menuCountsFromPeople,
  peopleFromAnswers,
  resizePeople,
  type PersonDiet,
} from "@/lib/rsvp-diet";
import { PeopleDiet } from "@/components/guest/people-diet";
import { WeddingActions, type WeddingActionsData } from "@/components/invitation/scenes/wedding-actions";
import { formatRsvpDate } from "@/lib/rsvp-window";
import { CompanionNames } from "@/components/guest/companion-names";

const HEALTH_CONSENT_ERROR = "Marca la casilla para enviar tus alergias o déjalas en blanco.";
/** Aviso del enlace personal (ítem 11): es de quien lo recibió y sirve para cambiar la respuesta. */
export const PERSONAL_LINK_TEXT = "Este enlace es tu invitación personal: es solo para ti, no lo reenvíes. Guárdalo para cambiar tu respuesta.";
const labelClass = "text-sm font-medium text-tinta";
const linkButtonClass =
  "inline-flex min-h-11 items-center text-sm text-tinta/80 underline underline-offset-2 outline-none hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cava";
/** Nota de salud guardada y plegada: existe, pero su texto no se enseña en el enlace (M1). */
export const HEALTH_NOTE_FOLDED_TEXT = "Ya nos dijiste algo sobre alergias. Por privacidad, no lo mostramos aquí.";
/** Abierto, con la nota guardada y nada marcado: qué pasará al enviar. */
export const HEALTH_NOTE_KEPT_CHIPS_TEXT = "Si no marcas nada, conservamos lo que nos dijiste sobre alergias; lo que marques lo sustituirá.";
const HEALTH_NOTE_TOO_LONG = "Lo que has escrito en «Otra» es demasiado largo para enviarlo. Acórtalo, por favor.";
const inputClass =
  "mt-2 block min-h-12 w-full rounded-none border-0 border-b border-current/25 bg-transparent py-3 text-base text-tinta transition-colors outline-none placeholder:text-tinta/45 focus-visible:border-cava focus-visible:shadow-[0_1px_0_0_var(--cava)]";
const chipClass =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border px-3 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-[220ms] ease-[var(--ease-out)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cava active:scale-[0.97] active:duration-[80ms]";

/**
 * Módulos (8-oct-2026): si la web tiene autobuses, alojamiento, canción, menú
 * o niños, el formulario lo pregunta al confirmar con «sí». Todo opcional
 * salvo la coherencia (parada si hay varias, menú que sume las personas):
 * el servidor vuelve a validarlo contra la web publicada.
 */
export function RsvpForm({ slug, invitationToken, modules = NO_MODULES, coupleNames = "", previous = null, maxCompanions = null, guestName = null, deadline = null, actions = null, now, demo = false }: {
  slug: string; invitationToken?: string; modules?: RsvpModules; coupleNames?: string; previous?: RsvpPrevious | null; maxCompanions?: number | null;
  /** Nombre de pila del titular del enlace («Carmen»), ya reducido en el servidor. */
  guestName?: string | null;
  /** Fecha límite de la pareja (YYYY-MM-DD) con el plazo abierto: el justificante dice hasta cuándo se puede cambiar. */
  deadline?: string | null;
  /** Calendario y mapa de la boda para el justificante (los mismos botones que el lugar). */
  actions?: WeddingActionsData | null;
  /** Reloj inyectable (tests): decide si la fecha lleva año. */
  now?: Date;
  /** /demo: envío local, nunca llama al servidor. */
  demo?: boolean;
}) {
  /** Tope de acompañantes de la invitación (§4.2); sin tope, el límite de siempre (10). */
  const maxAllowed = maxCompanions ?? 10;
  // Con respuesta anterior (§2.5) el formulario sale con lo que ya envió:
  // reenviarlo no pisa acompañantes, notas ni módulos.
  const initial = previous ? rsvpFormInitialState(previous) : null;
  const [name, setName] = useState(invitationToken ? "Invitado" : "");
  const [attending, setAttending] = useState<"si" | "no" | null>(initial?.attending ?? null);
  const [companions, setCompanions] = useState(Math.min(initial?.companions ?? 0, maxAllowed));
  /**
   * Menú y alergias por persona (ítem 21): tú y cada acompañante. El menú y
   * vegetariano/vegano vuelven al reabrir (repartidos por orden); lo de salud
   * no (M1): sale sin marcar con un aviso; sin marcar nada se conserva, lo
   * marcado lo sustituye y «Borrarlo» lo quita.
   */
  const [people, setPeople] = useState<PersonDiet[]>(() =>
    peopleFromAnswers((initial?.companions ?? 0) + 1, initial?.menu, initial?.diet, modules.menu),
  );
  const [healthNoteKept, setHealthNoteKept] = useState(initial?.healthNoteKept ?? false);
  /** «Algo más que debamos saber»: logística, sin consentimiento. Igual que la de salud. */
  const [logisticNotes, setLogisticNotes] = useState("");
  const [logisticNoteKept, setLogisticNoteKept] = useState(initial?.logisticNoteKept ?? false);
  /**
   * Las alergias son datos de salud (art. 9 RGPD): solo se envían con permiso
   * expreso, que se guarda con fecha y versión. Una nota nueva pide la casilla
   * otra vez; la conservada mantiene su consentimiento en el servidor.
   */
  const [healthConsent, setHealthConsent] = useState(false);
  /** Pulsó «Borrarla»: se dice que se borrará al enviar. */
  const [healthCleared, setHealthCleared] = useState(false);
  /** Con una nota de salud guardada, el bloque sale plegado («Cambiarlo» lo abre). */
  const [healthOpen, setHealthOpen] = useState(!(initial?.healthNoteKept ?? false));
  const [logisticCleared, setLogisticCleared] = useState(false);
  const [busUse, setBusUse] = useState<BusUse | null>(initial?.busUse ?? null);
  const [busStop, setBusStop] = useState<string | null>(initial?.busStop ?? null);
  const [lodging, setLodging] = useState<LodgingWhere | null>(initial?.lodging ?? null);
  const [hotel, setHotel] = useState<string | null>(initial?.hotel ?? null);
  const [song, setSong] = useState(initial?.song ?? "");
  const [kids, setKids] = useState(initial?.kids ?? 0);
  // Nombres de acompañantes (§4.3, solo con enlace personal). Los guardados no
  // se muestran (M1): las filas salen vacías y, si no las toca ni cambia el
  // número, se conservan. Si antes dio un número de niños, esas filas salen
  // marcadas como niño/a.
  const [companionRows, setCompanionRows] = useState<CompanionRow[]>(() =>
    Array.from({ length: Math.min(initial?.kids ?? 0, initial?.companions ?? 0) }, () => ({ name: "", kid: true })),
  );
  const [companionNamesKept, setCompanionNamesKept] = useState(initial?.companionNamesKept ?? false);
  /**
   * Solo cuenta escribir algún nombre: marcar «Es niño/a» en una fila vacía
   * no debe enviar una lista vacía que borraría los nombres guardados.
   */
  const companionNamesTouched = companionRows.slice(0, companions).some((row) => row.name.trim() !== "");
  /** Tú y tus acompañantes, con su nombre si lo has escrito (para la nota de salud). */
  const partyPeople = resizePeople(people, companions + 1).slice(0, companions + 1);
  const partyLabels = partyPeople.map((_, index) => dietPersonLabel(index, companionRows[index - 1]?.name));
  /** Nota de salud compuesta con las casillas («Tú: celiaquía; Pablo: …»): lo que se envía. */
  const healthNotes = attending === "si" ? composeHealthNote(partyPeople.map((diet, index) => ({ label: partyLabels[index]!, diet }))) : "";
  /** Con enlace personal, «Es niño/a» de cada acompañante sustituye a la pregunta del número de niños. */
  const askNames = Boolean(invitationToken);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"si" | "no" | null>(null);
  /** «Respuesta guardada. Vais 3 personas: …» (con «sí»). */
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  /** Justificante (ítem 12): lo que se acaba de guardar, fijado al enviar. */
  const [receipt, setReceipt] = useState<RsvpReceiptRow[]>([]);
  /** Tras enviar en esta visita, el aviso de la respuesta anterior ya no aplica. */
  const [sentThisVisit, setSentThisVisit] = useState(false);
  const [pending, startTransition] = useTransition();
  /** La celebración ocurre una vez por visita, aunque se cambie la respuesta. */
  const celebrated = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  /** Al enviar, el foco pasa al aviso para que VoiceOver lo lea (el formulario desaparece). */
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  /** Respuestas de los módulos y del menú/dieta por persona, como las valida el servidor. */
  function buildAnswers(): RsvpAnswersInput {
    const answers: RsvpAnswersInput = {};
    if (modules.bus && busUse) answers.bus = busStop ? { use: busUse, stop: busStop } : { use: busUse };
    if (modules.lodging && lodging) answers.lodging = hotel && lodging === "hotel" ? { where: lodging, hotel } : { where: lodging };
    if (modules.song && song.trim()) answers.song = song;
    const kidsCount = askNames ? kidsFromRows(companionRows, companions) : kids;
    if (modules.kids && kidsCount > 0) answers.kids = Math.min(kidsCount, companions);
    // El reparto de siempre (contrato de rsvp_answers.menu), derivado de cada persona.
    const menu = modules.menu.length > 0 ? menuCountsFromPeople(partyPeople, modules.menu) : null;
    if (menu) answers.menu = menu;
    const diet = dietPreferenceCounts(partyPeople);
    if (diet) answers.diet = diet;
    return answers;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!attending) {
      setError("Dinos si podrás acompañarnos.");
      return;
    }
    if (attending === "si" && companions > maxAllowed) {
      setError(tooManyCompanionsError(maxAllowed));
      return;
    }
    // Con «no» no hay alergias que pedir (ni casilla que exigir).
    if (attending === "si" && healthNotes.trim() && !healthConsent) {
      setError(HEALTH_CONSENT_ERROR);
      return;
    }
    if (healthNotes.length > HEALTH_NOTE_MAX) {
      setError(HEALTH_NOTE_TOO_LONG);
      return;
    }
    setError(null);
    const answers = buildAnswers();
    const names = askNames ? companionListFromRows(companionRows, companions).map((row) => row.name) : [];
    // Demo: el mismo «enviado» sin red ni BD (no hay boda real detrás).
    if (demo) {
      const first = attending === "si" && !celebrated.current;
      if (first) celebrated.current = true;
      setCelebrate(first);
      setSent(attending);
      setSavedSummary(attending === "si" ? rsvpPeopleSummary(companions, names) : null);
      setReceipt(attending === "si" ? rsvpReceipt({ answers, modules, healthNote: healthNotes, healthKept: false }) : []);
      setSentThisVisit(true);
      return;
    }
    startTransition(async () => {
      try {
        const kept = rsvpKeptPayload({
          attending,
          healthNotes,
          healthNoteKept,
          logisticNotes,
          logisticNoteKept,
          companions,
          initialCompanions: initial?.companions ?? 0,
          companionNamesKept,
          companionNamesTouched,
        });
        const result = await submitRsvp({
          invitationToken,
          slug,
          name,
          attending,
          companions,
          notes: kept.notes,
          healthNotes: attending === "si" ? healthNotes : "",
          healthConsent: attending === "si" && healthNotes.trim() ? healthConsent : undefined,
          keepHealthNote: kept.keepHealthNote,
          answers: Object.keys(answers).length > 0 ? answers : undefined,
          // Nombres guardados sin tocar: no se envían (el servidor no los toca).
          companionNames: askNames && !kept.keepCompanionNames ? (attending === "si" ? companionListFromRows(companionRows, companions) : []) : undefined,
        });
        if (result.ok) {
          // Lo escrito en esta visita sigue en los campos; el aviso de «lo
          // guardado» solo sigue si se conservó sin reescribirlo.
          setHealthNoteKept(kept.keepHealthNote);
          setLogisticNoteKept(kept.notes === undefined);
          setCompanionNamesKept(kept.keepCompanionNames);
          setHealthCleared(false);
          setLogisticCleared(false);
          const first = attending === "si" && !celebrated.current;
          if (first) celebrated.current = true;
          setCelebrate(first);
          setSent(attending);
          setSavedSummary(attending === "si" ? rsvpPeopleSummary(companions, names) : null);
          setReceipt(attending === "si" ? rsvpReceipt({ answers, modules, healthNote: healthNotes, healthKept: kept.keepHealthNote }) : []);
          setSentThisVisit(true);
        } else {
          setError(result.error);
        }
      } catch {
        setError("No hemos podido enviar tu respuesta. Revisa la conexión y vuelve a intentarlo.");
      }
    });
  }

  /** Avisos de lo guardado: solo mientras el campo siga en blanco (escribir lo sustituye). */
  const showHealthKept = (healthNoteKept || healthCleared) && !healthNotes.trim();
  const showLogisticKept = (logisticNoteKept || logisticCleared) && !logisticNotes.trim();
  /** Nombres guardados: se conservan, o se avisa ANTES de enviar de que se borrarán o sustituirán. */
  const namesNotice = askNames
    ? companionNamesNotice({ attending: attending ?? "no", companions, initialCompanions: initial?.companions ?? 0, companionNamesKept, companionNamesTouched })
    : null;

  if (sent) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="sp-rsvp-done sp-appear outline-none border-y border-salvia/50 py-5 text-sm leading-relaxed text-tinta"
        data-celebrate={celebrate ? "" : undefined}
      >
        {celebrate && (
          <span aria-hidden="true" className="sp-burst">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <span key={angle} style={{ "--a": `${angle}deg` } as React.CSSProperties} />
            ))}
          </span>
        )}
        {sent === "si" && (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="sp-done-check" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="m7.5 12.5 3 3 6-6.5" />
          </svg>
        )}
        <p className={`font-display text-lg text-salvia ${sent === "si" ? "pl-8" : ""}`}>
          {/* Demo: «¡Gracias, Marta!» delante (y sin un segundo «Gracias» si no viene). */}
          {demo && `${demoThanks(name)} `}
          {sent === "si" ? "¡Asistencia confirmada! Qué ganas de verte." : demo ? "Sentiremos no verte este día." : "Gracias por avisarnos. Sentiremos no verte este día."}
        </p>
        {sent === "si" && savedSummary && (
          <p className="mt-1 pl-8 text-sm leading-relaxed text-tinta/80" data-rsvp-saved-summary="">
            {savedSummary}
          </p>
        )}
        {/* Justificante (ítem 12): lo que se acaba de guardar y lo siguiente que hace falta. */}
        {sent === "si" && receipt.length > 0 && (
          <dl className="mt-3 grid gap-1.5 pl-8 text-sm leading-relaxed" data-rsvp-receipt="">
            {receipt.map((row) => (
              <div key={row.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2" data-rsvp-receipt-row={row.key}>
                <dt className="text-tinta/60">{row.label}</dt>
                <dd className="m-0 text-tinta">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {sent === "si" && actions && (
          <div className="mt-4" data-rsvp-receipt-actions="">
            <WeddingActions mode={demo ? "preview" : "public"} data={actions} />
          </div>
        )}
        {invitationToken && deadline && (
          <p className="mt-3 text-sm leading-relaxed text-tinta/80" data-rsvp-change-until={deadline}>
            {rsvpChangeUntilText(formatRsvpDate(deadline, now))}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setCelebrate(false);
            setSent(null);
          }}
          className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4 outline-none transition-transform duration-[140ms] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cava active:scale-[0.97] active:duration-[80ms]"
        >
          Cambiar mi respuesta
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={pending} className="m-0 border-0 p-0">
        <legend className="sr-only">Tu respuesta de asistencia</legend>
        {invitationToken && guestName && (
          <p className="mb-3 font-display text-lg text-tinta" data-rsvp-greeting="">
            Hola, {guestName}.
          </p>
        )}
        {previous && !sentThisVisit && (
          <p className="mb-5 text-sm font-medium leading-relaxed text-tinta" data-rsvp-previous="">
            {previousResponseText(previous)}
          </p>
        )}
        {invitationToken && (
          <p className="border-t border-current/10 pt-4 text-sm leading-relaxed text-tinta/70" data-rsvp-personal="">
            {PERSONAL_LINK_TEXT}
          </p>
        )}
        {!invitationToken && (
          <div>
            <label htmlFor="rsvp-name" className={labelClass}>
              Tu nombre y apellidos
            </label>
            <input
              id="rsvp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              placeholder="María García"
              className={inputClass}
            />
          </div>
        )}

        <fieldset className="mt-7 border-0 p-0">
          <legend className={labelClass}>¿Vienes?</legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ["si", "¡Sí, allí estaré!"],
                ["no", "No podré ir"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setAttending(value);
                  // «No podré ir»: fuera lo marcado sobre alergias y su permiso
                  // (no se envían; la RPC borra la nota de un «sí» anterior).
                  if (value === "no") {
                    setPeople((list) => list.map((person) => ({ ...person, tags: person.tags.filter((tag) => !isHealthTag(tag)), otherOn: false, other: "" })));
                    setHealthConsent(false);
                  }
                }}
                aria-pressed={attending === value}
                className={`${chipClass} ${
                  attending === value ? "border-tinta bg-tinta text-papel" : "border-current/25 bg-transparent text-tinta hover:border-current/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {attending === "si" && maxAllowed === 0 && (
          <p className="sp-appear mt-7 text-sm leading-relaxed text-tinta/70" data-rsvp-max="0">
            Tu invitación es solo para ti.
          </p>
        )}
        {attending === "si" && maxAllowed > 0 && (
          <div className="sp-appear mt-7" role="group" aria-labelledby="rsvp-companions-label" aria-describedby={maxCompanions !== null ? "rsvp-companions-max" : undefined}>
            <p id="rsvp-companions-label" className={labelClass}>
              ¿Cuántas personas vienen contigo? (sin contarte)
            </p>
            {/* −/+ con tope (ítem 21): nunca un número libre por encima de la invitación. */}
            <div className="mt-3 flex items-center gap-3">
              <button type="button" className={`${chipClass} w-11 border-current/25`} onClick={() => setCompanions((n) => Math.max(0, n - 1))} disabled={companions <= 0} aria-label="Una persona menos">
                −
              </button>
              <output id="rsvp-companions" aria-live="polite" className="tabular w-8 text-center text-lg text-tinta" data-value={companions}>
                {companions}
              </output>
              <button type="button" className={`${chipClass} w-11 border-current/25`} onClick={() => setCompanions((n) => Math.min(maxAllowed, n + 1))} disabled={companions >= maxAllowed} aria-label="Una persona más">
                +
              </button>
            </div>
            {maxCompanions !== null && (
              <p id="rsvp-companions-max" className="mt-2 text-sm text-tinta/65">
                {maxCompanionsHint(maxCompanions)}
              </p>
            )}
          </div>
        )}

        {attending === "si" && askNames && maxAllowed > 0 && companions > 0 && (
          <>
            <CompanionNames
              rows={companionRows}
              companions={Math.min(companions, maxAllowed)}
              onChange={setCompanionRows}
              labelClass={labelClass}
              inputClass={inputClass}
            />
          </>
        )}
        {attending === "si" && maxAllowed > 0 && namesNotice && <KeptNote text={namesNotice} />}

        {attending === "si" && (
          <ModuleQuestions
            modules={askNames ? { ...modules, kids: false } : modules}
            companions={companions}
            busUse={busUse} setBusUse={setBusUse} busStop={busStop} setBusStop={setBusStop}
            lodging={lodging} setLodging={setLodging} hotel={hotel} setHotel={setHotel}
            song={song} setSong={setSong} kids={kids} setKids={setKids}
          />
        )}

        {attending === "si" && (
          <PeopleDiet
            people={partyPeople}
            labels={partyLabels}
            menuOptions={modules.menu}
            showHealth={healthOpen}
            onChange={(index, person) => setPeople((list) => resizePeople(list, index + 1).map((item, i) => (i === index ? person : item)))}
            labelClass={labelClass}
            inputClass={inputClass}
            chipClass={chipClass}
          />
        )}

        {/* Nota de salud ya guardada (ítem 11): plegada; el texto nunca se muestra (M1). */}
        {attending === "si" && !healthOpen && (
          <div className="sp-appear mt-7" data-rsvp-health-folded="">
            <p className={labelClass}>Alergias o intolerancias (opcional)</p>
            <p className="mt-2 text-sm leading-relaxed text-tinta/65">
              {healthCleared ? "Se borrará al enviar tu respuesta." : HEALTH_NOTE_FOLDED_TEXT}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-5">
              <button type="button" onClick={() => setHealthOpen(true)} className={linkButtonClass}>
                Cambiarlo
              </button>
              {!healthCleared && (
                <button
                  type="button"
                  onClick={() => {
                    setHealthNoteKept(false);
                    setHealthCleared(true);
                  }}
                  className={linkButtonClass}
                >
                  Borrarlo
                </button>
              )}
            </div>
          </div>
        )}
        {/* Alergias solo con «sí»: a quien no viene no se le piden datos de salud.
            Las casillas de cada persona están arriba (PeopleDiet); aquí, lo guardado y el permiso. */}
        {attending === "si" && healthOpen && (showHealthKept || healthNotes.trim()) && (
          <div className="sp-appear mt-4">
            {showHealthKept && (
              <KeptNote
                id="rsvp-health-kept"
                text={HEALTH_NOTE_KEPT_CHIPS_TEXT}
                clearLabel="Borrarlo"
                cleared={healthCleared}
                onClear={() => {
                  setHealthNoteKept(false);
                  setHealthCleared(true);
                }}
              />
            )}
            {healthNotes.trim() && (
              <label className="sp-appear mt-4 flex items-start gap-3 text-sm leading-relaxed text-tinta/80">
                <input
                  type="checkbox"
                  checked={healthConsent}
                  onChange={(e) => setHealthConsent(e.target.checked)}
                  required
                  className="mt-0.5 size-5 shrink-0 accent-[var(--cava)]"
                />
                <span>Acepto que la pareja conozca estos datos de salud para organizar el menú.</span>
              </label>
            )}
          </div>
        )}

        <div className="mt-7">
          <label htmlFor="rsvp-notes" className={labelClass}>
            Algo más que debamos saber (opcional)
          </label>
          <textarea
            id="rsvp-notes"
            value={logisticNotes}
            onChange={(e) => setLogisticNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Vamos con carrito de bebé…"
            aria-describedby={showLogisticKept ? "rsvp-notes-kept" : undefined}
            className={`${inputClass} resize-y`}
          />
          {showLogisticKept && (
            <KeptNote
              id="rsvp-notes-kept"
              text={LOGISTIC_NOTE_KEPT_TEXT}
              cleared={logisticCleared}
              onClear={() => {
                setLogisticNoteKept(false);
                setLogisticCleared(true);
              }}
            />
          )}
        </div>

        {error && (
          <p role="alert" className="sp-appear mt-5 text-sm font-medium text-granate">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-8 inline-flex min-h-13 w-full items-center justify-center rounded-[10px] bg-tinta px-6 text-base font-semibold text-papel transition-[opacity,transform] duration-[220ms] ease-[var(--ease-out)] outline-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cava active:scale-[0.97] active:duration-[80ms] disabled:opacity-60"
        >
          {pending ? "Enviando…" : "Enviar mi respuesta"}
        </button>
        <p className="mt-4 text-center text-xs leading-relaxed text-tinta/60">
          Tus respuestas solo las ven {coupleNames || "los novios"}.{" "}
          <a href="/privacidad" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-tinta">
            Privacidad
          </a>
        </p>
      </fieldset>
    </form>
  );
}

/**
 * «Ya nos dijiste algo sobre alergias; si quieres cambiarlo, escríbelo de
 * nuevo.» con «Borrarla» (revisión M1: lo guardado no se enseña). Tras
 * pulsarlo, confirma que se borrará al enviar.
 */
function KeptNote({ id, text, cleared = false, onClear, clearLabel = "Borrarla" }: { id?: string; text: string; cleared?: boolean; onClear?: () => void; clearLabel?: string }) {
  return (
    <p id={id} className="sp-appear mt-2 text-sm leading-relaxed text-tinta/65" data-rsvp-kept="">
      {cleared ? (
        "Se borrará al enviar tu respuesta."
      ) : (
        <>
          {text}
          {onClear && (
            <>
              {" "}
              <button
                type="button"
                onClick={onClear}
                className="inline-flex min-h-11 items-center underline underline-offset-2 outline-none hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cava"
              >
                {clearLabel}
              </button>
            </>
          )}
        </>
      )}
    </p>
  );
}

/** «¡Gracias, Marta!» con el nombre de pila que se escribió en la demo. */
export function demoThanks(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `¡Gracias, ${first}!` : "¡Gracias!";
}

function Chips<T extends string>({ legend, options, value, onChange }: { legend: string; options: ReadonlyArray<readonly [T, string]>; value: T | null; onChange(value: T): void }) {
  return (
    <fieldset className="mt-7 border-0 p-0">
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={`${chipClass} ${value === v ? "border-tinta bg-tinta text-papel" : "border-current/25 bg-transparent text-tinta hover:border-current/50"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ModuleQuestions(props: {
  modules: RsvpModules;
  companions: number;
  busUse: BusUse | null; setBusUse(v: BusUse): void; busStop: string | null; setBusStop(v: string | null): void;
  lodging: LodgingWhere | null; setLodging(v: LodgingWhere): void; hotel: string | null; setHotel(v: string | null): void;
  song: string; setSong(v: string): void; kids: number; setKids(v: number): void;
}) {
  const { modules, companions } = props;
  const people = companions + 1;
  const stops = modules.bus?.stops ?? [];
  const hotels = modules.lodging?.hotels ?? [];
  const goes = props.busUse === "ida" || props.busUse === "ambos";
  return (
    <div className="sp-appear">
      {modules.bus && (
        <>
          <Chips<BusUse>
            legend={busQuestion(people)}
            options={[["ambos", "Ida y vuelta"], ["ida", "Solo ida"], ["vuelta", "Solo vuelta"], ["no", "No, voy por mi cuenta"]]}
            value={props.busUse}
            onChange={(v) => { props.setBusUse(v); if (v === "no" || v === "vuelta") props.setBusStop(null); }}
          />
          {goes && stops.length > 1 && (
            <Chips<string>
              legend="¿Desde qué parada?"
              options={stops.map((s) => [s.id, s.time ? `${s.name} · ${s.time}` : s.name] as const)}
              value={props.busStop}
              onChange={(v) => props.setBusStop(v)}
            />
          )}
        </>
      )}
      {modules.lodging && (
        <>
          <Chips<LodgingWhere>
            legend="¿Dónde te alojarás?"
            options={[
              ...(hotels.length > 0 ? [["hotel", hotels.length === 1 ? `En ${hotels[0]!.name}` : "En uno de vuestros hoteles"] as const] : []),
              ["otro", "En otro sitio"],
              ["no", "No me alojo"],
            ]}
            value={props.lodging}
            onChange={(v) => { props.setLodging(v); if (v !== "hotel") props.setHotel(null); }}
          />
          {props.lodging === "hotel" && hotels.length > 1 && (
            <Chips<string> legend="¿En cuál?" options={hotels.map((h) => [h.id, h.name] as const)} value={props.hotel} onChange={(v) => props.setHotel(v)} />
          )}
        </>
      )}
      {modules.kids && companions > 0 && (
        <div className="mt-7">
          <label htmlFor="rsvp-kids" className={labelClass}>¿Cuántos de tus acompañantes son niños?</label>
          <input id="rsvp-kids" type="number" min={0} max={companions} value={Math.min(props.kids, companions)}
            onChange={(e) => props.setKids(Math.max(0, Math.min(companions, Number(e.target.value) || 0)))} className={`${inputClass} tabular`} />
        </div>
      )}
      {modules.song && (
        <div className="mt-7">
          <label htmlFor="rsvp-song" className={labelClass}>Una canción que no puede faltar (opcional)</label>
          <input id="rsvp-song" value={props.song} onChange={(e) => props.setSong(e.target.value)} maxLength={RSVP_SONG_MAX} placeholder="Canción y artista" className={inputClass} />
        </div>
      )}
    </div>
  );
}
