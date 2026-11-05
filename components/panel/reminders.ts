/**
 * Recordatorios en el panel (puro, sin React): estado de la fila en la URL,
 * fechas cortas y textos de cada filtro. La fila se reconstruye siempre desde
 * el servidor (`getReminderQueue`); la URL solo guarda dónde está la pareja,
 * para sobrevivir a la recarga de iOS al volver de WhatsApp. Nunca guarda
 * tokens, enlaces ni textos de mensaje.
 */
import type { GuestListFilter } from "@/lib/messages/filters";
import { formatCount, plural } from "@/components/panel/guest-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tope de personas saltadas que viajan en la URL (36 caracteres cada una). */
export const MAX_SKIPPED = 50;
const MAX_COUNTER = 1000;

export interface QueueState {
  /** Persona en curso (id de invitado) o null = la primera de la fila. */
  persona: string | null;
  /** true tras abrir WhatsApp: al volver se pregunta «¿Lo has enviado?». */
  confirmar: boolean;
  /** Recordatorios confirmados en esta tanda. */
  enviados: number;
  /** Personas marcadas «No volver a recordarle» en esta tanda. */
  retirados: number;
  /** Personas saltadas en esta tanda (siguen en la fila del servidor). */
  saltados: string[];
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function counter(value: string | undefined): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 0;
  return Math.min(Number(value), MAX_COUNTER);
}

export function parseQueueState(params: Params): QueueState {
  const persona = read(params, "persona");
  const validPersona = persona && UUID.test(persona) ? persona.toLowerCase() : null;
  const skipped = (read(params, "saltados") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id, index, all) => UUID.test(id) && all.indexOf(id) === index)
    .slice(0, MAX_SKIPPED);
  return {
    persona: validPersona,
    confirmar: Boolean(validPersona) && read(params, "paso") === "confirmar",
    enviados: counter(read(params, "enviados")),
    retirados: counter(read(params, "retirados")),
    saltados: skipped,
  };
}

export function queueUrl(basePath: string, state: QueueState): string {
  const [path, existing] = basePath.split("?");
  const search = new URLSearchParams(existing);
  for (const key of ["persona", "paso", "enviados", "retirados", "saltados"]) search.delete(key);
  if (state.persona) search.set("persona", state.persona);
  if (state.persona && state.confirmar) search.set("paso", "confirmar");
  if (state.enviados > 0) search.set("enviados", String(Math.min(state.enviados, MAX_COUNTER)));
  if (state.retirados > 0) search.set("retirados", String(Math.min(state.retirados, MAX_COUNTER)));
  if (state.saltados.length > 0) search.set("saltados", state.saltados.slice(0, MAX_SKIPPED).join(","));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface QueuePerson { id: string }

export interface QueueView<T extends QueuePerson> {
  /** Persona que toca ahora (null = tanda terminada o fila vacía). */
  current: T | null;
  /** La persona de la URL ya no está en la fila (respondió, o se confirmó en otro dispositivo). */
  personaGone: boolean;
  /** Posición 1-based dentro de la tanda y total de la tanda. */
  position: number;
  total: number;
  /** Personas que quedan sin tocar (sin contar saltadas). */
  remaining: number;
  /** Saltadas que siguen en la fila (para «Repasar a quien habéis saltado»). */
  skippedInQueue: number;
}

/**
 * Vista de la tanda a partir de la fila del servidor + la URL. Confirmados y
 * retirados ya no vienen del servidor (ventana de 3 días / «no recordar»),
 * así que el total de la tanda es lo hecho + lo que queda en la fila.
 */
export function queueView<T extends QueuePerson>(queue: T[], state: QueueState): QueueView<T> {
  const skipped = new Set(state.saltados);
  const pending = queue.filter((item) => !skipped.has(item.id));
  const skippedInQueue = queue.length - pending.length;
  const fromUrl = state.persona ? pending.find((item) => item.id === state.persona) ?? null : null;
  const current = fromUrl ?? pending[0] ?? null;
  const done = state.enviados + state.retirados + skippedInQueue;
  const total = done + pending.length;
  return {
    current,
    personaGone: Boolean(state.persona) && !fromUrl && !skipped.has(state.persona ?? ""),
    position: current ? Math.min(done + 1, total) : total,
    total,
    remaining: pending.length,
    skippedInQueue,
  };
}

/* --- Fechas ------------------------------------------------------------ */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const madrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * «3 oct» (con año si no es el de `now`: «3 oct 2025»). Hora de Madrid fija:
 * el servidor y el navegador pintan lo mismo (sin desajustes de hidratación).
 */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const [year, month, day] = madrid.format(date).split("-").map(Number);
  const [currentYear] = madrid.format(now).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}${year !== currentYear ? ` ${year}` : ""}`;
}

/** «Recordada 1 vez, el 3 oct» · «Recordada 3 veces, la última el 3 oct» · "" si nunca. */
export function reminderSummary(count: number, lastAt: string | null | undefined, now?: Date): string {
  if (count <= 0) return "";
  const when = shortDate(lastAt, now);
  if (count === 1) return when ? `Recordada 1 vez, el ${when}` : "Recordada 1 vez";
  return when ? `Recordada ${formatCount(count)} veces, la última el ${when}` : `Recordada ${formatCount(count)} veces`;
}

/* --- Filtros: vacíos con dirección -------------------------------------- */

export const FILTER_EMPTY: Record<GuestListFilter, { title: string; body: string }> = {
  todos: { title: "Nadie en la lista todavía", body: "Añadid a vuestros invitados para empezar a enviar las invitaciones." },
  sin_enviar: { title: "Nadie sin enviar", body: "Todas las invitaciones están en camino. Cuando añadáis a alguien nuevo, aparecerá aquí." },
  enviada_sin_abrir: { title: "Nadie con la invitación sin abrir", body: "Todas las invitaciones que habéis enviado se han abierto al menos una vez. Lo vemos cuando alguien abre su enlace personal." },
  abierta_sin_responder: { title: "Nadie la ha abierto sin responder", body: "Quien abra su enlace personal y aún no haya dicho si viene aparecerá aquí." },
  esperando: { title: "Nadie esperando respuesta", body: "Quien recibe vuestra invitación y aún no ha respondido aparece aquí." },
  para_recordar: { title: "Nadie para recordar ahora", body: "Proponemos recordar a partir de 3 días después de la invitación y nunca dos veces en menos de 3 días; con el plazo cerrado, a nadie. Quien pidió no recibirlos tampoco aparece." },
  vienen: { title: "Nadie ha confirmado aún", body: "Cuando alguien diga que viene desde su enlace, aparecerá aquí con sus acompañantes." },
  no_vienen: { title: "Nadie ha dicho que no", body: "Si alguien no puede venir, lo veréis aquí." },
  sin_telefono: { title: "Todos tienen teléfono", body: "Podéis abrir WhatsApp con cualquier persona de vuestra lista." },
  con_notas: { title: "Nadie ha dejado notas", body: "Las alergias y los comentarios que escriban al responder aparecerán aquí, para el catering." },
  con_regalo: { title: "Aún no habéis anotado regalos", body: "Abrid a un invitado de la lista y pulsad «Anotar regalo». Es solo para vosotros: nadie más lo ve." },
  regalo_sin_indicar: { title: "Todo anotado", body: "Cada persona tiene un regalo anotado o la habéis marcado «Sin regalo»." },
  sin_agradecer: { title: "Nadie por agradecer", body: "Todos los regalos que habéis anotado están agradecidos." },
  sin_regalo: { title: "Nadie marcado sin regalo", body: "Desde la ficha de cada invitado podéis marcar «Sin regalo» para llevar vuestra cuenta." },
  sin_respuesta: { title: "Todo el mundo ha respondido", body: "No queda nadie sin responder." },
};

/** «12 personas no han respondido» · «1 persona no ha respondido». */
export function waitingLine(count: number): string {
  return count === 1 ? "1 persona no ha respondido" : `${plural(count, "persona", "personas")} no han respondido`;
}
