import { z } from "zod";

import { enabledScenes, findScene, type SiteDocument } from "./site-document";
import { dietSummaryText } from "./rsvp-diet";
import { BUS_USES, LODGING_WHERE, RSVP_SONG_MAX, type BusUse, type LodgingWhere, type RsvpModules } from "./rsvp-modules";

export { BUS_USES, LODGING_WHERE, NO_MODULES, RSVP_SONG_MAX, hasModules, type BusUse, type LodgingWhere, type RsvpModules } from "./rsvp-modules";

/**
 * Respuestas a los módulos del formulario de asistencia (8-oct-2026, docs/
 * superpowers/specs/2026-10-08-modulos-rsvp-design.md). Se guardan en
 * `wedding_guests.rsvp_answers` (≤ 4 KB, objeto). El servidor valida SIEMPRE
 * contra los módulos activos de la web publicada: una respuesta de autobús en
 * una boda sin autobuses no se guarda.
 */

export interface RsvpAnswers {
  bus?: { use: BusUse; stop?: string };
  lodging?: { where: LodgingWhere; hotel?: string };
  song?: string;
  /** Cuántas de las personas que vienen son niños. */
  kids?: number;
  /** Personas por opción de menú (id → n). */
  menu?: Record<string, number>;
  /**
   * Personas vegetarianas / veganas (ítem 21, 17-oct-2026). Preferencias, no
   * salud: las alergias van en la nota de salud con consentimiento
   * (lib/rsvp-diet.ts). Opcional: las respuestas anteriores no lo llevan.
   */
  diet?: Partial<Record<"vegetariano" | "vegano", number>>;
}

export function rsvpModulesFromDocument(doc: SiteDocument): RsvpModules {
  const scenes = enabledScenes(doc);
  const transport = scenes.find((s) => s.type === "transport");
  const stay = scenes.find((s) => s.type === "stay");
  const rsvp = findScene(doc, "rsvp");
  return {
    // Sin paradas no hay autobús al que apuntarse: no se pregunta (8-oct-2026).
    bus: transport?.type === "transport" && transport.props.ask && transport.props.stops.length > 0
      ? { stops: transport.props.stops.map((s) => ({ id: s.id, name: s.name, time: s.time })) }
      : null,
    lodging: stay?.type === "stay" && stay.props.ask
      ? { hotels: stay.props.hotels.map((h) => ({ id: h.id, name: h.name })) }
      : null,
    song: Boolean(rsvp?.props.song),
    kids: Boolean(rsvp?.props.kids),
    menu: (rsvp?.props.menuOptions ?? []).map((o) => ({ id: o.id, label: o.label })),
  };
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
/** Lo que llega del cliente: forma suelta; la regla de negocio va después. */
export const rsvpAnswersInputSchema = z
  .object({
    bus: z.object({ use: z.enum(BUS_USES), stop: id.optional() }).optional(),
    lodging: z.object({ where: z.enum(LODGING_WHERE), hotel: id.optional() }).optional(),
    song: z.string().max(RSVP_SONG_MAX * 2).optional(),
    kids: z.number().int().min(0).max(11).optional(),
    menu: z.record(id, z.number().int().min(0).max(11)).optional(),
    diet: z.object({ vegetariano: z.number().int().min(0).max(11).optional(), vegano: z.number().int().min(0).max(11).optional() }).strict().optional(),
  })
  .strict();
export type RsvpAnswersInput = z.input<typeof rsvpAnswersInputSchema>;

export type CleanAnswers = { ok: true; answers: RsvpAnswers | null } | { ok: false; error: string };

/**
 * Valida y limpia las respuestas para los módulos activos. `people` = quien
 * responde + acompañantes. Lo que no corresponde a un módulo activo se
 * descarta en silencio (una web cambiada entre abrir y enviar no bloquea al
 * invitado); lo incoherente con lo activo devuelve un error para el invitado.
 */
export function cleanRsvpAnswers(input: unknown, modules: RsvpModules, attending: "si" | "no", companions: number): CleanAnswers {
  if (attending === "no" || input == null) return { ok: true, answers: null };
  const parsed = rsvpAnswersInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Alguna respuesta no es válida. Revísala y vuelve a enviarla." };
  const raw = parsed.data;
  const people = companions + 1;
  const out: RsvpAnswers = {};

  if (modules.bus && raw.bus) {
    const { stops } = modules.bus;
    const goes = raw.bus.use === "ida" || raw.bus.use === "ambos";
    let stop: string | undefined;
    if (goes && stops.length === 1) stop = stops[0]!.id;
    else if (goes && stops.length > 1) {
      if (!raw.bus.stop || !stops.some((s) => s.id === raw.bus!.stop)) return { ok: false, error: "Dinos desde qué parada cogerás el autobús." };
      stop = raw.bus.stop;
    }
    out.bus = stop ? { use: raw.bus.use, stop } : { use: raw.bus.use };
  }

  if (modules.lodging && raw.lodging) {
    const { hotels } = modules.lodging;
    if (raw.lodging.where === "hotel") {
      if (hotels.length === 0) out.lodging = { where: "otro" };
      else if (hotels.length === 1) out.lodging = { where: "hotel", hotel: hotels[0]!.id };
      else if (raw.lodging.hotel && hotels.some((h) => h.id === raw.lodging!.hotel)) out.lodging = { where: "hotel", hotel: raw.lodging.hotel };
      else return { ok: false, error: "Dinos en cuál de los hoteles te alojarás." };
    } else {
      out.lodging = { where: raw.lodging.where };
    }
  }

  if (modules.song && raw.song) {
    const song = raw.song.replace(/\s+/g, " ").trim().slice(0, RSVP_SONG_MAX);
    if (song) out.song = song;
  }

  if (modules.kids && raw.kids !== undefined) {
    if (raw.kids > companions) return { ok: false, error: companions === 0 ? "Si vienen niños, súmalos como acompañantes." : `Como mucho ${companions} ${companions === 1 ? "niño" : "niños"}: el resto de acompañantes.` };
    out.kids = raw.kids;
  }

  if (modules.menu.length > 0 && raw.menu) {
    const menu: Record<string, number> = {};
    let total = 0;
    for (const option of modules.menu) {
      const n = raw.menu[option.id] ?? 0;
      if (n > 0) { menu[option.id] = n; total += n; }
    }
    if (total > 0) {
      // Se puede elegir solo una parte (P1-6): lo que falte lo ve la pareja como «sin menú».
      if (total > people) return { ok: false, error: `El menú no puede sumar más de ${people} ${people === 1 ? "persona" : "personas"} (tú y tus acompañantes).` };
      out.menu = menu;
    }
  }

  // Vegetariano / vegano (ítem 21): no depende de un módulo; nunca más personas de las que vienen.
  if (raw.diet) {
    const vegetariano = raw.diet.vegetariano ?? 0;
    const vegano = raw.diet.vegano ?? 0;
    if (vegetariano + vegano > people) return { ok: false, error: `Como mucho ${people} ${people === 1 ? "persona" : "personas"} con dieta vegetariana o vegana (tú y tus acompañantes).` };
    const diet: NonNullable<RsvpAnswers["diet"]> = {};
    if (vegetariano > 0) diet.vegetariano = vegetariano;
    if (vegano > 0) diet.vegano = vegano;
    if (Object.keys(diet).length > 0) out.diet = diet;
  }

  return { ok: true, answers: Object.keys(out).length > 0 ? out : null };
}

/** Lee lo guardado (jsonb) sin confiar en su forma; nunca lanza. */
export function readRsvpAnswers(value: unknown): RsvpAnswers | null {
  const parsed = rsvpAnswersInputSchema.safeParse(value);
  return parsed.success ? (parsed.data as RsvpAnswers) : null;
}

// ---------------------------------------------------------------------------
// Panel: textos y totales para la pareja
// ---------------------------------------------------------------------------

/** Nombres visibles de paradas, hoteles y menús (de la web, aunque no se pregunte). */
export interface ModuleLabels {
  stops: Record<string, string>;
  hotels: Record<string, string>;
  menu: Record<string, string>;
}

export function moduleLabelsFromDocument(doc: SiteDocument): ModuleLabels {
  const labels: ModuleLabels = { stops: {}, hotels: {}, menu: {} };
  for (const scene of doc.scenes) {
    if (scene.type === "transport") for (const s of scene.props.stops) labels.stops[s.id] = s.time ? `${s.name} (${s.time})` : s.name;
    if (scene.type === "stay") for (const h of scene.props.hotels) labels.hotels[h.id] = h.name;
    if (scene.type === "rsvp") for (const o of scene.props.menuOptions ?? []) labels.menu[o.id] = o.label;
  }
  return labels;
}

export const BUS_USE_LABELS: Record<BusUse, string> = { ambos: "Ida y vuelta", ida: "Solo ida", vuelta: "Solo vuelta", no: "Sin autobús" };

export function busText(a: RsvpAnswers, l: ModuleLabels): string {
  if (!a.bus) return "";
  const stop = a.bus.stop ? l.stops[a.bus.stop] ?? "" : "";
  return a.bus.use === "no" ? BUS_USE_LABELS.no : `${BUS_USE_LABELS[a.bus.use]}${stop ? ` desde ${stop}` : ""}`;
}

export function lodgingText(a: RsvpAnswers, l: ModuleLabels): string {
  if (!a.lodging) return "";
  if (a.lodging.where === "hotel") return a.lodging.hotel ? l.hotels[a.lodging.hotel] ?? "En uno de vuestros hoteles" : "En uno de vuestros hoteles";
  return a.lodging.where === "otro" ? "En otro sitio" : "No se aloja";
}

export function menuText(a: RsvpAnswers, l: ModuleLabels): string {
  return Object.entries(a.menu ?? {}).map(([id, n]) => `${n} ${l.menu[id] ?? "menú"}`.trim()).join(", ");
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Una línea para la ficha del invitado: «Autobús: ida y vuelta desde Madrid · Hotel Los Olivos · 2 Carne · 1 niño». */
export function describeAnswers(a: RsvpAnswers | null, l: ModuleLabels): string {
  if (!a) return "";
  const parts = [
    a.bus ? `Autobús: ${lowerFirst(busText(a, l))}` : "",
    a.lodging ? `Se aloja: ${lodgingText(a, l)}` : "",
    menuText(a, l) ? `Menú: ${menuText(a, l)}` : "",
    a.kids ? `${a.kids} ${a.kids === 1 ? "niño" : "niños"}` : "",
    a.diet ? dietSummaryText(a.diet) : "",
    a.song ? `Canción: «${a.song}»` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export interface AnswerRow {
  id: string;
  name: string;
  companions: number;
  answers: RsvpAnswers | null;
}

export interface ModuleTotals {
  /** Personas que respondieron «sí» con algún módulo contestado. */
  responded: number;
  bus: { ida: number; vuelta: number; byStop: Array<{ label: string; people: number }>; none: number } | null;
  lodging: { byHotel: Array<{ label: string; people: number; bus: number }>; other: number; otherBus: number; none: number } | null;
  menu: Array<{ label: string; people: number }>;
  /** Personas que vienen sin menú elegido (0 si no se pregunta el menú). */
  menuMissing: number;
  kids: number;
  songs: Array<{ song: string; name: string }>;
}

/** Personas de esta fila sin menú: las que vienen menos las que ya eligieron (nunca negativo). */
export function rowMenuMissing(row: Pick<AnswerRow, "companions" | "answers">): number {
  const chosen = Object.values(row.answers?.menu ?? {}).reduce((sum, n) => sum + n, 0);
  return Math.max(0, row.companions + 1 - chosen);
}

/**
 * «N personas sin menú» (P1-6): confirmados − suma de menús elegidos. `rows`
 * deben ser TODOS los que vienen, también los que no contestaron ningún
 * módulo (answers null): son justo los que faltan. Por fila, para que un
 * exceso de uno no tape lo que falta de otro. 0 si la boda no pregunta menú.
 */
export function menuMissingCount(rows: ReadonlyArray<Pick<AnswerRow, "companions" | "answers">>, modules: Pick<RsvpModules, "menu">): number {
  if (modules.menu.length === 0) return 0;
  return rows.reduce((sum, row) => sum + rowMenuMissing(row), 0);
}

/**
 * Totales por módulo, contando personas (quien responde + acompañantes).
 * `menuFrom`: menús entre los que pueden elegir los invitados (la web
 * publicada, guestMenuModules) para «sin menú»; por defecto, los de `modules`.
 */
export function summarizeAnswers(rows: AnswerRow[], modules: RsvpModules, l: ModuleLabels, menuFrom: Pick<RsvpModules, "menu"> | null = modules): ModuleTotals {
  const people = (r: AnswerRow) => r.companions + 1;
  const usesBus = (a: RsvpAnswers) => Boolean(a.bus && a.bus.use !== "no");
  const withAnswers = rows.filter((r) => r.answers);
  const totals: ModuleTotals = { responded: withAnswers.length, bus: null, lodging: null, menu: [], menuMissing: menuFrom ? menuMissingCount(rows, menuFrom) : 0, kids: 0, songs: [] };
  if (modules.bus) {
    const byStop = new Map<string, number>();
    let ida = 0, vuelta = 0, none = 0;
    for (const r of withAnswers) {
      const b = r.answers!.bus;
      if (!b) continue;
      const n = people(r);
      if (b.use === "no") { none += n; continue; }
      if (b.use === "ida" || b.use === "ambos") { ida += n; if (b.stop) byStop.set(b.stop, (byStop.get(b.stop) ?? 0) + n); }
      if (b.use === "vuelta" || b.use === "ambos") vuelta += n;
    }
    totals.bus = { ida, vuelta, none, byStop: [...byStop].map(([id, n]) => ({ label: l.stops[id] ?? "Parada", people: n })) };
  }
  if (modules.lodging) {
    const byHotel = new Map<string, { people: number; bus: number }>();
    let other = 0, otherBus = 0, none = 0;
    for (const r of withAnswers) {
      const lo = r.answers!.lodging;
      if (!lo) continue;
      const n = people(r);
      const bus = usesBus(r.answers!) ? n : 0;
      if (lo.where === "hotel" && lo.hotel) {
        const prev = byHotel.get(lo.hotel) ?? { people: 0, bus: 0 };
        byHotel.set(lo.hotel, { people: prev.people + n, bus: prev.bus + bus });
      } else if (lo.where === "no") none += n;
      else { other += n; otherBus += bus; }
    }
    totals.lodging = { byHotel: [...byHotel].map(([id, v]) => ({ label: l.hotels[id] ?? "Hotel", ...v })), other, otherBus, none };
  }
  if (modules.menu.length > 0) {
    totals.menu = modules.menu.map((o) => ({ label: o.label, people: withAnswers.reduce((sum, r) => sum + (r.answers!.menu?.[o.id] ?? 0), 0) }));
  }
  totals.kids = withAnswers.reduce((sum, r) => sum + (r.answers!.kids ?? 0), 0);
  totals.songs = withAnswers.filter((r) => r.answers!.song).map((r) => ({ song: r.answers!.song!, name: r.name }));
  return totals;
}
