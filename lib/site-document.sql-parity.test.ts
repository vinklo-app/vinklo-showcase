/**
 * Paridad del contrato SiteDocument entre sus dos validadores (P0-2 de la
 * revisión de código del 14-oct-2026):
 *   - Zod: `siteDocumentSchema` / `parseSiteDocument` (lib/site-document.ts).
 *   - SQL: `public.site_document_issue`, redefinida por completo en cada
 *     migración que toca el contrato (la vigente es la ÚLTIMA por nombre de
 *     archivo, que es el orden en que se aplican: scripts/test-sql.sh).
 *
 * Si añades una paleta, apertura, maqueta, tipo de escena o clave raíz en
 * Zod y no escribes la migración que redefine `site_document_issue` (o al
 * revés), este test falla antes del despliegue: sin ella, publicar daría
 * «unknown_key»/«palette»… a parejas reales.
 *
 * Dos capas:
 *   1. Estática: extrae del cuerpo SQL vigente las listas y los límites y los
 *      compara con las constantes de TypeScript.
 *   2. De comportamiento: el corpus tests/contract/site-document-cases.json
 *      lo valida Zod aquí y el SQL en tests/sql/site-document-parity.sql
 *      (job `sql` de CI); ambos deben coincidir con `valid` en cada caso.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SCENE_TYPES,
  SITE_DOCUMENT_MAX_BYTES,
  SITE_LAYOUT_IDS,
  SITE_LOCALE,
  SITE_MAX_SCENES,
  SITE_OPENING_IDS,
  SITE_PALETTE_IDS,
  SITE_SCHEMA_VERSION,
  SITE_TEMPLATE_ID,
  SITE_TEMPLATE_VERSION,
  SITE_THEME_IDS,
  STORY_SECONDS_MAX,
  STORY_SECONDS_MIN,
  parseSiteDocument,
  sceneSchema,
  siteDocumentSchema,
  type SceneType,
} from "./site-document";

const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const CASES_FILE = fileURLToPath(new URL("../tests/contract/site-document-cases.json", import.meta.url));
const DEFINITION = "create or replace function public.site_document_issue(";

/** Cuerpo de la última definición de site_document_issue (última migración que la define). */
function currentSqlDefinition(): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(MIGRATIONS_DIR + file, "utf8");
    const start = sql.toLowerCase().lastIndexOf(DEFINITION);
    if (start === -1) continue;
    const end = sql.indexOf("$$;", start);
    if (end === -1) throw new Error(`${file}: definición de site_document_issue sin cierre $$;`);
    found = { file, body: sql.slice(start, end) };
  }
  if (!found) throw new Error("Ninguna migración define public.site_document_issue");
  return found;
}

const { file: SQL_FILE, body: SQL } = currentSqlDefinition();

function match(re: RegExp, what: string): RegExpMatchArray {
  const m = SQL.match(re);
  if (!m) throw new Error(`${SQL_FILE}: no encuentro ${what} (${re}). Si cambió la forma del SQL, adapta este test.`);
  return m;
}
/** `'a', 'b'` → [a, b]; `'"a"', '"b"'` (literales jsonb) → [a, b]. */
function sqlList(raw: string): string[] {
  return [...raw.matchAll(/'"?([^'"]*)"?'/g)].map((m) => m[1]!);
}
/** Lista de valores permitidos de una clave raíz: `(p_doc -> 'clave') in (...)`. */
function rootEnum(key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sqlList(match(new RegExp(`\\(p_doc -> '${escaped}'\\) in\\s*\\(([^)]*)\\)`), `la lista de ${key}`)[1]!);
}
const sorted = (xs: readonly string[]) => [...xs].sort();

describe(`Contrato SiteDocument: Zod ↔ SQL (${SQL_FILE})`, () => {
  it("claves raíz permitidas", () => {
    const sql = sqlList(match(/jsonb_object_keys\(p_doc\) k\s+where k not in \(([^)]*)\)/, "las claves raíz")[1]!);
    expect(sorted(sql)).toEqual(sorted(Object.keys(siteDocumentSchema.shape)));
  });

  it("claves de escena permitidas", () => {
    const sql = sqlList(match(/jsonb_object_keys\(v_scene\) k where k not in \(([^)]*)\)/, "las claves de escena")[1]!);
    for (const option of sceneSchema.options) {
      expect(sorted(sql), `escena ${option.shape.type.value}`).toEqual(sorted(Object.keys(option.shape)));
    }
  });

  it("literales: schemaVersion, templateId, templateVersion y locale", () => {
    expect(Number(match(/\(p_doc -> 'schemaVersion'\) is distinct from '(\d+)'::jsonb/, "schemaVersion")[1])).toBe(SITE_SCHEMA_VERSION);
    expect(match(/\(p_doc -> 'templateId'\) is distinct from '"([^"]+)"'::jsonb/, "templateId")[1]).toBe(SITE_TEMPLATE_ID);
    expect(Number(match(/\(p_doc -> 'templateVersion'\) is distinct from '(\d+)'::jsonb/, "templateVersion")[1])).toBe(SITE_TEMPLATE_VERSION);
    expect(match(/\(p_doc -> 'locale'\) is distinct from '"([^"]+)"'::jsonb/, "locale")[1]).toBe(SITE_LOCALE);
  });

  it("catálogos: temas, paletas, aperturas y maquetas", () => {
    expect(sorted(rootEnum("themeId"))).toEqual(sorted(SITE_THEME_IDS));
    expect(sorted(rootEnum("palette"))).toEqual(sorted(SITE_PALETTE_IDS));
    expect(sorted(rootEnum("opening"))).toEqual(sorted(SITE_OPENING_IDS));
    expect(sorted(rootEnum("layout"))).toEqual(sorted(SITE_LAYOUT_IDS));
  });

  it("tipos de escena: los del SQL = SCENE_TYPES = la unión discriminada de Zod", () => {
    const sql = sqlList(match(/v_type not in \(([^)]*)\)/, "los tipos de escena")[1]!);
    expect(sorted(sql)).toEqual(sorted(SCENE_TYPES));
    expect(sorted(sceneSchema.options.map((o) => o.shape.type.value))).toEqual(sorted(SCENE_TYPES));
  });

  it("escenas únicas: duplicarla falla en Zod si y solo si el SQL la declara única", () => {
    const singletons = new Set(sqlList(match(/if v_type in \(([^)]*)\) then/, "las escenas únicas")[1]!));
    const cover = { id: "portada", type: "cover", props: {} };
    for (const type of SCENE_TYPES as readonly SceneType[]) {
      const twice = type === "cover"
        ? [cover, { id: "portada-2", type, props: {} }]
        : [cover, { id: `${type}-a`, type, props: {} }, { id: `${type}-b`, type, props: {} }];
      const ok = parseSiteDocument({ schemaVersion: 1, templateId: "papel-calido", templateVersion: 1, scenes: twice }).ok;
      expect(ok, `«${type}» repetida`).toBe(!singletons.has(type));
    }
  });

  it("número de escenas y segundos de la Story", () => {
    const [, min, max] = match(/v_count < (\d+) or v_count > (\d+)/, "los límites de escenas");
    expect(Number(min)).toBe(1);
    expect(Number(max)).toBe(SITE_MAX_SCENES);
    const [, lo, hi] = match(/'storySeconds'\)::integer not between (\d+) and (\d+)/, "los límites de storySeconds");
    expect([Number(lo), Number(hi)]).toEqual([STORY_SECONDS_MIN, STORY_SECONDS_MAX]);
  });

  it("identificador de escena: la expresión del SQL acepta lo mismo que Zod", () => {
    const sqlRe = new RegExp(match(/\(v_scene ->> 'id'\) !~ '([^']+)'/, "la expresión del id")[1]!);
    const samples = ["ab", "lugar", "a-1", "a".repeat(40), "a", "a".repeat(41), "1a", "Lugar", "a_b", "-a", "a b", ""];
    for (const id of samples) {
      const zodOk = parseSiteDocument({ schemaVersion: 1, templateId: "papel-calido", templateVersion: 1, scenes: [{ id: "portada", type: "cover", props: {} }, { id, type: "venue", props: {} }] }).ok;
      expect(sqlRe.test(id), `id ${JSON.stringify(id)}`).toBe(zodOk);
    }
  });

  it("tamaño: el límite SQL nunca es más estricto que el de Zod", () => {
    // El SQL mide jsonb::text (con espacios tras «:» y «,»), así que su
    // límite debe dejar holgura sobre SITE_DOCUMENT_MAX_BYTES.
    const sqlMax = Number(match(/octet_length\(p_doc::text\) > (\d+)/, "el límite de tamaño")[1]);
    expect(sqlMax).toBeGreaterThanOrEqual(SITE_DOCUMENT_MAX_BYTES);
  });
});

type ContractCase = { name: string; valid: boolean; doc: unknown };
const corpus = JSON.parse(readFileSync(CASES_FILE, "utf8")) as { cases: ContractCase[] };

describe("Corpus compartido del contrato (tests/contract/site-document-cases.json)", () => {
  it("tiene casos válidos e inválidos", () => {
    expect(corpus.cases.some((c) => c.valid)).toBe(true);
    expect(corpus.cases.some((c) => !c.valid)).toBe(true);
    expect(new Set(corpus.cases.map((c) => c.name)).size).toBe(corpus.cases.length);
  });
  it.each(corpus.cases.map((c) => [c.name, c] as const))("Zod: %s", (_name, c) => {
    expect(parseSiteDocument(c.doc).ok).toBe(c.valid);
  });
});
