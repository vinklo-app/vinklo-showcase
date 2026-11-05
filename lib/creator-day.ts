/**
 * «Más secciones en El día» (13-oct-2026, backlog del dueño, punto 9): lo que
 * la pareja añade a mano en el paso «Vuestro día» del creador además de
 * ceremonia, cóctel y banquete: más momentos del programa (hora, título,
 * sitio y notas), tarjetas de detalles (dress code, regalos…) y preguntas.
 *
 * Por qué campos propios del borrador y no la capa de secciones
 * (lib/creator-sections.ts): la capa se valida con el contrato, que exige
 * título (o pregunta) en cada elemento. Una fila recién añadida y aún vacía
 * rompería el borrador guardado (`parseBuilderDraft` lo descartaría) o el
 * documento (`composeBuilderDocument` volvería al adaptador v1). Aquí las
 * filas son laxas, como las paradas y los hoteles, y solo llega a la web lo
 * que cumple el contrato (con título); lo vacío no se enseña.
 *
 * Puro, sin React. Lo usan `composeBuilderDocument`, `adoptProposal` y el
 * paso «Vuestro día».
 */
import { z } from "zod";
import { SITE_MAX_AGENDA_ITEMS, SITE_MAX_DETAIL_CARDS, SITE_MAX_FAQ_ITEMS, agendaItemSchema, detailCardSchema, faqItemSchema, type AgendaItem, type DetailCard, type FaqItem } from "./site-document";

/** Mismo patrón que los ids del contrato: el id de la fila es el del elemento en la web. */
const rowId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);

/** Momento añadido a mano. `timeLabel` es texto libre (como en el contrato): la IA puede escribir «Al anochecer». */
export const builderDayMomentSchema = z.strictObject({
  id: rowId,
  title: z.string().max(120),
  timeLabel: z.string().max(20),
  place: z.string().max(160),
  address: z.string().max(240),
  notes: z.string().max(400),
});
export type BuilderDayMoment = z.infer<typeof builderDayMomentSchema>;

/** Tarjeta de detalles añadida a mano (resumen y enlace solo llegan por la IA; se conservan). */
export const builderDayCardSchema = z.strictObject({
  id: rowId,
  title: z.string().max(80),
  teaser: z.string().max(120),
  body: z.string().max(800),
  link: z.string().max(2048).optional(),
  linkLabel: z.string().max(40),
  /** Tarjeta de plantilla aún sin tocar: se pinta con su texto de partida de ahora (ver `ownedList`). */
  auto: z.literal(true).optional(),
});
export type BuilderDayCard = z.infer<typeof builderDayCardSchema>;

export const builderDayQuestionSchema = z.strictObject({
  id: rowId,
  question: z.string().max(160),
  answer: z.string().max(800),
  /** Pregunta de plantilla aún sin tocar (ver `ownedList`). */
  auto: z.literal(true).optional(),
});
export type BuilderDayQuestion = z.infer<typeof builderDayQuestionSchema>;

export const DAY_MOMENTS_MAX = SITE_MAX_AGENDA_ITEMS;
export const DAY_CARDS_MAX = SITE_MAX_DETAIL_CARDS;
export const DAY_QUESTIONS_MAX = SITE_MAX_FAQ_ITEMS;

/** Momentos que genera el propio borrador (salida, los tres del día y vuelta): no son filas a mano. */
export const FIXED_MOMENT_IDS: ReadonlySet<string> = new Set(["m-salida", "m-ceremonia", "m-coctel", "m-banquete", "m-vuelta"]);

/** Prefijo de los ids de las filas a mano de cada lista. */
export const HAND_PREFIX = { moments: "m", cards: "d", questions: "q" } as const;

/**
 * Id nuevo para una fila (`m-p1`, `d-p2`…): distinto de todo lo que ya usa
 * esa lista, también de lo que recuerda la capa de secciones (un id que la
 * capa conoce heredaría sus cambios).
 */
export function nextHandId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}-p${n}`;
    if (!used.has(id)) return id;
  }
}

const clip = (value: string, max: number) => value.trim().slice(0, max);

/** Solo lo que cumple el contrato llega a la web (nunca rompe el documento). */
function valid<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Momentos a mano que llegan al programa: los que tienen título. */
export function handAgendaItems(rows: readonly BuilderDayMoment[] | undefined): AgendaItem[] {
  return (rows ?? []).flatMap((row) => {
    if (!row.title.trim()) return [];
    const item = valid(agendaItemSchema, { id: row.id, title: clip(row.title, 120), timeLabel: clip(row.timeLabel, 20), place: clip(row.place, 160), address: clip(row.address, 240), notes: clip(row.notes, 400) });
    return item ? [item] : [];
  });
}

/** Tarjetas a mano que llegan a «Detalles»: las que tienen título (un enlace que no valga se omite). */
export function handDetailCards(rows: readonly BuilderDayCard[] | undefined): DetailCard[] {
  return (rows ?? []).flatMap((row) => {
    if (!row.title.trim()) return [];
    const base = { id: row.id, title: clip(row.title, 80), teaser: clip(row.teaser, 120), body: clip(row.body, 800), linkLabel: clip(row.linkLabel, 40) };
    const link = row.link?.trim();
    const card = (link ? valid(detailCardSchema, { ...base, link }) : null) ?? valid(detailCardSchema, base);
    return card ? [card] : [];
  });
}

/** Preguntas a mano que llegan a «Preguntas»: las que tienen pregunta (sin respuesta, el invitado no la ve). */
export function handFaqItems(rows: readonly BuilderDayQuestion[] | undefined): FaqItem[] {
  return (rows ?? []).flatMap((row) => {
    if (!row.question.trim()) return [];
    const item = valid(faqItemSchema, { id: row.id, question: clip(row.question, 160), answer: clip(row.answer, 800) });
    return item ? [item] : [];
  });
}

/**
 * Ids de plantilla que ya pasaron a filas (`dayKnown`): con él, las filas
 * mandan sobre TODA la lista de detalles y de preguntas, también las de
 * plantilla, que se editan y se quitan como las demás.
 */
export const builderDayKnownSchema = z.strictObject({
  cards: z.array(z.string().max(40)).max(40),
  questions: z.array(z.string().max(40)).max(40),
});
export type BuilderDayKnown = z.infer<typeof builderDayKnownSchema>;

/**
 * Lista de detalles o preguntas cuando las filas mandan (`dayKnown`):
 *  - una fila `auto` (plantilla sin tocar) se pinta con lo que la plantilla
 *    dice AHORA (p. ej. la respuesta de «¿Puedo ir con niños?» depende de si
 *    preguntáis por niños) y desaparece si la plantilla ya no la genera;
 *  - el resto de filas, tal cual (solo las que tienen título);
 *  - lo de plantilla que aparezca después (activar autobuses añade
 *    «¿Hay autobús?») entra al final; lo que ya pasó a filas y se quitó, no vuelve.
 */
export function ownedList<R extends { id: string; auto?: true }, T extends { id: string }>(starter: readonly T[], rows: readonly R[] | undefined, known: readonly string[], emit: (rows: R[]) => T[], max: number): T[] {
  const live = new Map(starter.map((item) => [item.id, item]));
  const list = (rows ?? []).flatMap((row) => {
    if (!row.auto) return emit([row]);
    const current = live.get(row.id);
    return current ? [current] : [];
  });
  const seen = new Set([...known, ...(rows ?? []).map((row) => row.id)]);
  return [...list, ...starter.filter((item) => !seen.has(item.id))].slice(0, max);
}

/**
 * Minutos de un «HH:MM» en el día de la boda; null si no es una hora. Lo de
 * antes de las 06:00 cuenta como la madrugada siguiente (la fiesta a la 01:00
 * va después del banquete, no antes de la ceremonia).
 */
export function dayMinutes(label: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 6 * 60 ? minutes + 24 * 60 : minutes;
}

/**
 * Coloca los momentos a mano en el programa: con hora, delante del primero
 * que empieza más tarde (el programa es cronológico); sin hora, al final
 * (antes de la vuelta en autobús, que cierra el día), en el orden de la
 * pareja. Entre momentos a la misma hora manda también su orden.
 */
export function placeMoments(fixed: readonly AgendaItem[], hand: readonly AgendaItem[]): AgendaItem[] {
  const out = [...fixed];
  for (const item of hand) {
    const time = dayMinutes(item.timeLabel);
    let at = -1;
    if (time !== null) at = out.findIndex((other) => { const t = dayMinutes(other.timeLabel); return t !== null && t > time; });
    if (at === -1) {
      const back = out.findIndex((other) => other.id === "m-vuelta");
      at = back === -1 ? out.length : back;
    }
    out.splice(at, 0, item);
  }
  return out;
}

/** Elemento de la web → fila a mano (lo que propone la IA vuelve a su paso tal cual). */
export function momentRow(item: AgendaItem): BuilderDayMoment {
  return { id: item.id, title: item.title, timeLabel: item.timeLabel, place: item.place, address: item.address, notes: item.notes };
}
/** JSON con las claves ordenadas (igualdad sin depender del orden). */
const same = (a: unknown, b: unknown) => JSON.stringify(a, Object.keys(a ?? {}).sort()) === JSON.stringify(b, Object.keys(b ?? {}).sort());
/** Fila de un elemento: `auto` si es exactamente el de plantilla (sigue vivo). */
export function ownedCardRow(card: DetailCard, starter: DetailCard | undefined): BuilderDayCard {
  return starter && same(card, starter) ? { ...cardRow(card), auto: true } : cardRow(card);
}
export function ownedQuestionRow(item: FaqItem, starter: FaqItem | undefined): BuilderDayQuestion {
  return starter && same(item, starter) ? { ...questionRow(item), auto: true } : questionRow(item);
}
export function cardRow(card: DetailCard): BuilderDayCard {
  return { id: card.id, title: card.title, teaser: card.teaser, body: card.body, ...(card.link ? { link: card.link } : {}), linkLabel: card.linkLabel };
}
export function questionRow(item: FaqItem): BuilderDayQuestion {
  return { id: item.id, question: item.question, answer: item.answer };
}

/** Mueve una fila (subir/bajar); fuera de rango, igual. */
export function moveRow<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}
