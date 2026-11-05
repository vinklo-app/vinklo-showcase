/**
 * Explicación corta por mesa de una propuesta (mesas con IA, 9-oct-2026):
 * «por qué esta gente va junta». Puro (cliente y servidor).
 *
 * PRIVACIDAD: lo único que puede salir hacia la IA es `ExplainTable`:
 * un alias de mesa («m1»), y por cada grupo su tamaño, sus etiquetas y su
 * lado. Nunca nombres, notas, alergias, acompañantes ni ids reales.
 * `explainTablesSchema` es estricto (rechaza cualquier campo de más) y el
 * servidor lo vuelve a validar antes de construir el prompt.
 *
 * Si la IA no está, falla o se limita, se usa `templateExplanation`
 * (determinista), que es también lo que se ve mientras llega la de la IA.
 */
import { z } from "zod";
import { GUEST_SIDES, type GuestSide } from "@/lib/crm/tags";
import type { AutoSeatGuest, AutoSeatResult } from "@/lib/crm/auto-seating";

export const EXPLAIN_MAX_TABLES = 120;
export const EXPLAIN_MAX_GROUPS = 40;
export const EXPLAIN_TEXT_MAX = 160;

export interface ExplainGroup {
  /** Personas del grupo (o del invitado suelto con sus acompañantes). */
  size: number;
  tags: string[];
  side: GuestSide | null;
}

export interface ExplainTable {
  /** Alias de la mesa en esta petición («m1», «m2»…): nunca el id real ni el nombre. */
  tableId: string;
  groups: ExplainGroup[];
  /** Etiquetas que más personas comparten (hasta 2). */
  dominantTags: string[];
  /** Lados presentes. */
  sides: GuestSide[];
}

/**
 * Etiquetas que delatan salud, dieta o discapacidad (datos sensibles, RGPD
 * art. 9): nunca viajan a la IA. Sin distinguir mayúsculas ni acentos.
 */
const SENSITIVE_TAG = /(alerg|celiac|intoler|vegan|vegetar|diabet|embaraz|gluten|lactos|medic|enferm|discapac)/;
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const isSensitiveTag = (tag: string): boolean => SENSITIVE_TAG.test(plain(tag));
export const withoutSensitiveTags = (tags: readonly string[]): string[] => tags.filter((tag) => !isSensitiveTag(tag));

/** Mesas sin etiquetas sensibles (ni en los grupos ni entre las dominantes). */
export function stripSensitiveTags(tables: readonly ExplainTable[]): ExplainTable[] {
  return tables.map((table) => ({
    ...table,
    groups: table.groups.map((group) => ({ ...group, tags: withoutSensitiveTags(group.tags) })),
    dominantTags: withoutSensitiveTags(table.dominantTags),
  }));
}

const tagSchema = z.string().trim().min(1).max(30);
export const explainGroupSchema = z.strictObject({
  size: z.number().int().min(1).max(30),
  tags: z.array(tagSchema).max(8),
  side: z.enum(GUEST_SIDES).nullable(),
});
export const explainTableSchema = z.strictObject({
  tableId: z.string().regex(/^m\d{1,3}$/),
  groups: z.array(explainGroupSchema).min(1).max(EXPLAIN_MAX_GROUPS),
  dominantTags: z.array(tagSchema).max(2),
  sides: z.array(z.enum(GUEST_SIDES)).max(3),
});
export const explainTablesSchema = z.array(explainTableSchema).min(1).max(EXPLAIN_MAX_TABLES);

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function topTags(groups: readonly ExplainGroup[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const group of groups) for (const tag of group.tags) counts.set(tag, (counts.get(tag) ?? 0) + group.size);
  return [...counts].sort((a, b) => b[1] - a[1] || byText(a[0].toLocaleLowerCase("es"), b[0].toLocaleLowerCase("es"))).slice(0, limit).map(([tag]) => tag);
}

/**
 * Datos anónimos de cada mesa que la propuesta toca (las que reciben a
 * alguien; no la mesa infantil, que lleva su frase fija). Devuelve también el
 * mapa alias → id real, que nunca sale del navegador.
 */
export function buildExplainTables(guests: readonly AutoSeatGuest[], result: AutoSeatResult, includePending: boolean): { tables: ExplainTable[]; aliases: Map<string, string> } {
  const finalTable = new Map<string, string | null>();
  for (const guest of guests) finalTable.set(guest.id, guest.tableId);
  for (const item of result.assignments) finalTable.set(item.guestId, item.tableId);
  const comes = (guest: AutoSeatGuest) => guest.status === "si" || (includePending && guest.status === "pendiente");

  const tables: ExplainTable[] = [];
  const aliases = new Map<string, string>();
  for (const table of result.tables) {
    if (table.added === 0 || table.kids) continue;
    const members = guests.filter((guest) => comes(guest) && finalTable.get(guest.id) === table.tableId).sort((a, b) => byText(a.id, b.id));
    if (members.length === 0) continue;
    const byGroup = new Map<string, AutoSeatGuest[]>();
    const groups: ExplainGroup[] = [];
    const toGroup = (list: AutoSeatGuest[]): ExplainGroup => {
      const sides = new Map<GuestSide, number>();
      for (const member of list) if (member.side) sides.set(member.side, (sides.get(member.side) ?? 0) + 1);
      const side = [...sides].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0]?.[0] ?? null;
      const tags = withoutSensitiveTags([...new Set(list.flatMap((member) => member.tags))]).sort(byText).slice(0, 8);
      return { size: Math.min(30, list.reduce((sum, member) => sum + Math.max(1, member.seats), 0)), tags, side };
    };
    for (const member of members) {
      if (member.group) byGroup.set(member.group, [...(byGroup.get(member.group) ?? []), member]);
      else groups.push(toGroup([member]));
    }
    for (const [, list] of [...byGroup].sort((a, b) => byText(a[0], b[0]))) groups.push(toGroup(list));
    groups.sort((a, b) => b.size - a.size || byText(a.tags.join("|"), b.tags.join("|")) || byText(a.side ?? "", b.side ?? ""));
    const alias = `m${tables.length + 1}`;
    aliases.set(alias, table.tableId);
    const trimmed = groups.slice(0, EXPLAIN_MAX_GROUPS);
    tables.push({
      tableId: alias,
      groups: trimmed,
      dominantTags: topTags(trimmed, 2),
      sides: [...new Set(trimmed.flatMap((group) => (group.side ? [group.side] : [])))].sort(byText),
    });
    if (tables.length >= EXPLAIN_MAX_TABLES) break;
  }
  return { tables, aliases };
}

export type SideNames = Record<GuestSide, string>;

/** «de Lucía», «de Juan», «de los dos». */
export function sideNames(partner1: string, partner2: string): SideNames {
  return { p1: `de ${partner1.trim() || "uno de los dos"}`, p2: `de ${partner2.trim() || "uno de los dos"}`, ambos: "de los dos" };
}

const groupsText = (n: number) => (n === 1 ? "un grupo" : `${n} grupos`);

/** Frase determinista para una mesa (sin IA). */
export function templateExplanation(table: ExplainTable, sides: SideNames): string {
  const groups = table.groups;
  const people = groups.reduce((sum, group) => sum + group.size, 0);
  const main = table.dominantTags[0];
  if (main) {
    const sharing = groups.filter((group) => group.tags.includes(main));
    if (groups.length === 1) return `Un grupo de ${people} que no se separa, con la etiqueta «${main}».`;
    if (sharing.length === groups.length) return `Juntamos ${groupsText(groups.length)} que comparten «${main}».`;
    const second = table.dominantTags[1];
    return second
      ? `La mayoría comparte «${main}»; el resto, «${second}» u otras afinidades.`
      : `La mayoría comparte «${main}»; completamos con quien encaja por lado o por sitio libre.`;
  }
  if (table.sides.length === 1) {
    const side = sides[table.sides[0]!];
    return groups.length === 1
      ? `Un grupo de ${people} invitados ${side}, sin separarlo.`
      : `Sin etiquetas en común: juntamos a invitados ${side}.`;
  }
  if (table.sides.length > 1) return "Sin etiquetas en común: juntamos a invitados de los dos lados para completar la mesa.";
  return groups.length === 1
    ? `Un grupo de ${people} que no se separa.`
    : "Sin etiquetas ni lado: cada grupo va entero y completamos con quien cabe.";
}

/** Frase fija de la mesa infantil. */
export const KIDS_TABLE_EXPLANATION = "Los niños con nombre, juntos en su mesa (los hermanos, al lado).";

/**
 * Último filtro (servidor) de una frase del modelo: una línea, sin enlaces,
 * correos ni marcas (salvo {p1}/{p2}), y tope de longitud. null = descartarla
 * (se usa la plantilla). Los nombres de la pareja los pone el navegador
 * (`withPartnerNames`): nunca viajan a la IA.
 */
export function cleanExplanation(text: unknown): string | null {
  if (typeof text !== "string") return null;
  let clean = text.replace(/\s+/g, " ").trim();
  if (!clean || /https?:|www\.|@/i.test(clean)) return null;
  if (/[<>]/.test(clean) || /[{}]/.test(clean.replace(/\{p[12]\}/g, ""))) return null;
  if (clean.length > EXPLAIN_TEXT_MAX) clean = `${clean.slice(0, EXPLAIN_TEXT_MAX - 1).replace(/\s+\S*$/, "")}…`;
  return clean;
}

/** {p1}/{p2} → nombres de la pareja. */
export function withPartnerNames(text: string, partner1: string, partner2: string): string {
  return text.replace(/\{p1\}/g, partner1.trim() || "uno de los dos").replace(/\{p2\}/g, partner2.trim() || "uno de los dos");
}
