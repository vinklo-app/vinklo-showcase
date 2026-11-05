/**
 * Slug público de una boda (/b/[slug]). Inmutable una vez creado (trigger
 * weddings_slug_immutable), así que lo que no deba poder salir se filtra aquí.
 */

/**
 * Nunca se asignan a una boda nueva: `ana-y-luis` (la boda de ejemplo; su
 * /b/ana-y-luis redirige a /demo en next.config) y las palabras de rutas o
 * de marca que confundirían en un enlace compartido.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "ana-y-luis",
  "demo", "crear", "panel", "login", "onboarding", "borrador", "unirse",
  "b", "v", "api", "admin", "auth", "og",
  "precios", "preguntas", "guias", "privacidad", "terminos", "aviso-legal",
  "vinklo",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/** "José María" → "jose-maria"; ñ/acentos transliterados. */
export function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Base del slug con el primer nombre de cada miembro y la fecha: "ana-y-luis-12-06-2027". */
export function buildBaseSlug(name1: string, name2: string, date: string): string {
  const first = slugifyName(name1).split("-")[0] || "novia";
  const second = slugifyName(name2).split("-")[0] || "novio";
  const [year, month, day] = date.split("-");
  return `${`${first}-y-${second}`.slice(0, 44)}-${day}-${month}-${year}`;
}

/**
 * Candidato número `attempt` (1 = la base, luego `-2`, `-3`…) o null si está
 * reservado. Con la fecha al final hoy no puede coincidir con ninguno: es una
 * defensa por si la base cambia.
 */
export function slugCandidate(base: string, attempt: number): string | null {
  const candidate = attempt === 1 ? base : `${base}-${attempt}`;
  return isReservedSlug(candidate) ? null : candidate;
}
