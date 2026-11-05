/**
 * Menú y alergias por persona (revisión de producto, ítem 21; bloque 3).
 * Puro y sin dependencias (lo usan el formulario público, la server action,
 * la hoja del catering y el CSV): nada de zod aquí.
 *
 * El formulario pregunta, para ti y para cada acompañante, el menú (si la
 * boda lo ofrece) y unas casillas de dieta. Lo que se guarda NO cambia de
 * contrato:
 *  - Menú → `rsvp_answers.menu` (personas por opción), el reparto de siempre.
 *  - Vegetariano / vegano (preferencias, no salud) → `rsvp_answers.diet`
 *    (personas por preferencia). Opcional: las respuestas antiguas no lo llevan.
 *  - Celiaquía, lactosa, frutos secos, embarazada y «Otra» son datos de salud
 *    (art. 9 RGPD): se componen en el texto de la nota de salud
 *    (`rsvp_notes`, con su consentimiento versionado, como hasta ahora), una
 *    persona por tramo: «Tú: celiaquía; Pablo: alergia a los frutos secos,
 *    marisco». El enlace personal nunca la devuelve (M1).
 * El resumen «3 sin gluten · 2 vegetarianos» cuenta las casillas: solo lee
 * notas con esa forma exacta; lo demás («Otra», una nota escrita a mano de
 * antes o un apunte de la pareja) no se interpreta: se avisa de cuántas notas
 * hay que leer en la tabla.
 */

export const DIET_PREFERENCES = ["vegetariano", "vegano"] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number];
export const HEALTH_TAGS = ["celiaquia", "lactosa", "frutos-secos", "embarazada"] as const;
export type HealthTag = (typeof HEALTH_TAGS)[number];
export type DietTag = HealthTag | DietPreference;

/** Orden de las casillas en el formulario (el de la revisión). */
export const DIET_CHIPS: ReadonlyArray<{ id: DietTag; label: string }> = [
  { id: "celiaquia", label: "Celiaquía" },
  { id: "lactosa", label: "Lactosa" },
  { id: "frutos-secos", label: "Frutos secos" },
  { id: "vegetariano", label: "Vegetariano" },
  { id: "vegano", label: "Vegano" },
  { id: "embarazada", label: "Embarazada" },
];

/** Texto de cada casilla de salud dentro de la nota (lo que lee el catering). */
export const HEALTH_NOTE_TEXT: Record<HealthTag, string> = {
  celiaquia: "celiaquía",
  lactosa: "intolerancia a la lactosa",
  "frutos-secos": "alergia a los frutos secos",
  embarazada: "embarazada",
};

export const DIET_OTHER_MAX = 80;
/** Límite de la nota de salud (el mismo que el servidor y la RPC). */
export const HEALTH_NOTE_MAX = 500;

export const isHealthTag = (tag: DietTag): tag is HealthTag => (HEALTH_TAGS as readonly string[]).includes(tag);

/** Lo que se marca de una persona en el formulario. */
export interface PersonDiet {
  /** Id de la opción de menú; null = sin elegir. */
  menu: string | null;
  tags: DietTag[];
  /** Pulsó «Otra»: se pide cuál. */
  otherOn: boolean;
  other: string;
}

export const emptyPersonDiet = (): PersonDiet => ({ menu: null, tags: [], otherOn: false, other: "" });

/** Marcar/desmarcar una casilla. Vegetariano y vegano se excluyen entre sí. */
export function toggleDietTag(person: PersonDiet, tag: DietTag): PersonDiet {
  if (person.tags.includes(tag)) return { ...person, tags: person.tags.filter((t) => t !== tag) };
  const rest = tag === "vegano" ? person.tags.filter((t) => t !== "vegetariano") : tag === "vegetariano" ? person.tags.filter((t) => t !== "vegano") : person.tags;
  return { ...person, tags: [...rest, tag] };
}

/** «Otra»: texto de una línea, sin separadores de la nota. */
export function cleanDietOther(value: string): string {
  return value.replace(/\s*[;\n\r]+\s*/g, ", ").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").slice(0, DIET_OTHER_MAX).trim();
}

/** Nombre de cada persona en la nota: «Tú», el nombre del acompañante o «Acompañante 2». */
export function dietPersonLabel(index: number, companionName?: string | null): string {
  if (index === 0) return "Tú";
  const name = (companionName ?? "").replace(/[;:\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return name || `Acompañante ${index}`;
}

/** Hay algún dato de salud marcado o escrito (pide el consentimiento). */
export function hasHealthData(people: readonly PersonDiet[]): boolean {
  return people.some((p) => p.tags.some(isHealthTag) || (p.otherOn && cleanDietOther(p.other) !== ""));
}

/**
 * Nota de salud a partir de las casillas: «Tú: celiaquía; Pablo: alergia a
 * los frutos secos, marisco». Solo las personas con algo de salud; vacía si
 * nadie marcó nada (vegetariano y vegano no van aquí).
 */
export function composeHealthNote(people: ReadonlyArray<{ label: string; diet: PersonDiet }>): string {
  return people
    .map(({ label, diet }) => {
      const items = HEALTH_TAGS.filter((tag) => diet.tags.includes(tag)).map((tag) => HEALTH_NOTE_TEXT[tag]);
      const other = diet.otherOn ? cleanDietOther(diet.other) : "";
      if (other) items.push(other);
      return items.length > 0 ? `${label}: ${items.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

/** Preferencias para `rsvp_answers.diet`: personas por preferencia; null si ninguna. */
export function dietPreferenceCounts(people: readonly PersonDiet[]): Partial<Record<DietPreference, number>> | null {
  const out: Partial<Record<DietPreference, number>> = {};
  for (const pref of DIET_PREFERENCES) {
    const n = people.filter((p) => p.tags.includes(pref)).length;
    if (n > 0) out[pref] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Menú por persona → reparto de siempre (`rsvp_answers.menu`); null si nadie eligió. */
export function menuCountsFromPeople(people: readonly PersonDiet[], options: ReadonlyArray<{ id: string }>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const option of options) {
    const n = people.filter((p) => p.menu === option.id).length;
    if (n > 0) out[option.id] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Al reabrir el enlace: el reparto guardado (y las preferencias) se reparten
 * por orden entre tú y tus acompañantes. Lo de salud no vuelve (M1): la nota
 * guardada se conserva hasta que se marque algo nuevo.
 */
export function peopleFromAnswers(
  count: number,
  menu: Record<string, number> | undefined,
  diet: Partial<Record<DietPreference, number>> | undefined,
  options: ReadonlyArray<{ id: string }>,
): PersonDiet[] {
  const people = Array.from({ length: Math.max(0, count) }, emptyPersonDiet);
  let i = 0;
  for (const option of options) {
    for (let n = menu?.[option.id] ?? 0; n > 0 && i < people.length; n--) people[i++]!.menu = option.id;
  }
  let j = 0;
  for (const pref of DIET_PREFERENCES) {
    for (let n = diet?.[pref] ?? 0; n > 0 && j < people.length; n--) people[j++]!.tags = [pref];
  }
  return people;
}

/** Ajusta la lista al número de personas sin perder lo marcado de quien sigue (ni de quien vuelve). */
export function resizePeople(people: readonly PersonDiet[], count: number): PersonDiet[] {
  const next = people.slice();
  while (next.length < count) next.push(emptyPersonDiet());
  return next;
}

// ---------------------------------------------------------------------------
// Panel: resumen para el catering
// ---------------------------------------------------------------------------

export type DietCounts = Record<DietTag, number>;
const zeroCounts = (): DietCounts => ({ celiaquia: 0, lactosa: 0, "frutos-secos": 0, embarazada: 0, vegetariano: 0, vegano: 0 });

const TEXT_TO_TAG = new Map<string, HealthTag>(HEALTH_TAGS.map((tag) => [HEALTH_NOTE_TEXT[tag], tag]));
const SEGMENT = /^([^:;]{1,80}): (.+)$/;

/**
 * Casillas de salud de una nota con la forma del formulario (una persona por
 * tramo «Nombre: a, b»). `details`: la nota dice algo más que esas casillas
 * («Otra», o una nota escrita a mano, sin esa forma): no se adivina nada de un
 * texto libre, se avisa de que hay que leerla.
 */
export function healthTagsFromNote(note: string | null | undefined): { counts: Record<HealthTag, number>; details: boolean } {
  const counts: Record<HealthTag, number> = { celiaquia: 0, lactosa: 0, "frutos-secos": 0, embarazada: 0 };
  const text = (note ?? "").trim();
  if (!text) return { counts, details: false };
  const segments = text.split("; ").map((segment) => SEGMENT.exec(segment));
  if (segments.some((match) => !match)) return { counts, details: true };
  let details = false;
  for (const match of segments) {
    const seen = new Set<HealthTag>();
    for (const item of match![2]!.split(", ")) {
      const tag = TEXT_TO_TAG.get(item.trim());
      if (tag) seen.add(tag);
      else details = true;
    }
    for (const tag of seen) counts[tag]++;
  }
  return { counts, details };
}

export interface DietSummary {
  counts: DietCounts;
  /** Notas que dicen algo más que las casillas («Otra» o escritas a mano): se leen en la tabla. */
  withDetails: number;
}

/**
 * Totales de quien viene: casillas de salud (de la nota) y preferencias (de
 * las respuestas). `rows` = solo los que vienen.
 */
export function summarizeDiet(rows: ReadonlyArray<{ notes: string | null; answers: { diet?: Partial<Record<DietPreference, number>> } | null }>): DietSummary {
  const counts = zeroCounts();
  let withDetails = 0;
  for (const row of rows) {
    const parsed = healthTagsFromNote(row.notes);
    for (const tag of HEALTH_TAGS) counts[tag] += parsed.counts[tag];
    if (parsed.details) withDetails++;
    for (const pref of DIET_PREFERENCES) counts[pref] += Math.max(0, row.answers?.diet?.[pref] ?? 0);
  }
  return { counts, withDetails };
}

const SUMMARY_TEXT: Record<DietTag, (n: number) => string> = {
  celiaquia: (n) => `${n} sin gluten`,
  lactosa: (n) => `${n} sin lactosa`,
  "frutos-secos": (n) => `${n} sin frutos secos`,
  vegetariano: (n) => (n === 1 ? "1 vegetariano" : `${n} vegetarianos`),
  vegano: (n) => (n === 1 ? "1 vegano" : `${n} veganos`),
  embarazada: (n) => (n === 1 ? "1 embarazada" : `${n} embarazadas`),
};
const SUMMARY_ORDER: readonly DietTag[] = ["celiaquia", "lactosa", "frutos-secos", "vegetariano", "vegano", "embarazada"];

/** «3 sin gluten · 2 vegetarianos»; vacío si nadie marcó nada. */
export function dietSummaryText(counts: Partial<DietCounts>): string {
  return SUMMARY_ORDER.filter((tag) => (counts[tag] ?? 0) > 0).map((tag) => SUMMARY_TEXT[tag](counts[tag]!)).join(" · ");
}

/** Resumen de una sola invitación (celda del CSV); vacío si no marcó nada. */
export function guestDietSummary(notes: string | null | undefined, answers: { diet?: Partial<Record<DietPreference, number>> } | null | undefined): string {
  return dietSummaryText(summarizeDiet([{ notes: notes ?? null, answers: answers ?? null }]).counts);
}
