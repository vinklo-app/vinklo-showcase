import { describe, expect, it } from "vitest";

import { COMPANION_NAMES_DROP_ALL_TEXT, COMPANION_NAMES_DROP_TEXT, COMPANION_NAMES_KEPT_TEXT, COMPANION_NAMES_REPLACE_TEXT, HEALTH_NOTE_KEPT_TEXT, busQuestion, companionNamesNotice, maxCompanionsHint, menuMissingHint, parseGuestRsvpCurrent, parseRsvpPrevious, previousResponseText, rsvpFormInitialState, rsvpKeptPayload, rsvpSavedSummary, tooManyCompanionsError } from "./rsvp-previous";

describe("parseRsvpPrevious: jsonb de guest_rsvp_current → estado", () => {
  it("una respuesta completa (20261101100000): solo booleanos, nunca textos privados", () => {
    const previous = parseRsvpPrevious({
      status: "si", companions: 2, responded_at: "2026-10-08T18:30:00+00:00",
      has_health_note: true, has_logistic_note: true, has_companion_names: true, health_consent_at: "2026-10-08T18:30:00+00:00",
      answers: { bus: { use: "ambos", stop: "p-1" }, lodging: { where: "hotel", hotel: "h-1" }, song: "Mediterráneo", kids: 1, menu: { "m-1": 2, "m-2": 1 } },
    });
    expect(previous).toEqual({
      status: "si", companions: 2, respondedAt: "2026-10-08T18:30:00+00:00",
      hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true, healthConsentAt: "2026-10-08T18:30:00+00:00",
      answers: { bus: { use: "ambos", stop: "p-1" }, lodging: { where: "hotel", hotel: "h-1" }, song: "Mediterráneo", kids: 1, menu: { "m-1": 2, "m-2": 1 } },
    });
  });
  it("RPC anterior a la migración (aún manda textos): solo se mira si existen y los textos se descartan", () => {
    const previous = parseRsvpPrevious({
      status: "si", companions: 1, notes: "Celíaca", logistic_notes: " Carrito ", health_consent_at: "2026-10-08T18:30:00+00:00", health_consent_version: "2026-10",
      answers: null, responded_at: null, companion_list: [{ name: "Leo", kid: true }],
    });
    expect(previous).toMatchObject({ hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true });
    const serialized = JSON.stringify(previous);
    for (const secret of ["Celíaca", "Carrito", "Leo"]) expect(serialized).not.toContain(secret);
    expect(parseRsvpPrevious({ status: "si", companions: 0, notes: "  ", logistic_notes: null, answers: null, responded_at: null })).toMatchObject({ hasHealthNote: false, hasLogisticNote: false, hasCompanionNames: false });
  });
  it("con «no» no hay nombres; sin nota de salud no hay fecha de consentimiento", () => {
    expect(parseRsvpPrevious({ status: "no", companions: 0, has_companion_names: true, answers: null, responded_at: null })?.hasCompanionNames).toBe(false);
    expect(parseRsvpPrevious({ status: "si", companions: 0, has_health_note: false, health_consent_at: "2026-10-08T18:30:00+00:00", answers: null, responded_at: null })?.healthConsentAt).toBeNull();
  });
  it("null, pendiente o forma rota → null", () => {
    expect(parseRsvpPrevious(null)).toBeNull();
    expect(parseRsvpPrevious({ status: "pendiente", companions: 0 })).toBeNull();
    expect(parseRsvpPrevious("si")).toBeNull();
  });
  it("módulos con forma desconocida se descartan sin romper el resto", () => {
    const previous = parseRsvpPrevious({ status: "si", companions: 1, answers: { raro: true }, responded_at: null });
    expect(previous).toEqual({ status: "si", companions: 1, hasHealthNote: false, hasLogisticNote: false, hasCompanionNames: false, healthConsentAt: null, answers: {}, respondedAt: null });
  });
  it("con «no» los acompañantes son 0", () => {
    expect(parseRsvpPrevious({ status: "no", companions: 3, notes: null, answers: null, responded_at: null })?.companions).toBe(0);
  });
});

describe("rsvpFormInitialState", () => {
  it("rellena los módulos y marca lo guardado que no se muestra", () => {
    const state = rsvpFormInitialState({ status: "si", companions: 2, hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true, healthConsentAt: "2026-10-08T18:30:00+00:00", respondedAt: null, answers: { bus: { use: "ida" }, song: "Vivir así", kids: 1, menu: { "m-1": 3 } } });
    expect(state).toEqual({ attending: "si", companions: 2, healthNoteKept: true, logisticNoteKept: true, companionNamesKept: true, busUse: "ida", busStop: null, lodging: null, hotel: null, song: "Vivir así", kids: 1, menu: { "m-1": 3 }, diet: {} });
  });
  it("vegetarianos y veganos guardados (ítem 21) vuelven al formulario", () => {
    const state = rsvpFormInitialState({ status: "si", companions: 1, hasHealthNote: false, respondedAt: null, answers: { diet: { vegano: 1 } } });
    expect(state.diet).toEqual({ vegano: 1 });
  });
  it("con «no» no hay nota de salud ni nombres que conservar; la logística sí", () => {
    const state = rsvpFormInitialState({ status: "no", companions: 0, hasHealthNote: true, hasLogisticNote: true, hasCompanionNames: true, respondedAt: null, answers: {} });
    expect(state).toMatchObject({ healthNoteKept: false, companionNamesKept: false, logisticNoteKept: true });
  });
});

describe("rsvpKeptPayload: qué se conserva al reenviar", () => {
  const base = { attending: "si" as const, healthNotes: "", healthNoteKept: true, logisticNotes: "", logisticNoteKept: true, companions: 2, initialCompanions: 2, companionNamesKept: true, companionNamesTouched: false };
  it("todo en blanco y guardado: se conserva todo", () => {
    expect(rsvpKeptPayload(base)).toEqual({ keepHealthNote: true, notes: undefined, keepCompanionNames: true });
  });
  it("lo que se reescribe sustituye a lo guardado", () => {
    expect(rsvpKeptPayload({ ...base, healthNotes: "Sin lactosa", logisticNotes: "Carrito" })).toEqual({ keepHealthNote: false, notes: "Carrito", keepCompanionNames: true });
  });
  it("«Borrar» (marca a false) o nada guardado: se borra", () => {
    expect(rsvpKeptPayload({ ...base, healthNoteKept: false, logisticNoteKept: false })).toEqual({ keepHealthNote: false, notes: "", keepCompanionNames: true });
  });
  it("nombres: escribir alguno o bajar el número de acompañantes los sustituye", () => {
    expect(rsvpKeptPayload({ ...base, companionNamesTouched: true }).keepCompanionNames).toBe(false);
    expect(rsvpKeptPayload({ ...base, companions: 1 }).keepCompanionNames).toBe(false);
    expect(rsvpKeptPayload({ ...base, companions: 0 }).keepCompanionNames).toBe(false);
  });
  it("nombres guardados + subir de 2 a 3 sin tocarlos: se conservan (F4)", () => {
    expect(rsvpKeptPayload({ ...base, companions: 3 }).keepCompanionNames).toBe(true);
  });

  it("con «no» no se conserva ni salud ni nombres", () => {
    expect(rsvpKeptPayload({ ...base, attending: "no" })).toEqual({ keepHealthNote: false, notes: undefined, keepCompanionNames: false });
  });
  it("aviso de tú", () => {
    expect(HEALTH_NOTE_KEPT_TEXT).toBe("Ya nos dijiste algo sobre alergias; si quieres cambiarlo, escríbelo de nuevo.");
  });
});

describe("menuMissingHint (aviso no bloqueante)", () => {
  it("cuenta quien falta por elegir; nada si ya están todos", () => {
    expect(menuMissingHint(8, 0)).toBe("Falta elegir el menú de 8 personas.");
    expect(menuMissingHint(3, 2)).toBe("Falta elegir el menú de 1 persona.");
    expect(menuMissingHint(1, 0)).toBe("Falta elegir el menú de 1 persona.");
    expect(menuMissingHint(3, 3)).toBeNull();
    expect(menuMissingHint(2, 5)).toBeNull();
  });
});

describe("previousResponseText", () => {
  it("con fecha (hora de Madrid)", () => {
    // 23:30 UTC del 8 = 9 de octubre en Madrid.
    expect(previousResponseText({ respondedAt: "2026-10-08T23:30:00Z" })).toBe("Ya nos respondiste el 9 de octubre. Puedes cambiarlo aquí.");
  });
  it("sin fecha", () => {
    expect(previousResponseText({ respondedAt: null })).toBe("Ya nos respondiste. Puedes cambiarlo aquí.");
  });
});

describe("parseGuestRsvpCurrent: respuesta + tope (§4.2)", () => {
  it("pendiente con tope: sin respuesta, con tope", () => {
    expect(parseGuestRsvpCurrent({ status: null, max_companions: 2 })).toEqual({ previous: null, maxCompanions: 2, guestName: null });
  });
  it("sin la migración del tope: tope null", () => {
    expect(parseGuestRsvpCurrent({ status: "si", companions: 1, notes: null, answers: null, responded_at: null })).toEqual({
      previous: { status: "si", companions: 1, hasHealthNote: false, hasLogisticNote: false, hasCompanionNames: false, healthConsentAt: null, answers: {}, respondedAt: null }, maxCompanions: null, guestName: null,
    });
  });
  it("una respuesta anterior por encima del tope nuevo se recorta (y sus nombres se sustituirán)", () => {
    const current = parseGuestRsvpCurrent({ status: "si", companions: 4, has_companion_names: true, answers: null, responded_at: null, max_companions: 1 });
    expect(current?.previous?.companions).toBe(1);
    expect(current?.previous?.hasCompanionNames).toBe(false);
  });
  it("plazo cerrado ({closed: true}): enlace válido sin nada que rellenar", () => {
    expect(parseGuestRsvpCurrent({ closed: true })).toEqual({ previous: null, maxCompanions: null, guestName: null });
  });
  it("nombre del titular (20261101130000): recortado; vacío, raro o sin la migración → null", () => {
    expect(parseGuestRsvpCurrent({ status: null, max_companions: null, guest_name: "  Carmen Ruiz " })?.guestName).toBe("Carmen Ruiz");
    expect(parseGuestRsvpCurrent({ status: null, guest_name: "   " })?.guestName).toBeNull();
    expect(parseGuestRsvpCurrent({ status: null, guest_name: 42 })?.guestName).toBeNull();
    expect(parseGuestRsvpCurrent({ status: null })?.guestName).toBeNull();
  });
  it("basura → null", () => {
    expect(parseGuestRsvpCurrent(null)).toBeNull();
    expect(parseGuestRsvpCurrent([1])).toBeNull();
  });
  it("textos", () => {
    expect(maxCompanionsHint(1)).toBe("Hasta 1 acompañante.");
    expect(maxCompanionsHint(3)).toBe("Hasta 3 acompañantes.");
    expect(tooManyCompanionsError(2)).toBe("Tu invitación es para ti y 2 personas más. Si necesitas cambiarlo, escribe a la pareja.");
    expect(tooManyCompanionsError(1)).toBe("Tu invitación es para ti y 1 persona más. Si necesitas cambiarlo, escribe a la pareja.");
    expect(tooManyCompanionsError(0)).toBe("Tu invitación es solo para ti. Si necesitas cambiarlo, escribe a la pareja.");
  });
});

describe("copys del formulario (§4-j)", () => {
  it("autobús: plural con las personas de la invitación, singular si va una", () => {
    expect(busQuestion(1)).toBe("¿Usarás el autobús?");
    expect(busQuestion(3)).toBe("¿Usaréis el autobús las 3 personas de vuestra invitación?");
  });
  it("segunda línea: solo con acompañantes y todos con nombre", () => {
    expect(rsvpSavedSummary(2, ["Pablo", " Leo "])).toBe("Respuesta guardada. Vais 3 personas: tú, Pablo y Leo.");
    expect(rsvpSavedSummary(1, ["Pablo"])).toBe("Respuesta guardada. Vais 2 personas: tú y Pablo.");
    expect(rsvpSavedSummary(2, ["Pablo"])).toBeNull();
    expect(rsvpSavedSummary(2, ["Pablo", "  "])).toBeNull();
    expect(rsvpSavedSummary(0, [])).toBeNull();
  });
});

describe("companionNamesNotice: aviso sobre los nombres guardados (F4)", () => {
  const base = { attending: "si" as const, companions: 2, initialCompanions: 2, companionNamesKept: true, companionNamesTouched: false };
  it("mismo número o más, sin tocar: se conservan", () => {
    expect(companionNamesNotice(base)).toBe(COMPANION_NAMES_KEPT_TEXT);
    expect(companionNamesNotice({ ...base, companions: 3 })).toBe(COMPANION_NAMES_KEPT_TEXT);
  });
  it("menos acompañantes sin escribir nombres: avisa antes de enviar de que se borrarán", () => {
    expect(companionNamesNotice({ ...base, companions: 1 })).toBe(COMPANION_NAMES_DROP_TEXT);
    expect(companionNamesNotice({ ...base, companions: 0 })).toBe(COMPANION_NAMES_DROP_ALL_TEXT);
  });
  it("con algún nombre escrito: la lista nueva sustituye a la guardada", () => {
    expect(companionNamesNotice({ ...base, companionNamesTouched: true })).toBe(COMPANION_NAMES_REPLACE_TEXT);
  });
  it("sin nombres guardados o con «no»: nada", () => {
    expect(companionNamesNotice({ ...base, companionNamesKept: false, companions: 0 })).toBeNull();
    expect(companionNamesNotice({ ...base, attending: "no", companions: 0 })).toBeNull();
  });
});
